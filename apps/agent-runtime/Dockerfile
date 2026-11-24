# Independent execution runtime. Business helpers remain provider-owned skill resources.
ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm@sha256:2559be987fd64d61badbdafd303ea58a9ccab36d6c3c08bce219e762177d2eca
FROM ${NODE_RUNTIME_IMAGE} AS node-runtime
FROM ${NODE_BUILDER_IMAGE} AS sandbox-builder
# Optional URL prefixes tried before GitHub for pinned downloads (tools/github-download.sh).
ARG GITHUB_DOWNLOAD_PROXIES=
COPY sandbox-policy/build-nsjail.sh sandbox-policy/sources.lock /sandbox-policy/
RUN --mount=type=bind,source=tools/github-download.sh,target=/tmp/github-download.sh \
    apt-get update && apt-get install -y --no-install-recommends \
      bison flex libprotobuf-dev protobuf-compiler libnl-route-3-dev pkg-config \
 && /bin/sh /sandbox-policy/build-nsjail.sh

FROM ${NODE_BUILDER_IMAGE} AS codex-builder
ARG TARGETARCH
ARG GITHUB_DOWNLOAD_PROXIES=
# Keep the repository layout that install.sh uses to find the download helper.
COPY codex/ /codex-source/apps/agent-runtime/codex/
COPY tools/github-download.sh /codex-source/scripts/github-download.sh
RUN sh /codex-source/apps/agent-runtime/codex/install.sh "$TARGETARCH" /codex

FROM ${NODE_RUNTIME_IMAGE} AS dependencies
RUN npm install -g pnpm@9.15.9
ENV npm_config_store_dir=/pnpm/store
COPY sources/ /src/
COPY inputs.json /inputs.json
COPY tools/ /tmp/tools/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store node /tmp/tools/workbench/install-runtime.mjs

FROM ${NODE_BUILDER_IMAGE} AS payload
ARG TARGETPLATFORM
RUN npm install -g pnpm@9.15.9
ENV npm_config_store_dir=/pnpm/store
COPY sources/ /build/workspace/
WORKDIR /build/workspace/ontomato
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY workspace/ /build/workspace/
COPY inputs.json /inputs.json
COPY tools/ /tmp/tools/
RUN TARGETPLATFORM=${TARGETPLATFORM} node /tmp/tools/workbench/stage-app.mjs
# Keep the frozen PI CLI and the image-resize worker's external package under
# /usr, which is visible inside the sandbox. PI's CLI and SDK are bundled.
RUN pi=packages/agent-runtime/node_modules/@earendil-works/pi-coding-agent \
 && photon="$(cd packages/agent-runtime && node --input-type=module -e 'import { createRequire } from "node:module"; import { dirname } from "node:path"; console.log(dirname(createRequire(import.meta.resolve("@earendil-works/pi-coding-agent")).resolve("@silvia-odwyer/photon-node")))' )" \
 && mkdir -p /pi/node_modules/@earendil-works /pi/node_modules/@silvia-odwyer \
 && cp -LR "$pi" /pi/node_modules/@earendil-works/ \
 && cp -LR "$photon" /pi/node_modules/@silvia-odwyer/ \
 && cp packages/agent-runtime/src/adapters/pi/import.mjs packages/agent-runtime/src/adapters/pi/extension.mjs /pi/ \
 && node /pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js --version | grep -Fx 1.4.0
RUN mkdir /codex-launcher \
 && cp packages/agent-runtime/src/adapters/codex/launch.mjs packages/agent-runtime/src/adapters/codex/config.toml \
       packages/agent-runtime/src/adapters/codex/model-template.json /codex-launcher/
COPY LICENSE NOTICE /stage/licenses/
FROM ${PYTHON_RUNTIME_IMAGE} AS python-runtime
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
COPY requirements-py310.txt /tmp/requirements-py310.txt
# Install from the optional Debian mirror, restore the base sources afterwards,
# and retry once from those original sources if the mirror install fails.
RUN --mount=type=bind,source=tools/apt-install.sh,target=/tmp/apt-install.sh \
    /bin/sh /tmp/apt-install.sh "${DEBIAN_MIRROR}" "${DEBIAN_SECURITY_MIRROR}" libstdc++6 git \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir --no-deps -i "${PIP_INDEX_URL}" -r /tmp/requirements-py310.txt \
 && pip check && python -c "import requests, numpy, pandas, sympy, litellm, starlette, uvicorn"
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/LICENSE /usr/local/share/node/LICENSE
COPY --from=dependencies /tmp/npm-licenses.json /tmp/npm-licenses.json
COPY tools/third_party_notices.py /tmp/third_party_notices.py
# Scan the installed Python environment and mount the npm production closure whose paths the report contains.
RUN --mount=type=bind,from=dependencies,source=/opt/runtime,target=/opt/runtime \
    python /tmp/third_party_notices.py /runtime-notices.txt --python --npm /tmp/npm-licenses.json <<'EOF'
Node.js: /usr/local/share/node/LICENSE
Python interpreter and standard library: /usr/local/lib/python3.10/LICENSE.txt
Debian packages: /usr/share/doc/<package>/copyright
PI CLI 1.4.0 (https://github.com/earendil-works/pi/releases/tag/v1.4.0): /app/licenses/pi-MIT.txt
Codex CLI 0.171.0 (https://github.com/openai/codex/releases/tag/rust-v0.171.0): /app/licenses/codex-Apache-2.0.txt
EOF
RUN rm -rf /usr/local/lib/python3.10/site-packages/pip* /usr/local/lib/python3.10/site-packages/setuptools* /usr/local/lib/python3.10/site-packages/pkg_resources /usr/local/bin/pip* \
 && node --version && python -c "import requests, numpy, pandas, sympy, litellm, starlette, uvicorn" \
 && ! python -m pip --version

FROM python-runtime AS final
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
# Install from the optional Debian mirror, restore the base sources afterwards,
# and retry once from those original sources if the mirror install fails.
RUN --mount=type=bind,source=tools/apt-install.sh,target=/tmp/apt-install.sh \
    /bin/sh /tmp/apt-install.sh "${DEBIAN_MIRROR}" "${DEBIAN_SECURITY_MIRROR}" fonts-wqy-microhei fonts-dejavu-core socat=1.7.4.4-2 iproute2=6.1.0-3 \
 && rm -rf /var/lib/apt/lists/*
# LiteLLM reads its own bundled model metadata instead of fetching it: startup never needs the network.
ENV NODE_ENV=production AGENT_RUNTIME_HOST=0.0.0.0 AGENT_RUNTIME_ROOT=/data LITELLM_LOCAL_MODEL_COST_MAP=true
COPY --from=dependencies /opt/runtime/node_modules /opt/runtime/node_modules
COPY --from=payload /stage/ /app/
COPY --from=payload /pi/ /usr/local/lib/ontomato-pi/
COPY --from=codex-builder /codex/ /usr/local/lib/ontomato-codex/
COPY --from=payload /codex-launcher/ /usr/local/lib/ontomato-codex/
COPY codex/LICENSE /app/licenses/codex-Apache-2.0.txt
COPY codex/NOTICE /app/licenses/codex-NOTICE.txt
COPY codex/sources.lock /app/licenses/codex-sources.lock
LABEL io.ontomato.agent-runtime.codex="0.171.0"
COPY --from=payload /stage/packages/agent-runtime/src/adapters/pi/UPSTREAM-LICENSE /app/licenses/pi-MIT.txt
COPY --from=python-runtime /runtime-notices.txt /app/licenses/THIRD_PARTY_NOTICES.txt
COPY requirements-py310.txt /app/licenses/python-requirements.txt
COPY --from=sandbox-builder /output/nsjail /usr/local/sbin/nsjail
COPY --from=sandbox-builder /output/licenses/ /app/licenses/
COPY sandbox-policy/sources.lock /app/licenses/sandbox-sources.lock
COPY sandbox-policy/debian-packages.lock /app/licenses/sandbox-debian-sources.lock
COPY sandbox-policy/seccomp.json sandbox-policy/apparmor sandbox-policy/ontomato-agent-runtime.cil \
     sandbox-policy/entrypoint.sh sandbox-policy/engine.py sandbox-policy/preflight.mjs sandbox-policy/probe.py /usr/local/lib/ontomato-sandbox/
RUN sha256sum /usr/local/sbin/nsjail /usr/bin/socat /usr/sbin/ip > /app/licenses/sandbox-binaries.sha256 \
 && dpkg-query -W socat iproute2 > /app/licenses/sandbox-debian-packages.txt \
 && cp /usr/share/doc/socat/copyright /app/licenses/socat.txt \
 && cp /usr/share/doc/iproute2/copyright /app/licenses/iproute2.txt
COPY tools/workbench/runtime-layout.mjs /tmp/runtime-layout.mjs
RUN node -e 'import("/tmp/runtime-layout.mjs").then(m => m.checkNoBrokenSymlinks("/app"))' && rm /tmp/runtime-layout.mjs && mkdir /data
LABEL org.opencontainers.image.source="https://github.com/ontomato-ai/Ontomato"
WORKDIR /app/apps/agent-runtime
# Import the assembled production graph without starting the service or contacting PostgreSQL.
RUN node --import tsx --input-type=module -e 'await import("@ontomato/agent-runtime")' \
 && python -c "import requests, numpy, pandas, sympy, litellm" \
 && ! command -v chromium && ! command -v chromium-browser
# Root is the supervisor only; worker-launch.py drops each worker to a distinct non-root UID.
RUN rm -f /runtime-notices.txt /tmp/npm-licenses.json /tmp/third_party_notices.py /tmp/requirements-py310.txt
USER 0:0
EXPOSE 3001
ENTRYPOINT ["/bin/sh", "/usr/local/lib/ontomato-sandbox/entrypoint.sh"]
CMD ["node", "--import", "tsx", "src/index.ts"]

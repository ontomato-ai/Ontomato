# Independent execution runtime. Business helpers remain provider-owned skill resources.
ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
ARG PYTHON_RUNTIME_IMAGE=docker.io/library/python:3.10-slim-bookworm@sha256:2559be987fd64d61badbdafd303ea58a9ccab36d6c3c08bce219e762177d2eca
FROM ${NODE_RUNTIME_IMAGE} AS node-runtime
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
COPY workspace/ /build/workspace/
COPY inputs.json /inputs.json
COPY tools/ /tmp/tools/
WORKDIR /build/workspace/ontomato
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN TARGETPLATFORM=${TARGETPLATFORM} node /tmp/tools/workbench/stage-app.mjs
COPY LICENSE NOTICE /stage/licenses/
FROM ${PYTHON_RUNTIME_IMAGE} AS python-runtime
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements-py310.txt /tmp/requirements-py310.txt
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir --no-deps -i "${PIP_INDEX_URL}" -r /tmp/requirements-py310.txt \
 && pip check && python -c "import requests, numpy, pandas, sympy"
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
The pi-agent-core fork retains its MIT license in /app/packages/agent-runtime/src/core/pi/LICENSE
EOF
RUN rm -rf /usr/local/lib/python3.10/site-packages/pip* /usr/local/lib/python3.10/site-packages/setuptools* /usr/local/lib/python3.10/site-packages/pkg_resources /usr/local/bin/pip* \
 && node --version && python -c "import requests, numpy, pandas, sympy" \
 && ! python -m pip --version

FROM python-runtime AS final
ENV NODE_ENV=production AGENT_RUNTIME_HOST=0.0.0.0 AGENT_RUNTIME_ROOT=/data
COPY --from=dependencies /opt/runtime/node_modules /opt/runtime/node_modules
COPY --from=payload /stage/ /app/
COPY --from=python-runtime /runtime-notices.txt /app/licenses/THIRD_PARTY_NOTICES.txt
COPY requirements-py310.txt /app/licenses/python-requirements.txt
COPY tools/workbench/runtime-layout.mjs /tmp/runtime-layout.mjs
RUN node -e 'import("/tmp/runtime-layout.mjs").then(m => m.checkNoBrokenSymlinks("/app"))' && rm /tmp/runtime-layout.mjs && mkdir /data
WORKDIR /app/apps/agent-runtime
# Import the assembled production graph without starting the service or contacting PostgreSQL.
RUN node --import tsx --input-type=module -e 'await import("@ontomato/agent-runtime")' \
 && python -c "import requests, numpy, pandas, sympy" \
 && ! command -v chromium && ! command -v chromium-browser
# Root is the supervisor only; worker-launch.py drops each worker to a distinct non-root UID.
RUN rm -f /runtime-notices.txt /tmp/npm-licenses.json /tmp/third_party_notices.py /tmp/requirements-py310.txt
USER 0:0
EXPOSE 3001
CMD ["node", "--import", "tsx", "src/index.ts"]

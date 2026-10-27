# Independent Node runtime. The production closure contains no workbench or Python.
ARG NODE_RUNTIME_IMAGE=docker.io/library/node:24.21.0-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG NODE_BUILDER_IMAGE=docker.io/library/node:24.21.0@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4
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
COPY --from=dependencies /tmp/npm-licenses.json /tmp/npm-licenses.json
# The report's absolute paths refer to the production store, not this stage's dev install.
RUN --mount=type=bind,from=dependencies,source=/opt/runtime,target=/opt/runtime \
    python3 /tmp/tools/third_party_notices.py /stage/licenses/THIRD_PARTY_NOTICES.txt --npm /tmp/npm-licenses.json <<'EOF'
Node.js and standard library: /usr/local/LICENSE
Debian packages: /usr/share/doc/<package>/copyright
The pi-agent-core fork retains its MIT license in /app/packages/agent-runtime/src/core/pi/LICENSE
EOF

FROM ${NODE_RUNTIME_IMAGE} AS final
ENV NODE_ENV=production AGENT_RUNTIME_HOST=0.0.0.0 AGENT_RUNTIME_ROOT=/data
COPY --from=dependencies /opt/runtime/node_modules /opt/runtime/node_modules
COPY --from=payload /stage/ /app/
COPY tools/workbench/runtime-layout.mjs /tmp/runtime-layout.mjs
RUN node -e 'import("/tmp/runtime-layout.mjs").then(m => m.checkNoBrokenSymlinks("/app"))' && rm /tmp/runtime-layout.mjs && mkdir /data
WORKDIR /app/apps/agent-runtime
# Import the assembled production graph without starting the service or contacting PostgreSQL.
RUN node --import tsx --input-type=module -e 'await import("@ontomato/agent-runtime")' \
 && ! command -v python && ! command -v python3 && ! command -v chromium && ! command -v chromium-browser
EXPOSE 3001
CMD ["node", "--import", "tsx", "src/index.ts"]

# Ontomato deployment

Four final images run the workbench, data engine, ontology manager and agent runtime.
PostgreSQL is a fifth service. The site needs Docker Engine 26+, Compose v2 and Python 3.8+.

## Online deployment

```bash
cp .env.example .env
# Set ARCH, POSTGRES_PASSWORD, ONTOMATO_MODEL_RUNTIME_TOKEN and PUBLIC_HOST in .env.
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.ghcr.yml' >> .env
echo 'ONTOMATO_VERSION=<version-and-build-tag>' >> .env
python3 prepare-env.py .env
docker compose pull
docker compose up -d --wait --wait-timeout 600
```

`ONTOMATO_MODEL_RUNTIME_TOKEN` is a random value per deployment (for example
`openssl rand -hex 24`) that the workbench and the data engine share: saved model API keys
are write-only, and the data engine hands them to the workbench encrypted with this value.
Both services refuse to start without it. A deployment created before this setting existed,
including one that follows a tag automatically, must add it to `.env` before taking a
release that requires it.

CI publishes a shared `<version>-ci<run>.<attempt>-g<commit>` tag for all four images,
as well as `edge`, `stable`, release and `latest` aliases. Use the full build tag above so
`docker ps` shows the deployed build. Update `ONTOMATO_VERSION`, then run `python3 prepare-env.py .env`, pull and up. Images come from GHCR. Build
and publication happen before deployment; Compose has no build step.

### Automatic updates (optional)

A development or test deployment that should always follow a tag, usually `edge` or `stable`, can add
`docker-compose.autoupdate.yml` to the end of `COMPOSE_FILE` and run `docker compose up -d`:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.ghcr.yml:docker-compose.autoupdate.yml
ONTOMATO_VERSION=edge
```

This adds a Watchtower container (`nickfedor/watchtower`). Every 5 minutes it checks whether
the tags of the workbench, data engine, ontology manager and agent runtime containers point to new images on
GHCR; if so it pulls them, recreates those containers with their existing configuration and
removes the replaced images. PostgreSQL is not touched, and only this Compose project's
containers are watched. The four images update independently, and changes to the deployment
templates still need a manual update. Keep fixed versions without automatic updates for
production sites.

## Offline delivery

On the connected build host, after CI has published the final images:

```bash
make tools-bundle ARCH=amd64
make bundle ARCH=amd64 VERSION=4.1.1
# Later versions, using the SAME persistent MIRROR_STATE:
make bundle ARCH=amd64 VERSION=<next-version>
```

The default state is `.build/mirror/<arch>`; set `MIRROR_STATE` to a durable path
for production exports. `IMAGE_REGISTRY` and `IMAGE_TAG` select the published
multi-architecture images, and `ARCH` selects the platform inside them.
Either architecture can be exported on either host without emulation: oc-mirror
runs with the Docker engine's own tool image, and the target architecture's tool
image, built by copying only, goes into the independent tool kit.
Each product image is checked for the expected architecture, component and version,
then resolved to an immutable platform digest. `REGISTRY_AUTH_FILE` can point to
an oc-mirror-compatible auth JSON; credentials are never copied into a delivery.

The result is `.build/bundle/ontomato-<version>-<time>-<arch>.tar`, including
this deployment template, `offline/` and `package/`. `package/mirror_*.tar` files
are oc-mirror's own archives and contain only application image content. Every full or
incremental package combines them with the prepared `offline/` tool kit, including
Registry 3.1.2 and oc-mirror 4.22.17. amd64 uses the base-instruction-set binary on UBI 8.
`make tools-bundle` prepares `.build/offline-tools/<arch>` independently of the application
version; `TOOL_BUNDLE` selects an existing kit for final assembly. A new tool kit uses a
new output directory. `tools-export --registry-repository` chooses the repository serving
the pinned Registry digest. Tool images are currently included in full even in increments.
Do not use `docker load` on `mirror_*.tar`.

On the disconnected machine, extract the first bundle and run:

```bash
python3 offline/mirror.py tools-install --bundle offline
python3 offline/mirror.py import --bundle package \
  --state /var/lib/ontomato-mirror --output-env images.env
cp .env.example .env
# Set POSTGRES_PASSWORD, ONTOMATO_MODEL_RUNTIME_TOKEN and PUBLIC_HOST in .env, then append the image references:
cat images.env >> .env
python3 prepare-env.py .env
docker compose pull
docker compose up -d --wait --wait-timeout 600
```

Registry listens only on `127.0.0.1:5000`. The default project is
`ontomato-offline`; `--port` and `--project` can select an isolated instance. The
site's application images are pulled by digest from this local Registry. Like export,
import runs the Docker engine's own oc-mirror and Registry images; on a site these
are the bundled ones.

For updates, extract the new bundle outside the existing deployment directory.
Run its `tools-install` and import commands with the same state directory.
Tool installation only loads tool images; it does not import application images, change
application configuration, restart services or install host Docker/Compose/Python. After successful import,
replace the seven image/version/architecture values in the existing `.env` with
those in `images.env`, then run `python3 prepare-env.py .env`, pull and up. Keep existing secrets, data directories
and database volumes. Import failure leaves the previous `.env` and application
containers untouched. Retain the previous references to select a prior image;
application/database migration compatibility must be considered separately.

## State and recovery

- Keep the connected export state (both cache and `export/working-dir`) and each
  site's import state (cache, incoming working directory and Registry data).
- The export cache defaults to `<state>/cache`. The bundle option `--cache-dir` can
  point several states at one shared download cache: it only supplies blob bytes,
  while which blobs an export archives comes from the state's `export/working-dir` history.
- Successful Registry imports are recorded under the site state's `imports/` directory.
  These receipts do not assert that the application upgrade has completed.
- Copy each completed delivery before the next export: oc-mirror reuses its
  output directory. The wrapper copies archives into the versioned bundle first.
- Deliver increments in export order. A site missing a middle version must import
  the missing archives first. A fresh site or lost cache needs a full delivery:
  export the required version with a NEW empty `MIRROR_STATE`, combined with the prepared tool kit.
- A populated Registry does not replace oc-mirror's local cache. Do not prune or
  delete either history during a delivery chain. Retain packages for recovery.
- This is whole-layer deduplication: changing a file in a large layer transfers
  that whole new layer. It is not a binary patch format. Keep application changes
  separate from stable dependencies in the Dockerfiles.

Official references: [oc-mirror](https://github.com/openshift/oc-mirror),
[Distribution](https://distribution.github.io/distribution/).

## Data and ports

PostgreSQL uses a named volume and is published on loopback port 5432 by default.
Workbench port is 3000, manager 3005 and data engine 18087. Override them in `.env`.
`frontend_data` maps to `/app/data`, `backend_data` to `/deploy`, and
`agent_runtime_data` to the independent runtime’s `/data`. The runtime uses the
`agent_runtime` schema in the `ontomato` database and has no published host port. Initial
`initdb.sql` creates the product databases. Services default to UTC; set `TZ` for
another timezone. This stack does not migrate a pre-existing database.

## Configuration

`prepare-env.py` generates `AGENT_RUNTIME_SERVICE_TOKEN` once (0600 `.env`) on
installation or upgrade. Both Node services reference that same value. Existing
credentials are preserved; retain `.env` and `agent_runtime_data` when updating.
Run this preparation after copying updated deployment templates and before Compose.
The runtime temporarily reads model configuration from Java until that owner is migrated.

Models are normally configured in the UI. To seed new domains, optionally set
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `EMBEDDING_BASE_URL`,
`EMBEDDING_API_KEY`, `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` (default 2048)
in `.env`. Unset means the product default; an explicit empty value stays empty.
Existing domains keep their saved model settings.

For an existing installation, rename the old `BACKEND_` keys for LLM, embedding,
LDAP, company sync, SSO, service/node ID, card URL, data adapter and production
connection by removing that prefix in `.env` **and** its `${...}` placeholders in
`backend_data/conf/application.yml` (locally `apps/data-engine/.dev/conf/application.yml`).
`POSTGRE_USER_NAME` / `POSTGRE_PASSWORD` become `POSTGRES_USER` / `POSTGRES_PASSWORD`;
`POSTGRE_DRIVER_CLASS` becomes `DATA_ENGINE_JDBC_DRIVER`. In `application.yml`, replace
`url: ${POSTGRE_JDBC_URL:}` with the template line
`url: ${DATA_ENGINE_JDBC_URL:jdbc:postgresql://${POSTGRES_HOST:localhost}:${POSTGRES_PORT:5432}/datarag}`;
renaming the placeholder alone leaves the URL empty, because Compose no longer injects one.
Keep customized values and resolve duplicate keys before restarting.
The JDBC override is only needed for a nonstandard database connection; otherwise both
clients use `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.
The workbench retains its own database, and Java retains `datarag`.

To inspect the **running** build, including a deployment tracking `edge`:

```bash
docker inspect --format '{{.Name}} {{index .Config.Labels "org.opencontainers.image.version"}} {{index .Config.Labels "io.ontomato.build"}}' $(docker compose ps -q)
```


## Runtime Python and deployment network policy

Business Python execution runs in the public `ontomato-agent-runtime` image.
Keep the runtime volume and database together when backing up: the volume also
holds the monotonically allocated worker UID state. The production supervisor
must start as root so it can drop each worker to a distinct non-root UID/GID;
starting it as an unprivileged container user rejects isolated executions.
Do not set `NODE_ENV=development` in production. Workers have private workspaces,
read-only provider libraries, rlimits and wall/process-tree cancellation. These
are not filesystem namespaces or aggregate cgroup limits.

Code provides no network isolation. Python/skills can reach addresses reachable
from the runtime container. Allow the required PostgreSQL, workbench callback,
ontology, model-provider and configured external-MCP connections. Site egress
allowlists belong to deployment network policy; this release installs no egress
proxy or host firewall. Stronger process/network isolation is follow-up work.

`prepare-env.py` preserves existing values and generates missing
`AGENT_RUNTIME_SERVICE_TOKEN` (workbench host), `AGENT_RUNTIME_ONTOLOGY_TOKEN`
(ontology host), `ONTOMATO_QUERY_SERVICE_TOKEN` (exploration issuer caller) and
`ONTOMATO_QUERY_SIGNING_KEY` (ontology grant signing). Keep `.env` private.
The runtime image includes pinned Python computation packages and combined
Python/npm notices in `/app/licenses/THIRD_PARTY_NOTICES.txt`.

Saved Function/dashboard code using the retired protocol must be converted in
the pre-release data migration. New generators emit `ontomato-python:2`; there
is no compatibility proxy. The traditional MCP calculator and its startup
Python environment remain until traditional ABC cleanup. Public `ask` supports
explicit same-session replies; automatic next-chat-message routing is batch 3.

Compose sets a stable `NODE_ID` for ontology job recovery. If overridden or deployed
with multiple ontology nodes, use a stable unique ID for each node.

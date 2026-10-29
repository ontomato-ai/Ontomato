#!/bin/bash
# The JVM owns product file synchronization and the data-engine lifecycle.
set -euo pipefail

APP_ROOT=/app
APP_LIB="$APP_ROOT/lib"
RUNTIME_LIB=/opt/datarag/lib
DEPLOY_DIR=/deploy
CONF_DIR="$DEPLOY_DIR/conf"

die() { echo "[entrypoint] $*" >&2; exit 78; }

ls "$APP_LIB"/*.jar >/dev/null 2>&1 || die "no application jar under $APP_LIB"
export ONTOMATO_CONF_DEFAULTS="$APP_ROOT/conf-defaults"
[ -d "$ONTOMATO_CONF_DEFAULTS" ] || die "missing $ONTOMATO_CONF_DEFAULTS"

# The conf directory is on the JVM classpath, so it must exist before the JVM starts;
# ProductFileSync fills it during startup.
mkdir -p "$CONF_DIR"
cd "$DEPLOY_DIR"
echo "[entrypoint] datarag starting"
exec "$JAVA_HOME/bin/java" \
  -Djava.awt.headless=true \
  -Dfile.encoding=UTF-8 \
  "$@" \
  -classpath "$CONF_DIR:$APP_LIB/*:$RUNTIME_LIB/*" \
  io.ontomato.dataengine.RAGMain

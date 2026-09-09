#!/usr/bin/env bash
set -euo pipefail

SOURCE_IMAGE="${1:-awg-control:test}"
PROJECT_NAME="awg-control-lifecycle-test"
COMPOSE_FILE="deploy/compose/compose.yaml"
TEST_DIR="$(mktemp -d)"
MASTER_KEY_PATH="$TEST_DIR/master-key"

cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" ps || true
    docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" logs --no-color --tail 40 panel || true
  fi
  AWG_CONTROL_VERSION="compose-test-upgrade" \
  AWG_CONTROL_PUBLIC_ORIGIN="https://panel.example" \
  AWG_CONTROL_MASTER_KEY_PATH="$MASTER_KEY_PATH" \
    docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TEST_DIR"
  return "$status"
}
trap cleanup EXIT

docker tag "$SOURCE_IMAGE" ghcr.io/mednov-ai/awg-control:compose-test

# Compose file-backed secrets retain their host ownership. Create this disposable
# key as the same unprivileged UID/GID used by Panel so it remains mode 0400.
chmod 0777 "$TEST_DIR"
docker run --rm \
  --volume "$TEST_DIR:/secret" \
  --entrypoint sh \
  "$SOURCE_IMAGE" \
  -c 'umask 077; head -c 32 /dev/urandom > /secret/master-key; chmod 0400 /secret/master-key'
chmod 0700 "$TEST_DIR"

export AWG_CONTROL_VERSION="compose-test"
export AWG_CONTROL_PUBLIC_ORIGIN="https://panel.example"
export AWG_CONTROL_MASTER_KEY_PATH="$MASTER_KEY_PATH"

CONFIG="$(docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" config)"
[[ "$CONFIG" != *"/var/run/docker.sock"* ]]
[[ "$CONFIG" != *"amnezia"* ]]
docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" up --detach

for _ in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:8080/api/v1/health/live >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8080/api/v1/health/live >/dev/null

docker tag "$SOURCE_IMAGE" ghcr.io/mednov-ai/awg-control:compose-test-upgrade
export AWG_CONTROL_VERSION="compose-test-upgrade"
docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" up --detach
curl --retry 20 --retry-delay 1 --retry-connrefused --fail --silent \
  http://127.0.0.1:8080/api/v1/health/live >/dev/null

docker compose --project-name "$PROJECT_NAME" -f "$COMPOSE_FILE" down --volumes --remove-orphans
test -z "$(docker ps --all --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")"
test -z "$(docker volume ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")"
trap - EXIT
rm -rf "$TEST_DIR"
echo "Compose install, upgrade, and uninstall lifecycle passed."

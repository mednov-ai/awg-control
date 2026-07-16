#!/usr/bin/env bash
set -euo pipefail

PANEL_URL="${1:-http://127.0.0.1:8080}"
curl --fail --silent --show-error "$PANEL_URL/api/v1/health/live" >/dev/null
curl --fail --silent --show-error "$PANEL_URL/api/v1/health/ready" >/dev/null
echo "Panel liveness and readiness checks passed."


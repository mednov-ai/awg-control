#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-play-and-say.ru}"
EXPECTED_IP="${2:-89.124.113.223}"
KEY_PATH="${3:-/Users/evgeniymednov/.ssh/play_and_say_vps_ed25519}"

ACTUAL_IP="$(dig +short A "$DOMAIN" | tail -1)"
[[ "$ACTUAL_IP" == "$EXPECTED_IP" ]] || {
  echo "DNS mismatch: expected $EXPECTED_IP, received ${ACTUAL_IP:-none}. Stop." >&2
  exit 1
}
echo "DNS verified: $DOMAIN -> $ACTUAL_IP"
echo "The next command is read-only and does not print VPN configurations or environment values."
ssh -i "$KEY_PATH" -o IdentitiesOnly=yes "root@$EXPECTED_IP" \
  'hostname; systemctl is-active nginx docker k3s; docker ps --format "{{.Names}}|{{.Image}}|{{.Ports}}"'


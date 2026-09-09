#!/usr/bin/env bash
set -euo pipefail

PANEL_DOMAIN="${1:-awg.play-and-say.ru}"
SITE_DOMAIN="${2:-play-and-say.ru}"
EXPECTED_IP="${3:-89.124.107.104}"
KEY_PATH="${4:-/Users/evgeniymednov/.ssh/amnezia_89_124_107_104_ed25519}"

ACTUAL_IP="$(dig +short A "$PANEL_DOMAIN" | tail -1)"
[[ "$ACTUAL_IP" == "$EXPECTED_IP" ]] || {
  echo "DNS mismatch for $PANEL_DOMAIN; expected $EXPECTED_IP and received ${ACTUAL_IP:-none}. Stop." >&2
  exit 1
}
ssh-keygen -F "$EXPECTED_IP" >/dev/null || {
  echo "No pinned SSH host key for $EXPECTED_IP. Verify it out of band before continuing." >&2
  exit 1
}

echo "DNS and pinned SSH host-key entry are present. Running narrow read-only checks."
ssh -i "$KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "root@$EXPECTED_IP" \
  'hostname; systemctl is-active nginx docker k3s; nginx -t; ss -H -ltn "sport = :8080"; docker ps --format "{{.Names}}|{{.Image}}|{{.Ports}}|{{.Status}}"'

SITE_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://$SITE_DOMAIN/")"
PANEL_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://$PANEL_DOMAIN/api/v1/health/live" || true)"
echo "Existing site HTTPS status: $SITE_STATUS"
echo "Panel HTTPS status before rollout (absence is expected): ${PANEL_STATUS:-unreachable}"

if timeout 8 openssl s_client -connect "$PANEL_DOMAIN:443" -servername "$PANEL_DOMAIN" </dev/null 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName; then
  echo "Current Panel certificate metadata shown above; no key material was read."
else
  echo "No valid Panel certificate is currently served; issuance remains a separately approved rollout step."
fi
echo "Preflight is read-only; it did not install Panel, issue a certificate, enable a site, reload nginx, or touch VPN state."

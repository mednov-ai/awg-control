#!/usr/bin/env bash
set -euo pipefail
umask 077

DRY_RUN=false
VERSION=""
BINARY=""
CHECKSUM=""
BUNDLE=""
PANEL_PUBLIC_KEY=""
STATE_DIR="/var/lib/awg-control-relay"
AGENT_HOME="/var/lib/awg-control-relay-agent"

usage() {
  echo "Usage: $0 --panel-public-key FILE [--version VERSION | --binary FILE --checksum SHA256 --bundle FILE] [--dry-run]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --binary) BINARY="${2:-}"; shift 2 ;;
    --checksum) CHECKSUM="${2:-}"; shift 2 ;;
    --bundle) BUNDLE="${2:-}"; shift 2 ;;
    --panel-public-key) PANEL_PUBLIC_KEY="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$PANEL_PUBLIC_KEY" && -f "$PANEL_PUBLIC_KEY" ]] || usage
[[ "$(uname -s)" == "Linux" ]] || { echo "Helper supports Linux only." >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture." >&2; exit 1 ;;
esac

PUBLIC_KEY_TYPE="$(awk 'NR==1 {print $1}' "$PANEL_PUBLIC_KEY")"
[[ "$PUBLIC_KEY_TYPE" == "ssh-ed25519" || "$PUBLIC_KEY_TYPE" == "sk-ssh-ed25519@openssh.com" ]] || {
  echo "Panel public key must be Ed25519." >&2
  exit 1
}

[[ "$(awk 'END { print NR }' "$PANEL_PUBLIC_KEY")" -eq 1 ]] || { echo "Exactly one public key is required." >&2; exit 1; }
ssh-keygen -lf "$PANEL_PUBLIC_KEY" >/dev/null || { echo "Invalid public key." >&2; exit 1; }

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
if [[ -n "$VERSION" ]]; then
  command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
  BINARY="$TEMP_DIR/awgctl"
  BUNDLE="$TEMP_DIR/awgctl.sigstore.json"
  BASE_URL="https://github.com/mednov-ai/awg-control/releases/download/v${VERSION}"
  curl --fail --location --silent --show-error "$BASE_URL/awgctl-linux-${ARCH}" --output "$BINARY"
  curl --fail --location --silent --show-error "$BASE_URL/awgctl-linux-${ARCH}.sha256" --output "$TEMP_DIR/checksum"
  curl --fail --location --silent --show-error "$BASE_URL/awgctl-linux-${ARCH}.sigstore.json" --output "$BUNDLE"
  CHECKSUM="$(awk '{print $1}' "$TEMP_DIR/checksum")"
fi

[[ -f "$BINARY" && "$CHECKSUM" =~ ^[a-fA-F0-9]{64}$ && -f "$BUNDLE" ]] || usage
ACTUAL_CHECKSUM="$(sha256sum "$BINARY" | awk '{print $1}')"
[[ "$ACTUAL_CHECKSUM" == "$CHECKSUM" ]] || { echo "Helper checksum mismatch." >&2; exit 1; }
command -v cosign >/dev/null || { echo "cosign is required to verify the signed Helper artifact." >&2; exit 1; }
cosign verify-blob "$BINARY" \
  --bundle "$BUNDLE" \
  --certificate-identity-regexp '^https://github.com/mednov-ai/awg-control/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' >/dev/null

echo "Verified Helper for linux/${ARCH}."
echo "Proposed files:"
echo "  /usr/local/sbin/awgctl (root:root 0755)"
echo "  /etc/sudoers.d/awg-control-relay-agent (root:root 0440)"
echo "  ${AGENT_HOME}/.ssh/authorized_keys (agent-owned directory, 0600 file)"
echo "  ${STATE_DIR} (root:root 0700)"
echo "Panel will later install only /etc/awg-control-relay/nginx.conf and awg-control-relay.service."
echo "No firewall, existing nginx service, Docker daemon, Amnezia container or VPN peer will be changed."
echo "Requires preinstalled /usr/sbin/nginx and /usr/lib/nginx/modules/ngx_stream_module.so."
if $DRY_RUN; then
  echo "Dry run complete; no system files were changed."
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "Apply mode must run as root." >&2; exit 1; }
[[ -x /usr/sbin/nginx && -f /usr/lib/nginx/modules/ngx_stream_module.so ]] || { echo "Install nginx-core and libnginx-mod-stream through the operator package procedure first." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }
command -v visudo >/dev/null || { echo "visudo is required." >&2; exit 1; }

[[ ! -e /etc/sudoers.d/awg-control-agent ]] || { echo "Relay bootstrap requires a separate host without a VPN Helper account." >&2; exit 1; }

if ! id awg-control-relay-agent >/dev/null 2>&1; then
  useradd --system --home-dir "$AGENT_HOME" --create-home --shell /bin/sh awg-control-relay-agent
fi
usermod --shell /bin/sh awg-control-relay-agent
install -o root -g root -m 0755 "$BINARY" /usr/local/sbin/awgctl
install -d -o root -g root -m 0700 "$STATE_DIR"
install -d -o awg-control-relay-agent -g awg-control-relay-agent -m 0700 "$AGENT_HOME/.ssh"
KEY_LINE="restrict,command=\"sudo -n /usr/local/sbin/awgctl ssh-relay-rpc\" $(tr -d '\r\n' < "$PANEL_PUBLIC_KEY")"
touch "$AGENT_HOME/.ssh/authorized_keys"
chown awg-control-relay-agent:awg-control-relay-agent "$AGENT_HOME/.ssh/authorized_keys"
chmod 0600 "$AGENT_HOME/.ssh/authorized_keys"
grep -Fqx "$KEY_LINE" "$AGENT_HOME/.ssh/authorized_keys" || printf '%s\n' "$KEY_LINE" >> "$AGENT_HOME/.ssh/authorized_keys"

SUDOERS_TEMP="$TEMP_DIR/awg-control-relay-agent.sudoers"
printf '%s\n' 'awg-control-relay-agent ALL=(root) NOPASSWD: /usr/local/sbin/awgctl ssh-relay-rpc' > "$SUDOERS_TEMP"
visudo -cf "$SUDOERS_TEMP" >/dev/null
install -o root -g root -m 0440 "$SUDOERS_TEMP" /etc/sudoers.d/awg-control-relay-agent

echo "Relay-only SSH bootstrap complete. Register this server in Panel, check status, then install the relay service."

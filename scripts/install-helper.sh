#!/usr/bin/env bash
set -euo pipefail
umask 077

DRY_RUN=false
VERSION=""
BINARY=""
CHECKSUM=""
BUNDLE=""
PANEL_PUBLIC_KEY=""
STATE_DIR="/var/lib/awg-control-helper"
AGENT_HOME="/var/lib/awg-control-agent"

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
echo "  /etc/sudoers.d/awg-control-agent (root:root 0440)"
echo "  ${AGENT_HOME}/.ssh/authorized_keys (agent-owned directory, 0600 file)"
echo "  ${STATE_DIR} (root:root 0700)"
echo "  /etc/systemd/system/awg-control-enforce.{service,timer}"
echo "No firewall, nginx, Docker daemon, Amnezia container, or VPN peer will be changed."
if $DRY_RUN; then
  echo "Dry run complete; no system files were changed."
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "Apply mode must run as root." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }
command -v visudo >/dev/null || { echo "visudo is required." >&2; exit 1; }

if ! id awg-control-agent >/dev/null 2>&1; then
  useradd --system --home-dir "$AGENT_HOME" --create-home --shell /usr/sbin/nologin awg-control-agent
fi
install -o root -g root -m 0755 "$BINARY" /usr/local/sbin/awgctl
install -d -o root -g root -m 0700 "$STATE_DIR"
install -d -o awg-control-agent -g awg-control-agent -m 0700 "$AGENT_HOME/.ssh"
KEY_LINE="restrict,command=\"sudo -n /usr/local/sbin/awgctl ssh-rpc\" $(tr -d '\r\n' < "$PANEL_PUBLIC_KEY")"
touch "$AGENT_HOME/.ssh/authorized_keys"
chown awg-control-agent:awg-control-agent "$AGENT_HOME/.ssh/authorized_keys"
chmod 0600 "$AGENT_HOME/.ssh/authorized_keys"
grep -Fqx "$KEY_LINE" "$AGENT_HOME/.ssh/authorized_keys" || printf '%s\n' "$KEY_LINE" >> "$AGENT_HOME/.ssh/authorized_keys"

SUDOERS_TEMP="$TEMP_DIR/awg-control-agent.sudoers"
printf '%s\n' 'awg-control-agent ALL=(root) NOPASSWD: /usr/local/sbin/awgctl ssh-rpc' > "$SUDOERS_TEMP"
visudo -cf "$SUDOERS_TEMP" >/dev/null
install -o root -g root -m 0440 "$SUDOERS_TEMP" /etc/sudoers.d/awg-control-agent

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -o root -g root -m 0644 "$SCRIPT_DIR/../deploy/systemd/awg-control-enforce.service" /etc/systemd/system/awg-control-enforce.service
install -o root -g root -m 0644 "$SCRIPT_DIR/../deploy/systemd/awg-control-enforce.timer" /etc/systemd/system/awg-control-enforce.timer
systemctl daemon-reload
systemctl enable --now awg-control-enforce.timer
/usr/local/sbin/awgctl health >/dev/null
echo "Helper installed without restarting Docker or Amnezia containers."


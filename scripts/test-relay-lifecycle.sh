#!/usr/bin/env bash
# Disposable Ubuntu fixture only. Never points at an operator server.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o "$TEMP_DIR/awgctl-arm64" "$REPO_DIR/cmd/awgctl"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o "$TEMP_DIR/awgctl-amd64" "$REPO_DIR/cmd/awgctl"
cp "$SCRIPT_DIR/test-relay-fixture.py" "$TEMP_DIR/fixture.py"
cp "$SCRIPT_DIR/install-relay.sh" "$TEMP_DIR/install-relay.sh"
docker run --rm --cap-add NET_ADMIN -v "$TEMP_DIR:/fixture:ro" ubuntu:24.04 bash -c '
  set -euo pipefail
  printf "#!/bin/sh\nexit 101\n" > /usr/sbin/policy-rc.d
  chmod 0755 /usr/sbin/policy-rc.d
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends nginx-core libnginx-mod-stream python3 iproute2 sudo openssh-client systemd >/dev/null
  case "$(uname -m)" in aarch64) install /fixture/awgctl-arm64 /usr/local/sbin/awgctl ;; x86_64) install /fixture/awgctl-amd64 /usr/local/sbin/awgctl ;; *) exit 1 ;; esac
  ip addr add 203.0.113.10/32 dev lo
  mkdir -p /var/lib/awg-control-relay
  python3 /fixture/fixture.py
'

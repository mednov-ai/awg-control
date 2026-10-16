#!/usr/bin/env bash
# Disposable local container only; no production host or existing container is used.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go test -c -o "$TEMP_DIR/helper-tests-arm64" "$REPO_DIR/internal/helper"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go test -c -o "$TEMP_DIR/helper-tests-amd64" "$REPO_DIR/internal/helper"
cp "$SCRIPT_DIR/test-wireguard-fixture.py" "$TEMP_DIR/fixture.py"
docker run --rm --cap-add NET_ADMIN --cap-add SYS_ADMIN --security-opt apparmor=unconfined -v "$TEMP_DIR:/fixture:ro" ubuntu:24.04 bash -c '
  set -euo pipefail
  printf "#!/bin/sh\nexit 101\n" > /usr/sbin/policy-rc.d
  chmod 0755 /usr/sbin/policy-rc.d
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends wireguard-tools iproute2 iputils-ping nginx-core libnginx-mod-stream python3 >/dev/null
  case "$(uname -m)" in aarch64) arch=arm64 ;; x86_64) arch=amd64 ;; *) exit 1 ;; esac
  AWG_WIREGUARD_FIXTURE=1 "/fixture/helper-tests-$arch" -test.run "^TestWireGuardConfigStandardParser$"
  python3 /fixture/fixture.py
'

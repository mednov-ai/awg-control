#!/usr/bin/env bash
set -euo pipefail
umask 077

CHOICE=""
PURGE_STATE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-suspended) CHOICE=restore-suspended ;;
    --leave-suspended) CHOICE=leave-suspended ;;
    --purge-helper-state) PURGE_STATE=true ;;
    *) echo "Usage: $0 (--restore-suspended|--leave-suspended) [--purge-helper-state]" >&2; exit 2 ;;
  esac
  shift
done
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
[[ -n "$CHOICE" ]] || { echo "An explicit suspended-peer choice is required." >&2; exit 2; }
if $PURGE_STATE && [[ "$CHOICE" != "restore-suspended" ]]; then
  echo "Helper state cannot be purged while suspended peers are intentionally left disabled." >&2
  exit 1
fi

if [[ -x /usr/local/sbin/awgctl ]]; then
  /usr/local/sbin/awgctl uninstall-prepare "$CHOICE" >/dev/null
fi
systemctl disable --now awg-control-enforce.timer 2>/dev/null || true
rm -f /etc/systemd/system/awg-control-enforce.timer /etc/systemd/system/awg-control-enforce.service
rm -f /etc/sudoers.d/awg-control-agent
rm -f /usr/local/sbin/awgctl
systemctl daemon-reload
if id awg-control-agent >/dev/null 2>&1; then
  userdel awg-control-agent
fi
if $PURGE_STATE; then
  rm -rf /var/lib/awg-control-helper /var/lib/awg-control-agent
fi
echo "Helper removed. Amnezia containers, server configurations, and unrelated peers were not removed."

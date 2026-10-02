# Development

Use Node.js 24, pnpm, Go 1.24+, and Docker Compose v2.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
go test -race ./...
```

Tests and fixtures must use unmistakably fake key material. Do not snapshot or
print complete client configs. Integration tests must operate on disposable
containers and may remove only peers created by the test itself.

Database changes require a numbered SQL migration, clean/upgrade/restore tests,
backup behavior, and a matching `spec.md` update. API/RPC changes require schema
and compatibility tests. Security-sensitive bug fixes require regression tests.


## Relay verification

Run `scripts/test-relay-lifecycle.sh` for disposable Ubuntu/nginx UDP integration. The fixture uses a process shim for systemctl and validates the actual unit syntax; full systemd/reboot and AWG tunnel acceptance remain pilot checks. Use Node 24 with the pinned pnpm for Panel tests; test key material is synthetic.

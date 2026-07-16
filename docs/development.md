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


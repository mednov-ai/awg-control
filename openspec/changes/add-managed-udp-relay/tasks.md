## 1. Contracts and persistence

- [x] 1.1 Add relay contracts and discovered UDP metadata; verify TypeScript/API compatibility tests.
- [x] 1.2 Add migration 0006, encrypted credential persistence and operation metadata; verify clean migration, upgrade and backup restore tests.

## 2. Relay runtime

- [x] 2.1 Implement isolated versioned relay RPC, lock/journal/fingerprint/snapshot/validation/rollback; verify Go unit/race and protocol security tests.
- [x] 2.2 Add signed operator bootstrap and independent systemd service; verify script syntax, dry-run and disposable lifecycle/UDP integration tests.

## 3. Panel and browser

- [x] 3.1 Implement authenticated relay lifecycle API, idempotency, reconciliation and polling; verify API/OpenAPI/security tests.
- [x] 3.2 Add RU/EN relay administration UI; verify component tests and browser smoke.
- [x] 3.3 Add transient direct/relay QR/config/vpn:// variants; verify endpoint-only transformation, decoded import and close/repeat tests.

## 4. Documentation and acceptance

- [x] 4.0 Record selected Selectel target `139.100.236.101`, local SSH alias/key path and successful read-only operator login with stored host-key verification (2026-10-02); inventory and relay readiness remain unverified.
- [x] 4.1 Update product, architecture, security and operator contracts; verify OpenSpec strict validation and normal local checks.
- [ ] 4.2 Bootstrap and deploy to Selectel `139.100.236.101` after fresh host-key, architecture, service/port/package/firewall inventory and reviewed installation scope; create separate restricted runtime credentials and retain before/after preservation evidence.
- [ ] 4.3 Verify real-client direct/relay handshake, traffic and expected exit IP; preserve existing peers/container state and record pilot acceptance separately.

Evidence and remaining gates are recorded in [verification.md](verification.md).
Documentation and local checks for 4.1 are complete. Compatible Fastify, fast-uri
and brace-expansion patch updates close the dependency audit findings; the final
Node 24 / pnpm 11.9 audit, lint, typecheck, tests and build passed.
No live deployment or client tunnel acceptance has been performed.

The subsequent SSH-only check recorded in design.md supplies the target address
and operator access details previously listed as missing in verification.md.
Bootstrap/network review and live tunnel acceptance are still pending.
Read-only inventory for 4.2 is recorded in verification.md. A signed release
containing relay RPC is required. The operator removed the review-gate
requirement on 2026-10-02; signed delivery and pilot evidence remain required.

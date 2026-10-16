## 1. Контракты продукта и совместимость

- [x] 1.1 Перед изменением реализации обновить `spec.md` и соответствующие правила `AGENTS.md`: classic WireGuard, границы операторской установки, модель Instance, one-time router profile, relay, RPC, migration/security/acceptance; проверить согласованность с delta spec и `openspec validate add-classic-wireguard-support --strict`.
- [x] 1.2 Добавить shared adapter/protocol schemas и стабильные ошибки неподтвержденного протокола, неоднозначного UDP mapping и несовместимого Helper; проверить TypeScript/schema tests и отсутствие самодельных UI копий типов.
- [x] 1.3 Ввести VPN Helper RPC 1.1 с безопасной поддержкой 1.0 и выбором версии Panel по подтвержденной поддержке; проверить current/previous compatibility tests, сохранение AWG response shape и отказ WireGuard mutation через 1.0/старые сохраненные IDs.
- [x] 1.4 Добавить следующую свободную numbered migration для Instance enums; проверить clean/0006 upgrade/backup-restore, foreign_key_check и integrity_check, сохранность udp_port, всех AWG/relay IDs и частичного unique index из 0005.

## 2. Discovery и WireGuard runtime

- [x] 2.1 Зафиксировать positive runtime probes на disposable контейнерных Amnezia WireGuard/Legacy/AWG2/AWG3 fixtures; проверить различение engine/config без зависимости от имен/tags и read-only результат при неоднозначности, без вывода секретов.
- [x] 2.2 Реализовать адаптер WireGuard и безопасную переклассификацию с отключением management при смене identity; проверить renamed containers, частичные/неизвестные AWG markers, сохранение Instance/Connection UUID и отсутствие неявного adoption.
- [x] 2.3 Определять UDP endpoint по listen-port конкретного интерфейса и соответствующему Docker mapping; проверить несколько опубликованных UDP портов, несовпадающие/неоднозначные bindings и отказ до route mutation.
- [x] 2.4 Подключить WireGuard к общему transaction pipeline: lock/snapshot/validate/no-restart apply/verify/rollback; проверить round-trip неизвестных полей/комментариев, basename, numeric owner/mode, fingerprint conflict и apply/rollback failures в Go tests.
- [x] 2.5 Проверить и при необходимости адаптировать stats, expiry/quota projection и policy timer для WireGuard; подтвердить handshake/counter epoch/reset tests и offline enforcement на disposable Instance без изменений AWG.

## 3. Создание Connection и одноразовая выдача

- [x] 3.1 Добавить стандартный WireGuard client template с IPv4 /32, DNS, AllowedIPs, MTU и keepalive из design; проверить стандартным WireGuard parser/fixture, отсутствие AWG полей/хуков/::/0 и утечек server-only secret, без снимков полного config.
- [x] 3.2 Подключить адаптер к API create/suspend/resume/revoke и atomic metadata commit; проверить first-free/concurrent allocation, retained reservations, revoked reuse, rollback и компенсацию peer при ошибке Panel commit.
- [x] 3.3 Расширить схемы Fastify и генерируемый OpenAPI без приема произвольных VPN CIDR, paths или upstream; проверить API compatibility, strict unknown-field validation, Origin/session controls и отказ unsupported Helper.
- [x] 3.4 Проверить one-time/no-store правила для WireGuard, duplicate operation/потерянного ответа и прямого/relay payload; тестами подтвердить `CONFIG_ALREADY_ISSUED`, отсутствие секретов в SQLite/journals/audit/shared query caches/browser storage и очистку окна.

## 4. Selectel relay и интерфейс

- [x] 4.1 Расширить relay eligibility на подтвержденные managed WireGuard + AWG 3.1 со fresh discovery, сохранив ограничение AWG2; проверить отдельный listen port, правильный upstream, stale metadata, idempotency/reconciliation, rollback и неизменность существующего AWG route.
- [x] 4.2 Добавить WireGuard relayEndpoint в one-time response и endpoint-only browser variants; проверить, что меняется только единственный Peer Endpoint, snapshot остается стабильным в открытом окне и direct доступен без relay.
- [x] 4.3 Обновить RU/EN выбор Instance/протокола, relay candidate labels, стандартный .conf/QR, single-device guidance и инструкцию импорта роутера; проверить component/browser smoke с synthetic данными, accessible labels и отсутствие неподтвержденного WireGuard vpn:// экспорта.
- [x] 4.4 Расширить disposable integration fixture на настоящий WireGuard peer через direct и nginx UDP relay; подтвердить handshake/двусторонний трафик, idle/reconnect, rollback и сохранение параллельного AWG route; это не заменяет реальный роутер.

## 5. Документация и локальная готовность

- [x] 5.1 Обновить architecture/development/security/operator/relay/pilot docs и добавить runbook установки WireGuard через AmneziaVPN: preflight, отдельный порт/subnet/config, fresh identity, approval gates и scoped rollback; проверить ссылки, отсутствие исторического Play&Say DNS как адреса VPN и отсутствие секретов.
- [x] 5.2 Добавить router acceptance checklist с model/firmware/LAN, DNS/NAT/IPv6 policy, direct/relay exit IP и idle/reconnect; проверить, что неизвестные router/live результаты остаются открытыми и не меняют acceptance прежнего `add-managed-udp-relay`.
- [x] 5.3 Выполнить `pnpm check`, `pnpm audit --audit-level moderate`, Go format/vet/race, shell syntax, relay/WireGuard lifecycle fixtures и OpenSpec strict validation; записать результаты и реальные ограничения, сохранив unrelated dirty файлы и credential notes.

## 6. Отдельные live и router acceptance gates

- [x] 6.1 После запроса оператора на выпуск/установку проверить подписанные Panel/Helper artifacts, создать/проверить SQLite backup, сохранить прошлый image digest и отдельно защитить master key; записать commit/push/tag/digest/deployment по отдельности, не обновлять relay Helper без необходимости.
- [x] 6.2 После отдельного разрешения live-фазы выполнить fresh DNS/host-key/inventory, проверить наличие WireGuard и при необходимости подготовить его средствами AmneziaVPN по runbook; сравнить before/after services, контейнеры/старты/restarts, порты, peer counts/fingerprints, остановиться при изменениях вне scope.
- [x] 6.3 После fresh discovery/snapshot и разрешения peer mutations создать disposable WireGuard Connection, по отдельному решению добавить Selectel route; проверить preservation действующего AWG route/peers и scoped rollback, не публикуя config/QR/ключи.
- [ ] 6.4 На реальном роутере последовательно проверить direct и Selectel: import, handshake, двусторонний трафик, LAN-client DNS/Internet, ожидаемый Node exit IP, IPv6 policy и idle/reconnect; записать модель/firmware/UTC и redacted evidence, при отсутствии подтверждения оставить задачу открытой.
- [ ] 6.5 После отдельного разрешения на relay reboot проверить восстановление обоих протоколов; отозвать только disposable Connection, проверить сохранение существующих peers/services и завершить приемку лишь по фактическим результатам. Автоматически не архивировать изменение.

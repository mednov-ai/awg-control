## Context

См. `proposal.md` для мотивации. Текущий `profileForConfig` в `internal/helper/runtime.go` относит `wg` без AWG-маркеров к `amneziawg-legacy`; это не доказывает протокол. Discovery уже проверяет контейнерные `/etc/wireguard/<interface>.conf`, но не выделяет классический WireGuard. `udpPort` выбирает первый опубликованный UDP-порт контейнера: для нового адаптера такое предположение неприемлемо.

`InstanceSchema` и SQLite ограничивают adapter/protocol enums. VPN RPC сейчас 1.0, relay RPC отдельно 1.1/1.0. Relay service, выдача API и UI фильтруют исключительно `3.1`. `add-managed-udp-relay` реализован в рабочем дереве, но его клиентская приемка остается открыта. Его код и контракты являются зависимостью этой работы; нельзя затереть текущие изменения или объявить прежнюю приемку выполненной.

AmneziaVPN поддерживает установку WireGuard: [официальная инструкция](https://docs.amnezia.org/documentation/instructions/install-configure-protocols/). Формат стандартного профиля и поведение keepalive описаны в [WireGuard Quick Start](https://www.wireguard.com/quickstart/) и [wg-quick manual](https://git.zx2c4.com/wireguard-tools/about/src/man/wg-quick.8). Наличие WireGuard на пилотном сервере сейчас не проверялось; planning не выполняет SSH и не устанавливает контейнеры.

## Goals / Non-Goals

**Goals:** Поддержать контейнерный WireGuard, установленный AmneziaVPN, в существующей Node/Instance/Connection модели; дать роутеру два альтернативных IPv4 Internet-egress профиля; переиспользовать транзакции Helper и protocol-neutral UDP relay.

**Non-Goals:** Host-native/systemd WireGuard discovery, собственный VPN installer/API, VPN termination в Selectel, site-to-site и объявления клиентских LAN-подсетей, управление маршрутизатором и автоматическое переключение endpoints. Не требуется `vpn://` для стандартного роутера: основными форматами WireGuard являются `.conf` и QR; существующий Amnezia-export AWG сохраняется.

## Decisions

### 1. Отдельный адаптер и положительное подтверждение runtime

Добавить `adapter: wireguard`, `protocolVersion: wireguard` как идентификатор семейства, не как вымышленную версию WireGuard 1.x. Разрешать управление только подтвержденным сочетанием adapter/protocol/capabilities/mode. Расширить общий контракт и убрать предположения, что каждый `wg` является Legacy.

Для контейнерных интерфейсов сопоставлять конфигурацию с runtime интерфейсом и стандартным WireGuard engine: использовать фиксированные безопасные пробы типа link/engine и возможностей tools, без shell-строк, full dumps и доверия image/container name. Во время реализации сначала зафиксировать воспроизводимые положительные и отрицательные пробы на disposable Amnezia WireGuard/Legacy/AWG2/AWG3 fixtures. Одного отсутствия AWG-полей, имени `wg` или успешного чтения счетчиков недостаточно. Если engine неразличим по доступным пробам, Instance остается read-only с понятной диагностикой; администратор не может обойти проверку простым выбором названия протокола.

Все активные AWG-маркеры учитываются до стандартного WireGuard fallback. Неполный/неизвестный AWG, включая частичные 3.x поля, никогда не становится writable WireGuard. Наличие неизвестных параметров не дает права удалять их: round-trip сохраняет их, неподдерживаемый синтаксис отключает мутации. Смена идентичности существующего Instance сохраняет UUID/Connections и сбрасывает management до явного подтверждения после fresh discovery; прежний `managed` не переносится автоматически.

Альтернатива — переименовать Legacy в WireGuard — отвергнута: она смешивает разные протоколы и может сделать действующие подключения неработоспособными.

### 2. WireGuard устанавливается через AmneziaVPN оператором

Добавить runbook подготовки отдельного протокола средствами AmneziaVPN. До установки: свежие DNS/SSH host-key проверки, inventory, snapshot, свободный порт, отдельная непересекающаяся подсеть/config path, проверка плана изменений и отдельное разрешение live-фазы. Использовать актуальный VPN/Panel hostname из операторских документов (`wg.cbrgn.mooo.com` на дату планирования), не DNS Play&Say для выбора VPN сервера.

Если установленная версия AmneziaVPN не умеет добавить протокол без вмешательства в существующие AWG containers, остановить операцию и отдельно согласовать scope. Не переустанавливать весь сервер и не заменять AWG 3.1. После подготовки — обычный read-only discovery/import, затем отдельное включение management. Откат затрагивает только новый Instance и его собственные сетевые правила, с учетом уже выданных peers; общий uninstall Panel/Helper не удаляет VPN.

Альтернатива — добавить установку контейнеров в Panel — расширяет root-поверхность и противоречит действующему контракту; не требуется для данного сценария.

### 3. Общие транзакции, отдельный стандартный client template

WireGuard использует `wg` и существующий transaction pipeline. Валидация/strip не запускает `wg-quick up/down` или server hooks; `syncconf` применяется без рестарта и без исполнения произвольных конфигурационных команд. Сохраняются basename `<interface>.conf`, числовые owner/mode, конфликты fingerprint, compensation при неуспешном commit Panel, idempotency и root-only recovery.

Client template имеет allowlist стандартных полей: `[Interface]` PrivateKey/Address/DNS/MTU, `[Peer]` PublicKey/Endpoint/AllowedIPs/PersistentKeepalive и PresharedKey только если поддерживаемый серверный сценарий его действительно требует. Не копировать AWG поля, server private key, PostUp/PostDown или server-only настройки. IPv4 baseline: первый свободный `/32`, `AllowedIPs = 0.0.0.0/0`, валидный DNS, явный консервативный MTU 1280 для обеих альтернатив и keepalive 25 секунд для router/NAT/relay сценария. Не добавлять `::/0` без реализации IPv6 egress. Runbook объясняет политику IPv6 на LAN клиентах и настройку NAT/DNS на конкретном роутере; это client egress, а не прием маршрутов удаленной LAN на сервере.

Существующие expiry/quota projection, счетчики и состояния должны работать для нового адаптера без отдельного механизма. Выдача `.conf`/QR только в transient memory и по `no-store`; `vpn://` для WireGuard не показывается без отдельного проверенного контракта кодирования, не являющегося зависимостью router acceptance.

### 4. Расширение допуска relay без изменения его модели доверия

Переиспользовать нынешние relay tables/RPC/nginx и endpoint transformation. Разрешены только подтвержденные managed AWG 3.1 и WireGuard; AWG2 остается вне scope. API выполняет fresh discovery и перепроверяет adapter, protocol, capabilities, mode и порт, а не доверяет ранее сохраненному UI значению.

Получать runtime listen port выбранного интерфейса и сопоставлять именно его Docker UDP mapping; множественные несовместимые bindings/неоднозначный адрес fail closed. На этапе реализации выдать стабильную диагностическую ошибку и contract test. Upstream IP берется из зарегистрированного Node, не из произвольного ввода. Host-network layouts без подтвержденного внешнего mapping в данный scope не входят.

Новый WireGuard route использует отдельный свободный relay listen port. Обновление полного набора relay routes сохраняет AWG route, его ID и upstream; действующие ограничения уникальности и host-level reconciliation остаются. VPN keys отсутствуют на relay. Relay Helper не требует обновления, если его прежний wire contract не меняется: это отдельно проверить, не совмещать с обязательным обновлением VPN Helper.

Browser использует snapshot endpoint в одноразовом response, меняя ровно один Endpoint. Одинаковые остальные поля в двух профилях позволяют использовать их последовательно на одном роутере. Для другого устройства создается отдельный Connection. Relay сам не добавляет маскировку протокола и не гарантирует доступность WireGuard в конкретной сети; это проверяется реальным трафиком.

### 5. Миграция и совместимость контрактов

Новая миграция — следующий свободный номер (сейчас ожидается `0007` после relay `0006`, перепроверить при apply). Расширить CHECK constraints Instance adapter/protocol, сохранив `udp_port`, UUIDs, foreign keys Connections/relay_routes, все индексы и индекс из 0005. Схему проверять через `schema_migrations`; не редактировать уже существующие миграции и не переклассифицировать legacy rows массово по SQL.

Для VPN RPC ввести minor 1.1, сохраняя 1.0 AWG request/response shape. Helper 1.1 по запросам 1.0 не выдает подтвержденный WireGuard как Legacy и не допускает мутаций такого Instance через старый контракт. Сопоставление старых сохраненных IDs перепроверяется безопасно до мутации. Panel использует 1.1 только после проверки поддержки; Helper 1.0 остается пригоден для существующего AWG, но не для нового WireGuard. И protocol-level, и VPN-level версии имеют отдельные поля/типы, их нельзя смешивать. Обновить Fastify schemas и генерируемый OpenAPI, shared UI types, RU/EN labels.

Альтернатива — молча расширить enum в 1.0 — отвергнута: старые строгие клиенты могут отклонить discovery целиком или неверно управлять WireGuard.

## Risks / Trade-offs

- Неоднозначная Legacy/runtime идентичность → read-only и fixture-доказательства; не мигрировать существующие managed peers автоматически.
- AmneziaVPN может изменить другие контейнеры при установке → reviewed operator scope, snapshots и before/after IDs/start times/fingerprints; остановка при неожиданном поведении.
- Пересечение VPN subnet с LAN роутера → предварительная проверка адресации перед подготовкой; модель/firmware/локальная подсеть уточняются перед live-приемкой.
- IPv4-only профиль может оставить IPv6 мимо VPN → явно описать границу и проверить политику IPv6 на LAN, не обещать all-traffic protection по одному IPv4 exit-IP тесту.
- Selectel UDP route активен, но WireGuard не проходит сеть клиента → acceptance только по actual-router handshake/traffic/DNS/exit IP; health остается отдельным статусом.
- Изменение relay конфигурации может затронуть активные relay сессии → отдельное разрешение live route update, scoped rollback и проверка восстановления AWG клиентов.
- Утеря одноразового окна → замещающий Connection и отзыв старого; никакого восстановления private key из журналов.

## Migration Plan

1. В apply сначала обновить `spec.md` (цели, adapter/model/API/RPC/relay/install/security/acceptance) и согласовать новую поддержку с `AGENTS.md`; только затем менять реализацию. Основной контракт сейчас остается описанием действующего поведения.
2. Реализовать и проверить на synthetic/disposable fixtures весь путь direct и relay, включая миграцию с 0006, backup/restore, failure/rollback и предыдущий RPC minor. Сохранить все unrelated dirty изменения.
3. Выпустить/проверить подписанные Helper и multi-arch Panel artifacts. Перед deploy создать и проверить consistent SQLite backup, сохранить предыдущий image digest и отдельно защитить master key. Planning не является разрешением на публикацию/установку.
4. После отдельного operator решения выполнить свежий preflight, совместимое обновление VPN Helper и Panel, затем подготовить WireGuard через AmneziaVPN, если его нет. Не менять existing AWG services и не обновлять relay Helper без необходимости.
5. Discovery/import, проверка positive protocol identity, snapshot, явное разрешение peer mutation. Создать disposable Connection, проверить direct, затем отдельно добавить WireGuard relay route и проверить Selectel. Проверить текущий AWG route и все existing services/peers после операции.
6. На реальном роутере поочередно проверить оба профиля: handshake, трафик в обе стороны, DNS и Internet с LAN клиента, ожидаемый exit IP Node, idle/reconnect и восстановление после relay reboot только при отдельном разрешении на reboot. Записать безопасные результаты; неизвестные тесты оставить открытыми.
7. Rollback после schema migration: matching backup + предыдущий Panel image. Отдельно вернуть только новый relay route, сохранив AWG route; совместимый Helper можно оставить. Не перезапускать Docker/nginx/AWG и не удалять новый WireGuard с выданными рабочими peers автоматически. Archive — отдельный шаг после выполнения применимых gates.

## Open Questions

Модель и firmware роутера, LAN-подсеть и желаемая политика IPv6 нужны перед клиентской приемкой и подбором конкретных шагов импорта. Это не меняет стандартный WireGuard контракт и не блокирует реализацию; до получения данных нельзя заявлять поддержку конкретного роутера.

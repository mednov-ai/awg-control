## Why

Роутер оператора поддерживает классический WireGuard, но не AWG 3.1. AWG Control должен выдавать для него стандартные подключения как напрямую к VPN Node, так и через существующий UDP relay в Selectel, сохраняя действующие AWG-инстансы.

## What Changes

- Добавить отдельный адаптер `wireguard` для классического WireGuard, установленного средствами AmneziaVPN; различать его с AmneziaWG Legacy, AWG2 и AWG 3.1 по конфигурации и подтвержденному runtime.
- Описать операторскую подготовку отдельного WireGuard Instance рядом с AWG 3.1 через AmneziaVPN: отдельные контейнер, UDP-порт, подсеть и persistent config. Panel не устанавливает VPN-контейнеры.
- Обеспечить discovery/import, создание Connection, автоматическую адресацию, одноразовый стандартный `.conf`/QR, статистику, suspend/resume/revoke и локальное применение квот/сроков.
- Расширить существующий Selectel relay на подтвержденные managed WireGuard Instances. Прямой и relay-профили одного Connection отличаются только Endpoint; выход в Internet остается на VPN Node.
- Добавить понятный RU/EN выбор протокола и Instance, инструкции для роутера, миграцию метаданных и версионирование VPN Helper RPC с совместимостью предыдущей minor-версии.
- Сохранить текущие AWG-подключения, одноразовость секретов и неизменность действующего маршрута AWG 3.1 через Selectel.

## Capabilities

### New Capabilities

- `classic-wireguard`: Обнаружение, безопасное управление и одноразовая выдача стандартных WireGuard-подключений, включая прямой и Selectel endpoints и операторскую подготовку через AmneziaVPN.

### Modified Capabilities

Нет: `openspec/specs/` пока не содержит основных capability specs. Изменение дополняет незавершенное `add-managed-udp-relay`, использует его пути `managed-udp-relay` и `relay-connection-issuance` как контекст и не переписывает его артефакты или acceptance.

## Impact

Go Helper discovery/runtime/client-template и локальные политики; VPN RPC; shared TypeScript contracts, API/OpenAPI и SQLite; UI Instance/issuance/relay; `spec.md`, `AGENTS.md` и операторские/security документы. Потребуются совместимые подписанные Helper и Panel. Новая numbered migration расширит adapter/protocol enums без изменения существующих IDs и резервирования адресов.

## Non-goals

Установка VPN из Panel API, управление роутером, site-to-site/LAN-to-LAN и маршрутизация удаленной LAN, автоматическое переключение endpoints, преобразование AWG 3.1 peer в WireGuard, расширение relay на AWG2, установка на Selectel VPN-сервера и любые live-изменения в рамках планирования.

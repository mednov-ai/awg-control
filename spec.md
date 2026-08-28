# AWG Control — спецификация продукта

Статус: проектирование v1  
Версия документа: 0.3
Дата актуализации: 2026-08-28

## 1. Назначение документа

Этот документ — основной продуктовый и технический контракт AWG Control. Изменение поведения продукта, модели данных, API, установки, безопасности или поддержки VPN-адаптеров должно сопровождаться обновлением этой спецификации в том же изменении.

AWG Control развивается как самостоятельный универсальный продукт. Он не является модулем Play&Say и не должен зависеть от репозиториев, доменов, Kubernetes-кластера или бизнес-логики Play&Say. Сервер Play&Say используется только как первый реальный пилот совместимости.

Планируемый публичный репозиторий: `mednov-ai/awg-control`.  
Лицензия: Apache-2.0.

## 2. Проблема и продукт

Amnezia устанавливает рабочие AmneziaWG-серверы, но оператору нужен отдельный лёгкий инструмент для повседневного управления:

- людьми и их устройствами;
- VPN-подключениями и сроками их действия;
- одноразовой выдачей клиентской конфигурации и QR-кода;
- просмотром текущего и накопленного трафика;
- квотами и автоматической блокировкой;
- несколькими независимыми серверами из одной панели;
- безопасным аудитом административных действий.

AWG Control — self-hosted web-панель для существующих и новых установок AmneziaWG. Панель не заменяет Amnezia, не создаёт собственный VPN-протокол и не требует переустановки действующего сервера.

## 3. Цели v1

1. Подключаться к уже работающим AmneziaWG Legacy, AWG2 и AWG 3.1 без остановки VPN.
2. Обнаруживать фактическую конфигурацию, интерфейс и управляющий бинарник, а не полагаться только на имя контейнера.
3. Импортировать существующие peers без необходимости знать их клиентские приватные ключи.
4. Создавать пользователей и несколько подключений устройств для каждого пользователя.
5. Выдавать новую клиентскую конфигурацию и QR-код ровно один раз.
6. Показывать handshake, входящий, исходящий и суммарный трафик по подключению и пользователю.
7. Применять срок действия и node-local квоту даже при временной недоступности центральной панели.
8. Управлять одним локальным сервером или несколькими удалёнными серверами одинаковым способом.
9. Устанавливаться и обновляться без вмешательства в контейнеры Amnezia.
10. Оставлять существующие VPN-подключения работоспособными после удаления панели.

## 4. Не входит в v1

- собственная реализация VPN-протокола;
- установка или обновление самих контейнеров Amnezia через Panel API; отдельный
  AWG 3.1 instance разворачивается оператором и затем проходит обычный discovery;
- мобильный VPN-клиент;
- пользовательский кабинет для конечных пользователей;
- OIDC/LDAP/SSO;
- биллинг и приём платежей;
- глобальная квота, суммирующая трафик одного пользователя на разных nodes;
- high availability панели и кластер SQLite;
- одновременное редактирование одного peer панелью и приложением Amnezia без проверки конфликтов;
- хранение или повторное восстановление выданного клиентского приватного ключа.

## 5. Роли и основные сценарии

В v1 интерфейсом пользуются только администраторы.

Основные сценарии:

1. Администратор устанавливает панель и создаёт первого локального администратора.
2. Через bootstrap-команду он ставит `awgctl` на VPN-сервер и регистрирует ограниченный SSH-ключ.
3. Панель выполняет read-only discovery и показывает найденные AWG-инстансы.
4. Администратор подтверждает импорт существующих peers и связывает их с пользователями.
5. Администратор создаёт новое подключение, сразу показывает или скачивает `.conf`, либо показывает QR-код.
6. Администратор видит трафик, последний handshake и состояние квоты.
7. Администратор приостанавливает, возобновляет или отзывает подключение.
8. Node самостоятельно приостанавливает подключение по истечению срока или квоты.
9. Администратор просматривает аудит и состояние nodes.

## 6. Термины

- **Panel** — web-интерфейс, API, фоновые задачи и SQLite AWG Control.
- **Node** — Linux-сервер с одним или несколькими AmneziaWG-инстансами.
- **Instance** — обнаруженный AWG-интерфейс и связанная с ним серверная конфигурация.
- **Helper** — статический root-owned бинарник `awgctl` на Node.
- **VPN user** — человек или логическая учётная запись, владеющая подключениями.
- **Connection** — отдельный peer/устройство с собственной парой ключей.
- **Imported connection** — существующий peer, обнаруженный без клиентского приватного ключа.
- **Managed connection** — peer, изменения которого разрешены AWG Control.
- **Observed connection** — импортированный peer, доступный только для мониторинга до явного принятия в управление.

## 7. Архитектура

### 7.1 Компоненты

| Компонент | Технология | Ответственность |
| --- | --- | --- |
| Web | React + TypeScript | Административный UI, локальная генерация QR из одноразового config payload |
| API | Node.js 24 + TypeScript + Fastify | REST API, аутентификация, оркестрация nodes, аудит |
| Worker | В процессе API v1 | Опрос статистики, агрегация трафика, health checks |
| Storage | SQLite/WAL через `better-sqlite3` | Метаданные, состояния, агрегаты, сессии и аудит |
| Helper | Статический Go-бинарник `awgctl` | Discovery, чтение статистики и транзакционные изменения AWG на Node |
| Transport | OpenSSH | Ограниченный JSON-RPC канал Panel → Helper |

Frontend собирается в статические файлы и обслуживается тем же контейнером, что и API. Это сохраняет single-image deployment и same-origin модель безопасности.

### 7.2 Режимы

**Local mode** — панель управляет одним Node, обычно тем же сервером. Даже в этом режиме используется ограниченный SSH transport на `127.0.0.1`, чтобы код управления и права не отличались от hub mode.

**Hub mode** — одна панель управляет несколькими Nodes по SSH. Для каждого Node хранятся отдельные fingerprint, transport key и настройки опроса.

Переход из local в hub mode не требует миграции данных: local mode является hub mode с одним преднастроенным Node.

### 7.3 Сетевые границы

- Панель по умолчанию слушает `127.0.0.1:8080`.
- TLS и публичный hostname предоставляет существующий nginx, Caddy или Traefik.
- Node принимает обычный OpenSSH, но ключ панели разрешает только forced-command helper.
- Публичный Docker socket не монтируется в контейнер панели.
- Panel не получает общий root shell и не использует root SSH-ключ оператора.

## 8. Интеграция с AmneziaWG

### 8.1 Поддерживаемые адаптеры v1

| Семейство | Типичный бинарник | Типичный интерфейс | Примечание |
| --- | --- | --- | --- |
| AmneziaWG Legacy | `wg` | `wg0` | Legacy-установки Amnezia |
| AWG2 | `awg` или совместимый `wg` | `awg0` | Новое поколение AmneziaWG |
| AWG 3.1 | `awg` | `awg0` | Отдельный instance со своим контейнером, UDP-портом, подсетью и конфигурацией |

Имена являются подсказками, а не контрактом. Helper обязан подтвердить бинарник, интерфейс, конфигурацию и runtime-состояние фактической проверкой.

Версия определяется по активным полям `[Interface]`, а не по имени контейнера или
image tag. `HeaderProtectionKey` вместе с `RandomTrailers` и `DisableCookies`
идентифицирует AWG 3.1. Конфигурация с `HeaderProtectionKey`, но без полного набора
полей 3.1, считается AWG 3.0 и доступна только read-only. Helper не должен
классифицировать AWG 3.x как AWG2.

AWG2 и AWG 3.1 могут работать на одном Node одновременно. У них обязательны
разные контейнеры, UDP-порты, VPN-подсети и persistent config paths. Peers,
снимки, fingerprint, статистика, квоты и операции управления изолируются по
Instance ID. Установка AWG 3.1 не изменяет и не перезапускает AWG2.

### 8.2 Discovery

Read-only discovery:

1. Находит работающие контейнеры-кандидаты и их network/runtime metadata.
2. Проверяет наличие `awg`/`wg` внутри контейнера.
3. Получает список интерфейсов без вывода приватных ключей.
4. Находит соответствующий конфигурационный файл и таблицу клиентов.
5. Вычисляет безопасный fingerprint исходных файлов.
6. Возвращает capabilities адаптера: stats, create, suspend, resume, revoke и metadata update.
7. Не изменяет контейнер, интерфейс, конфигурацию или peer.

Контейнеры нельзя определять только по имени `amnezia-awg` или `amnezia-awg2`: пользователь может переименовать контейнер или иметь несколько инстансов.

### 8.3 Импорт

- Существующие peers импортируются по public key и Instance.
- Клиентский приватный ключ при импорте отсутствует и не запрашивается.
- Изначально импортированный peer имеет режим `observed`.
- Для мутаций администратор явно переводит peer в `managed`.
- Неизвестные комментарии и параметры конфигурации должны сохраняться без изменений.
- Панельные имена пользователей являются каноническими; запись display name в Amnezia metadata выполняется только при подтверждённой поддержке адаптером.

## 9. Безопасное изменение конфигурации

Каждая мутация выполняется helper как единая транзакция:

1. Проверить подпись запроса, operation ID, права операции и ожидаемый fingerprint.
2. Взять `flock` на конкретный Instance.
3. Повторно прочитать актуальное состояние и отклонить конфликт внешнего изменения.
4. Создать root-only snapshot конфигурации и связанной metadata.
5. Построить новый файл с сохранением неизвестных AWG-параметров.
6. Проверить синтаксис подходящим бинарником/адаптером.
7. Атомарно заменить persistent-файл.
8. Применить разницу через `syncconf` или эквивалент без рестарта контейнера.
9. Проверить runtime-состояние и presence/absence целевого peer.
10. При любой ошибке восстановить snapshot и повторно применить исходное состояние.
11. Записать root-only journal результата и вернуть новый fingerprint.

Требования:

- операции идемпотентны по `operationId`;
- параллельные изменения одного Instance запрещены;
- неизвестная версия/структура конфигурации переводит адаптер в read-only;
- restart контейнера не является штатным способом применения;
- snapshot не передаётся в Panel и автоматически очищается по retention policy;
- логи не содержат private key, preshared key или полную конфигурацию.

Приостановленное подключение исключается из активной конфигурации, но необходимая серверная peer metadata сохраняется root-only на Node для безопасного возобновления. Удаление helper при наличии таких подключений должно потребовать явного выбора: восстановить peers или оставить их приостановленными. Молчаливое удаление peer запрещено.

## 10. Ключи и одноразовая выдача

Для нового Connection helper создаёт клиентскую пару ключей и необходимые параметры в оперативной памяти:

1. Public key добавляется в серверную конфигурацию.
2. Полный client config возвращается Panel один раз по защищённому SSH-каналу.
3. API передаёт config активной административной сессии с `Cache-Control: no-store`.
4. Web локально строит QR-код и предлагает скачать `.conf`.
5. После ответа backend и helper удаляют client private key из доступной памяти; в SQLite, логах, snapshots панели и audit payload он не записывается.

Повторное получение `.conf` или QR невозможно. При потере конфигурации администратор создаёт заменяющее подключение и отзывает старое. Для imported connection генерация конфигурации также невозможна.

Node по необходимости сохраняет только серверные peer-данные, уже требуемые AWG, включая public key и возможный preshared key. Эти файлы принадлежат root и никогда не возвращаются через API.

## 11. Модель данных

Все идентификаторы — UUIDv7. Время хранится в UTC ISO 8601, UI отображает локальную timezone администратора.

### 11.1 Admin

- `id`
- `username`
- `passwordHash`
- `totpEnabled`, `totpSecretEncrypted`
- `status`: active/disabled
- `lastLoginAt`
- `createdAt`, `updatedAt`

### 11.2 Node

- `id`, `name`, `description`
- `host`, `port`, `sshUsername`
- `hostKeyFingerprint`
- `transportPrivateKeyEncrypted`
- `status`: pending/discovered/healthy/degraded/offline
- `helperVersion`
- `lastSeenAt`, `lastErrorCode`
- `pollIntervalSeconds`
- `createdAt`, `updatedAt`

### 11.3 Instance

- `id`, `nodeId`, `displayName`
- `adapter`: amneziawg-legacy/awg2/awg3
- `protocolVersion`: legacy/2/3.0/3.1/unknown; поддерживаемые для мутаций
  сочетания — legacy, AWG2 `2` и AWG3 `3.1`; остальные fail closed в read-only
- `containerRef`, `interfaceName`, `configRef`
- `capabilitiesJson`
- `sourceFingerprint`
- `mode`: observed/managed/read-only
- `lastDiscoveredAt`

`configRef` — внутренний непрозрачный идентификатор helper, а не произвольный путь, присланный API-клиентом.

### 11.4 VpnUser

- `id`, `nodeId`, `displayName`
- `externalReference` — необязательная интеграционная ссылка
- `status`: active/suspended/archived
- `notes`
- `createdAt`, `updatedAt`

В v1 пользователь принадлежит одному Node и может иметь несколько Connections на разных Instances этого Node.

### 11.5 Connection

- `id`, `vpnUserId`, `instanceId`
- `name`, `publicKey`, `addressCidr`
- `source`: created/imported
- `managementMode`: observed/managed
- `status`: active/suspended/expired/quota-exceeded/revoked/error
- `expiresAt`, `quotaPolicyId`, `quotaOverrideAt`
- `lastHandshakeAt`
- `rxBytesTotal`, `txBytesTotal`
- `lastCounterRx`, `lastCounterTx`, `counterEpoch`
- `createdAt`, `updatedAt`, `revokedAt`

Client private key и полный client config отсутствуют в схеме.

Ручное возобновление после `expired` или `quota-exceeded` требует явного `override` и
аудита. Для expiry override очищает завершившийся срок. Для quota override начинает
новое локально учитываемое окно; обычный период квоты снова становится
авторитетным после ближайшей естественной границы периода.

### 11.6 QuotaPolicy

- `id`, `nodeId`, `name`
- `limitBytes`
- `period`: lifetime/month/calendar-month
- `resetTimezone`
- `action`: suspend
- `createdAt`, `updatedAt`

### 11.7 TrafficRollup

- `connectionId`
- `bucketStart`, `bucketKind`: hourly/daily
- `rxBytes`, `txBytes`
- составной unique key `(connectionId, bucketStart, bucketKind)`

### 11.8 AuditEvent

- `id`, `occurredAt`
- `adminId`, `action`, `targetType`, `targetId`
- `nodeId`, `operationId`
- `result`: success/failure/rejected
- `errorCode`, `remoteAddress`
- `detailsJson` — только redacted metadata

## 12. Трафик, сроки и квоты

- Worker запрашивает peer counters и handshake по умолчанию раз в 60 секунд.
- UI показывает RX, TX и total; единицы форматируются, исходные значения остаются целыми bytes.
- Накопленный total не уменьшается при перезапуске контейнера или обнулении runtime counters.
- Если текущий counter меньше предыдущего, начинается новая counter epoch, а уже накопленное значение сохраняется.
- Hourly rollups хранятся 90 дней, daily rollups — 2 года. Retention настраивается.
- Ограничения v1 рассчитываются на одном Node. Cross-node aggregation отсутствует.
- Helper устанавливает systemd timer `awgctl enforce`, выполняющийся каждую минуту.
- Panel синхронизирует на Node минимальную policy projection без пользовательских секретов.
- Node применяет expiry/quota локально, даже если Panel недоступна.
- Ручное возобновление quota-exceeded Connection требует сброса/смены политики или явного override с аудитом.
- Допустимая задержка применения срока/квоты — не более 90 секунд.

## 13. API панели

Базовый путь: `/api/v1`. Формат: JSON UTF-8. Контракт публикуется как OpenAPI 3.1.

Основные endpoints:

| Метод и путь | Назначение |
| --- | --- |
| `POST /auth/login` | Создать административную сессию |
| `POST /auth/logout` | Завершить сессию |
| `GET /auth/me` | Текущий администратор |
| `GET/POST /nodes` | Список и регистрация Nodes |
| `POST /nodes/{id}/discover` | Запустить read-only discovery |
| `POST /nodes/{id}/verify-host-key` | Подтвердить SSH host fingerprint |
| `GET /nodes/{id}/instances` | Обнаруженные AWG Instances |
| `GET /instances/{id}/peers` | Read-only список peers для подтверждённого импорта |
| `POST /instances/{id}/manage` | Явно разрешить мутации после проверки capabilities |
| `POST /instances/{id}/import` | Импортировать peers в observed mode |
| `GET/POST /users` | Пользователи VPN |
| `GET/PATCH /users/{id}` | Карточка и изменение пользователя |
| `POST /users/{id}/connections` | Создать Connection и одноразово вернуть config |
| `POST /connections/{id}/adopt` | Принять imported peer в управление |
| `POST /connections/{id}/suspend` | Приостановить |
| `POST /connections/{id}/resume` | Возобновить |
| `POST /connections/{id}/revoke` | Необратимо отозвать peer |
| `GET /connections/{id}/traffic` | Таймсерии и totals |
| `GET/POST/PATCH /quota-policies` | Управление квотами |
| `GET /audit-events` | Фильтруемый аудит |
| `GET /health/live` | Liveness |
| `GET /health/ready` | Readiness БД и worker |

Дополнительные auth endpoints: `GET /auth/bootstrap`, `POST /auth/totp/enroll` и
`POST /auth/totp/confirm`. TOTP secret и recovery codes возвращаются только в
одноразовых ответах с запретом кэширования.

Мутирующие endpoints принимают `Idempotency-Key`. Ошибки используют `application/problem+json` со стабильными `type`, `code`, `status`, `title`, `traceId`; секретные значения и команды helper в ответ не включаются.

`POST /users/{id}/connections` является единственной точкой выдачи client config: успешный response содержит `connection`, `clientConfig` и необходимые данные для локального QR. Повтор того же `Idempotency-Key` после успешной выдачи возвращает metadata без client config и сообщает `CONFIG_ALREADY_ISSUED`; повторно генерировать старый private key нельзя.

## 14. Helper RPC

SSH forced-command принимает newline-delimited JSON через stdin и возвращает JSON через stdout. Произвольные shell-команды, пути и аргументы запрещены.

Операции v1:

- `discover`
- `snapshot`
- `list`
- `stats`
- `create`
- `rename` — только поддерживаемая adapter metadata
- `enable`
- `disable`
- `revoke`
- `apply-policy`
- `health`

Каждый запрос содержит `protocolVersion`, `requestId`, `operationId`, `action`, typed `parameters`. Helper проверяет строгую JSON Schema, отклоняет неизвестные поля и ограничивает размер ввода. Ответ содержит `ok`, `requestId`, `result` либо стабильную ошибку `code/message/retryable`; stack trace наружу не выводится.

Helper никогда не выполняет строку как shell и не доверяет container name, interface name или filesystem path из запроса. Panel оперирует только opaque Instance ID, ранее выданным discovery.

## 15. Аутентификация и защита панели

- Локальные административные аккаунты.
- Пароли хэшируются Node.js `scrypt` с индивидуальной salt и версионированными параметрами.
- Сессия использует случайный server-side session ID в cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- Все мутации защищены Origin/CSRF проверкой.
- Login и чувствительные операции имеют rate limit.
- Первый admin создаётся одноразовой CLI-командой, а не default password.
- Опциональный TOTP доступен в v1; recovery codes показываются один раз и хранятся как hash.
- API не поддерживает CORS по умолчанию.
- Content Security Policy запрещает сторонние scripts и передачу QR payload наружу.
- Журналы используют allowlist полей; request/response body для issuance endpoint не логируется.

## 16. SSH-модель доступа к Node

Bootstrap выполняется оператором с существующим административным доступом. Runtime-доступ панели создаётся отдельно:

1. Root-owned helper устанавливается как `/usr/local/sbin/awgctl`.
2. Создаётся системный пользователь `awg-control-agent` без пароля и интерактивного shell.
3. В `authorized_keys` добавляется отдельный public key панели с `restrict` и forced command `sudo -n /usr/local/sbin/awgctl ssh-rpc`.
4. `sudoers` разрешает этому пользователю только указанную команду без произвольных аргументов/shell.
5. Panel закрепляет SSH host key fingerprint при регистрации Node; несовпадение блокирует соединение.
6. PTY, agent forwarding, port forwarding, X11 forwarding и user rc запрещены.

Transport private key панели хранится в SQLite только в виде AES-256-GCM ciphertext. Master key монтируется отдельно, например `/run/secrets/awg-control-master-key`, и не находится в SQLite volume или Docker image. Запуск без валидного master key завершается ошибкой. Ротация transport key и master key должна быть документированной CLI-операцией.

## 17. UI

Языки v1: русский и английский. Все видимые и assistive labels должны проходить через i18n.

Основные экраны:

- вход и настройка первого администратора;
- dashboard состояния Nodes, Connections и трафика;
- Nodes: регистрация, host fingerprint, discovery, Instances и health;
- VPN users: поиск, статусы, connections и aggregated traffic;
- Connection: handshake, адрес, трафик, срок, квота, suspend/resume/revoke;
- одноразовый экран выдачи `.conf` и QR с явным предупреждением;
- quota policies;
- audit log;
- settings и TOTP.

QR строится в браузере из уже полученного одноразового config. Config не отправляется внешнему QR-сервису, telemetry или error tracker.

## 18. Хранилище и миграции

- SQLite работает в WAL mode с `foreign_keys=ON` и разумным `busy_timeout`.
- Один процесс API является writer; фоновые задачи работают в нём же.
- Все schema migrations нумеруются, транзакционны и выполняются перед readiness.
- Перед необратимой миграцией автоматически создаётся backup SQLite.
- Downgrade через старый бинарник не гарантируется; rollback релиза использует backup совместимой схемы.
- В backup SQLite transport keys остаются зашифрованными. Master key резервируется отдельно оператором.
- AuditEvent append-only для приложения; retention настраивается отдельно от traffic rollups.

## 19. Установка, обновление и удаление

### 19.1 Panel

Основная поставка — Docker Compose:

- image `ghcr.io/mednov-ai/awg-control:<semver>`;
- named volume для `/var/lib/awg-control`;
- read-only secret mount для master key;
- bind по умолчанию `127.0.0.1:8080`;
- healthcheck;
- `restart: unless-stopped`;
- reverse proxy настраивается отдельно оператором.

### 19.2 Helper

Helper поставляется как отдельные подписанные static binaries для Linux amd64/arm64 с checksums и SBOM. Installer:

- проверяет platform и checksum;
- создаёт пользователя, root-only каталоги, sudoers и systemd timer;
- не меняет firewall, nginx и Docker daemon;
- не перезапускает и не пересоздаёт контейнеры Amnezia;
- имеет режим `--dry-run`.

### 19.3 Обновление

1. Сделать backup SQLite и проверить master key availability.
2. Проверить release signature/checksum.
3. Обновить helper совместимой версии на Nodes.
4. Обновить image tag Panel.
5. Выполнить migrations, readiness и read-only discovery regression.
6. При несовместимости helper/API запретить мутации, но оставить просмотр последнего состояния.

Panel и helper согласуют версию RPC. Поддерживается текущая и одна предыдущая minor-версия helper.

### 19.4 Удаление

- Удаление Panel удаляет только контейнер/volume по явному выбору.
- Удаление Panel не удаляет Helper автоматически.
- Удаление Helper не удаляет контейнеры Amnezia, server configs или peers.
- Если есть suspended peers, uninstaller останавливается и требует явного решения об их состоянии.
- Перед удалением Helper оператор запускает `awgctl uninstall-prepare restore-suspended`
  либо явно подтверждает `awgctl uninstall-prepare leave-suspended`; первый вариант
  транзакционно возвращает сохранённые peer blocks и прекращает удаление при любой ошибке.
- Purge VPN peers существует только как отдельная опасная операция с перечислением целей и подтверждением; в обычный uninstall не входит.

## 20. Совместимость и ограничения эксплуатации

Поддерживаемые платформы v1:

- Linux amd64 и arm64;
- Ubuntu 22.04/24.04;
- Debian 12/13;
- systemd, OpenSSH и Docker с Compose v2;
- существующие контейнерные установки AmneziaWG Legacy, AWG2 и AWG 3.1;
- одновременная работа AWG2 и AWG 3.1 на одном Node при раздельных портах,
  подсетях и persistent config paths.

Целевой размер одной панели v1:

- до 25 Nodes;
- до 1000 Connections;
- опрос раз в 60 секунд;
- один экземпляр Panel и одна SQLite database.

При превышении целевого размера требуется отдельное нагрузочное подтверждение или переход на следующую storage/worker архитектуру.

## 21. Наблюдаемость и аудит

- Структурированные JSON logs с `traceId`, `nodeId`, `operationId`, но без key/config payload.
- Метрики процесса и очереди доступны на loopback/admin network endpoint.
- Health Node различает SSH, host-key, helper-version, discovery и stats failures.
- Ошибка одного Node не останавливает polling остальных.
- UI явно показывает stale data и время последнего успешного опроса.
- Аудит фиксирует login, node registration, fingerprint confirmation, import/adopt, issuance, policy change, suspend/resume/revoke, update и failure.
- Public key в UI и логах маскируется, полное значение доступно только на защищённой detail-странице администратору.

## 22. CI и релизы

GitHub Actions должен выполнять:

1. lint, typecheck и unit tests TypeScript/React;
2. Go format, vet, unit tests и static analysis;
3. contract tests API ↔ helper для поддерживаемых RPC-версий;
4. migration tests с чистой и предыдущей схемой SQLite;
5. integration tests на disposable Docker fixtures Legacy/AWG2/AWG3.1, включая
   одновременную работу AWG2 и AWG3.1;
6. browser smoke для login, import и одноразовой выдачи;
7. secret scan, dependency scan и image scan;
8. сборку multi-arch image и helper binaries;
9. генерацию checksums, provenance и SBOM;
10. подпись release artifacts и публикацию semver release.

Релиз не публикуется при несовместимости OpenAPI/RPC, неуспешном rollback test или обнаружении секрета в artifact/log fixture.

## 23. Тестовая стратегия

### Unit

- парсеры Legacy/AWG2/AWG3.1, неизвестные поля и round-trip;
- классификация 3.0 как read-only и запрет ошибочного fallback AWG3 → AWG2;
- клиентский шаблон AWG3.1 содержит обязательные общие параметры без сохранения
  private key после одноразовой выдачи;
- counter reset и traffic aggregation;
- quota/expiry и timezone boundaries;
- state machine Connection;
- redaction и запрет sensitive logging;
- idempotency и conflict detection.

### Integration

- discovery без мутаций;
- create → stats → suspend → resume → revoke;
- внешний конфликт config fingerprint;
- syntax failure и полный rollback;
- недоступный Panel при локальном `awgctl enforce`;
- helper/API version negotiation;
- SQLite backup/migration/restore.

### Security

- forced-command не даёт shell, PTY или forwarding;
- helper отклоняет path/container/command injection;
- SSH host-key mismatch блокирует Node;
- config response не кэшируется и не логируется;
- повтор issuance не возвращает private key;
- CSRF, session fixation, rate limit и TOTP recovery.

### End-to-end

- установка чистой Panel;
- регистрация тестового Node;
- read-only импорт существующих peers;
- создание и локальный QR;
- проверка статистики и квоты;
- безопасное удаление без удаления Amnezia/peers.

## 24. Пилот на сервере Play&Say

Play&Say — первый production-like compatibility target, но не зависимость продукта.

Порядок пилота:

1. Повторно проверить DNS, SSH host key и runtime inventory.
2. Установить helper в dry-run/read-only режиме.
3. Выполнить discovery обоих AWG-инстансов.
4. Сравнить количество и public-key fingerprints peers с исходным runtime, не извлекая private/PSK.
5. Импортировать peers только как `observed`.
6. Убедиться, что nginx, Docker, k3s и оба AWG-контейнера не перезапускались.
7. Создать snapshot.
8. После отдельного разрешения создать одно disposable Connection.
9. Проверить подключение, handshake и traffic counters.
10. Отозвать только disposable Connection и проверить отсутствие изменений у остальных peers.
11. Проверить rollback и uninstall safety на тестовом Instance до расширения управления.

Первый пилот не меняет существующие пользовательские peers, firewall, nginx, Docker daemon или Kubernetes.

## 25. Критерии готовности v1

v1 считается готовой, когда:

- чистая установка Panel и Helper документирована и воспроизводима на всех заявленных ОС/архитектурах;
- Legacy, AWG2 и AWG3.1 проходят одинаковый lifecycle contract;
- AWG2 и AWG3.1 одновременно обнаруживаются как разные Instances, а мутация
  одного не меняет container ID, config fingerprint, peer count или uptime другого;
- импорт не изменяет исходные конфигурации;
- выдаваемый client config/QR доступен только один раз и не остаётся в БД/логах;
- create/suspend/resume/revoke выполняются без рестарта контейнера;
- ошибка применения восстанавливает byte-equivalent поддерживаемые данные исходной конфигурации;
- expiry/quota применяется Node не позднее 90 секунд при выключенной Panel;
- totals корректны после counter reset/restart;
- uninstall не удаляет Amnezia и peers;
- security, integration и browser smoke проходят в CI;
- пилот Play&Say завершён без простоя и без изменения существующих peers.

## 26. Следующие версии

После v1 могут рассматриваться OIDC, end-user portal, PostgreSQL, HA workers, global user/quota across Nodes, уведомления, API tokens, managed Amnezia installation и дополнительные WireGuard-совместимые адаптеры. Эти возможности не должны усложнять или ослаблять безопасность v1 до появления подтверждённой потребности.

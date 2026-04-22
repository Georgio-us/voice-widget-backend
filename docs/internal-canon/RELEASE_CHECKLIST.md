# VIA Release Checklist (Short)

## 1) Env (backend)
- `TELEGRAM_INTERACTIVE_TOKEN` задан
- `SUPER_ADMIN_ID` / `OWNER_TG_ID` заданы
- `SUBSCRIPTION_KEY_PEPPER` задан (не пустой)
- `TELEGRAM_INITDATA_ENFORCE_ADMIN=1`
- `TELEGRAM_INITDATA_ALLOW_LEGACY_TGID=0`
- `EXIT_ON_UNCAUGHT_EXCEPTION=1`
- `EXIT_ON_UNHANDLED_REJECTION=0`

## 2) Env (frontend)
- `VW_API_URL` указывает на нужный backend
- `VW_CARDS_SEARCH_URL` указывает на нужный backend
- `VW_SHARE_BASE_URL` указывает на нужный frontend
- `TELEGRAM_BOT_USERNAME` корректный

## 3) DB / migrations
- Выполнены SQL:
  - `001_stage1_foundation.sql`
  - `002_olx_integrations.sql`
  - `003_client_residential_complexes.sql`
  - `004_specs_area_m2_decimal.sql`
  - `005_subscriptions.sql`

## 4) Smoke
- Backend: `npm --prefix Voice-Widget-Backend run smoke:soft`
- Frontend: `npm --prefix Voice-Widget-Frontend run smoke:soft`
- Оба PASS

## 5) Runtime checks
- Mini App открывается без 403/500
- Кнопка “Найдено/Доступно объектов” работает стабильно
- Слайдер и список отображаются и листаются
- `Подробнее` / `Читать описание` работают без вылезания контейнеров
- В list+slider не ломается `cardId` (нет дубликатов/пропаданий)

## 6) Subscriptions
- В “Управление подпиской” видно текущий статус
- Генерация ключей (super-admin) работает
- Активация ключа owner-ом работает
- После активации в БД есть актуальная `owner_subscriptions` запись

## 7) Telegram transport
- Webhook установлен и отвечает 200
- Нет постоянных `409 Conflict: getUpdates`

## 8) Debug sanity
- Online/Debug доступен только super-admin
- Debug Insights показывает актуальные:
  - interpreted insights
  - effective filters
  - timing/tokens
  - last turn dialog
  - candidates/cards


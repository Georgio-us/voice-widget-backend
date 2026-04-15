# Подписки: текущая модель работы

Этот документ фиксирует фактическую логику подписок в текущей реализации backend.
Ниже описано "как работает сейчас", без проектных вариантов "как могло бы быть".

## 1) Где и как хранятся ключи

- Ключи и активации хранятся в БД конкретного клиентского окружения:
  - `license_keys`
  - `license_redemptions`
  - `owner_subscriptions`
- Ключ, созданный в одном клиентском окружении, не переносится в другое.
- Проверка ключа идет по `key_hash`, который зависит от `SUBSCRIPTION_KEY_PEPPER` текущего backend-окружения.

Следствие:
- Если у вас 25 клиентов (25 отдельных backend/db), то у каждого своя независимая история ключей и активаций.

## 2) Кто может что делать

- Генерация ключей (`POST /api/admin/subscriptions/keys/create`) — только `super_admin`.
- Просмотр статистики ключей (`GET /api/admin/subscriptions/keys/stats`) — только `super_admin`.
- Активация ключа (`POST /api/admin/subscriptions/redeem`) — `owner` и `super_admin`.

## 3) На кого применяется активация

Текущая логика `redeem`:

- Если активацию делает `owner`: подписка активируется на его `tgUserId`.
- Если активацию делает `super_admin`: подписка активируется на
  1. `ownerTgId` из запроса (если явно передан),
  2. иначе `OWNER_TG_ID` из ENV текущего клиентского backend.

Важно:
- `tgUserId` из body не используется как target-owner в super-admin сценарии.
- Это сделано, чтобы супер-админ не "сжигал" ключи на себя при активации в клиентском боте.

## 4) Что происходит при повторной активации

Текущая модель: **replace (перезапись)**, не accumulate.

При каждой успешной активации:
1. Все текущие активные подписки owner помечаются как `expired`.
2. Создается новая запись `active` с `starts_at = now`.
3. `ends_at` вычисляется только по новому ключу.

Это значит:
- `30 дней` + `30 дней` => не `60`, а новая `30` от времени второй активации.
- `год` + `7 дней` => год закрывается, активной становится `7 дней`.
- `7 дней` + `30 дней` => активной становится `30 дней`.

## 5) Почему ключ может не активироваться

Частые причины:
- `KEY_NOT_FOUND` — ключ не найден в этой БД/окружении.
- `KEY_REDEMPTIONS_EXHAUSTED` — ключ исчерпал лимит активаций.
- `KEY_DISABLED` — ключ отключен.
- `KEY_EXPIRED` / `KEY_NOT_ACTIVE_YET` — ключ вне окна валидности.
- `KEY_ISSUED_TO_OTHER_OWNER` — ключ выпущен под другого owner.
- `FORBIDDEN_OWNER_ONLY` — пользователь не owner/super_admin.

## 6) Что блокируется без активной подписки

Для owner без активной подписки `isAdmin = false`, поэтому часть админ-функций возвращает `403 SUBSCRIPTION_REQUIRED`, например:

- добавление/редактирование объектов,
- отдельные админ-операции по ЖК,
- OLX connect/status/sync.

При этом активация ключа (`/subscriptions/redeem`) остается доступной owner/super_admin.

## 7) Практический процесс (как работать без ошибок)

1. Супер-админ генерирует ключ в нужном клиентском окружении.
2. Передает ключ владельцу, либо активирует сам из интерфейса этого клиента.
3. Проверяет результат в БД:
   - `owner_subscriptions.owner_tg_id` = owner клиента,
   - `owner_subscriptions.activated_by_tg_id` = кто фактически нажал активацию.
4. Проверяет, что gated-функции перестали отдавать `SUBSCRIPTION_REQUIRED`.

## 8) Минимальный SQL для проверки

```sql
SELECT id, owner_tg_id, plan, status, starts_at, ends_at, activated_by_tg_id, note
FROM owner_subscriptions
ORDER BY id DESC
LIMIT 10;
```

```sql
SELECT id, license_key_id, redeemed_by_tg_id, redeemed_at, key_last4, request_meta
FROM license_redemptions
ORDER BY id DESC
LIMIT 20;
```

```sql
SELECT id, plan, key_last4, is_enabled, redemptions_count, max_redemptions, issued_to_tg_id, issued_by_tg_id
FROM license_keys
ORDER BY created_at DESC
LIMIT 20;
```

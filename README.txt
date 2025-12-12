Voice Widget — краткое описание проекта и окружения

1) Структура проекта
- Frontend (виджет): /Users/georgious/Desktop/Voice-Widget-Frontend
  • Основной веб‑компонент: voice-widget-v1.js (вставляется на сайт через loader.js или напрямую тегом <voice-widget>)
  • Клиент API: modules/api-client.js (отправка аудио/текста, получение карточек, обработка скрытых команд)
  • Стили и ассеты: voice-widget.css, assets/*

- Backend (API): /Users/georgious/Desktop/Voice-Widget-Backend
  • Точка входа: index.js (Express)
  • Основной диалог/аудио: /api/audio/upload (+ /api/audio/interaction, /api/audio/session/:id, /api/audio/stats, /api/audio/health)
  • Cards API (подбор карточек): /api/cards/search, /api/cards/:id (routes/cardRoute.js)
  • Слой БД: services/db.js (Postgres/pg), services/propertiesRepository.js (запросы к таблице properties)
  • Импорт данных в БД: scripts/importFromCSV.js, scripts/importFromXlsx.js, scripts/importFromJs.js

2) Окружение (Railway + Postgres)
- Бэкенд деплоится на Railway.
- База данных Postgres — также в Railway. Таблица properties заполняется из CSV/XLSX/JS через скрипты в папке scripts/.
- Изображения карточек предполагаются доступными по публичным URL (можно хранить в S3/R2/CDN и класть URL в БД).

3) Какие файлы можно импортировать в БД
- CSV: scripts/importFromCSV.js — читает /data/properties.csv и пишет в таблицу properties.
- XLSX: scripts/importFromXlsx.js — читает /data/properties.xlsx.
- JS: scripts/importFromJs.js — импортирует из /data/properties.js (массив объектов).
  Примечание: скрипты ожидают адекватные поля (external_id, location_*, specs_*, price_amount и т.д.) и приводят массивы/объекты к JSON‑строкам при вставке.

4) Где хранится .env и почему его нет в репозитории
- .env не коммитится намеренно (в .gitignore), т.к. содержит секреты.
- Локально: создайте файл /Users/georgious/Desktop/Voice-Widget-Backend/.env и положите туда переменные вида:
    OPENAI_API_KEY=sk-...
    DATABASE_URL=postgres://user:pass@host:port/db
  index.js загружает dotenv (или импортируется раньше), поэтому переменные попадут в process.env.
- На Railway: переменные задаются в Dashboard → Variables. Отдельного физического .env там нет — платформа прокидывает значения в окружение процесса.

5) Почему API‑ключа “нет в корне проекта”
- Ключ OpenAI хранится только в переменных окружения (process.env.OPENAI_API_KEY). Это исключает утечки при коммите/деплое.
- Фронтенд ключ не знает и не использует — все вызовы к OpenAI идут с бэкенда.

6) Где находится DATABASE_URL
- Локально: в .env (или в окружении терминала), читается в services/db.js из process.env.DATABASE_URL.
- На проде (Railway): в разделе Variables у сервиса бэкенда. Код берёт значение через process.env.

7) Как фронтенд определяет URL бэкенда (apiUrl)
- Внутри voice-widget-v1.js (resolveApiUrl) есть автодетект:
  • Порядок приоритета: ?vwApi=… → window.__VW_API_URL__ → localStorage('vw_api_url') → если hostname локальный → http://localhost:3001/api/audio/upload → иначе продовый fallback.
  • Тег <voice-widget> может получить атрибут api-url=".../api/audio/upload" (например, через loader.js).
  • В рантайме можно вызвать setApiUrl(url) у компонента — сохранится в localStorage и попадёт в APIClient.

8) Откуда берутся карточки (сейчас)
- Основной диалоговый эндпоинт /api/audio/upload и обработчик /api/audio/interaction используют данные из Postgres (services/propertiesRepository.js). Ранее использовался /data/properties.js, но логика перенесена.
- Дополнительно есть отдельный Cards API: /api/cards/search и /api/cards/:id (routes/cardRoute.js). Фронт может обращаться к нему (APIClient уже содержит хелперы).

9) Быстрый старт (локально)
- Backend:
  • cd Voice-Widget-Backend && npm i
  • Создать .env с OPENAI_API_KEY и DATABASE_URL (можно указывать Railway‑URL)
  • npm run dev (или npm start)
  • Импортировать данные: node scripts/importFromCSV.js / importFromXlsx.js / importFromJs.js

- Frontend:
  • Открыть index.html (демо) или подключить виджет через loader.js на любую страницу.
  • При необходимости явно задать API URL через window.__VW_API_URL__ либо параметром ?vwApi=...

10) Примечания по продакшену
- Индексы в БД: полезно проиндексировать location_city, location_district, specs_rooms, price_amount (+ композитные при необходимости).
- Миграции и бэкапы: хранить SQL/миграции, настроить регулярные бэкапы Railway.
- Безопасность: не логировать секреты; включить SSL к Postgres (PGSSLMODE=require или ssl: { rejectUnauthorized:false }).


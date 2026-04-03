# Снимок кодов OLX `attributes` (автогенерация)

Файл **перезаписывается** скриптом после успешного запроса к БД:

```bash
cd Voice-Widget-Backend
DATABASE_URL="postgresql://..." npm run analyze:olx-attributes
```

Пока скрипт не выполнялся в окружении с доступом к Postgres, таблиц с реальными `code` здесь нет.  
После прогона скопируйте блок **«Предлагаемый маппинг»** и таблицу частот в `DOCS_DATA_MAPPING.md` → часть C.

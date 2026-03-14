# Backend IIR Attendance

Сервер на Node.js (Express), PostgreSQL, опционально Google Sheets.

## Структура

- `server.js` — точка входа, подключение маршрутов
- `config.js` — переменные окружения и константы
- `util/` — genId, isValidId, haversine
- `services/` — db (пул), auth (токены преподавателя), rateLimit, sheets
- `routes/` — health, auth, sessions, check, attendances

## Запуск

```bash
npm install
cp .env.example .env   # при необходимости
# Заполнить .env: DATABASE_URL, TEACHER_SECRET, опционально GOOGLE_SHEETS_*
node server.js
```

Порт задаётся через `PORT` (по умолчанию 4000).

## Переменные окружения

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `DATABASE_URL` | да | Строка подключения PostgreSQL |
| `TEACHER_SECRET` | да | Секретный код преподавателя (надёжный пароль) |
| `GOOGLE_SHEETS_CREDENTIALS` | нет | JSON сервисного аккаунта для Google Sheets |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | нет | ID таблицы для записи посещаемости |
| `LOCAL_TZ` | нет | Часовой пояс для дат (по умолчанию Asia/Novosibirsk) |
| `PGSSLMODE` | нет | `disable` — отключить SSL для БД |

## Защита и нагрузка

- Rate limit на ввод кода: 5 попыток / 15 мин на IP
- Rate limit на `/api/check`: 120 запросов/мин на IP
- Rate limit на `/api/attendances`: 60 запросов/мин на IP
- Пул БД: до 20 соединений, подходит для ~100 одновременных пользователей

## Миграция БД

При первом развёртывании выполнить `schema.sql`. Если БД уже была создана до появления колонки `parent_qr_token`, выполнить:

```sql
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS parent_qr_token text;
```

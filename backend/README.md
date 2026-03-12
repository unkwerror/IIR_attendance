## NSU Attendance — backend

Этот каталог содержит бэкенд для системы честной отметки посещаемости.

### Стек

- **Node.js + Express**
- **PostgreSQL** (рекомендуется Supabase/Neon/Railway)

Сейчас в `server.js` данные хранятся **в памяти** (Map), чтобы можно было сразу начать интеграцию фронтенда. После того как всё будет отлажено, можно заменить это на реальные запросы в БД.

### Основные эндпоинты

- `POST /api/sessions` — создать сессию
- `POST /api/sessions/:id/qr-token` — сгенерировать новый QR‑токен
- `POST /api/check` — проверка студента по QR (до формы)
- `POST /api/attendances` — отправка формы (ФИО/группа)
- `GET /api/sessions/:id/attendances` — список отмеченных студентов
- `POST /api/sessions/:id/end` — завершить сессию

### Локальный запуск

```bash
cd backend
npm install
npm run dev
```

По умолчанию сервер стартует на `http://localhost:4000`.

### Где бесплатно хостить

- **Бэкенд (Node.js)**:
  - **Render** — бесплатный web service (Node), простой деплой из GitHub.
  - **Railway** — тоже есть бесплатный tier, удобный деплой Node.
- **PostgreSQL (БД)**:
  - **Supabase** — щедрый бесплатный план, удобная админка и REST.
  - **Neon** — serverless PostgreSQL, тоже есть free tier.

Один из простых вариантов:

1. Создать Supabase‑проект (PostgreSQL) и выписать `DATABASE_URL`.
2. На Render создать новый **Web Service** из GitHub‑репозитория.
3. В Render задать переменную окружения `DATABASE_URL` (из Supabase).
4. Команда запуска: `npm install && npm run start` в каталоге `backend`.

Фронтенд (`index.html`) можно продолжать хостить на **GitHub Pages** или **Cloudflare Pages**, настроив запросы к API по URL, который выдаст Render.


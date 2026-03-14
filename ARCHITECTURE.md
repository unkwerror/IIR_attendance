# Архитектура приложения IIR Attendance

## Структура проекта

```
IIR_attendance/
├── index.html              # Единая точка входа (разметка + подключаемые скрипты)
├── assets/
│   ├── css/
│   │   └── main.css        # (опционально) вынесенные стили
│   ├── js/
│   │   ├── config.js       # API_BASE, константы
│   │   ├── api.js          # Все запросы к бэкенду
│   │   ├── auth.js         # Токен преподавателя (sessionStorage)
│   │   ├── particles.js    # Анимация частиц
│   │   └── app.js          # Инициализация, экраны, логика
│   └── startup.mp4         # Видео сплэша
├── backend/
│   ├── server.js           # Точка входа Express
│   ├── config.js           # Env и константы
│   ├── util/
│   │   ├── id.js           # genId, isValidId
│   │   └── haversine.js    # Расстояние по координатам
│   ├── services/
│   │   ├── db.js           # Пул PostgreSQL
│   │   ├── auth.js         # Токены преподавателя, constant-time сравнение
│   │   ├── rateLimit.js    # Лимиты по IP (verify, check, attendances)
│   │   └── sheets.js       # Google Sheets
│   └── routes/
│       ├── health.js       # GET /health
│       ├── auth.js         # verify-teacher, check-teacher-token
│       ├── sessions.js     # sessions CRUD, qr-token, attendances list
│       ├── check.js        # POST /api/check (проверка QR студентом)
│       └── attendances.js  # POST /api/attendances
├── backend/schema.sql      # Миграции БД
└── DEPLOY.md               # Инструкции деплоя
```

## Бэкенд (рефакторинг выполнен)

- **Модули**: конфиг, утилиты, сервисы (db, auth, rateLimit, sheets), маршруты.
- **Без дублирования**: общие функции (genId, isValidId, haversine) и лимиты в одном месте.
- **Безопасность**:
  - Секрет преподавателя только в env, сравнение через `crypto.timingSafeEqual`.
  - Rate limit на ввод кода: 5 попыток / 15 мин на IP.
  - Rate limit на `/api/check`: 120 запросов/мин на IP (до ~100 пользователей).
  - Rate limit на `/api/attendances`: 60 запросов/мин на IP.
  - Валидация длины полей и формата id (8–64 символа, буквы/цифры).
- **Нагрузка (~100 пользователей)**:
  - Пул БД: `max: 20`, `idleTimeoutMillis: 30000`.
  - Лимиты защищают от флуда одним клиентом; 100 студентов дают порядка 100 check + 100 attendances в минуту — укладывается в лимиты.

## Фронтенд (рекомендуемая структура)

- **config.js**: `window.APP_CONFIG = { apiBase: 'https://...' }`, парсинг URL-параметров.
- **api.js**: объект с методами `checkTeacherToken()`, `verifyTeacher(code)`, `createSession(body)`, `getQrToken(sessionId, interval)`, `check(body)`, `submitAttendance(body)`, `getAttendances(sessionId)` — все через `fetch(APP_CONFIG.apiBase + ...)`.
- **auth.js**: `getTeacherToken()`, `setTeacherToken(t)`, `clearTeacherToken()` на базе `sessionStorage`.
- **particles.js**: уже вынесен, `startParticles(canvasId, preset)`.
- **app.js**: инициализация (звёзды, сплэш), `show(id)`, экраны (teacher-code, setup, teacher, student), `runCheck`, `startSession`, геолокация, QR, опрос списка посещаемости. Использует только `APP_CONFIG`, `AttendanceApi`, `Auth`, `startParticles` — без дублирования вызовов API и работы с токеном.

Подключение в `index.html`:

```html
<link rel="stylesheet" href="assets/css/main.css">
<script src="assets/js/config.js"></script>
<script src="assets/js/api.js"></script>
<script src="assets/js/auth.js"></script>
<script src="assets/particles.js"></script>
<script src="assets/js/app.js"></script>
```

## Защита и ограничения

| Угроза | Реализация |
|--------|------------|
| Перебор кода преподавателя | Rate limit 5 попыток / 15 мин на IP |
| Пересылка QR / флуд check | Лимит 120 check/мин на IP, короткое время жизни QR-токена (макс 30 с) |
| Массовая отправка attendances | Лимит 60 attendances/мин на IP |
| Подделка токенов | Криптостойкие id (crypto.randomBytes), одноразовые токены с привязкой к fingerprint |
| Утечка секрета | TEACHER_SECRET только в env на сервере, constant-time сравнение |

## Деплой

См. **DEPLOY.md**: миграция БД (`parent_qr_token`), переменные окружения, деплой бэкенда и фронта.

# Деплой изменений IIR Attendance

## 1. База данных (миграция)

Если БД уже была создана **до** добавления колонки `parent_qr_token`, выполните один раз в клиенте PostgreSQL (Supabase SQL Editor, Render Shell, pgAdmin и т.п.):

```sql
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS parent_qr_token text;
```

Если поднимаете БД с нуля — просто выполните весь `backend/schema.sql`, колонка создастся автоматически.

---

## 2. Бэкенд (Render)

1. Закоммитьте и запушьте изменения в репозиторий, с которым связан сервис на Render:
   ```bash
   git add .
   git commit -m "Security: QR anti-forward, rate limit, validation"
   git push origin main
   ```
2. Render сам пересоберёт и перезапустит сервис после push (если включён Auto-Deploy).
3. Если Auto-Deploy выключен — зайдите в Dashboard → ваш Web Service → **Manual Deploy** → **Deploy latest commit**.

Проверка: откройте `https://iir-attendance.onrender.com/health` — должен вернуться JSON с `"status":"ok"`.

---

## 3. Фронтенд (GitHub Pages / Cloudflare Pages)

1. Убедитесь, что в репозитории есть:
   - `index.html` в корне (или в папке `docs/` для GitHub Pages)
   - папка **`assets/`** с файлом **`assets/startup.mp4`** (иначе сплэш без видео)
2. Закоммитьте и запушьте:
   ```bash
   git add index.html assets/
   git commit -m "Front: splash, anti-cheat UI, qr_code_overused message"
   git push origin main
   ```
3. **GitHub Pages:** если сайт из ветки `main` и папки `/` (root) — после push страница обновится сама (иногда с задержкой 1–2 мин).
4. **Cloudflare Pages:** привязан к тому же репо — сборка запустится по push; дождитесь окончания деплоя.

В `index.html` уже указан бэкенд: `API_BASE = 'https://iir-attendance.onrender.com'`. Менять нужно только если меняете URL бэкенда.

---

## 4. Что проверить после деплоя

| Что | Как |
|-----|-----|
| Бэкенд жив | Открыть `https://iir-attendance.onrender.com/health` |
| Фронт открывается | Открыть ваш URL сайта (GitHub Pages / Cloudflare) |
| Сплэш с видео | На сайте должна быть анимация/видео при загрузке |
| Вход преподавателя | Ввести код, создать сессию |
| Отметка студента | Отсканировать QR, пройти проверку, ввести ФИО и группу |
| Защита от пересылки | Интервал QR не больше 30 сек; при >45 устройствах на один код — сообщение «Код перегружен» |

---

## Переменные окружения (бэкенд на Render)

В **Environment** должны быть заданы:

- `DATABASE_URL` — строка подключения к PostgreSQL
- `TEACHER_SECRET` — секретный код преподавателя (надёжный пароль)
- По желанию: `GOOGLE_SHEETS_CREDENTIALS`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `LOCAL_TZ`

После смены переменных на Render нажмите **Save** и при необходимости сделайте **Manual Deploy**.

# Подробная инструкция по деплою IIR Attendance (после рефакторинга)

После рефакторинга бэкенд разбит на модули: `config.js`, `routes/`, `services/`, `util/`. Деплой по шагам ниже.

---

## Подготовка в репозитории

1. Убедитесь, что в репозитории есть вся структура:
   - **Корень:** `index.html`, папка `assets/` (в ней `particles.js`, `startup.mp4`).
   - **Бэкенд:** папка `backend/` с файлами:
     - `server.js`, `config.js`
     - `package.json`, `package-lock.json`
     - папки: `routes/`, `services/`, `util/`
     - `schema.sql`
2. В `index.html` проверьте URL бэкенда (строка с `API_BASE`). Для Render обычно:
   ```javascript
   const API_BASE = 'https://iir-attendance.onrender.com';
   ```
   Замените на ваш URL, если он другой.

---

## 1. База данных (миграция)

### Вариант А: БД с нуля

Если создаёте новую БД (Render PostgreSQL, Supabase, Neon и т.п.):

1. Создайте базу и получите **Connection string** (например `postgres://user:pass@host:5432/dbname`).
2. В SQL-клиенте (Supabase SQL Editor, Render Shell, pgAdmin, `psql`) выполните **целиком** содержимое файла `backend/schema.sql`.

После этого таблицы `sessions`, `qr_tokens`, `attendances` и колонка `parent_qr_token` уже будут на месте.

### Вариант Б: БД уже была (до рефакторинга)

Если таблицы уже созданы, но колонки `parent_qr_token` в `qr_tokens` могло не быть, выполните один раз:

```sql
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS parent_qr_token text;
```

Проверка: в таблице `qr_tokens` должна быть колонка `parent_qr_token` (тип `text`, может быть NULL).

---

## 2. Бэкенд на Render

### 2.1. Создание сервиса (если ещё нет)

1. Зайдите на [render.com](https://render.com) → **Dashboard** → **New** → **Web Service**.
2. Подключите репозиторий с проектом IIR Attendance.
3. Укажите:
   - **Name:** например `iir-attendance` (или как у вас уже есть).
   - **Region:** выберите ближайший.
   - **Branch:** `main` (или ваша основная ветка).
   - **Root Directory:** укажите **`backend`** (важно: не корень репо, а папка с `server.js` и `package.json`).
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Environment:**
   - Добавьте переменные (см. раздел «Переменные окружения» ниже).
   - Обязательно: `DATABASE_URL`, `TEACHER_SECRET`.

### 2.2. Если сервис уже создан (обновление после рефакторинга)

1. В настройках Web Service проверьте:
   - **Root Directory** = **`backend`** (чтобы Render запускал `npm start` из папки с `server.js` и модулями).
2. Если Root Directory был пустым или корнем репо — поменяйте на `backend` и сохраните.
3. Убедитесь, что **Build Command** = `npm install`, **Start Command** = `npm start`.

### 2.3. Деплой кода

1. Закоммитьте и запушьте все изменения:
   ```bash
   cd /path/to/IIR_attendance
   git add .
   git status   # проверьте, что попали backend/, index.html, assets/
   git commit -m "Refactor: modular backend, single particle layer, smooth transitions"
   git push origin main
   ```
2. Если на Render включён **Auto-Deploy** — сервис сам пересоберётся и перезапустится после push.
3. Если Auto-Deploy выключен: **Dashboard** → ваш Web Service → **Manual Deploy** → **Deploy latest commit**.

### 2.4. Переменные окружения (бэкенд)

В **Dashboard** → ваш Web Service → **Environment** должны быть:

| Ключ | Обязательно | Пример / описание |
|------|-------------|-------------------|
| `DATABASE_URL` | Да | `postgres://user:password@host:5432/dbname?sslmode=require` — полная строка подключения к PostgreSQL. |
| `TEACHER_SECRET` | Да | Секретный код преподавателя (сильный пароль). Хранится только на сервере. |
| `PORT` | Нет | Render задаёт сам; при необходимости можно переопределить. |
| `GOOGLE_SHEETS_CREDENTIALS` | Нет | JSON сервисного аккаунта Google (строка в одну строку) для записи посещаемости в таблицу. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Нет | ID таблицы Google Sheets (из URL). |
| `LOCAL_TZ` | Нет | Часовой пояс для дат в таблице, например `Europe/Moscow` или `Asia/Novosibirsk`. |
| `PGSSLMODE` | Нет | Значение `disable` только если БД не использует SSL. |

После смены переменных нажмите **Save**. При необходимости сделайте **Manual Deploy**.

### 2.5. Проверка бэкенда

- Откройте в браузере: `https://ВАШ-СЕРВИС.onrender.com/health`
- Ожидаемый ответ: `{"status":"ok","time":"2026-03-..."}`

Если видите 503 или ошибку — смотрите **Logs** в Render (часто причина: неверный `DATABASE_URL` или БД недоступна из интернета, например по IPv6).

---

## 3. Фронтенд (GitHub Pages или Cloudflare Pages)

### 3.1. Что должно быть в репозитории

- В корне (или в папке `docs/` для GitHub Pages из `docs/`):
  - `index.html`
  - папка **`assets/`** с файлами:
    - `particles.js`
    - `startup.mp4`

Без `assets/particles.js` и `assets/startup.mp4` сплэш и частицы будут работать не так или не найдутся.

### 3.2. Деплой

1. Закоммитьте и запушьте фронт (если ещё не пушили вместе с бэкендом):
   ```bash
   git add index.html assets/
   git commit -m "Front: smooth transitions, single particle layer"
   git push origin main
   ```
2. **GitHub Pages:**  
   - **Settings** → **Pages** → Source: ветка `main`, папка `/` (root).  
   - После push страница обновится сама (иногда с задержкой 1–2 минуты).  
   - Если сайт из папки `docs/` — положите `index.html` и `assets/` в `docs/`.
3. **Cloudflare Pages:**  
   - Проект привязан к тому же репо — сборка запустится по push.  
   - Build output directory обычно `dist` или корень; для статики без сборки укажите корень и соберите только при необходимости.  
   - Дождитесь окончания деплоя в панели Cloudflare.

### 3.3. URL бэкенда во фронте

В `index.html` в начале скрипта задаётся:

```javascript
const API_BASE = 'https://iir-attendance.onrender.com';
```

Замените на ваш реальный URL бэкенда (как в разделе «Проверка бэкенда»), если он другой. После смены снова сделайте commit и push фронта.

---

## 4. Проверка после деплоя

| Шаг | Действие |
|-----|----------|
| 1 | Открыть `https://ВАШ-БЭКЕНД.onrender.com/health` → JSON с `"status":"ok"`. |
| 2 | Открыть URL фронта (GitHub Pages / Cloudflare) → загружается страница, показывается сплэш с анимацией и частицами. |
| 3 | После сплэша — экран ввода кода преподавателя; ввести `TEACHER_SECRET` → переход на экран настройки сессии. |
| 4 | Заполнить предмет, интервал QR, при желании геолокацию → «ЗАПУСТИТЬ СЕССИЮ» → экран с QR-кодом. |
| 5 | С телефона или второго браузера открыть ссылку из QR (или вставить URL с `?sid=...&t=...`) → проверка → форма ФИО/группа → отправка → «Вы отмечены!». |
| 6 | На экране преподавателя список отмеченных обновляется; переходы между экранами плавные, частицы не сбрасываются. |

---

## 5. Частые проблемы

- **Бэкенд не стартует / 503:**  
  - Проверьте **Root Directory** = `backend`.  
  - Проверьте в логах Render ошибки по `DATABASE_URL` (хост, пароль, SSL).  
  - Для Render лучше использовать их же PostgreSQL (внутренний хост), внешний Supabase/Neon иногда блокируется по сети.

- **Фронт не находит бэкенд (сеть / CORS):**  
  - В коде бэкенда уже стоит `cors({ origin: '*' })`.  
  - Убедитесь, что во фронте `API_BASE` указывает на тот же URL, что открывается в браузере для `/health`.

- **Нет видео/частиц на сплэше:**  
  - Проверьте, что в репо (и в папке деплоя) есть `assets/startup.mp4` и `assets/particles.js`, и что запросы к ним не отдают 404.

- **«Session not found» / «invalid token»:**  
  - Обычно это из-за того, что фронт ходит на другой бэкенд (другой URL или старый инстанс). Сверить `API_BASE` и перезапустить/задеплоить бэкенд при необходимости.

---

## Краткий чеклист деплоя

1. [ ] БД: выполнен `schema.sql` или миграция `parent_qr_token`.
2. [ ] Render: Root Directory = `backend`, Build = `npm install`, Start = `npm start`.
3. [ ] Render: заданы `DATABASE_URL` и `TEACHER_SECRET` (и при необходимости Google Sheets + `LOCAL_TZ`).
4. [ ] В репо запушены все изменения (в т.ч. `backend/` с модулями).
5. [ ] Во фронте в `index.html` указан правильный `API_BASE`.
6. [ ] В репо есть `index.html` и `assets/` (particles.js, startup.mp4).
7. [ ] Проверены `/health`, сплэш, вход преподавателя, создание сессии, отметка студента и плавные переходы.

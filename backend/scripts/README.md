# Scripts Guide

Быстрый справочник по скриптам в `backend/scripts`.

## Структура

- `cleanup/` — очистка тестовых данных из БД и Google Sheets
- `loadtest/` — нагрузочные сценарии `k6`
- `utils/` — вспомогательные утилиты скриптов

## Базовые условия

Запускать из папки `backend`:

```bash
cd /home/www1rt/Documents/IIR_attendance/backend
```

Для всех `k6`-скриптов обязательны:

- `BASE_URL`
- `TEACHER_CODE`

Если `TEACHER_CODE` содержит `$`, передавайте в одинарных кавычках:

```bash
TEACHER_CODE='abc$123'
```

---

## Cleanup (очистка данных)

Файлы:

- `scripts/cleanup/cleanup-attendances.js`
- `scripts/cleanup/cleanup-config.json`

### 1) Сначала проверка (без удаления)

```bash
node scripts/cleanup/cleanup-attendances.js \
  --config scripts/cleanup/cleanup-config.json \
  --dry-run
```

### 2) Реальное удаление

```bash
node scripts/cleanup/cleanup-attendances.js \
  --config scripts/cleanup/cleanup-config.json \
  --execute
```

Для БД нужен `DATABASE_URL`.  
Для Google Sheets дополнительно нужны `GOOGLE_SHEETS_CREDENTIALS` и `GOOGLE_SHEETS_SPREADSHEET_ID`.

---

## Loadtest: 80 users (базовый)

Файл: `scripts/loadtest/attendance-80.k6.js`

```bash
BASE_URL="https://iir-attendance.onrender.com" \
TEACHER_CODE='YOUR_TEACHER_CODE' \
USERS=80 \
QR_LIFETIME_SEC=15 \
k6 run scripts/loadtest/attendance-80.k6.js
```

---

## Loadtest: Ramp (плавный разгон)

Файл: `scripts/loadtest/attendance-ramp.k6.js`

```bash
BASE_URL="https://iir-attendance.onrender.com" \
TEACHER_CODE='YOUR_TEACHER_CODE' \
MAX_VUS=200 \
HOLD_SEC=90 \
QR_LIFETIME_SEC=15 \
THINK_TIME_SEC=0.2 \
k6 run scripts/loadtest/attendance-ramp.k6.js
```

---

## Loadtest: Mixed (часть повторных агентов)

Файл: `scripts/loadtest/attendance-mixed.k6.js`

```bash
BASE_URL="https://iir-attendance.onrender.com" \
TEACHER_CODE='YOUR_TEACHER_CODE' \
USERS=200 \
DUPLICATE_SHARE=0.35 \
QR_LIFETIME_SEC=15 \
THINK_TIME_SEC=0.15 \
k6 run scripts/loadtest/attendance-mixed.k6.js
```

`DUPLICATE_SHARE` — доля агентов, которые пробуют повторную регистрацию тем же fingerprint.

---

## Полезные опции

- `DEBUG=true` для детального лога в `k6`.
- Если `k6` не установлен:

```bash
sudo snap install k6
```

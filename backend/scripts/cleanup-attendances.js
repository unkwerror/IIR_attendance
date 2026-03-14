#!/usr/bin/env node
/**
 * Скрипт удаления неактуальных отметок из БД и Google Таблицы.
 * Оставляет только записи, у которых предмет (subject/Предмет) входит в список allowedSubjects из конфига.
 *
 * Запуск (конфиг обязателен — файл или env):
 *   node scripts/cleanup-attendances.js --config path/to/cleanup-config.json [--dry-run | --execute]
 *
 * Переменные окружения: .env в backend/ или в корне проекта.
 *   DATABASE_URL — обязательно (БД).
 *   GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEETS_SPREADSHEET_ID — нужны только для очистки Google Таблицы.
 */

import './load-env.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { pool } from '../services/db.js';
import { getSheetsClient } from '../services/sheets.js';
import { config } from '../config.js';

const USAGE = `Использование:
  node scripts/cleanup-attendances.js --config <путь к JSON> [--dry-run | --execute]
  или задайте конфиг в переменной CLEANUP_CONFIG_JSON (JSON-строка).

  --config   путь к файлу конфига (если не задан CLEANUP_CONFIG_JSON)
  --dry-run  только показать, что будет удалено (по умолчанию)
  --execute  выполнить удаление`;

function normalizeSubject(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function loadCleanupConfig() {
  const args = process.argv.slice(2);
  let dryRun = true;
  let configPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--execute') dryRun = false;
    else if (args[i] === '--config' && args[i + 1]) {
      configPath = path.resolve(process.cwd(), args[i + 1]);
      i++;
    }
  }

  const envConfig = process.env.CLEANUP_CONFIG_JSON;
  let raw = null;
  let source = null;

  if (configPath) {
    try {
      raw = fs.readFileSync(configPath, 'utf8');
      source = 'file';
    } catch (e) {
      console.error('Не удалось прочитать конфиг:', configPath, e.message);
      process.exit(1);
    }
  } else if (envConfig && String(envConfig).trim()) {
    raw = String(envConfig).trim();
    source = 'env';
  }

  if (!raw) {
    console.error('Не указан конфиг. Задайте --config <путь к JSON> или переменную CLEANUP_CONFIG_JSON.');
    console.error(USAGE);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Конфиг невалидный JSON:', source === 'env' ? '(CLEANUP_CONFIG_JSON)' : configPath, e.message);
    process.exit(1);
  }

  if (!Array.isArray(data.allowedSubjects) || data.allowedSubjects.length === 0) {
    console.error('В конфиге должен быть непустой массив allowedSubjects.');
    process.exit(1);
  }

  const allowedSubjects = data.allowedSubjects.map(normalizeSubject);
  const sheetName = data.sheetName != null ? data.sheetName : null;
  if (data.dryRun === false || data.execute === true) dryRun = false;

  return { allowedSubjects, sheetName, dryRun };
}

async function cleanupDatabase(allowedSubjects, dryRun) {
  const set = new Set(allowedSubjects);
  const { rows: sessions } = await pool.query(
    'SELECT id, subject, started_at FROM sessions ORDER BY started_at'
  );
  const toDelete = sessions.filter((s) => !set.has(normalizeSubject(s.subject)));
  const toKeep = sessions.filter((s) => set.has(normalizeSubject(s.subject)));

  console.log('\n--- База данных ---');
  console.log('Всего сессий:', sessions.length);
  console.log('Оставляем (subject в списке):', toKeep.length);
  console.log('Удаляем сессий (и их отметки каскадом):', toDelete.length);

  if (toDelete.length === 0) {
    console.log('Удалять нечего.');
    return { deletedSessions: 0 };
  }

  if (dryRun) {
    toDelete.forEach((s) => console.log('  [dry-run] удалить сессию:', s.id, '|', s.subject, '|', s.started_at));
    return { deletedSessions: toDelete.length, dryRun: true };
  }

  const ids = toDelete.map((s) => s.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
  await pool.query(`DELETE FROM sessions WHERE id IN (${placeholders})`, ids);
  console.log('Удалено сессий:', toDelete.length);
  return { deletedSessions: toDelete.length };
}

async function cleanupSheets(allowedSubjects, sheetName, dryRun) {
  const c = getSheetsClient();
  if (!c) {
    console.warn('\n--- Google Таблица ---');
    console.warn('GOOGLE_SHEETS_CREDENTIALS или GOOGLE_SHEETS_SPREADSHEET_ID не заданы, пропуск.');
    return { deletedRows: 0 };
  }

  const set = new Set(allowedSubjects);
  const range = sheetName ? `'${sheetName}'!A:D` : 'A:D';

  const { data } = await c.sheets.spreadsheets.values.get({
    spreadsheetId: c.spreadsheetId,
    range
  });
  const rows = data.values || [];
  if (rows.length === 0) {
    console.log('\n--- Google Таблица ---');
    console.log('Лист пуст или диапазон A:D не найден.');
    return { deletedRows: 0 };
  }

  const header = rows[0];
  const dataRows = rows.slice(1);
  const subjectCol = 3; // колонка D (Предмет), 0-based
  const kept = dataRows.filter((row) => {
    const subj = (row[subjectCol] ?? '').trim().toLowerCase();
    return set.has(subj);
  });
  const deletedCount = dataRows.length - kept.length;

  console.log('\n--- Google Таблица ---');
  console.log('Всего строк данных:', dataRows.length);
  console.log('Оставляем (Предмет в списке):', kept.length);
  console.log('Удалить строк:', deletedCount);

  if (deletedCount === 0) {
    console.log('Удалять нечего.');
    return { deletedRows: 0 };
  }

  if (dryRun) {
    console.log('[dry-run] В таблице остались бы только строки с Предмет:', allowedSubjects.join(', '));
    return { deletedRows: deletedCount, dryRun: true };
  }

  const newRows = [header, ...kept];
  const updateRange = sheetName ? `'${sheetName}'!A1:D${newRows.length}` : `A1:D${newRows.length}`;
  await c.sheets.spreadsheets.values.update({
    spreadsheetId: c.spreadsheetId,
    range: updateRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: newRows }
  });

  if (rows.length > newRows.length) {
    const clearStart = newRows.length + 1;
    const clearEnd = rows.length;
    const clearRange = sheetName ? `'${sheetName}'!A${clearStart}:D${clearEnd}` : `A${clearStart}:D${clearEnd}`;
    await c.sheets.spreadsheets.values.clear({
      spreadsheetId: c.spreadsheetId,
      range: clearRange
    });
  }

  console.log('Обновлено: оставлено строк', kept.length, ', старые данные ниже удалены.');
  return { deletedRows: deletedCount };
}

async function main() {
  const { allowedSubjects, sheetName, dryRun } = loadCleanupConfig();

  console.log('Актуальные предметы (оставляем только их):', allowedSubjects);
  console.log('Режим:', dryRun ? 'DRY-RUN (ничего не меняем)' : 'EXECUTE (удаляем)');

  if (!config.databaseUrl) {
    console.error('DATABASE_URL не задан. Добавьте в .env в backend/ или в корне: DATABASE_URL=postgresql://...');
    process.exit(1);
  }

  try {
    const dbResult = await cleanupDatabase(allowedSubjects, dryRun);
    const sheetsResult = await cleanupSheets(allowedSubjects, sheetName, dryRun);
    console.log('\nИтого:', {
      db: dbResult,
      sheets: sheetsResult
    });
    if (dryRun) {
      console.log('\nЧтобы выполнить удаление, запустите с флагом --execute');
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

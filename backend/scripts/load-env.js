/**
 * Загружает .env до импорта config/db/sheets, чтобы DATABASE_URL и др. были в process.env.
 * Подключать первым: import './load-env.js';
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = __dirname;
const backendDir = path.join(__dirname, '..');
const projectRoot = path.join(__dirname, '..', '..');
const cwd = process.cwd();
[path.join(scriptsDir, '.env'), path.join(backendDir, '.env'), path.join(projectRoot, '.env'), path.join(cwd, '.env')].forEach((p) => {
  dotenv.config({ path: p });
});

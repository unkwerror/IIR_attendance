/**
 * Конфигурация приложения и парсинг URL.
 */

export const apiBase = 'https://api.iir-attendance.ru';

/**
 * Параметры из query/hash (iOS Safari QR может отдавать #?...
 */
export function getParams() {
  const raw = location.search || '';
  const hashRaw = location.hash.startsWith('#?') ? location.hash.slice(1) : '';
  return new URLSearchParams(raw || hashRaw);
}

const P = getParams();
export const urlParams = {
  token: P.get('t'),
  session: P.get('sid')
};

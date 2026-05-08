/**
 * Конфигурация приложения и парсинг URL.
 */

export const apiBase = 'https://523bfde6b325bc59-109-174-15-132.serveousercontent.com';

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

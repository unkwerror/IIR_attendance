/**
 * Хранение токена преподавателя (sessionStorage).
 */

const KEY = 'teacherToken';

export function getTeacherToken() {
  return sessionStorage.getItem(KEY);
}

export function setTeacherToken(token) {
  sessionStorage.setItem(KEY, token);
}

export function clearTeacherToken() {
  sessionStorage.removeItem(KEY);
}

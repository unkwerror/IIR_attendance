import { google } from 'googleapis';
import { config } from '../config.js';

let client = null;

function parseGoogleCredentials(raw) {
  const src = String(raw || '').trim();
  if (!src) return null;
  const unescapedQuotes = src.split('\\"').join('"');
  const normalizedBackslashNewlines = unescapedQuotes.replace(/\\\r?\n/g, '\\n');

  const attempts = [
    src,
    unescapedQuotes,
    normalizedBackslashNewlines,
    normalizedBackslashNewlines.replace(/\\\\n/g, '\\n')
  ];

  for (const candidate of attempts) {
    try {
      let parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

export function getSheetsClient() {
  if (client) return client;
  const { credentials, spreadsheetId } = config.googleSheets;
  if (!credentials || !spreadsheetId) return null;
  const creds = parseGoogleCredentials(credentials);
  if (!creds) {
    console.error(
      'Invalid GOOGLE_SHEETS_CREDENTIALS JSON: expected service-account JSON object string in .env'
    );
    return null;
  }
  const jwt = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  client = {
    sheets: google.sheets({ version: 'v4', auth: jwt }),
    spreadsheetId
  };
  return client;
}

export async function appendAttendanceRow({ createdAt, studentName, studentGroup, sessionSubject }) {
  const c = getSheetsClient();
  if (!c) return;
  const d = new Date(createdAt || Date.now());
  const ymd = d.toLocaleString('en-CA', {
    timeZone: config.localTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  try {
    await c.sheets.spreadsheets.values.append({
      spreadsheetId: c.spreadsheetId,
      range: 'A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[ymd, studentName || '', studentGroup || '', sessionSubject || '']] }
    });
  } catch (e) {
    console.error('append to Google Sheets error', e);
  }
}

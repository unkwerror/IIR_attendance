import { google } from 'googleapis';
import { config } from '../config.js';

let client = null;

export function getSheetsClient() {
  if (client) return client;
  const { credentials, spreadsheetId } = config.googleSheets;
  if (!credentials || !spreadsheetId) return null;
  let creds;
  try {
    creds = JSON.parse(credentials);
  } catch (e) {
    console.error('Invalid GOOGLE_SHEETS_CREDENTIALS JSON', e);
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

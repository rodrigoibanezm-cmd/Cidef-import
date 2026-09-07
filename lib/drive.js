import { google } from 'googleapis';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

function getCredentials() {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw) throw new Error('Missing GOOGLE_PRIVATE_KEY');
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
    const credentials = JSON.parse(decoded);
    if (!credentials.client_email || !credentials.private_key) throw new Error('missing fields');
    return credentials;
  } catch {
    throw new Error('GOOGLE_PRIVATE_KEY must contain the full service-account JSON encoded as Base64');
  }
}

function getDrive() {
  const auth = new google.auth.GoogleAuth({ credentials: getCredentials(), scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  return google.drive({ version: 'v3', auth });
}

function folderId() {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error('Missing GOOGLE_DRIVE_FOLDER_ID');
  return id;
}

const FILE_FIELDS = 'id,name,mimeType,createdTime,modifiedTime,size';

export async function findFileInFolder(fileName) {
  const drive = getDrive();
  const result = await drive.files.list({ q: `'${folderId()}' in parents and name = '${fileName}' and trashed = false`, pageSize: 10, fields: `files(${FILE_FIELDS})` });
  const files = result.data.files ?? [];
  if (!files.length) throw new Error(`Drive file not found: ${fileName}`);
  if (files.length > 1) throw new Error(`More than one Drive file found: ${fileName}`);
  return files[0];
}

export async function listFilesInFolder(nameContains) {
  const drive = getDrive();
  const files = [];
  let pageToken;
  do {
    const result = await drive.files.list({ q: `'${folderId()}' in parents and name contains '${nameContains}' and trashed = false`, pageSize: 100, pageToken, fields: `nextPageToken,files(${FILE_FIELDS})` });
    files.push(...(result.data.files ?? []));
    pageToken = result.data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function downloadFile(fileId) {
  const drive = getDrive();
  const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(result.data);
}

export async function downloadFileStream(fileId) {
  const drive = getDrive();
  const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return result.data;
}

export async function downloadFileToPath(fileId, filePath) {
  const stream = await downloadFileStream(fileId);
  await pipeline(stream, fs.createWriteStream(filePath));
  return filePath;
}

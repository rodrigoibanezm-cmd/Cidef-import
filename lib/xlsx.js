import XLSX from 'xlsx';

function normalizeName(value, index) {
  const base = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `col_${index + 1}`;
}
function uniqueColumns(headers) {
  const seen = new Map();
  return headers.map((header, index) => { const base = normalizeName(header, index); const count = seen.get(base) ?? 0; seen.set(base, count + 1); return count === 0 ? base : `${base}_${count + 1}`; });
}
export function parseSheet(buffer, sheetName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false, blankrows: false });
  if (matrix.length < 2) throw new Error(`Sheet has no data: ${sheetName}`);
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = uniqueColumns(Array.from({ length: width }, (_, i) => matrix[0][i]));
  const rows = matrix.slice(1).filter((row) => row.some((value) => value !== null && value !== '')).map((row) => columns.map((_, i) => { const value = row[i]; return value === null || value === undefined || value === '' ? null : String(value); }));
  return { columns, rows };
}

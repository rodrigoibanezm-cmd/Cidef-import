import unzipper from 'unzipper';
import sax from 'sax';

function colIndex(ref = '') { const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''; let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return Math.max(0, n - 1); }
async function parseSharedStrings(entry) {
  if (!entry) return [];
  const strings = []; const parser = sax.createStream(true, { trim: false }); let inSi = false; let inT = false; let text = '';
  parser.on('opentag', (node) => { if (node.name === 'si') { inSi = true; text = ''; } else if (inSi && node.name === 't') inT = true; });
  parser.on('text', (value) => { if (inSi && inT) text += value; }); parser.on('cdata', (value) => { if (inSi && inT) text += value; });
  parser.on('closetag', (name) => { if (name === 't') inT = false; if (name === 'si') { strings.push(text); inSi = false; text = ''; } });
  await new Promise((resolve, reject) => { parser.on('error', reject); parser.on('end', resolve); entry.stream().on('error', reject).pipe(parser); });
  return strings;
}
function cellValue(type, raw, inline, sharedStrings) { if (type === 's') return sharedStrings[Number(raw)] ?? raw ?? null; if (type === 'inlineStr') return inline || null; if (raw === '' || raw == null) return null; return String(raw); }
function attachRowParser(stream, sharedStrings, onRow, onDone, onError) {
  const parser = sax.createStream(true, { trim: false }); let currentRow = null; let currentCell = null; let captureV = false; let captureT = false;
  parser.on('opentag', (node) => { if (node.name === 'row') currentRow = { number: Number(node.attributes.r || 0), values: [] }; else if (node.name === 'c' && currentRow) currentCell = { index: colIndex(node.attributes.r || ''), type: node.attributes.t || '', raw: '', inline: '' }; else if (node.name === 'v' && currentCell) captureV = true; else if (node.name === 't' && currentCell?.type === 'inlineStr') captureT = true; });
  parser.on('text', (value) => { if (captureV && currentCell) currentCell.raw += value; if (captureT && currentCell) currentCell.inline += value; }); parser.on('cdata', (value) => { if (captureT && currentCell) currentCell.inline += value; });
  parser.on('closetag', (name) => { if (name === 'v') captureV = false; if (name === 't') captureT = false; if (name === 'c' && currentCell && currentRow) { currentRow.values[currentCell.index] = cellValue(currentCell.type, currentCell.raw, currentCell.inline, sharedStrings); currentCell = null; } if (name === 'row' && currentRow) { onRow(currentRow); currentRow = null; } });
  parser.on('error', onError); parser.on('end', onDone); stream.on('error', onError); stream.pipe(parser); return parser;
}
export async function openRvmWorkbook(buffer) {
  const zip = await unzipper.Open.buffer(buffer); const sharedEntry = zip.files.find((f) => f.path === 'xl/sharedStrings.xml'); const sheetEntry = zip.files.filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))[0]; if (!sheetEntry) throw new Error('RVM workbook has no worksheet XML');
  const sharedStrings = await parseSharedStrings(sharedEntry);
  async function firstRow() { return new Promise((resolve, reject) => { const stream = sheetEntry.stream(); let settled = false; attachRowParser(stream, sharedStrings, (row) => { if (settled) return; settled = true; stream.destroy(); resolve(row); }, () => { if (!settled) reject(new Error('RVM workbook has no rows')); }, (error) => { if (!settled) reject(error); }); }); }
  async function *rows() { const pending = []; let notify; let done = false; let failed; const stream = sheetEntry.stream(); attachRowParser(stream, sharedStrings, (row) => { pending.push(row); if (notify) { notify(); notify = null; } }, () => { done = true; if (notify) notify(); }, (error) => { failed = error; done = true; if (notify) notify(); }); while (!done || pending.length) { if (!pending.length) await new Promise((resolve) => { notify = resolve; }); if (failed) throw failed; while (pending.length) yield pending.shift(); } }
  return { firstRow, rows, sheetName: sheetEntry.path };
}

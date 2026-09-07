import XLSX from 'xlsx';

const clean = (v, i) => { const s = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return s || `col_${i + 1}`; };
function unique(row) { const seen = new Map(); return row.map((v, i) => { const base = clean(v, i); const n = seen.get(base) || 0; seen.set(base, n + 1); return n ? `${base}_${n + 1}` : base; }); }
function findVigencia(matrix) { const text = matrix.slice(0,15).flat().filter(Boolean).join(' '); const match = text.match(/(\d{2}-\d{2}-\d{4})/); return match ? match[1] : null; }
function headerRow(row) { const text = row.filter(Boolean).join(' ').toLowerCase(); return row.filter(Boolean).length >= 4 && text.includes('precio') && (text.includes('linea') || text.includes('modelo') || text.includes('transm')); }
export function parsePriceWorkbook(buffer, sourceFile) {
  const wb=XLSX.read(buffer,{type:'buffer'}); const records=[];
  for (const sheetName of wb.SheetNames) {
    const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:null,raw:false,blankrows:false}); const validFrom=findVigencia(matrix); let headers=null; let group=null;
    matrix.forEach((row,idx)=>{ if(headerRow(row)){headers=unique(row); if(row[0]) group=String(row[0]).trim(); return;} if(!headers||row.filter(Boolean).length<2)return; const rec={source_file:sourceFile,source_sheet:sheetName,vigencia:validFrom,source_row:String(idx+1),product_group:group}; headers.forEach((key,i)=>{const value=row[i];rec[key]=value===null||value===undefined||value===''?null:String(value);}); records.push(rec); });
  }
  const columns=[...new Set(records.flatMap(r=>Object.keys(r)))]; const rows=records.map(r=>columns.map(c=>r[c]??null)); return {columns,rows,records};
}

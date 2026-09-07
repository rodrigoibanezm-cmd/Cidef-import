import crypto from 'node:crypto';
import { listFilesInFolder, downloadFile } from '../drive.js';
import { parseFirstSheet } from '../xlsx.js';
import { queryDb } from '../neon.js';

const FILE_PREFIX = 'proy_';
const FILE_RE = /^proy_([^.]+)\.(xlsx|xls|xlsb)$/i;
const REQUIRED_COLUMNS = ['fecha', 'vendedor', 'marca', 'modelo'];

const STORE_ALIASES = Object.freeze({
  antofagasta: 'antofagasta',
  bellavista: 'bellavista',
  concepcion: 'concepcion',
  alameda: 'mall alameda',
  costanera: 'mall cenco costanera',
  quilin: 'mall paseo quilin',
  egana: 'mall plaza egana',
  norte: 'mall plaza norte',
  oeste: 'mall plaza oeste',
  sur: 'mall plaza sur',
  vespucio: 'mall plaza vespucio',
  pajaritos: 'pajaritos',
  vicuna: 'vicuna mackenna',
  vmac: 'vicuna mackenna',
});

function norm(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function compact(value) { return norm(value).replace(/\s+/g, ''); }

function parseInputDate(value) {
  const raw = String(value ?? '').trim();
  let m = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  let year; let month; let day;
  if (m) { day = Number(m[1]); month = Number(m[2]); year = Number(m[3]); }
  else {
    m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) throw new Error(`Invalid FECHA: ${raw}`);
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error(`Invalid FECHA: ${raw}`);
  return date;
}

function isoDate(date) { return date.toISOString().slice(0, 10); }

function weekBounds(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime());
  monday.setUTCDate(d.getUTCDate() - daysSinceMonday);
  const friday = new Date(monday.getTime());
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { weekStart: isoDate(monday), expectedCloseDate: isoDate(friday) };
}

function extractCrmId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const matches = raw.match(/\d{5,}/g);
  return matches?.at(-1) ?? null;
}

function normalizeRut(rut, dv) {
  const base = String(rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  const digit = String(dv ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (!base) return null;
  if (digit && !base.endsWith(digit)) return `${base}${digit}`;
  return base;
}

function rowObject(columns, row) {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

function sourceKey(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

async function loadDimensions() {
  const [branches, sellers, personAliases, products] = await Promise.all([
    queryDb(`SELECT sucursal_id::text, nombre_canonico FROM public.sucursales_master WHERE vigente=true AND tipo_canal='CIDEF'`),
    queryDb(`
      SELECT p.persona_id::text, p.usuario_canonico, p.nombre_canonico,
             ps.sucursal_id::text AS sucursal_id,
             ps.vigente AS assignment_active,
             ps.rol
      FROM public.personas_master p
      LEFT JOIN public.persona_sucursal ps ON ps.persona_id=p.persona_id AND ps.vigente=true AND ps.rol='VENDEDOR_TIENDA'
    `),
    queryDb(`SELECT persona_id::text, valor_raw, valor_normalizado FROM public.persona_aliases WHERE COALESCE(validated,true)=true`),
    queryDb(`
      SELECT DISTINCT ma.nombre_canonico AS marca, m.modelo_id::text, m.nombre_canonico AS modelo,
             pa.valor_raw AS alias_raw, pa.valor_normalizado AS alias_normalizado
      FROM public.producto_portafolio_v01 pp
      JOIN public.modelos_master_v01 m ON m.modelo_id=pp.modelo_id
      JOIN public.marcas_master_v01 ma ON ma.marca_id=m.marca_id
      LEFT JOIN public.producto_aliases_v01 pa ON pa.modelo_id=m.modelo_id AND pa.marca_id=ma.marca_id AND pa.estado='RESUELTO'
      WHERE pp.vigente=true AND pp.organizacion='CIDEF'
    `),
  ]);

  const branchByToken = new Map();
  for (const branch of branches) {
    const canonical = norm(branch.nombre_canonico).replace(/^cidef\s+/, '');
    branchByToken.set(canonical, branch);
  }

  const sellerByToken = new Map();
  function addSellerToken(token, personaId) {
    if (!token) return;
    const key = compact(token);
    if (!sellerByToken.has(key)) sellerByToken.set(key, new Set());
    sellerByToken.get(key).add(String(personaId));
  }
  const sellerRowsById = new Map();
  for (const row of sellers) {
    if (!sellerRowsById.has(row.persona_id)) sellerRowsById.set(row.persona_id, []);
    sellerRowsById.get(row.persona_id).push(row);
    addSellerToken(row.usuario_canonico, row.persona_id);
    addSellerToken(row.nombre_canonico, row.persona_id);
  }
  for (const alias of personAliases) {
    addSellerToken(alias.valor_raw, alias.persona_id);
    addSellerToken(alias.valor_normalizado, alias.persona_id);
  }

  const productByKey = new Map();
  function addProduct(brand, text, row) {
    const key = `${norm(brand)}|${norm(text)}`;
    if (!productByKey.has(key)) productByKey.set(key, new Map());
    productByKey.get(key).set(row.modelo_id, row);
  }
  for (const row of products) {
    addProduct(row.marca, row.modelo, row);
    addProduct(row.marca, row.alias_raw, row);
    addProduct(row.marca, row.alias_normalizado, row);
  }

  return { branches, branchByToken, sellerByToken, sellerRowsById, productByKey };
}

function resolveBranch(fileName, dims) {
  const match = fileName.match(FILE_RE);
  if (!match) throw new Error(`Invalid projection filename: ${fileName}`);
  const rawToken = norm(match[1]);
  const alias = STORE_ALIASES[compact(rawToken)] ?? rawToken;
  const exact = dims.branchByToken.get(norm(alias));
  if (exact) return exact;
  const candidates = dims.branches.filter((row) => norm(row.nombre_canonico).includes(norm(alias)));
  if (candidates.length !== 1) throw new Error(`Cannot uniquely resolve store from filename ${fileName}`);
  return candidates[0];
}

function resolveSeller(value, branchId, dims) {
  const ids = [...(dims.sellerByToken.get(compact(value)) ?? [])];
  if (!ids.length) throw new Error(`Unknown seller: ${value}`);
  const inBranch = ids.filter((id) => (dims.sellerRowsById.get(id) ?? []).some((row) => row.sucursal_id === String(branchId)));
  if (inBranch.length === 1) return { personaId: inBranch[0], warning: null };
  if (inBranch.length > 1) throw new Error(`Ambiguous seller in branch: ${value}`);
  if (ids.length === 1) return { personaId: ids[0], warning: `Seller ${value} has no active VENDEDOR_TIENDA assignment in this store` };
  throw new Error(`Ambiguous seller: ${value}`);
}

function resolveModel(brand, model, dims) {
  const candidates = [...(dims.productByKey.get(`${norm(brand)}|${norm(model)}`)?.values() ?? [])];
  if (candidates.length !== 1) throw new Error(`Cannot uniquely resolve active CIDEF model: ${brand} / ${model}`);
  return candidates[0];
}

async function adoptExistingProjection({ rowKey, fileName, rowNumber, clientRut, clientName, weekStart, branchId, personaId, modeloId, expectedCloseDate, crmId, dimensionGroupCount }) {
  if (crmId) {
    const byCrm = await queryDb(`
      SELECT projection_id::text FROM public.weekly_sales_projection
      WHERE week_start=$1::date AND sucursal_id=$2::bigint AND crm_opportunity_id=$3::text
      ORDER BY projection_id
    `, [weekStart, branchId, crmId]);
    if (byCrm.length === 1) {
      await queryDb(`UPDATE public.weekly_sales_projection SET source_row_key=$2, source_file=$3, source_row_number=$4, source_client_rut=$5, source_client_name=$6, updated_at=now() WHERE projection_id=$1::bigint`, [byCrm[0].projection_id, rowKey, fileName, rowNumber, clientRut, clientName]);
      return byCrm[0].projection_id;
    }
  }

  if (dimensionGroupCount === 1) {
    const candidates = await queryDb(`
      SELECT projection_id::text FROM public.weekly_sales_projection
      WHERE week_start=$1::date AND sucursal_id=$2::bigint AND persona_id=$3::bigint AND modelo_id=$4::bigint
        AND expected_close_date=$5::date AND source_row_key IS NULL
      ORDER BY projection_id
    `, [weekStart, branchId, personaId, modeloId, expectedCloseDate]);
    if (candidates.length === 1) {
      await queryDb(`UPDATE public.weekly_sales_projection SET source_row_key=$2, source_file=$3, source_row_number=$4, source_client_rut=$5, source_client_name=$6, crm_opportunity_id=COALESCE(crm_opportunity_id,$7), crm_link_method=CASE WHEN crm_opportunity_id IS NULL AND $7::text IS NOT NULL THEN 'MANUAL' ELSE crm_link_method END, updated_at=now() WHERE projection_id=$1::bigint`, [candidates[0].projection_id, rowKey, fileName, rowNumber, clientRut, clientName, crmId]);
      return candidates[0].projection_id;
    }
  }
  return null;
}

async function persistProjection(data) {
  const existing = await queryDb(`SELECT projection_id::text, crm_opportunity_id FROM public.weekly_sales_projection WHERE source_row_key=$1 LIMIT 1`, [data.rowKey]);
  if (existing.length) {
    await queryDb(`
      UPDATE public.weekly_sales_projection
      SET source_file=$2, source_row_number=$3, source_client_rut=$4, source_client_name=$5,
          crm_opportunity_id=COALESCE(crm_opportunity_id,$6),
          crm_link_method=CASE WHEN crm_opportunity_id IS NULL AND $6::text IS NOT NULL THEN 'MANUAL' ELSE crm_link_method END,
          updated_at=now()
      WHERE source_row_key=$1
    `, [data.rowKey, data.fileName, data.rowNumber, data.clientRut, data.clientName, data.crmId]);
    return { projectionId: existing[0].projection_id, action: 'EXISTING' };
  }

  const adoptedId = await adoptExistingProjection(data);
  if (adoptedId) return { projectionId: adoptedId, action: 'ADOPTED' };

  const inserted = await queryDb(`
    INSERT INTO public.weekly_sales_projection
      (week_start, sucursal_id, persona_id, modelo_id, projected_units, expected_close_date,
       crm_opportunity_id, crm_link_method, source_row_key, source_file, source_row_number,
       source_client_rut, source_client_name, updated_at)
    VALUES ($1::date,$2::bigint,$3::bigint,$4::bigint,1,$5::date,$6::text,$7::text,$8::text,$9::text,$10::integer,$11::text,$12::text,now())
    RETURNING projection_id::text
  `, [data.weekStart, data.branchId, data.personaId, data.modeloId, data.expectedCloseDate, data.crmId, data.crmId ? 'MANUAL' : 'NONE', data.rowKey, data.fileName, data.rowNumber, data.clientRut, data.clientName]);
  return { projectionId: inserted[0].projection_id, action: 'INSERTED' };
}

export async function run(input = {}) {
  const startedAt = Date.now();
  const dims = await loadDimensions();
  let files = (await listFilesInFolder(FILE_PREFIX)).filter((file) => FILE_RE.test(file.name));
  if (input.file_name) files = files.filter((file) => file.name === input.file_name);
  if (!files.length) throw new Error(input.file_name ? `Projection file not found: ${input.file_name}` : 'No proy_*.xls/xlsx/xlsb files found in Drive folder');

  const totals = { files: files.length, rows: 0, inserted: 0, existing: 0, adopted: 0, errors: 0 };
  const fileResults = [];

  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const branch = resolveBranch(file.name, dims);
    const parsed = parseFirstSheet(await downloadFile(file.id));
    const missing = REQUIRED_COLUMNS.filter((column) => !parsed.columns.includes(column));
    if (missing.length) throw new Error(`${file.name}: missing required columns: ${missing.join(', ')}`);

    const prepared = parsed.rows.map((rawRow, index) => {
      const row = rowObject(parsed.columns, rawRow);
      const date = parseInputDate(row.fecha);
      const { weekStart, expectedCloseDate } = weekBounds(date);
      const seller = resolveSeller(row.vendedor, branch.sucursal_id, dims);
      const product = resolveModel(row.marca, row.modelo, dims);
      const clientRut = normalizeRut(row.rut, row.dv);
      const clientName = String(row.cliente ?? '').trim() || null;
      const crmId = extractCrmId(row.link_pilot);
      const identity = [weekStart, branch.sucursal_id, seller.personaId, product.modelo_id, clientRut || norm(clientName) || crmId || `row-${index + 2}`].join('|');
      const dimensionGroup = [weekStart, branch.sucursal_id, seller.personaId, product.modelo_id, expectedCloseDate].join('|');
      return { row, rowNumber: index + 2, weekStart, expectedCloseDate, personaId: seller.personaId, modeloId: product.modelo_id, clientRut, clientName, crmId, identity, dimensionGroup, sellerWarning: seller.warning };
    });

    const identitySeen = new Map();
    const dimensionCounts = new Map();
    for (const item of prepared) dimensionCounts.set(item.dimensionGroup, (dimensionCounts.get(item.dimensionGroup) ?? 0) + 1);

    const result = { file: file.name, store: branch.nombre_canonico, sheet: parsed.sheetName, rows: prepared.length, inserted: 0, existing: 0, adopted: 0, warnings: [], errors: [] };
    totals.rows += prepared.length;

    for (const item of prepared) {
      const occurrence = (identitySeen.get(item.identity) ?? 0) + 1;
      identitySeen.set(item.identity, occurrence);
      const rowKey = sourceKey([item.identity, occurrence]);
      try {
        const saved = await persistProjection({
          rowKey,
          fileName: file.name,
          rowNumber: item.rowNumber,
          clientRut: item.clientRut,
          clientName: item.clientName,
          weekStart: item.weekStart,
          branchId: branch.sucursal_id,
          personaId: item.personaId,
          modeloId: item.modeloId,
          expectedCloseDate: item.expectedCloseDate,
          crmId: item.crmId,
          dimensionGroupCount: dimensionCounts.get(item.dimensionGroup),
        });
        const bucket = saved.action.toLowerCase();
        result[bucket] += 1;
        totals[bucket] += 1;
        if (item.sellerWarning) result.warnings.push({ row: item.rowNumber, warning: item.sellerWarning });
      } catch (error) {
        totals.errors += 1;
        result.errors.push({ row: item.rowNumber, error: error.message });
      }
    }
    fileResults.push(result);
  }

  return { strategy: 'DRIVE_INCREMENTAL_IDEMPOTENT', pattern: 'proy_*.xls|xlsx|xlsb', totals, files: fileResults, elapsedMs: Date.now() - startedAt };
}

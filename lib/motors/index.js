import { run as importVehiculos } from './import-vehiculos.js';
import { run as importEstadisticasVenta } from './import-estadisticas-venta.js';
import { run as importNotasVenta } from './import-notas-venta.js';
import { run as importListaPrecios } from './import-lista-precios.js';
import { run as importRvm } from './import-rvm.js';
import { run as importCrmCidef } from './import-crm-cidef.js';

const MOTORS = Object.freeze({
  import_vehiculos: importVehiculos,
  import_estadisticas_venta: importEstadisticasVenta,
  import_notas_venta: importNotasVenta,
  import_lista_precios: importListaPrecios,
  import_rvm: importRvm,
  import_crm_cidef: importCrmCidef,
});

export function getMotor(name) { return MOTORS[name] ?? null; }
export function listMotors() { return Object.keys(MOTORS); }
export const INGESTION_MOTORS = Object.freeze(Object.keys(MOTORS));

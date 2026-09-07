import { findFileInFolder, downloadFile } from '../drive.js';
import { parseSheet } from '../xlsx.js';
import { beginTableSnapshot, appendTableRows, commitTableSnapshot, abortTableSnapshot } from '../neon.js';
import { cleanVehicleSource } from '../vehicle-source-cleaning.js';

const FILE_NAME='Base_Unidades_por_Vistas_20210819.xlsx'; const SHEET_NAME='Inventario Vehiculos Global'; const TABLE_NAME='vehiculos_raw';
export async function run(){const startedAt=Date.now();const file=await findFileInFolder(FILE_NAME);const buffer=await downloadFile(file.id);const {columns,rows}=parseSheet(buffer,SHEET_NAME);const snapshot=await beginTableSnapshot(TABLE_NAME,columns);try{const loaded=await appendTableRows(snapshot,rows);const cleaned=await cleanVehicleSource(snapshot.staging);await commitTableSnapshot(snapshot);return{source:{id:file.id,name:file.name,modifiedTime:file.modifiedTime},sheet:SHEET_NAME,table:TABLE_NAME,strategy:'FULL_SNAPSHOT_REPLACE',rowsLoaded:rows.length,rowsFinal:cleaned.after,columnsFinal:cleaned.kept_columns.length,batchSize:loaded.batchSize,cleaned,elapsedMs:Date.now()-startedAt};}catch(error){await abortTableSnapshot(snapshot);throw error;}}

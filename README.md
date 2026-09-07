# Cidef-import

Servicio exclusivo de ingesta de datos CIDEF.

## Responsabilidad

Drive / archivos fuente -> validación y normalización de carga -> Neon.

Este repositorio no contiene motores analíticos, ROM, Custom GPT, universos analíticos ni lógica de interpretación.

## Endpoint

`POST /api/router`

Contrato compatible con el loader anterior:

```json
{
  "tenant": "data_loader",
  "motor": "import_vehiculos",
  "input": {}
}
```

## Imports disponibles

- `import_vehiculos`
- `import_estadisticas_venta`
- `import_notas_venta`
- `import_lista_precios`
- `import_rvm`
- `import_crm_cidef`
- `import_weekly_projections`

## Proyecciones semanales

`import_weekly_projections` busca en la carpeta configurada de Drive todos los archivos Excel cuyo nombre cumpla `proy_<tienda>.xls`, `proy_<tienda>.xlsx` o `proy_<tienda>.xlsb`.

Ejemplos: `proy_oeste.xlsx`, `proy_norte.xlsx`, `proy_pajaritos.xlsx`.

Columnas mínimas del archivo: `FECHA`, `VENDEDOR`, `MARCA`, `MODELO`. Si existen, también usa `RUT`, `DV`, `CLIENTE` y `LINK PILOT`.

La semana se deriva de `FECHA`: lunes como `week_start` y viernes como `expected_close_date`. Cada fila representa exactamente una proyección / un VIN.

La importación es incremental e idempotente. Cada fila recibe una `source_row_key` determinística y el índice único de `weekly_sales_projection` evita duplicados al volver a cargar el mismo archivo. Para filas históricas sin `source_row_key`, el import sólo adopta una proyección existente cuando el match es inequívoco; en caso contrario inserta una fila nueva antes que fusionar dos VIN reales.

Migración requerida antes del primer uso: `sql/weekly-sales-projection-import.sql`.

Opcionalmente puede procesarse sólo un archivo:

```json
{
  "tenant": "data_loader",
  "motor": "import_weekly_projections",
  "input": {
    "file_name": "proy_oeste.xlsx"
  }
}
```

## Variables de entorno

- `DATABASE_URL` o `POSTGRES_URL`
- `GOOGLE_PRIVATE_KEY`: JSON completo de la service account codificado en Base64
- `GOOGLE_DRIVE_FOLDER_ID`

## Migración

La primera etapa es una copia funcional. El repo original conserva temporalmente los loaders hasta validar el nuevo deployment y realizar el corte de tráfico.

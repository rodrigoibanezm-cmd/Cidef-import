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

## Variables de entorno

- `DATABASE_URL` o `POSTGRES_URL`
- `GOOGLE_PRIVATE_KEY`: JSON completo de la service account codificado en Base64
- `GOOGLE_DRIVE_FOLDER_ID`

## Migración

La primera etapa es una copia funcional. El repo original conserva temporalmente los loaders hasta validar el nuevo deployment y realizar el corte de tráfico.

ALTER TABLE public.weekly_sales_projection
  ADD COLUMN IF NOT EXISTS source_row_key text,
  ADD COLUMN IF NOT EXISTS source_file text,
  ADD COLUMN IF NOT EXISTS source_row_number integer,
  ADD COLUMN IF NOT EXISTS source_client_rut text,
  ADD COLUMN IF NOT EXISTS source_client_name text;

CREATE UNIQUE INDEX IF NOT EXISTS weekly_sales_projection_source_row_key_uq
  ON public.weekly_sales_projection (source_row_key)
  WHERE source_row_key IS NOT NULL;

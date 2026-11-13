-- Dias extras de operação (sábados etc.) no forecast de embarque
-- Rodar no SQL Editor do Supabase DISTR (qaehjplsasumuhszjcnu) ANTES de subir o código.
ALTER TABLE embarque_forecast_mensal
  ADD COLUMN IF NOT EXISTS dias_extras text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN embarque_forecast_mensal.dias_extras IS 'Datas (ISO) de dias normalmente sem operação que terão embarque (ex.: sábados). Entram como dias úteis no cálculo do forecast.';

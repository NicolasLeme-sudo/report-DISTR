-- Peças e movimentos por operador no dia (05/11/2026) — Top 5 operadores do telão DISTR (tv.html).
-- Rode uma vez no SQL Editor do Supabase. O ingest do Kardex já grava as colunas; sem esta migração ele
-- grava sem elas e só avisa no log. Depois de rodar, reenvie o Kardex dos últimos 7 dias para encher o histórico.
alter table ressuprimento_operador_diario
  add column if not exists pecas integer not null default 0,
  add column if not exists movimentos integer not null default 0;

alter table ressuprimento_retirada_operador
  add column if not exists pecas integer not null default 0,
  add column if not exists movimentos integer not null default 0;

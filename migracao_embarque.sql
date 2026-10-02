-- ============================================================================
-- MIGRAÇÃO — Setor de Embarque (02/10/2026)
-- ============================================================================
-- Rode no SQL Editor do Supabase (usa meu_papel(), de esquema.sql).
--
--   embarque_diario — um registro por DIA vindo da base histórica do Embarque
--   ("Base Report", aba Plan1: expedição, backlog, separação e faturamento em
--   peças). Subir a base de novo nunca duplica: a chave é o dia (upsert).
--
--   embarque_forecast_mensal — forecast de peças EMBARCADAS por mês. O valor do
--   mês é dividido igualmente entre os dias úteis (seg–sex, menos os
--   dias_folga) para virar o forecast diário do gráfico. pecas_entrada é
--   opcional (forecast de entrada no backlog, ainda não informado pelo Embarque).
-- ============================================================================

create table if not exists embarque_diario (
  dia            date primary key,
  expedido       integer,
  backlog        integer,
  separacao      integer,
  faturamento    integer,
  atualizado_em  timestamptz not null default now()
);

comment on table embarque_diario is
  'Histórico diário do Embarque (peças): expedido, backlog, separação, faturamento. '
  'Fonte: base histórica do modelo antigo de backlog, subida em Admin > Embarque.';

alter table embarque_diario enable row level security;

drop policy if exists ler_embarque_diario on embarque_diario;
create policy ler_embarque_diario on embarque_diario
  for select to authenticated using (meu_papel() is not null);

drop policy if exists gravar_embarque_diario on embarque_diario;
create policy gravar_embarque_diario on embarque_diario
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

create table if not exists embarque_forecast_mensal (
  mes            text primary key check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  pecas_embarque bigint not null check (pecas_embarque >= 0),
  pecas_entrada  bigint check (pecas_entrada >= 0),
  dias_folga     date[] not null default '{}',
  atualizado_em  timestamptz not null default now()
);

comment on table embarque_forecast_mensal is
  'Forecast mensal de peças embarcadas; o gráfico divide pelos dias úteis (seg–sex menos dias_folga).';

alter table embarque_forecast_mensal enable row level security;

drop policy if exists ler_embarque_forecast on embarque_forecast_mensal;
create policy ler_embarque_forecast on embarque_forecast_mensal
  for select to authenticated using (meu_papel() is not null);

drop policy if exists gravar_embarque_forecast on embarque_forecast_mensal;
create policy gravar_embarque_forecast on embarque_forecast_mensal
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- Forecast de outubro/2026 informado pelo usuário: 731 mil peças em 22 dias úteis.
insert into embarque_forecast_mensal (mes, pecas_embarque) values ('2026-10', 731000)
on conflict (mes) do nothing;

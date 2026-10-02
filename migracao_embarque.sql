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

-- ----------------------------------------------------------------------------
-- 02/10/2026 — proporção por marca/segmento do forecast e backlog "em tela"
-- ----------------------------------------------------------------------------
alter table embarque_forecast_mensal
  add column if not exists prop_marca jsonb not null default '[]'::jsonb,      -- [{"nome":"OLYMPIKUS","pct":50}, ...] soma 100
  add column if not exists prop_segmento jsonb not null default '[]'::jsonb;   -- [{"nome":"CALÇADO","pct":60}, ...] soma 100

-- Backlog de HOJE = peças (pares) dos PFAs pendentes em tela (Start Inicial), do último
-- snapshot de PFAs, com o total por situação ("Nao disp. picking" vira a parte vermelha da coluna).
create or replace function public.embarque_backlog_em_tela() returns jsonb language sql stable security invoker set search_path = public as $$
  with s as (select payload, gerado_em from dashboard_snapshots where pagina = 'pfas' order by gerado_em desc limit 1),
  g as (select s.gerado_em, r->>'situacao' as sit, sum((r->>'pares')::int) as pares
        from s, jsonb_array_elements(s.payload->'pendentes') r group by 1, 2)
  select jsonb_build_object('gerado_em', max(gerado_em), 'total', coalesce(sum(pares), 0), 'por_situacao', coalesce(jsonb_object_agg(sit, pares), '{}'::jsonb)) from g;
$$;

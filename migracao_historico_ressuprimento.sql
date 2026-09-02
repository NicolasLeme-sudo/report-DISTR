-- Histórico diário de ressuprimento (dia + segmento + turno), pra alimentar
-- o filtro de intervalo de datas do card "Ressuprimento por dia" (padrão:
-- últimos 7 dias corridos), cruzando vários uploads de Kardex ao longo do
-- tempo — cada upload sobrescreve (upsert) só os dias do período que ele
-- cobre, sem duplicar nem exigir limpeza manual.

create table if not exists ressuprimento_historico_diario (
  dia date not null,
  segmento text not null,
  turno text not null check (turno in ('T01', 'T02', 'T02_T03', 'T03')),
  pecas integer not null default 0,
  movimentos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, segmento, turno)
);

create index if not exists idx_ressuprimento_historico_dia on ressuprimento_historico_diario (dia);

alter table ressuprimento_historico_diario enable row level security;

drop policy if exists "leitura para autenticados com papel" on ressuprimento_historico_diario;
create policy "leitura para autenticados com papel" on ressuprimento_historico_diario
  for select using (meu_papel() is not null);

drop policy if exists "escrita só admin" on ressuprimento_historico_diario;
create policy "escrita só admin" on ressuprimento_historico_diario
  for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- ============================================================================
-- Retirada do Pulmão (21/10/2026) — quem tirou material do Pulmão (pro corredor de ressuprimento ou
-- direto pro Picking), por dia + segmento + turno, e quem fez, por dia + turno + login. Alimenta o
-- interruptor "Retirada do Pulmão / Alocação no Picking / Geral" da tela Ressuprimento.
-- diretas_* = parte que foi direto Pulmão -> Picking (na visão Geral conta uma vez só).
-- ============================================================================
create table if not exists ressuprimento_retirada_diario (
  dia date not null,
  segmento text not null,
  turno text not null,
  pecas integer not null default 0,
  movimentos integer not null default 0,
  diretas_pecas integer not null default 0,
  diretas_movimentos integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, segmento, turno)
);
create table if not exists ressuprimento_retirada_operador (
  dia date not null,
  turno text not null,
  login text not null,
  nome text,
  atualizado_em timestamptz not null default now(),
  primary key (dia, turno, login)
);
alter table ressuprimento_retirada_diario enable row level security;
alter table ressuprimento_retirada_operador enable row level security;
drop policy if exists "leitura para autenticados com papel" on ressuprimento_retirada_diario;
create policy "leitura para autenticados com papel" on ressuprimento_retirada_diario for select using (meu_papel() is not null);
drop policy if exists "escrita só admin" on ressuprimento_retirada_diario;
create policy "escrita só admin" on ressuprimento_retirada_diario for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');
drop policy if exists "leitura para autenticados com papel" on ressuprimento_retirada_operador;
create policy "leitura para autenticados com papel" on ressuprimento_retirada_operador for select using (meu_papel() is not null);
drop policy if exists "escrita só admin" on ressuprimento_retirada_operador;
create policy "escrita só admin" on ressuprimento_retirada_operador for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

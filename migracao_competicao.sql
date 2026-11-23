-- ============================================================================
-- MIGRAÇÃO — Competição Black Friday da DISTR (23/11/2026)
-- ============================================================================
-- Rodar UMA vez no SQL Editor do Supabase DISTR (qaehjplsasumuhszjcnu). Usa meu_papel() (esquema.sql).
-- 6 times: 1, 2 e 3 = 1º Turno · 4, 5 e 6 = 2º Turno. Produção = Alocação no Picking
-- (ressuprimento_operador_diario, por usuário EX<matrícula>). Quem lança é só o admin.
--
--   competicao_times      — quem está em cada time (usuario_wms = login do GCI, ex. EX000796) e a presença P/F/A por dia
--   competicao_pontos     — vistoria, desafio e ajuste lançados à mão (nunca edita nem apaga: correção = estorno)
--   competicao_hora_ouro  — hora de ouro agendada (usada quando houver produção por hora)
-- ============================================================================

create table if not exists public.competicao_times (
  id            bigserial primary key,
  usuario_wms   text not null unique,          -- EX + matrícula; vaga sem nome = NOVATO.<time>.<n>
  nome          text,
  turno         text not null check (turno in ('1º Turno', '2º Turno')),
  time          smallint not null check (time between 1 and 6),
  observacao    text,
  lider         boolean not null default false,
  presenca      jsonb not null default '{}'::jsonb,   -- { "2026-11-27": "P" | "F" | "A" }
  atualizado_em timestamptz not null default now()
);
create index if not exists competicao_times_time_idx on public.competicao_times (turno, time);
alter table public.competicao_times enable row level security;
drop policy if exists ler_competicao_times on public.competicao_times;
create policy ler_competicao_times on public.competicao_times for select to authenticated using (meu_papel() is not null);
drop policy if exists gravar_competicao_times on public.competicao_times;
create policy gravar_competicao_times on public.competicao_times for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

create table if not exists public.competicao_pontos (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  turno text not null,
  time smallint not null check (time between 1 and 6),
  categoria text not null check (categoria in ('vistoria', 'desafio', 'ajuste')),
  item text,                       -- item do checklist ou nome do desafio
  pontos integer not null,         -- negativo = desconto
  motivo text,
  registrado_por uuid default auth.uid() references auth.users(id),
  registrado_email text,
  criado_em timestamptz not null default now()
);
create index if not exists competicao_pontos_dia_idx on public.competicao_pontos (dia, turno);
alter table public.competicao_pontos enable row level security;
drop policy if exists ler_competicao_pontos on public.competicao_pontos;
create policy ler_competicao_pontos on public.competicao_pontos for select to authenticated using (meu_papel() is not null);
drop policy if exists inserir_competicao_pontos on public.competicao_pontos;
create policy inserir_competicao_pontos on public.competicao_pontos for insert to authenticated with check (meu_papel() = 'admin');

create table if not exists public.competicao_hora_ouro (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  turno text not null,
  hora smallint not null check (hora between 0 and 23),   -- começa em hora:00 e dura 60 min
  meta_time integer not null,                              -- peças na hora, por time
  criado_por uuid default auth.uid() references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (dia, turno, hora)
);
alter table public.competicao_hora_ouro enable row level security;
drop policy if exists ler_competicao_hora_ouro on public.competicao_hora_ouro;
create policy ler_competicao_hora_ouro on public.competicao_hora_ouro for select to authenticated using (meu_papel() is not null);
drop policy if exists gravar_competicao_hora_ouro on public.competicao_hora_ouro;
create policy gravar_competicao_hora_ouro on public.competicao_hora_ouro for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- A escalação inicial (nomes e usuários EX) fica fora do Git: escalacao_black_distr.sql, que se roda depois deste arquivo.

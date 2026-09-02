-- ============================================================================
-- MIGRAÇÃO — Planejamento de Ressuprimento (PFA por turno) + dicionário Artigo→Família
-- ============================================================================
-- Rode isto no SQL Editor do Supabase, depois de esquema.sql e
-- migracao_ressuprimento.sql (usa meu_papel() e dim_familias).
--
-- O QUE ISTO CRIA:
--
--   dim_artigo_familia — dicionário ARTIGO → FAMÍLIA, alimentado sozinho a
--   cada upload de Picking/Pulmão (ingest-ressuprimento.js faz upsert nele).
--   Existe porque o Kardex de movimentações (ingest-movimentacoes.js) só traz
--   o código do ARTIGO, nunca a família — e sem família não dá pra quebrar o
--   ressuprimento por segmento (Vestuário/Calçado/...). Picking e Pulmão já
--   resolvem família por artigo linha a linha; esta tabela só passa a GUARDAR
--   isso, em vez de descartar depois de agregado como fazia até aqui.
--
--   ressuprimento_planejamento — o que a assistente de planejamento está
--   delegando: PFA + família + turno + data. É o dado manual que a tela nova
--   de Admin grava, pra cruzar contra o Kardex (D0 / D-1 / sem planejamento).
-- ============================================================================

create table if not exists dim_artigo_familia (
  artigo_codigo   text primary key,
  familia_codigo  text not null,
  atualizado_em   timestamptz not null default now()
);

comment on table dim_artigo_familia is
  'Dicionário artigo->família, populado automaticamente a cada upload de Picking/Pulmão '
  '(ver upsertArtigoFamilia em ingest-ressuprimento.js). Usado pelo Kardex de movimentações '
  'pra resolver a família de cada ARTIGO, que o Kardex não traz.';

alter table dim_artigo_familia enable row level security;

drop policy if exists ler_dim_artigo_familia on dim_artigo_familia;
create policy ler_dim_artigo_familia on dim_artigo_familia
  for select to authenticated using (meu_papel() is not null);

-- Escrita é automática (feita pelo próprio ingest, rodando como admin) — mesmo
-- padrão de gravar_extracoes/gravar_posicoes em esquema.sql.
drop policy if exists gravar_dim_artigo_familia on dim_artigo_familia;
create policy gravar_dim_artigo_familia on dim_artigo_familia
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- ============================================================================

create table if not exists ressuprimento_planejamento (
  id              bigint generated always as identity primary key,
  pfa             text not null,
  familia_codigo  text not null,
  turno           text not null check (turno in ('T01', 'T02', 'T02_T03', 'T03')),
  data            date not null,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references auth.users(id)
);

comment on table ressuprimento_planejamento is
  'PFAs que a assistente de planejamento delegou pra operação ressuprir — '
  'lançado na tela Admin > Planejamento, um registro por PFA+família+turno+data. '
  'Cruzado com o Kardex de movimentações pra classificar D0/D-1/sem planejamento.';

create index if not exists idx_planejamento_data on ressuprimento_planejamento (data);
create index if not exists idx_planejamento_familia on ressuprimento_planejamento (familia_codigo);

alter table ressuprimento_planejamento enable row level security;

drop policy if exists ler_ressuprimento_planejamento on ressuprimento_planejamento;
create policy ler_ressuprimento_planejamento on ressuprimento_planejamento
  for select to authenticated using (meu_papel() is not null);

-- Só admin lança/edita, mesmo padrão de toda escrita manual do app até aqui
-- (dim_armazens, dim_capacidade_zonas). Ajustar pra incluir 'gestor' se a
-- assistente de planejamento não tiver perfil admin.
drop policy if exists gravar_ressuprimento_planejamento on ressuprimento_planejamento;
create policy gravar_ressuprimento_planejamento on ressuprimento_planejamento
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');
-- ============================================================================

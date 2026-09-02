-- ============================================================================
-- MIGRAÇÃO — Ressuprimento (Picking × Pulmão)
-- ============================================================================
-- Rode isto no SQL Editor do Supabase do projeto report-distribuidora, depois
-- de já ter rodado o esquema.sql principal (usa a função meu_papel() e a
-- tabela dashboard_snapshots que ele cria).
--
-- O QUE ISTO CRIA:
--   dim_capacidade_zonas — único objeto novo. O restante do Ressuprimento
--   (dados de Picking/Pulmão, ocupação, árvore Marca›Segmento, cruzamento)
--   já usa dashboard_snapshots com pagina='ressuprimento', que já existe e
--   já tem RLS — nenhuma tabela nova precisa pra isso.
--
--   dim_capacidade_zonas guarda a capacidade REAL de cada zona (posições),
--   editável pela gestão. Enquanto uma zona não tem linha aqui, a tela usa
--   ocupado×1.2 como estimativa provisória (decisão da operação, 01/09/2026)
--   — ver ingest-ressuprimento.js, função `zona()`.
-- ============================================================================

create table if not exists dim_capacidade_zonas (
  zona          text primary key,   -- 'pulmao' | 'picking_meia' | 'picking_vestuario' | 'picking_calcado'
  capacidade    int not null check (capacidade >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);

comment on table dim_capacidade_zonas is
  'Capacidade real (em posições) de cada zona de estoque, editável pela gestão. '
  'Zona sem linha aqui usa ocupado×1.2 como estimativa provisória (ver ingest-ressuprimento.js).';

alter table dim_capacidade_zonas enable row level security;

-- LEITURA: qualquer autenticado (mesmo padrão de dim_armazens/dim_familias).
drop policy if exists ler_dim_capacidade_zonas on dim_capacidade_zonas;
create policy ler_dim_capacidade_zonas on dim_capacidade_zonas
  for select to authenticated using (meu_papel() is not null);

-- ESCRITA: só admin (mesmo padrão da categoria editável de dim_armazens).
drop policy if exists gravar_dim_capacidade_zonas on dim_capacidade_zonas;
create policy gravar_dim_capacidade_zonas on dim_capacidade_zonas
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- ============================================================================
-- CAPACIDADES REAIS — planilha "Ocupação Estoque" da gestão (02/09/2026)
-- ============================================================================
-- Até estes números existirem, a tela usava ocupado x1.2 como estimativa, o que
-- travava TODA zona em 83,3% (é o que a divisão dá quando a capacidade é o
-- próprio ocupado vezes 1,2 — parecia dado real e não era). Com as linhas
-- abaixo a porcentagem passa a refletir a ocupação de verdade.
--
-- ATENÇÃO: a zona "Insumo" (714 posições) existe na planilha da gestão mas
-- ainda NÃO tem card na tela — as famílias de insumo caem no segmento OUTROS.
-- Deixada de fora de propósito até a operação decidir se quer o card.
insert into dim_capacidade_zonas (zona, capacidade) values
  ('pulmao',            5010),
  ('picking_meia',       366),
  ('picking_vestuario', 12980),
  ('picking_calcado',   3933)
on conflict (zona) do update set capacidade = excluded.capacidade, atualizado_em = now();
-- ============================================================================

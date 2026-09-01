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
-- OPCIONAL: se/quando a gestão validar os números reais de capacidade, insira
-- (ou atualize) assim — os quatro nomes de zona são os únicos que a tela lê:
--
-- insert into dim_capacidade_zonas (zona, capacidade) values
--   ('pulmao', 0),
--   ('picking_meia', 0),
--   ('picking_vestuario', 0),
--   ('picking_calcado', 0)
-- on conflict (zona) do update set capacidade = excluded.capacidade, atualizado_em = now();
-- ============================================================================

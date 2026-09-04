-- Histórico diário de ressuprimento POR FAMÍLIA + TURNO (dia + família +
-- turno), pra deixar o card "Ressuprimento planejado × realizado"
-- (D0/D-1/pendente/sem planejamento) parar de depender só do ÚLTIMO Kardex
-- processado.
--
-- Mesmo padrão de ressuprimento_historico_diario (migracao_historico_
-- ressuprimento.sql): cada upload de Kardex faz upsert só nos dias que ele
-- cobre. Reprocessar um período já gravado sobrescreve; um Kardex mais
-- curto (ex.: terça a hoje) nunca apaga dias fora do arquivo (ex.: segunda),
-- que continuam valendo do abastecimento anterior — pedido do usuário,
-- 05/09/2026 ("abasteço desde o início da semana até hoje; cada
-- abastecimento absorve os dias que ainda não fecharam pra frente,
-- mantendo os que já fecharam").
--
-- Por que por FAMÍLIA (e não só segmento/turno como a outra tabela): o
-- cruzamento D0/D-1/sem-planejamento é feito por família (ver comentário em
-- ingest-movimentacoes.js), então é essa a granularidade mínima que permite
-- reclassificar um dia antigo sem reprocessar o Kardex daquele dia de novo.
-- TURNO entra como terceira chave (não usado na decisão D0/D-1, que
-- continua turno-agnóstica) só pra permitir mostrar o "sem planejamento"
-- quebrado por turno — pedido do usuário, mesmo dia.

create table if not exists ressuprimento_familia_diario (
  dia            date not null,
  familia_codigo text not null,
  turno          text not null check (turno in ('T01', 'T02', 'T03')),
  pecas          integer not null default 0,
  movimentos     integer not null default 0,
  atualizado_em  timestamptz not null default now(),
  primary key (dia, familia_codigo, turno)
);

create index if not exists idx_ressuprimento_familia_diario_dia on ressuprimento_familia_diario (dia);

alter table ressuprimento_familia_diario enable row level security;

drop policy if exists "leitura para autenticados com papel" on ressuprimento_familia_diario;
create policy "leitura para autenticados com papel" on ressuprimento_familia_diario
  for select using (meu_papel() is not null);

drop policy if exists "escrita só admin" on ressuprimento_familia_diario;
create policy "escrita só admin" on ressuprimento_familia_diario
  for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

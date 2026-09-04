-- Histórico diário de OPERADORES (dia + turno + login), pra "Operadores" no
-- card "Ressuprimento por dia" parar de mostrar "—" sempre que o histórico
-- contínuo está ativo (o snapshot de UM Kardex guarda operadores; o
-- histórico agregado por dia+segmento+turno nunca guardou quem mexeu).
--
-- Diferente das outras tabelas de histórico (que somam peças/movimentos),
-- aqui o que interessa é CONTAGEM DISTINTA de login — por isso a tabela
-- guarda uma linha por (dia, turno, login) em vez de um total pronto:
-- upsert por essa chave já resolve dedup entre uploads que se sobrepõem,
-- e "quantos operadores" vira um COUNT DISTINCT no momento de exibir.

create table if not exists ressuprimento_operador_diario (
  dia            date not null,
  turno          text not null check (turno in ('T01', 'T02', 'T03')),
  login          text not null,
  nome           text,
  atualizado_em  timestamptz not null default now(),
  primary key (dia, turno, login)
);

create index if not exists idx_ressuprimento_operador_diario_dia on ressuprimento_operador_diario (dia);

alter table ressuprimento_operador_diario enable row level security;

create policy "leitura para autenticados com papel" on ressuprimento_operador_diario
  for select using (meu_papel() is not null);

create policy "escrita só admin" on ressuprimento_operador_diario
  for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

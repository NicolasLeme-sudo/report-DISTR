-- Turno REAL de cada colaborador (dim_colaboradores_turno), pra parar de
-- chutar o turno de quem fez o movimento no Kardex só pelo horário.
--
-- login: o mesmo formato que aparece no Kardex ("EX000923"). Vem do código
-- do ativo (ex: 15000923) trocando o "15" por "EX" — feito automaticamente
-- pelo upload da base de Ativos (Admin › Abastecimento).
--
-- turno: 'T01' | 'T02' | 'T03', ou NULL quando o colaborador é ADM/CARGO DE
-- CONFIANCA (não tem turno operacional) — nesse caso uma movimentação desse
-- login cai no fallback por horário, igual a um login não cadastrado.
--
-- Atualizada semanalmente (upsert por login — reenviar a planilha atualiza
-- quem mudou de turno e mantém quem não mudou).

create table if not exists dim_colaboradores_turno (
  login text primary key,
  nome text,
  turno text check (turno in ('T01', 'T02', 'T03') or turno is null),
  turno_bruto text,   -- valor original da coluna "Horario" da planilha, pra auditoria
  atualizado_em timestamptz not null default now()
);

alter table dim_colaboradores_turno enable row level security;

drop policy if exists "leitura para autenticados com papel" on dim_colaboradores_turno;
create policy "leitura para autenticados com papel" on dim_colaboradores_turno
  for select using (meu_papel() is not null);

drop policy if exists "escrita só admin" on dim_colaboradores_turno;
create policy "escrita só admin" on dim_colaboradores_turno
  for all using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

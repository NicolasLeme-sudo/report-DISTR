/* ============================================================================
   TESTES — ingest-colaboradores.js  (rode com: node testes-ingest-colaboradores.js)
   ============================================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = { window: {}, console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'ingest-colaboradores.js'), 'utf8'), ctx);

let falhas = 0;
function ok(cond, nome) {
  console.log((cond ? '  ok  ' : '  FALHOU  ') + nome);
  if (!cond) falhas++;
}
function eq(a, b, nome) {
  const bateu = JSON.stringify(a) === JSON.stringify(b);
  if (!bateu) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));
  ok(bateu, nome);
}

console.log('\n=== codigoAtivoParaLogin — "15xxxxxx" -> "EXxxxxxx" ===');
eq(ctx.codigoAtivoParaLogin('15000923'), 'EX000923', 'código de 8 dígitos com 15 na frente');
eq(ctx.codigoAtivoParaLogin(15001956), 'EX001956', 'código como número (não string) funciona igual');
eq(ctx.codigoAtivoParaLogin('15,000,923'), 'EX000923', 'ignora pontuação/vírgulas de formatação do Excel');
eq(ctx.codigoAtivoParaLogin('923'), null, 'código curto demais (não é 15xxxxxx) vira null, não login inventado');
eq(ctx.codigoAtivoParaLogin('20000923'), null, 'código que não começa com 15 vira null');
eq(ctx.codigoAtivoParaLogin(''), null, 'vazio vira null');
eq(ctx.codigoAtivoParaLogin(null), null, 'null vira null');

console.log('\n=== turnoDoHorario — só T01/T02/T03 direto; resto vira null (cai no fallback) ===');
eq(ctx.turnoDoHorario('1º Turno'), 'T01', '"1º Turno" -> T01');
eq(ctx.turnoDoHorario('2º Turno'), 'T02', '"2º Turno" -> T02');
eq(ctx.turnoDoHorario('3º Turno'), 'T03', '"3º Turno" -> T03');
eq(ctx.turnoDoHorario('1o turno'), 'T01', 'sem o símbolo de ordinal (o comum) também reconhece');
eq(ctx.turnoDoHorario('ADM'), null, '"ADM" não é turno operacional -> null (cai no fallback por horário)');
eq(ctx.turnoDoHorario('CARGO DE CONFIANCA'), null, '"CARGO DE CONFIANCA" -> null');
eq(ctx.turnoDoHorario('14:48 AS 18:40 E DAS 19:40 AS 00:16'), null, 'horário livre (sem "Turno") -> null, nunca inventa');
eq(ctx.turnoDoHorario(''), null, 'vazio -> null');
eq(ctx.turnoDoHorario(null), null, 'null -> null');

console.log('\n=== construirLinhasColaboradores — monta as linhas, avisa o que não deu pra aproveitar ===');
const avisos = [];
const linhas = ctx.construirLinhasColaboradores([
  { codigo: '15000923', nome: 'Fulano', horario: '1º Turno' },
  { codigo: '15001173', nome: 'Ciclano', horario: '2º Turno' },
  { codigo: '15001956', nome: 'Beltrano', horario: 'ADM' },
  { codigo: '923', nome: 'Código curto', horario: '1º Turno' },   // ignorado
], function (m) { avisos.push(m); });
eq(linhas.length, 3, '3 das 4 linhas viram registro (a de código inválido é descartada)');
const porLogin = {}; linhas.forEach(function (l) { porLogin[l.login] = l; });
eq(porLogin.EX000923.turno, 'T01', 'Fulano (1º Turno) vira EX000923/T01');
eq(porLogin.EX001173.turno, 'T02', 'Ciclano (2º Turno) vira EX001173/T02');
eq(porLogin.EX001956.turno, null, 'Beltrano (ADM) vira EX001956/turno null');
eq(porLogin.EX001956.turno_bruto, 'ADM', 'turno_bruto guarda o valor original, mesmo quando turno é null');
ok(avisos.some(function (a) { return /1 linha.*ignorada/.test(a); }), 'avisa 1 linha ignorada por código inválido');

console.log('\n=== upsertColaboradoresTurno — grava em lotes, upsert por login ===');
(async function () {
  const chamadas = [];
  const cliente = { from: function (nome) { return { upsert: async function (l, opts) { chamadas.push({ tabela: nome, n: l.length, opts: opts }); return { error: null }; } }; } };
  const muitasLinhas = [];
  for (let i = 0; i < 1100; i++) muitasLinhas.push({ login: 'EX' + i, nome: 'X', turno: 'T01', turno_bruto: '1º Turno', atualizado_em: '2026-01-01' });
  await ctx.upsertColaboradoresTurno(cliente, muitasLinhas, function () {});
  eq(chamadas.length, 3, '1100 linhas em lotes de 500 viram 3 chamadas (500+500+100)');
  ok(chamadas.every(function (c) { return c.tabela === 'dim_colaboradores_turno' && c.opts.onConflict === 'login'; }),
     'toda chamada mira dim_colaboradores_turno com onConflict=login');

  console.log('\n=== processarColaboradores — orquestra tudo, resume por turno no aviso final ===');
  const avisos2 = [];
  const cliente2 = { from: function () { return { upsert: async function () { return { error: null }; } }; } };
  const resultado = await ctx.processarColaboradores(cliente2, [
    { codigo: '15000001', nome: 'A', horario: '1º Turno' },
    { codigo: '15000002', nome: 'B', horario: '1º Turno' },
    { codigo: '15000003', nome: 'C', horario: '2º Turno' },
    { codigo: '15000004', nome: 'D', horario: 'ADM' },
  ], function (m) { avisos2.push(m); });
  eq(resultado, { total: 4, por_turno: { T01: 2, T02: 1, T03: 0, sem_turno: 1 } }, 'resumo final bate: 2 T01, 1 T02, 0 T03, 1 sem turno');
  ok(avisos2.some(function (a) { return /2.*T01.*1.*T02.*0.*T03.*1.*sem turno/.test(a); }), 'aviso final descreve a distribuição por turno');

  console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
})();

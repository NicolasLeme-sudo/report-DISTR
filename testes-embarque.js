/* ============================================================================
   TESTES — embarque.js (rode com: node testes-embarque.js)
   ============================================================================ */
const E = require('./embarque.js');
let falhas = 0;
function ok(c, n) { console.log((c ? '  ok  ' : '  XX  ') + n); if (!c) falhas++; }
function eq(a, b, n) { const x = JSON.stringify(a) === JSON.stringify(b); if (!x) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); ok(x, n); }
function secao(t) { console.log('\n=== ' + t + ' ==='); }

secao('leitura da base (layout da aba Plan1)');
const serial = function (iso) { return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569; };
const dias = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'];
const linhas = [
  [null, null, null],
  [null, 36, 36, 36, 36, 37, 37, 37, 37, 37, 37, 37, 37],            // linha de semana: não é data
  [null].concat(dias.map(serial)),
  ['BASE DADOS', 'qui', 'sex', 'sáb', 'dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom', 'seg'],
  ['SEPARAÇÃO'], ['Peças', 27482, 26476, 3004, null, null, 30392, 26792, 36532, 34694, null, null, 35692],
  ['FATURAMENTO'], ['Peças', 7422, 28493, null, null, null, 14235, 20336, 31436, 25725, null, null, 28833],
  ['EXPEDIÇÃO'], ['Peças', 15570, 50114, null, null, null, 46845, 25733, 23239, 39162, null, null, 10239],
  ['BACKLOG', '.'], ['Peças', 187686, 203932, null, null, null, 188798, '#N/A', 158563, 201473, null, null, 204096],
  ['BACKLOG (IDADE)'], ['1 dia', 1, 2, 3],
];
const p = E.parsearBaseEmbarque(linhas);
eq(p.registros.length, 8, 'dia sem NENHUM número (dom/feriado) não vira registro; sábado só com separação vira');
eq(p.registros[0], { dia: '2026-09-03', expedido: 15570, backlog: 187686, separacao: 27482, faturamento: 7422 }, 'primeiro dia lido com as 4 séries');
eq(p.periodo, { de: '2026-09-03', ate: '2026-09-14' }, 'período da base');
eq(p.total_expedido, 15570 + 50114 + 46845 + 25733 + 23239 + 39162 + 10239, 'total expedido bate com a soma da linha EXPEDIÇÃO');
const sab = p.registros.find(function (r) { return r.dia === '2026-09-05'; });
eq([sab.expedido, sab.separacao], [null, 3004], 'sábado: expedição nula (não zero), separação preservada');
eq(p.registros.find(function (r) { return r.dia === '2026-09-09'; }).backlog, null, '"#N/A" na célula vira nulo');
eq(p.registros.find(function (r) { return r.dia === '2026-09-14'; }).expedido, 10239, 'seção BACKLOG (IDADE) não confunde com BACKLOG');
let erro = null;
try { E.parsearBaseEmbarque([[null], [null, 1, 2]]); } catch (e) { erro = e.message; }
ok(/linha de datas/.test(erro || ''), 'arquivo sem linha de datas dá erro claro');
erro = null;
try { E.parsearBaseEmbarque(linhas.filter(function (l) { return l[0] !== 'EXPEDIÇÃO'; })); } catch (e) { erro = e.message; }
ok(/EXPEDIÇÃO/.test(erro || ''), 'sem a seção EXPEDIÇÃO dá erro claro');
eq(E.dataDeCelula(46279), '2026-09-14', 'serial do Excel vira data (46279 = 14/09/2026)');
eq(E.dataDeCelula('14/09/2026'), '2026-09-14', '"dd/mm/aaaa" vira ISO');
eq(E.dataDeCelula(37), null, 'número pequeno (semana) não é data');

secao('forecast do mês dividido pelos dias úteis');
const uteis = E.diasUteisDoMes('2026-10', []);
eq(uteis.length, 22, 'outubro/2026 tem 22 dias úteis (seg–sex)');
eq([uteis[0], uteis[uteis.length - 1]], ['2026-10-01', '2026-10-30'], 'de 01/10 (qui) a 30/10 (sex)');
eq(E.diasUteisDoMes('2026-10', ['2026-10-12']).length, 21, 'folga informada sai dos dias úteis');
const dist = E.distribuirNosDias(731000, uteis);
const vals = Object.keys(dist).map(function (k) { return dist[k]; });
eq(vals.reduce(function (s, v) { return s + v; }, 0), 731000, 'a soma dos 22 dias fecha EXATO em 731.000');
eq([Math.min.apply(null, vals), Math.max.apply(null, vals)], [33227, 33228], 'cada dia útil: 33.227 (6 primeiros dias levam +1)');
eq(dist['2026-10-01'], 33228, 'o resto da divisão vai nos primeiros dias');
const fc = E.forecastPorDia([{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }]);
eq([fc.saida['2026-10-03'], fc.saida['2026-10-04']], [0, 0], 'sábado e domingo do mês com forecast ficam em 0');
eq(fc.saida['2026-09-30'], undefined, 'mês sem forecast fica sem valor (não 0)');
eq(Object.keys(fc.entrada).length, 0, 'sem entrada informada, não há entrada prevista');

secao('série do gráfico (D-30 a D+30)');
const diario = [
  { dia: '2026-09-30', expedido: 20000, backlog: 90000 },
  { dia: '2026-10-01', expedido: 17166, backlog: 83515 },
];
const s = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }], '2026-10-02');
eq(s.dias.length, 61, '61 dias');
eq([s.dias[30], s.dias_semana[30], s.hoje_idx], ['02/10', 'Sex', 30], 'hoje no meio da janela');
eq([s.expedido[28], s.expedido[29]], [20000, 17166], 'expedido real nos dias da base');
eq(s.expedido[30], null, 'hoje (depois do último dia da base) fica sem expedido');
eq(s.expedido[0], 0, 'dia dentro do período sem lançamento = 0 (não nulo)');
eq([s.forecast[29], s.forecast[30]], [33228, 33228], 'forecast: 01/10 e 02/10 (primeiros dias levam o +1)');
eq(s.forecast[28], null, 'antes do mês com forecast: sem forecast');
eq(s.ultimo_dia_expedicao, '2026-10-01', 'último dia com expedição');
eq(s.backlog[29], 83515, 'backlog efetivo do último dia');
eq(s.backlog[30], null, 'sem entrada prevista: backlog futuro NÃO é projetado');
const s2 = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: 750000, dias_folga: [] }], '2026-10-02');
ok(s2.backlog[30] !== null, 'com entrada prevista o backlog do dia seguinte é projetado');
eq(s2.backlog[30], 83515 + 750000 / 22 - 731000 / 22 > 0 ? Math.round(83515 + 34091 - 33228) : 0, 'backlog(D+1) = backlog(D) + entrada(D) − saída(D)');
const s3 = E.montarSerieEmbarque([], [], '2026-10-02');
ok(s3.expedido.every(function (v) { return v === null; }) && !s3.tem_forecast, 'sem dado nenhum: série vazia, sem erro');

console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

// node testes-competicao.js — tela Competição e Admin da DISTR (competicao.js, ingest-competicao.js)
const assert = require('assert');
require('./regras-black.js');
const C = require('./competicao.js');
const A = require('./ingest-competicao.js');
const R = globalThis.RegrasBlack;

/* ---------- casamento de nomes ---------- */
const colabs = [
  { login: 'EX900001', nome: 'AUGUSTO DE MELO CARDOSO', turno: 'T01' },
  { login: 'EX900002', nome: 'ALAN PEREIRA SOUZA', turno: 'T01' },
  { login: 'EX900006', nome: 'ALAN JUNIOR DE PEREIRA', turno: 'T02' },
  { login: 'EX900007', nome: 'RAUL ANTUNES DA ROCHA', turno: 'T01' },
  { login: 'EX900008', nome: 'BEATRIZ CARLA PRADO LEME SILVEIRA', turno: null },
  { login: 'EX900009', nome: 'BEATRIZ CARLA DOS REIS TORRES', turno: 'T02' },
  { login: 'EX900010', nome: 'PAULO RAMOS DE LIMA', turno: 'T01' },
  { login: 'EX900011', nome: 'PAULO LUIZ LIMA DE SOUSA', turno: null },
  { login: 'EX000100', nome: 'MARIA SOUZA', turno: 'T01' },
  { login: 'EX000101', nome: 'MARIA SOUZA', turno: 'T02' }
];
assert.strictEqual(A.norm('Júlio  Regis-Ç.'), 'JULIO REGIS C');
assert.deepStrictEqual(A.casarNome('Augusto de Melo Cardoso', colabs, '1º Turno'), { tipo: 'exato', login: 'EX900001', nomeBase: 'AUGUSTO DE MELO CARDOSO' });
assert.strictEqual(A.casarNome('RAUL ANUNES DA ROCHA', colabs, '1º Turno').tipo, 'aproximado', 'erro de digitação no sobrenome');
assert.strictEqual(A.casarNome('RAUL ANUNES DA ROCHA', colabs, '1º Turno').login, 'EX900007');
const ana = A.casarNome('BEATRIZ CARLA PRADO LEME', colabs, '1º Turno');
assert.strictEqual(ana.tipo, 'aproximado'); assert.strictEqual(ana.login, 'EX900008', 'sobrenome a mais no cadastro');
assert.strictEqual(A.casarNome('MARIA SOUZA', colabs, '2º Turno').login, 'EX000101', 'homônimo desempata pelo turno');
assert.strictEqual(A.casarNome('MARIA SOUZA', colabs, null).tipo, 'ambiguo', 'homônimo sem turno é ambíguo');
assert.strictEqual(A.casarNome('FULANO DE TAL', colabs, '1º Turno').tipo, 'nao');

/* ---------- planilha "Black" (abas T01 e T2) ---------- */
const abaT01 = [
  ['', '', 'Apoio', '', 'Equipe 01', '', 'Equipe 02', '', 'Equipe 03'],
  ['', '', 'NADIA', '', 'AUGUSTO DE MELO CARDOSO', '', 'EMANUEL SANTOS', '', 'JULIO REGIS'],
  ['', '', '', '', 'ALAN PEREIRA SOUZA', '', 'RAUL ANUNES DA ROCHA', '', 'CAIO'],
  ['', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '3k', '', '3k', '', '3k']
];
const abaT2 = [
  ['', '', 'Apoio', '', 'Equipe 01', '', 'Equipe 02', '', 'Equipe 03'],
  ['', '', 'OTAVIO', '', 'DARIO', '', 'JORGE', '', 'LUCIO'],
  ['', '', '', '', 'KEVIN', '', 'JANAINA', '', 'NOVATO'],
  ['', '', '', '', '', '', '', '', 'NOVATO'],
  ['', '', '', '', '3k', '', '3k', '', '3k']
];
const abas = [{ nome: 'T01', linhas: abaT01 }, { nome: 'T2', linhas: abaT2 }, { nome: 'Legenda', linhas: [['x']] }];
assert.strictEqual(A.turnoDaAba('T01'), '1º Turno'); assert.strictEqual(A.turnoDaAba('T2'), '2º Turno'); assert.strictEqual(A.turnoDaAba('Laranja'), null);
assert.strictEqual(A.formatoDaPlanilha(abas), 'black');
const it = A.parseEscalacaoBlack(abas);
assert.strictEqual(it.length, 13, '6 do 1º turno + 7 do 2º (2 novatos)');
const porTime = {}; it.forEach(x => (porTime[x.time] = porTime[x.time] || []).push(x));
assert.deepStrictEqual(porTime[1].map(x => x.nome), ['AUGUSTO DE MELO CARDOSO', 'ALAN PEREIRA SOUZA']);
assert.deepStrictEqual(porTime[2].map(x => x.nome), ['EMANUEL SANTOS', 'RAUL ANUNES DA ROCHA']);
assert.deepStrictEqual(porTime[3].map(x => x.nome), ['JULIO REGIS', 'CAIO']);
assert.deepStrictEqual(porTime[4].map(x => x.nome), ['DARIO', 'KEVIN'], 'equipe 01 do 2º turno é o time 4');
assert.strictEqual(porTime[6].length, 3); assert.strictEqual(porTime[6].filter(x => x.novato).length, 2);
assert.ok(it.every(x => x.nome !== 'NADIA' && x.nome !== 'OTAVIO' && !/k$/i.test(x.nome || '')), 'apoio e linha 3k ficam de fora');
assert.strictEqual(it.filter(x => x.turno === '1º Turno').length, 6);

/* ---------- planilha por times: exportar e ler de volta ---------- */
const cad = [
  { id: 1, usuario_wms: 'EX900001', nome: 'AUGUSTO', turno: '1º Turno', time: 1, observacao: 'x', lider: true, presenca: { '2026-11-27': 'P', '2026-11-28': 'F' } },
  { id: 2, usuario_wms: 'EX900002', nome: 'ALAN', turno: '1º Turno', time: 1, observacao: null, lider: false, presenca: {} },
  { id: 3, usuario_wms: 'EX900005', nome: 'DARIO', turno: '2º Turno', time: 4, observacao: null, lider: false, presenca: { '2026-11-29': 'A' } },
  { id: 4, usuario_wms: 'NOVATO.6.1', nome: null, turno: '2º Turno', time: 6, observacao: 'novato', lider: false, presenca: {} }
];
const exp = A.abasExportacao(cad);
assert.strictEqual(exp.length, 6); assert.strictEqual(exp[0].nome, 'Vermelho');
assert.strictEqual(A.formatoDaPlanilha(exp), 'times');
const volta = A.parsePlanilhaPorTimes(exp);
assert.strictEqual(volta.length, 4);
const v1 = volta.find(x => x.usuario_wms === 'EX900001');
assert.deepStrictEqual(v1.presenca, { '2026-11-27': 'P', '2026-11-28': 'F' }); assert.strictEqual(v1.lider, true); assert.strictEqual(v1.time, 1); assert.strictEqual(v1.turno, '1º Turno');
assert.strictEqual(volta.find(x => x.usuario_wms === 'EX900005').turno, '2º Turno');
assert.strictEqual(volta.find(x => x.usuario_wms === 'NOVATO.6.1').novato, true);

/* ---------- montar linhas do banco ---------- */
const itens = [
  { turno: '1º Turno', time: 1, nome: 'AUGUSTO', usuario_wms: null, novato: false },
  { turno: '1º Turno', time: 1, nome: 'SEM CADASTRO', usuario_wms: null, novato: false },
  { turno: '1º Turno', time: 1, nome: null, usuario_wms: null, novato: true },
  { turno: '2º Turno', time: 6, nome: null, usuario_wms: null, novato: true }
];
const linhas = A.montarLinhasBanco(itens, { 0: 'EX900001' }, cad);
assert.strictEqual(linhas[0].usuario_wms, 'EX900001'); assert.deepStrictEqual(linhas[0].presenca, { '2026-11-27': 'P', '2026-11-28': 'F' }, 'mantém a presença de quem já estava');
assert.strictEqual(linhas[1].usuario_wms, 'SEMUSU.1.2'); assert.ok(/informar o EX/.test(linhas[1].observacao));
assert.strictEqual(linhas[2].usuario_wms, 'NOVATO.1.3'); assert.strictEqual(linhas[3].usuario_wms, 'NOVATO.6.1');

/* ---------- lançamentos ---------- */
const hoje = '2026-11-27';
const vis = A.montarLancamentos('vistoria', hoje, '1º Turno', { time: 2, itens: [0, 5], limpa: false });
assert.strictEqual(vis.length, 2); assert.strictEqual(vis[0].pontos, -20); assert.strictEqual(vis[1].pontos, -50); assert.ok(vis.every(l => l.categoria === 'vistoria' && l.time === 2));
assert.strictEqual(A.montarLancamentos('vistoria', hoje, '1º Turno', { time: 2, limpa: true })[0].pontos, 100);
const ginc = A.montarLancamentos('gincana', '2026-11-28', '2º Turno', { item: 'Torre Black', valor: 150 });
assert.deepStrictEqual(ginc.map(l => l.time), [4, 5, 6], 'gincana vale igual para os 3 times do turno'); assert.ok(ginc.every(l => l.pontos === 150 && l.categoria === 'desafio' && l.item === 'Gincana: Torre Black'));
assert.strictEqual(A.montarLancamentos('desafio', hoje, '1º Turno', { time: 1, item: 'Outro', outro: '  ', valor: 100 }).length, 0, 'outro sem nome não lança');
assert.strictEqual(A.montarLancamentos('desafio', hoje, '1º Turno', { time: 1, item: 'Outro', outro: 'Quiz', valor: 100 })[0].item, 'Quiz');
assert.strictEqual(A.montarLancamentos('ajuste', hoje, '1º Turno', { time: 1, valor: -30, motivo: '' }).length, 0, 'ajuste exige motivo');
assert.strictEqual(A.montarLancamentos('ajuste', hoje, '1º Turno', { time: 1, valor: -30, motivo: 'erro' })[0].pontos, -30);
const est = A.linhaEstorno({ id: 'abc', dia: '2026-11-27T00:00:00', turno: '1º Turno', time: 2, categoria: 'vistoria', item: 'Lixo', pontos: -20 });
assert.strictEqual(est.pontos, 20); assert.strictEqual(est.motivo, 'Estorno de abc'); assert.strictEqual(est.dia, '2026-11-27');

/* ---------- tela: dias, blocos, acumulado ---------- */
const cadRank = [
  { usuario_wms: 'EX1', nome: 'A', turno: '1º Turno', time: 1, presenca: { '2026-11-27': 'P', '2026-11-28': 'P', '2026-11-29': 'P' } },
  { usuario_wms: 'EX2', nome: 'B', turno: '1º Turno', time: 2, presenca: { '2026-11-27': 'P', '2026-11-28': 'F' } },
  { usuario_wms: 'EX3', nome: 'C', turno: '1º Turno', time: 3, presenca: {} },
  { usuario_wms: 'EX4', nome: 'D', turno: '2º Turno', time: 4, presenca: {} },
  { usuario_wms: 'NOVATO.6.1', nome: null, turno: '2º Turno', time: 6, presenca: {} }
];
const prod = [
  { dia: '2026-11-26', turno: 'T01', login: 'EX3', nome: 'C', pecas: 500 },
  { dia: '2026-11-27', turno: 'T01', login: 'EX1', nome: 'A', pecas: 1000 },
  { dia: '2026-11-27', turno: 'T01', login: 'EX2', nome: 'B', pecas: 3200 },
  { dia: '2026-11-27', turno: 'T02', login: 'EX4', nome: 'D', pecas: 2000 }
];
const dados = { cadastro: cadRank, producao: prod, lanc: [{ id: 'l1', dia: '2026-11-27', turno: '1º Turno', time: 1, categoria: 'desafio', pontos: 100 }], hoje: '2026-11-27' };
const dias = C.diasDisponiveis(dados);
assert.deepStrictEqual(dias, ['2026-11-29', '2026-11-28', '2026-11-27', '2026-11-26'], 'dias da Black sempre aparecem + dias com produção');
assert.strictEqual(C.diaPadrao(dias, '2026-11-27'), '2026-11-27'); assert.strictEqual(C.diaPadrao(dias, '2026-11-25'), '2026-11-26'); assert.strictEqual(C.diaPadrao(dias, '2026-11-20'), '2026-11-26');
const blocos = C.montarBlocos(dados, '2026-11-27', 'ambos');
assert.strictEqual(blocos.length, 2); assert.strictEqual(blocos[0].turno, '1º Turno');
assert.deepStrictEqual(blocos[0].linhas.map(l => l.t.n), [2, 1, 3], 'pódio do 1º turno por peças: time 2 (3.200) à frente do 1 (1.000)');
assert.strictEqual(blocos[0].linhas[0].r.metaBatida, 200); assert.strictEqual(blocos[0].linhas[1].r.desafios, 100);
assert.strictEqual(blocos[1].linhas.length, 2, 'só times com membros no cadastro');
assert.strictEqual(C.montarBlocos(dados, '2026-11-27', '2º Turno').length, 1);
const html = C.cardTimeHtml(blocos[0].linhas[0], '2026-11-27', C.presencaMap(cadRank, '2026-11-27'));
assert.ok(/Time Azul/.test(html) && /3\.200/.test(html) && /data-flip="time-2"/.test(html) && /Meta batida/.test(html) && /lider/.test(html));
assert.ok(/Novato \(vaga\)/.test(C.blocoHtml(blocos[1], '2026-11-27', {})), 'novato aparece como vaga');
assert.ok(/sem produção em 28\/11/.test(C.blocoHtml(C.montarBlocos(dados, '2026-11-28', '1º Turno')[0], '2026-11-28', {})));
const acc = C.acumuladoDosDias(dados);
assert.ok(acc[1] && acc[2] && acc[4], 'acumula os times do cadastro');
assert.strictEqual(acc[1].dias, 3, 'presença lançada conta como atividade nos 3 dias');
assert.strictEqual(acc[1].trinca, 200, 'time 1 com presença 100% nos 3 dias leva a Trinca Perfeita');
assert.strictEqual(acc[2].trinca, 0, 'time 2 faltou em 28/11');
const umDia = { cadastro: cadRank.map(r => Object.assign({}, r, { presenca: {} })), producao: prod, lanc: [], hoje: '2026-11-27' };
assert.strictEqual(C.acumuladoDosDias(umDia)[1].dias, 1, 'só 27/11 tem produção: os outros dias não entram');
assert.strictEqual(C.acumuladoDosDias(umDia)[1].trinca, 0);
assert.ok(/Trinca/.test(C.acumuladoHtml(acc, dados)));
assert.ok(/começa no primeiro dia/.test(C.acumuladoHtml({}, dados)));

/* ---------- extração ---------- */
const ex = A.montarExtracao(dados, ['2026-11-27']);
assert.deepStrictEqual(ex.map(a => a.nome), ['Times', 'Acumulado', 'Colaboradores', 'Lançamentos']);
assert.strictEqual(ex[0].linhas[0].length, 13);
assert.ok(ex[0].linhas.length > 1 && ex[1].linhas.length > 1 && ex[2].linhas.length > 1 && ex[3].linhas.length === 2);
assert.strictEqual(ex[3].linhas[1][5], 100);

/* ---------- erro de tabela inexistente ---------- */
assert.ok(C.tabelaInexistente({ code: '42P01' })); assert.ok(C.tabelaInexistente({ message: 'Could not find the table public.competicao_times in the schema cache' }));
assert.ok(C.tabelaInexistente({ message: 'relation "competicao_times" does not exist' })); assert.ok(!C.tabelaInexistente({ message: 'permission denied' }));

/* ---------- carregarDados com cliente Supabase simulado ---------- */
function fakeSb(tabelas) {
  return { from(t) {
    const b = { select() { return b; }, order() { return b; }, gte() { return b; },
      range(a, z) { const r = tabelas[t]; return Promise.resolve(r.error ? { data: null, error: r.error } : { data: (r.data || []).slice(a, z + 1), error: null }); },
      then(res, rej) { const r = tabelas[t]; return Promise.resolve(r.error ? { data: null, error: r.error } : { data: r.data, error: null }).then(res, rej); } };
    return b;
  } };
}
(async () => {
  const grande = Array.from({ length: 2500 }, (_, i) => ({ dia: '2026-11-20', turno: 'T01', login: 'EX' + i, nome: 'n', pecas: 1, atualizado_em: i === 7 ? '2026-11-23T12:00:00Z' : '2026-11-23T10:00:00Z' }));
  const ok = await C.carregarDados(fakeSb({ competicao_times: { data: cadRank }, competicao_pontos: { data: dados.lanc }, ressuprimento_operador_diario: { data: grande } }));
  assert.strictEqual(ok.cadastro.length, 5); assert.strictEqual(ok.lanc.length, 1);
  assert.strictEqual(ok.producao.length, 2500, 'pagina de 1000 em 1000 e junta tudo'); assert.strictEqual(ok.snap, '2026-11-23T12:00:00Z');
  const semPontos = await C.carregarDados(fakeSb({ competicao_times: { data: cadRank }, competicao_pontos: { error: { code: '42P01', message: 'relation does not exist' } }, ressuprimento_operador_diario: { data: [] } }));
  assert.deepStrictEqual(semPontos.lanc, [], 'sem a tabela de pontos a tela segue sem lançamentos');
  let erro = null;
  try { await C.carregarDados(fakeSb({ competicao_times: { error: { code: 'PGRST205', message: "Could not find the table 'public.competicao_times' in the schema cache" } }, competicao_pontos: { data: [] }, ressuprimento_operador_diario: { data: [] } })); } catch (e) { erro = e; }
  assert.ok(erro && C.tabelaInexistente(erro), 'tabela de times inexistente vira mensagem amigável na tela');
  let negado = null;
  try { await C.carregarDados(fakeSb({ competicao_times: { error: { code: '42501', message: 'permission denied' } }, competicao_pontos: { data: [] }, ressuprimento_operador_diario: { data: [] } })); } catch (e) { negado = e; }
  assert.ok(negado && !C.tabelaInexistente(negado));
  console.log('testes-competicao.js OK');
})().catch(e => { console.error(e); process.exit(1); });

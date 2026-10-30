/* ============================================================================
   TESTES — embarque.js (rode com: node testes-embarque.js)
   ============================================================================ */
const E = require('./embarque.js');
let falhas = 0;
function ok(c, n) { console.log((c ? '  ok  ' : '  XX  ') + n); if (!c) falhas++; }
function eq(a, b, n) { const x = JSON.stringify(a) === JSON.stringify(b); if (!x) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); ok(x, n); }
function secao(t) { console.log('\n=== ' + t + ' ==='); }

secao('datas de célula');
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
eq([fc.entrada['2026-10-01'], fc.entrada['2026-10-03']], [33228, 0], 'sem entrada informada, a entrada prevista = forecast ÷ dias úteis');

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
eq(s.backlog[30], 83515, 'sem entrada informada: entrada = saída prevista, backlog projetado se mantém');
const s2 = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: 750000, dias_folga: [] }], '2026-10-02');
ok(s2.backlog[30] !== null, 'com entrada prevista o backlog do dia seguinte é projetado');
eq(s2.backlog[30], 83515 + 750000 / 22 - 731000 / 22 > 0 ? Math.round(83515 + 34091 - 33228) : 0, 'backlog(D+1) = backlog(D) + entrada(D) − saída(D)');
const s3 = E.montarSerieEmbarque([], [], '2026-10-02');
ok(s3.expedido.every(function (v) { return v === null; }) && !s3.tem_forecast, 'sem dado nenhum: série vazia, sem erro');


secao('forecast em mil peças e proporção por marca/segmento');
eq([E.lerMilPecas('731'), E.lerMilPecas('731,5'), E.lerMilPecas('731000'), E.lerMilPecas('731.000'), E.lerMilPecas('')], [731000, 731500, 731000, 731000, null], '"731" = 731 mil; valor grande já é peças; vazio = nulo');
ok(isNaN(E.lerMilPecas('abc')), 'texto inválido dá erro');
const rm = E.repartir(33228, [{ nome: 'OLYMPIKUS', pct: 50 }, { nome: 'MIZUNO', pct: 30 }, { nome: 'UNDER ARMOUR', pct: 20 }]);
eq(rm.map(function (x) { return x.valor; }), [16614, 9968, 6646], 'repartição 50/30/20 do dia (33.228)');
eq(rm.reduce(function (s, x) { return s + x.valor; }, 0), 33228, 'a soma das partes fecha EXATO no total do dia');
const rs = E.repartir(33227, [{ nome: 'CALÇADO', pct: 60 }, { nome: 'VESTUÁRIO', pct: 40 }]);
eq(rs.reduce(function (s, x) { return s + x.valor; }, 0), 33227, 'segmento 60/40 também fecha exato (total ímpar)');
eq(E.repartir(100, []), [], 'sem proporção informada: nada a repartir');
eq(E.validarProporcoes('Marca', [{ nome: 'mizuno', pct: '60' }, { nome: 'Olympikus', pct: '40' }]).map(function (x) { return x.nome; }), ['MIZUNO', 'OLYMPIKUS'], 'proporção válida (60+40), nome em caixa alta');
let e2 = null; try { E.validarProporcoes('Marca', [{ nome: 'MIZUNO', pct: '60' }, { nome: 'OLYMPIKUS', pct: '30' }]); } catch (e) { e2 = e.message; }
ok(/somam 90%/.test(e2 || ''), 'soma diferente de 100% é recusada com a soma no texto');
eq(E.validarProporcoes('Marca', [{ nome: '', pct: '' }]), [], 'linha em branco é ignorada (campo opcional)');
const sp = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_dolga: [], dias_folga: [],
  prop_marca: [{ nome: 'MIZUNO', pct: 60 }, { nome: 'OLYMPIKUS', pct: 40 }], prop_segmento: [] }], '2026-10-02');
eq(sp.forecast_marca[30].map(function (x) { return x.valor; }), [19937, 13291], 'tooltip: forecast do dia aberto por marca (60/40 de 33.228)');
eq(sp.forecast_segmento[30], [], 'sem proporção de segmento: lista vazia');
eq(sp.forecast_marca[28], [], 'dia de mês sem forecast: sem abertura');

secao('backlog de hoje = peças em tela, com a parte "Não disp. picking"');
const et = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }], '2026-10-02',
  undefined, { total: 83554, por_situacao: { 'Leitura expedicao': 80000, 'Nao disp. picking': 3554 }, gerado_em: '2026-10-02T11:51:25Z' });
eq([et.backlog[30], et.backlog_efetivo[30]], [83554, 83554], 'hoje: backlog = total em tela');
eq([et.backlog_nao_disp[30], et.backlog_nao_disp[29]], [3554, null], 'parte vermelha só no dia de hoje');
eq(et.backlog_hoje.nao_disp, 3554, 'resumo de hoje para o canto do gráfico');
eq(et.backlog[29], 83515, 'dias anteriores: backlog da base');
const ec = E.montarSerieEmbarque(diario, [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: 750000, dias_folga: [] }], '2026-10-02',
  undefined, { total: 83554, por_situacao: {}, gerado_em: '2026-10-02T11:51:25Z' });
eq(ec.backlog[31], 83554 + 34091 - 33228, 'projeção parte do backlog em tela de hoje (83.554)');
eq(ec.backlog_nao_disp[30], 0, 'sem "Nao disp. picking" no snapshot: parte vermelha zero');

secao('saída efetiva nos dias que já passaram');
eq([s.saida_efetiva[28], s.saida_efetiva[29], s.saida_efetiva[30]], [20000, 17166, null], 'efetiva até o último dia da base; hoje sem efetiva (usa a prevista)');


secao('transportadora: só o nome curto');
eq(['DISPLAN ENCOMENDAS URGENTES LTDA', 'TECMAR TRANSPORTES LTDA.', 'PATRUS TRANSPORTES URGENTES LTDA', 'VITORIA PROVEDORA LOGISTICA LTDA', 'VITÓRIA PROVEDORA LOGISTICA LTDA',
  'CIDEX LOGISTICA LTDA', 'TRANSPORTADORA TRANSPRADO LTDA', 'PRIMMUS LOGÍSTICA EXPRESSA LTDA', 'S/CARRO', ''].map(E.nomeCurtoTransportadora),
  ['DISPLAN', 'TECMAR', 'PATRUS', 'VITÓRIA', 'VITÓRIA', 'CIDEX', 'TRANSPRADO', 'PRIMMUS', 'SEM TRANSPORTADORA', 'SEM TRANSPORTADORA'], 'nome curto das 7 transportadoras (com ou sem acento, com ponto final)');

secao('notas embarcadas (detalhado)');
const FAMS = { '068': { marca: 'OLYMPIKUS', categoria: 'MEIAS OLYMPIKUS' }, '103': { marca: 'MIZUNO', categoria: 'VESTUÁRIO MIZUNO' }, '102': { marca: 'MIZUNO', categoria: 'TÊNIS MIZUNO' },
  '108': { marca: 'MIZUNO', categoria: 'CHUTEIRA MIZUNO' } };
const notas = E.parsearNotasEmbarcadas([
  ['Embarcador', 'Destinatário', 'Nota Fiscal', 'Emissão', 'Embarque OT 1P.', 'Valor NF', 'Vol.', 'Peças', 'Família', 'Marca', 'Cód.Transp.', 'Transportadora'],
  ['DIS', 'CLIENTE A', '000202314', 46198, 46205, 1109.52, 1, 36, '068', 'Confecçao Olympikus', '000585', 'PATRUS TRANSPORTES URGENTES LTDA'],
  ['DIS', 'CLIENTE B', '000202327', 46198, 46209, 1337.08, 2, 92, '103', 'Confecçao Mizuno', '090834', 'DISPLAN ENCOMENDAS URGENTES LTDA'],
  ['DIS', 'CLIENTE C', '000202328', 46198, 46209, 10, 1, 10, '108', 'Chuteira Mizuno', '090834', 'DISPLAN ENCOMENDAS URGENTES LTDA'],
  ['DIS', 'CLIENTE D', '000202327', 46198, 46209, 1337.08, 2, 92, '103', 'Confecçao Mizuno', '090834', 'DISPLAN ENCOMENDAS URGENTES LTDA'],
  ['DIS', 'CLIENTE E', '000202999', 46198, 46209, 5, 1, 7, '999', 'Confeaçao Under Armour', '090834', 'TECMAR TRANSPORTES LTDA'],
], FAMS);
eq(notas.registros.length, 4, 'linha repetida (mesma NF) é descartada');
eq(notas.registros.map(function (r) { return r.marca + '/' + r.segmento; }), ['OLYMPIKUS/MEIA', 'MIZUNO/VESTUÁRIO', 'MIZUNO/CALÇADO', 'UNDER ARMOUR/OUTROS'], 'marca vem do cadastro, segmento macro da categoria; chuteira conta como calçado');
eq([notas.registros[0].embarque, notas.registros[0].emissao, notas.registros[0].pecas, notas.registros[0].volumes], ['2026-07-02', '2026-06-25', 36, 1], 'datas do Excel viram ISO; peças e volumes lidos');
ok(notas.registros.every(function (r) { return !JSON.stringify(r).includes('CLIENTE'); }), 'nome do cliente NÃO é guardado');
ok(notas.avisos.some(function (a) { return /999/.test(a); }), 'família fora do cadastro gera aviso');
let e3 = null; try { E.parsearNotasEmbarcadas([['a', 'b']], {}); } catch (e) { e3 = e.message; }
ok(/Nota Fiscal/.test(e3 || ''), 'planilha sem o cabeçalho esperado dá erro claro');
const expT = E.aplicarExpedidoTime([{ dia: '2026-10-21', expedido: 23555, fonte_expedido: 'nfs_embarcadas' }, { dia: '2026-10-22', expedido: 14839, fonte_expedido: 'nfs_embarcadas' }, { dia: '2026-10-26', expedido: 9000, backlog: 5 }],
  [{ d: '2026-10-22', p: 21000 }, { d: '2026-10-22', p: 633 }, { d: '2026-10-24', p: 0 }, { d: '2026-10-23', p: 16765 }]);
eq(expT.filter(function (r) { return r.dia >= '2026-10-22' && r.dia <= '2026-10-24'; }).map(function (r) { return r.dia.slice(8) + ':' + r.expedido; }), ['22:21633', '23:16765', '24:0'], 'expedição do dia = soma do arquivo do time no período que ele cobre');
eq([expT.find(function (r) { return r.dia === '2026-10-21'; }).expedido, expT.find(function (r) { return r.dia === '2026-10-26'; }).expedido], [23555, null], 'antes do arquivo do time segue a base antiga; depois dele não há expedido (o GCI não entra)');
// formato diário do Embarque (26/10/2026): sem número de NF
const otDiario = E.parsearNotasEmbarcadas([
  ['Embarque OT 1P.', 'Família', 'Peças', 'Vol.', 'Transportadora'],
  ['01/10/2026', 103, 53, 2, 'PATRUS TRANSPORTES URGENTES LTDA'],
  ['01/10/2026', 103, 53, 2, 'PATRUS TRANSPORTES URGENTES LTDA'],
  ['02/10/2026', 68, 12, 1, 'DISPLAN ENCOMENDAS URGENTES LTDA'],
  [null, null, 118, 5, null],
], FAMS);
ok(otDiario.sem_nf, 'arquivo sem a coluna Nota Fiscal é reconhecido');
eq(otDiario.registros.map(function (r) { return r.nf; }), ['OT|2026-10-01|1', 'OT|2026-10-01|2', 'OT|2026-10-02|1'], 'chave = OT|data|sequência do dia (duas notas iguais no mesmo dia continuam duas)');
eq([otDiario.total_pecas, otDiario.periodo.de, otDiario.periodo.ate], [118, '2026-10-01', '2026-10-02'], 'linha de total no fim é ignorada; período do arquivo');
eq([otDiario.registros[0].familia, otDiario.registros[0].marca, otDiario.registros[2].segmento], ['103', 'MIZUNO', 'MEIA'], 'família numérica vira código com 3 dígitos e ganha marca/segmento do cadastro');
eq(otDiario.avisos.length, 0, 'sem avisos para o arquivo diário limpo');

secao('filtros e mix');
const agg = [
  { d: '2026-09-29', m: 'OLYMPIKUS', s: 'MEIA', t: 'DISPLAN ENCOMENDAS URGENTES LTDA', p: 600, v: 30, n: 6 },
  { d: '2026-09-29', m: 'MIZUNO', s: 'VESTUÁRIO', t: 'PATRUS TRANSPORTES URGENTES LTDA', p: 300, v: 20, n: 3 },
  { d: '2026-09-30', m: 'MIZUNO', s: 'CHUTEIRA', t: 'DISPLAN ENCOMENDAS URGENTES LTDA', p: 100, v: 5, n: 1 },
  { d: '2026-08-31', m: 'OLYMPIKUS', s: 'MEIA', t: 'TECMAR TRANSPORTES LTDA.', p: 1000, v: 50, n: 10 },
];
const mx = E.montarMix(agg, {}, 'tudo');
eq([mx.total.p, mx.total.v, mx.total.n], [2000, 105, 20], 'totais de peças, volumes e notas');
eq(mx.transportadoras.map(function (x) { return x.nome + ':' + x.p + ':' + x.v + ':' + Math.round(x.pct); }), ['TECMAR:1000:50:50', 'DISPLAN:700:35:35', 'PATRUS:300:20:15'], 'ranking de transportadoras: peças, volumes e % do total');
eq(mx.segs, ['MEIA', 'VESTUÁRIO', 'CALÇADO', 'ACESSÓRIO'], 'chuteira entra em CALÇADO na matriz; colunas em ordem fixa (todas sempre presentes)');
eq(E.montarMix(agg, {}, '2026-09').total.p, 1000, 'período = um mês (setembro)');
const mfil = E.montarMix(agg, { marca: ['MIZUNO'], seg: [], transp: ['PATRUS'] }, 'tudo');
eq(mfil.total.p, 300, 'matriz respeita os 3 filtros');
eq(mfil.transportadoras.map(function (x) { return x.nome; }), ['PATRUS', 'DISPLAN'], 'ranking respeita marca/segmento mas ignora o próprio filtro de transportadora');
const fcs = [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [], prop_marca: [{ nome: 'MIZUNO', pct: 25 }, { nome: 'OLYMPIKUS', pct: 75 }], prop_segmento: [] }];
const base = E.montarSerieEmbarque(diario, fcs, '2026-10-02');
const grupos = [{ m: 'MIZUNO', s: 'VESTUÁRIO', t: 'PATRUS TRANSPORTES URGENTES LTDA', sit: 'Leitura expedicao', p: 700 }, { m: 'MIZUNO', s: 'CALÇADO', t: 'S/CARRO', sit: 'Nao disp. picking', p: 300 }, { m: 'OLYMPIKUS', s: 'MEIA', t: 'TECMAR TRANSPORTES LTDA.', sit: 'Leitura expedicao', p: 5000 }];
const ctx = { filtros: { marca: ['MIZUNO'], seg: [], transp: [] }, agg: agg, forecasts: fcs, emTela: { total: 6000, gerado_em: '2026-10-02T10:00:00Z', grupos: grupos } };
const sf = E.aplicarFiltrosNaSerie(base, ctx);
eq(E.aplicarFiltrosNaSerie(base, { filtros: { marca: [], seg: [], transp: [] } }), base, 'sem filtro: devolve a série original');
eq(sf.forecast[30], Math.round(33228 * 0.25), 'forecast do dia = forecast × proporção da marca (25%)');
eq([sf.expedido[27], sf.expedido[28], sf.expedido[29]], [300, 100, null], 'realizado filtrado vem do detalhado (Mizuno: 300 em 29/09, 100 em 30/09; 01/10 já fora do detalhado = sem dado)');
eq([sf.backlog[30], sf.backlog_nao_disp[30], sf.backlog[29]], [1000, 300, null], 'backlog de hoje filtrado (Mizuno: 1.000, dos quais 300 não disp.); histórico da base antiga some');
eq(E.aplicarFiltrosNaSerie(base, Object.assign({}, ctx, { filtros: { marca: ['UNDER ARMOUR'], seg: [], transp: [] } })).forecast[30], 0, 'marca fora das proporções cadastradas do mês = 0%');
const semProp = [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [], prop_marca: [], prop_segmento: [] }];
eq(E.aplicarFiltrosNaSerie(E.montarSerieEmbarque(diario, semProp, '2026-10-02'), Object.assign({}, ctx, { forecasts: semProp })).forecast[30], null, 'mês sem proporção cadastrada: sem forecast filtrado (não inventa)');

secao('proporção cruzada (segmento dentro de cada marca)');
const cz = E.validarCruzada([
  { nome: 'olympikus', pct: '60', segmentos: [{ nome: 'MEIA', pct: '80' }, { nome: 'VESTUÁRIO', pct: '20' }, { nome: '', pct: '' }] },
  { nome: 'MIZUNO', pct: '40', segmentos: [{ nome: 'VESTUÁRIO', pct: '50' }, { nome: 'CALÇADO', pct: '50' }] },
]);
eq(cz.prop_marca, [{ nome: 'OLYMPIKUS', pct: 60 }, { nome: 'MIZUNO', pct: 40 }], 'marcas viram a proporção por marca');
eq(cz.prop_segmento, [{ nome: 'MEIA', pct: 48 }, { nome: 'VESTUÁRIO', pct: 32 }, { nome: 'CALÇADO', pct: 20 }], 'segmento geral = Σ marca% × segmento%');
let erroCz = ''; try { E.validarCruzada([{ nome: 'MIZUNO', pct: 100, segmentos: [{ nome: 'MEIA', pct: 70 }] }]); } catch (e) { erroCz = e.message; }
ok(/Segmentos de MIZUNO.*100%/.test(erroCz), 'segmentos de uma marca precisam somar 100%');
erroCz = ''; try { E.validarCruzada([{ nome: 'MIZUNO', pct: 100, segmentos: [] }]); } catch (e) { erroCz = e.message; }
ok(/Segmentos de MIZUNO/.test(erroCz), 'marca sem segmentos dá erro claro');
const mxC = E.matrizPrevista(Object.assign({ mes: '2026-10', pecas_embarque: 1000 }, cz), []);
eq([mxC.cel['OLYMPIKUS|MEIA'], mxC.cel['OLYMPIKUS|VESTUÁRIO'], mxC.cel['MIZUNO|VESTUÁRIO'], mxC.cel['MIZUNO|CALÇADO']], [480, 120, 200, 200], 'matriz do forecast usa a célula exata informada');
eq(mxC.segs.map(function (g) { return g.nome; }), ['MEIA', 'VESTUÁRIO', 'CALÇADO', 'ACESSÓRIO'], 'colunas na ordem fixa');
const fcz = [Object.assign({ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }, cz)];
const sCz = E.aplicarFiltrosNaSerie(E.montarSerieEmbarque(diario, fcz, '2026-10-02'), { filtros: { marca: ['MIZUNO'], seg: ['CALÇADO'], transp: [] }, agg: agg, forecasts: fcz, emTela: null });
eq(sCz.forecast[30], Math.round(33228 * 0.2), 'filtro Mizuno + Calçado = célula informada (40% × 50% = 20%), não o produto das margens');

secao('nomes digitados no forecast viram o nome dos dados');
eq(E.validarProporcoes('Segmento', [{ nome: 'Calçados', pct: '60' }, { nome: 'vestuario', pct: '30' }, { nome: 'MEIAS', pct: '10' }]).map(function (x) { return x.nome; }),
  ['CALÇADO', 'VESTUÁRIO', 'MEIA'], 'plural, sem acento e minúsculo -> CALÇADO / VESTUÁRIO / MEIA');
eq(E.validarProporcoes('Marca', [{ nome: 'Under Armor', pct: 40 }, { nome: 'olympikus', pct: 60 }]).map(function (x) { return x.nome; }),
  ['UNDER ARMOUR', 'OLYMPIKUS'], '"Under Armor" -> UNDER ARMOUR');
eq(E.validarProporcoes('Marca', [{ nome: 'Fila', pct: 100 }])[0].nome, 'FILA', 'nome desconhecido fica como digitado (maiúsculo)');
let erroDup = ''; try { E.validarProporcoes('Segmento', [{ nome: 'Calçado', pct: 50 }, { nome: 'CALÇADOS', pct: 50 }]); } catch (e) { erroDup = e.message; }
ok(/repetido/.test(erroDup), 'Calçado e Calçados juntos = nome repetido');
eq(E.validarCruzada([{ nome: 'Mizuno', pct: 100, segmentos: [{ nome: 'calcados', pct: 100 }] }]).prop_cruzada[0], { nome: 'MIZUNO', pct: 100, segmentos: [{ nome: 'CALÇADO', pct: 100 }] }, 'cruzada também normaliza marca e segmento');

secao('entrada prevista automática (entrada do mês anterior + % do forecast sobre o expedido dele)');
const hist = [{ dia: '2026-08-31', expedido: 21684, backlog: 115258 }, { dia: '2026-09-01', expedido: 300000, backlog: 100000 }, { dia: '2026-09-30', expedido: 351255, backlog: 103699 }];
const eMes = E.entradaDoMes(hist, '2026-09');
eq([eMes.entrada, eMes.expedido, eMes.dias], [103699 - 115258 + 651255, 651255, 2], 'entrada = backlog fim − backlog início + expedido');
const auto = E.entradaAutomatica(hist, { mes: '2026-10', pecas_embarque: 731000 });
eq(auto.entrada_dia, Math.round((639696 / 2) * (731000 / 22) / (651255 / 2)), 'entrada/dia × (forecast por dia útil ÷ expedido por dia do mês anterior)');
eq(E.entradaDoMes([{ dia: '2026-08-31', expedido: 1, backlog: 1 }, { dia: '2026-09-15', expedido: 10, backlog: 5 }], '2026-09'), null, 'mês ainda não fechado na base: sem entrada automática');
const fcA = E.forecastPorDia([{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }], hist);
eq([fcA.entrada['2026-10-01'], fcA.entrada['2026-10-03']], [auto.entrada_dia, 0], 'entrada automática nos dias úteis, 0 no fim de semana');
const fcI = E.forecastPorDia([{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: 660000, dias_folga: [] }], hist);
eq(fcI.entrada['2026-10-01'], 30000, 'entrada informada no Admin tem prioridade sobre a automática');

secao('agenda do mês: PFA importada no mês = parte do forecast; importada antes = backlog do mês anterior');
const fAg = [{ mes: '2026-10', pecas_embarque: 731000, pecas_entrada: null, dias_folga: [] }];
const sAg = E.montarSerieEmbarque(diario, fAg, '2026-10-02', null, { total: 210983, por_situacao: {}, por_importacao: { '2026-09-25': 78933, '2026-10-02': 132050 } });
eq([sAg.agenda.anterior, sAg.agenda.importado_mes, sAg.agenda.restante, sAg.agenda.dias_restantes], [78933, 132050, 598950, 20], 'separa backlog do mês anterior e agenda já importada; falta 731.000 − 132.050 em 20 dias úteis');
eq([sAg.entrada[30], sAg.entrada[33], sAg.entrada[31]], [132050, Math.floor(598950 / 20) + 1, 0], 'entrada: hoje = importado hoje; dias úteis seguintes = o que falta ÷ dias; fim de semana 0');
eq([sAg.backlog[30], sAg.backlog[31]], [210983, 210983 - 33228], 'amanhã = hoje − saída de hoje (a entrada de hoje já está em tela)');
ok(sAg.backlog[40] < sAg.backlog[33], 'backlog flui: cai quando a entrada que falta por dia é menor que a saída prevista');

secao('perfil operacional por dia da semana');
const histP = [];
for (let k = 0; k < 70; k++) {
  const d = E.forecastPorDia ? new Date(Date.UTC(2026, 6, 1) + k * 86400000).toISOString().slice(0, 10) : null;
  const w = new Date(d + 'T12:00:00Z').getUTCDay();
  if (w === 0 || w === 6) continue;
  histP.push({ dia: d, expedido: w === 2 ? 40000 : 20000, backlog: 100000 });
}
const pf = E.perfilSemana(histP, '2026-10-02');
ok(pf && pf.saida[2] > 1.5 && pf.saida[1] < 1, 'terça (dia mais forte no histórico) pesa mais na saída');
const dP = E.distribuirPorPeso(731000, E.diasUteisDoMes('2026-10', []), pf.saida);
eq(Object.keys(dP).reduce(function (t, k) { return t + dP[k]; }, 0), 731000, 'distribuição por peso fecha EXATO no total do mês');
ok(dP['2026-10-06'] > dP['2026-10-05'], 'terça recebe mais forecast que segunda');
eq(E.perfilSemana([{ dia: '2026-09-30', expedido: 1, backlog: 1 }], '2026-10-02'), null, 'sem histórico suficiente: sem perfil (divide por igual)');

secao('histórico pelo NFs Embarcadas + Pendentes (16/10/2026)');
{
  const base = [{ dia: '2026-09-30', expedido: 20000, backlog: 90000 }, { dia: '2026-10-01', expedido: 18000, backlog: 85000 }];
  const hist = [
    { dia: '2026-10-01', expedido: 15822, backlog: 84594, entrada: 30000 },
    { dia: '2026-10-02', expedido: 11868, backlog: 203208, entrada: 1000 },
    { dia: '2026-10-03', entrada: 500 },
    { dia: '2026-10-05', expedido: 27092, backlog: 198833, entrada: 4000 },
  ];
  const m = E.mesclarHistoricoOperacao(base, hist);
  const d = function (x) { return m.filter(function (r) { return r.dia === x; })[0]; };
  eq(d('2026-09-30').expedido, 20000, 'dia só da base continua igual');
  eq([d('2026-10-01').expedido, d('2026-10-01').backlog], [15822, 84594], 'dia abastecido: NFs Embarcadas e Pendentes valem sobre a base');
  eq([d('2026-10-03').expedido, d('2026-10-04').expedido], [0, 0], 'fim de semana dentro do período das NFs = 0 expedido');
  eq(d('2026-10-03').entrada, 500, 'entrada pela data de importação');
  const sr = E.montarSerieEmbarque(m, [], '2026-10-06', null, { total: 231538, por_situacao: {} });
  const ix = function (x) { return sr.dias_iso.indexOf(x); };
  eq(sr.entrada_efetiva[ix('2026-10-02')], 1000, 'entrada efetiva do dia = importado no dia');
  eq(sr.saida_efetiva[ix('2026-10-02')], 11868, 'saída efetiva = NFs Embarcadas');
  eq(sr.backlog_efetivo[ix('2026-10-02')], 203208, 'backlog efetivo = Pendentes do dia');
  // sábado 03/10 sem Pendentes: 203.208 + 1.000 − 11.868 = 192.340; domingo: 192.340 + 500 − 0
  eq([sr.backlog_efetivo[ix('2026-10-03')], sr.backlog_efetivo[ix('2026-10-04')]], [192340, 192840], 'fim de semana sem Pendentes: backlog anterior + entrada − saída');
}

console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

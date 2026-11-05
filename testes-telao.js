/* ============================================================================
   TESTES — telão DISTR (start-inicial-calc.js e ressuprimento-calc.js)
   Rode com: node testes-telao.js — sai com código 1 se algum caso falhar.
   ============================================================================ */
const SI = require('./start-inicial-calc.js');
const RC = require('./ressuprimento-calc.js');

let falhas = 0;
function ok(cond, nome) { console.log((cond ? '  ok  ' : '  FALHOU  ') + nome); if (!cond) falhas++; }
function eq(a, b, nome) {
  const bateu = JSON.stringify(a) === JSON.stringify(b);
  if (!bateu) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));
  ok(bateu, nome);
}

/* Snapshot de exemplo: uma PFA por etapa + uma de cliente que personaliza em Leitura expedição. */
function exemplo() {
  return {
    conferencia_regra: 'pendentes_leitura',
    etapas: ['Nao disp. picking', 'Disp. p/ picking', 'Em picking', 'Gerar Nota Fiscal', 'Leitura expedicao'],
    faixas_fifo: [{ chave: '0-2', rotulo: '0–2 dias' }, { chave: '3-5', rotulo: '3–5 dias' }, { chave: '6-10', rotulo: '6–10 dias' }, { chave: '11+', rotulo: '11+ dias' }],
    ajustes_em_aberto: 2,
    aguardando_coleta: [{ pfa: '500006', data_nota: '2026-10-28' }],
    pendentes: [
      { pfa: '500001', situacao: 'Nao disp. picking', pares: 100, faixa_fifo: '0-2', segmento_macro: 'CALÇADO', cliente_nome: 'LOJA A' },
      { pfa: '500002', situacao: 'Disp. p/ picking', pares: 50, faixa_fifo: '3-5', segmento_macro: 'MEIA', cliente_nome: 'LOJA B' },
      { pfa: '500003', situacao: 'Em picking', pares: 30, faixa_fifo: '3-5', segmento_macro: 'CHINELO', cliente_nome: 'LOJA C' },
      { pfa: '500004', situacao: 'Gerar Nota Fiscal', pares: 20, faixa_fifo: '6-10', segmento_macro: 'VESTUÁRIO', cliente_nome: 'LOJA D' },
      // Leitura expedição com todos os volumes lidos -> 06 Lido na esteira (ag. embarque)
      { pfa: '500005', situacao: 'Leitura expedicao', conferencia: 'completa', pares: 40, faixa_fifo: '11+', segmento_macro: 'CALÇADO',
        cliente_nome: 'LOJA E', data_nota_pendentes: '2026-10-30' },
      // cliente que personaliza: vence o "lido na esteira" -> 04 Material em personalização; NF só no Analítico
      { pfa: '500006', situacao: 'Leitura expedicao', conferencia: 'completa', pares: 10, faixa_fifo: '11+', segmento_macro: 'BOLSA',
        cliente_nome: 'BADAN ARTIGOS ESPORTIVOS LTDA' },
    ],
  };
}

console.log('\n=== Start Inicial: etapa de personalização e lido na esteira (mesma regra do report) ===');
const p = exemplo();
SI.aplicarEtapaPersona(p, SI.listaPadraoPersona());
eq(p.pendentes.map(function (r) { return r.situacao; }),
  ['Nao disp. picking', 'Disp. p/ picking', 'Em picking', 'Gerar Nota Fiscal', 'Lido na esteira', 'Material em personalizacao'],
  'Leitura expedição completa vira Lido na esteira; cliente que personaliza vira Material em personalização');
eq(p.pendentes[5].data_nota, '2026-10-28', 'data da NF vem do Analítico quando o Pendentes não tem');
eq(p.etapas.slice(0, 7), SI.ORDEM_ETAPA_TELA, 'etapas na ordem da tela (00 a 06)');

console.log('\n=== Start Inicial: resumo do telão (sem filtros) ===');
const r = SI.resumoStartInicial(p, new Date(2026, 10, 5, 9));
eq(r.total, { pares: 250, pfas: 6 }, 'total em tela');
eq(r.pendente, { pares: 110, pfas: 4 }, 'material pendente = total − 00 Não Disp. Picking (100) − 06 Lido na esteira (40)');
eq(r.etapas.map(function (e) { return [e.etapa, e.pares]; }), [
  ['Nao disp. picking', 100], ['Disp. p/ picking', 50], ['Em picking', 30], ['Gerar Nota Fiscal', 20],
  ['Material em personalizacao', 10], ['Leitura expedicao', 0], ['Lido na esteira', 40]], 'funil com as 7 etapas, 00 e 06 inclusive (zerada aparece)');
eq(r.nfAgColeta, { pares: 50, pfas: 2 }, 'NF emitida ag. coleta = PFAs em tela com data de NF');
eq([r.maisAntiga.pfa, r.maisAntiga.dias, r.maisAntiga.pecas], ['500006', 8, 10], 'PFA mais antiga pela data da NF (28/10 -> 05/11 = 8 dias)');
eq(r.fifo.map(function (f) { return f.pares; }), [100, 80, 20, 50], 'FIFO por faixa');
eq(r.matriz.cols.map(function (c) { return c.chave; }), ['ACESSÓRIO', 'CALÇADO', 'MEIA', 'VESTUÁRIO', 'OUTROS'], 'colunas da matriz (+ Outros quando existe)');
eq(r.matriz.linhas.map(function (l) { return [l.chave, l.pares]; }), [['SEM', 200], ['2026-10-28', 10], ['2026-10-30', 40]], 'linhas: Sem NF primeiro, depois as datas da NF');
eq(r.matriz.linhas[0].vals[1].pares, 130, 'Chinelo entra em Calçados (100 + 30)');
eq(r.nfSegmento.map(function (s) { return [s.chave, s.sem, s.com]; }),
  [['ACESSÓRIO', 0, 0], ['CALÇADO', 130, 40], ['MEIA', 50, 0], ['VESTUÁRIO', 20, 0], ['OUTROS', 0, 10]], 'NF × segmento resumido: Sem NF / Com NF por segmento');
eq(r.segmentos[0],{ segmento: 'CALÇADO', pares: 140, pfas: 2 }, 'segmentos em ordem de peças');
eq(r.ajustesEmAberto, 2, 'ajustes de PFA em aberto');

console.log('\n=== Ressuprimento: Alocação / Retirada / Soma e Top 5 ===');
const aloc = [
  { dia: '2026-11-03', segmento: 'CALÇADO', turno: 'T01', pecas: 100, movimentos: 10 },
  { dia: '2026-11-03', segmento: 'MEIA', turno: 'T02_T03', pecas: 50, movimentos: 5 },
  { dia: '2026-11-04', segmento: 'CALÇADO', turno: 'T03', pecas: 70, movimentos: 7 },
];
const ret = [{ dia: '2026-11-04', segmento: 'CALÇADO', turno: 'T03', pecas: 30, movimentos: 3 }];
const opsA = [{ dia: '2026-11-04', turno: 'T03', login: 'EX1', nome: 'ANA SILVA', pecas: 70, movimentos: 7 }];
const opsR = [{ dia: '2026-11-04', turno: 'T03', login: 'EX1', nome: 'ANA SILVA', pecas: 30, movimentos: 3 },
  { dia: '2026-11-04', turno: 'T01', login: 'EX2', nome: 'BIA', pecas: 5, movimentos: 1 }];
const diasA = RC.diasDoHistorico(RC.combinarEtapaRessup('alocacao', aloc, ret, opsA, opsR).historico);
eq(diasA.map(function (d) { return [d.dia, d.pecas]; }), [['2026-11-03', 150], ['2026-11-04', 70]], 'alocação por dia');
eq(diasA[0].turnos.T02.pecas, 50, 'turno antigo T02_T03 vira T02 (igual ao report)');
const diasG = RC.diasDoHistorico(RC.combinarEtapaRessup('geral', aloc, ret, opsA, opsR).historico);
eq(diasG[1].pecas, 100, 'soma = alocação 70 + retirada 30');
eq(RC.topOperadoresDia('geral', opsA, opsR, '2026-11-04', 5).map(function (o) { return [o.login, o.pecas]; }), [['EX1', 100], ['EX2', 5]], 'Top 5 na soma junta as peças do mesmo login');
eq(RC.topOperadoresDia('geral', opsA, opsR, '2026-11-04', 5, 'T01').map(function (o) { return [o.login, o.pecas]; }), [['EX2', 5]], 'Top 5 de um turno só (T01)');
eq(RC.topOperadoresDia('alocacao', [{ dia: '2026-11-04', turno: 'T01', login: 'EX9' }], [], '2026-11-04', 5), [], 'linha sem peças (antes da migração) não entra no Top 5');

console.log(falhas ? '\n' + falhas + ' TESTE(S) FALHARAM' : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);

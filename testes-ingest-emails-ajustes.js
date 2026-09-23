/* ============================================================================
   TESTES — ingest-emails-ajustes.js (rode com: node testes-ingest-emails-ajustes.js)
   Usa o texto do corpo como o .msg entrega (uma célula por linha), copiado
   dos e-mails reais de 16–21/09/2026.
   ============================================================================ */
const E = require('./ingest-emails-ajustes.js');
let falhas = 0;
function ok(c, n) { console.log((c ? '  ok  ' : '  FALHOU  ') + n); if (!c) falhas++; }
function eq(a, b, n) { const x = JSON.stringify(a) === JSON.stringify(b); if (!x) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); ok(x, n); }
const d = new Date('2026-09-21T19:34:08Z');

console.log('\n=== sem NF — FALTA TOTAL é do item; só cancela quando falta o pedido inteiro ===');
const semNf = ['Boa tarde!', 'PFA', 'CLIENTE', 'ENC', 'QUANT. PARES ', 'VOL', 'FAM', 'ART', 'DES', 'COR', 'TAM', 'TOTAL DE FALTAS', 'TOTAL DE FALTAS', 'SITUAÇÃO', 'COD. REP',
  '246191', 'CL-80971-80982VULCABRAS SP COMERCIO', '978221', '225', '2', '82', '1326799', 'SPORTSTYLE LEFT CHE', 'SERJBL', 'GG', '3', '18', 'FALTA TOTAL', '711',
  '246191', 'CL-80971-80982VULCABRAS SP COMERCIO', '978221', '225', '3', '82', '1326799', 'SPORTSTYLE LEFT CHE', 'SERJBL', 'GG', '15', '\tFALTA TOTAL', '711',
  '246397', 'CL-96588-MORIA CONFECCOES', '976833', '1', '3', '103', 'MIMSR4656', 'T-SHIRT', 'CLBRBL', '5-GG', '1', '1', 'FALTA TOTAL', '818',
  'PFA liberada para cancelamento. '].join('\n');
const l1 = E.interpretarEmailAjuste({ assunto: 'PFA COM DIVERGÊNCIA ', remetente: 'Erika', data: d, corpo: semNf });
eq(l1.length, 2, 'duas linhas (246191 e 246397)');
eq(l1[0].qtde_faltante, 18, 'mesmo SKU em 2 volumes: soma 3 + 15 = 18 (uma linha por SKU na planilha)');
eq(l1[0].tipo, 'AJUSTE', '246191: 225 pares e faltam 18 → AJUSTE, não cancelamento');
eq(l1[1].tipo, 'CANCELAMENTO', '246397: faltou o pedido inteiro (1 de 1) → CANCELAMENTO');

eq(E.linhaPlanilhaAjuste(l1[0])[5], '082', 'família completada com zero à esquerda pra planilha');

console.log('\n=== com NF — instrução do comercial decide o tipo; tabela de instrução não vira registro ===');
const comNf = ['Olá', 'Ok, seguir com devolução também',
  'Simoni, a Nota 215880 falta total também, poderia verificar?',
  'NF', 'PFA', 'CLIENTE', 'SITUAÇÃO', 'COD. REP', 'INSTRUÇÃO',
  '216258', '241720', 'CL 84280 84284 EBAZAR', 'FALTA PARCIAL', '693', 'EMBARCAR',
  '214827', '236442', 'CL 92884 JC ABDON', 'FALTA TOTAL', '821', 'DEVOLVER',
  '215880', '238369', 'CL-80971 VULCABRAS', 'FALTA TOTAL', '711', 'EMBARCAR',
  'Simoni, posso enviar a NF 216258 com divergência?',
  'NF', 'PFA', 'CLIENTE', 'ENC', 'QUANT. PARES ', 'VOL', 'FAM', 'ART', 'DESC ', 'COR', 'TAM', 'QUANT. FALTANTE', 'TOTAL FALTAS(PFA)', 'SITUAÇÃO', 'COD. REP',
  '216258', '241720', 'CL 84280 84284 EBAZAR', '977237', '1681', '80', '83', '1364181', 'MOCHIL UA', 'BKBKMB', 'U', '6', '21', 'FALTA PARCIAL', '693',
  '214827', '236442', 'CL 92884 JC ABDON', '967708', '1', '1', '102', '102364003', 'WAVE', 'GRALIL', '37', '1', '1', 'FALTA TOTAL', '821',
  '215880', '238369', 'CL-80971 VULCABRAS', '972976', '204', '3', '83', '1384463', 'MALA UA', 'BLBKWT', 'U', '12', '12', 'FALTA TOTAL', '711',
  '215887', '240365', 'CL-58801 PONTOAKAN', '965824', '12', '1', '83', '1383440', 'BONE', 'WHTSTE', 'U', '1', '1', 'FALTA TOTAL', '630'].join('\n');
const l2 = E.interpretarEmailAjuste({ assunto: 'ENC: NFs COM DIVERGÊNCIA', remetente: 'Erika', data: d, corpo: comNf });
eq(l2.map(function (l) { return l.nf; }), ['216258', '214827', '215880', '215887'], 'só os 4 registros de divergência (a tabela de instrução não entra)');
eq(l2.map(function (l) { return l.tipo; }), ['BO_POS_NF', 'AD_DEVOLUCAO', 'BO_POS_NF', null], 'EMBARCAR → envio faltante c/ NF; DEVOLVER → AD; sem instrução → null');
ok(/conferir/.test(l2[2].status), '215880 citada em texto DEPOIS da instrução → pede conferência');
ok(!/conferir/.test(l2[0].status), '216258 citada só ANTES da instrução → sem alerta');

console.log('\n=== validação contra o snapshot + consolidação por e-mail mais recente ===');
const v = E.validarLinhasEmail(l1.concat(l2), {
  pendentes: [{ pfa: '246191', pares: 225 }, { pfa: '246397', pares: 2 }],
  aguardando_coleta: [{ pfa: '236442', nota: '214827', qtde: 1 }, { pfa: '241720', nota: '999999', qtde: 1681 }],
  ajustes: [{ pfa_antiga: '246191', artigo: '1326799', cor_tam: 'SERJBL GG' }],
});
ok(v[0].ja_lancado, 'linha já lançada antes é marcada');
ok(v[1].alertas.some(function (a) { return /pares da PFA em Pendentes/.test(a); }), 'CANCELAMENTO cuja falta (1) ≠ pares em Pendentes (2) gera alerta');
ok(v[2].alertas.some(function (a) { return /NF do e-mail/.test(a); }), 'NF divergente do sistema gera alerta');
eq(v[3].alertas, [], 'NF que bate e FALTA TOTAL = qtde da NF: sem alerta');
const antigo = Object.assign({}, l2[1], { tipo: null, data_hora_email: '2026-09-17T14:52:00Z' });
const novo = Object.assign({}, l2[1], { data_hora_email: '2026-09-17T18:00:00Z' });
eq(E.consolidarLinhasEmails([[novo], [antigo]])[0].tipo, 'AD_DEVOLUCAO', 'mesma linha em 2 e-mails: vale o mais recente, independente da ordem dos arquivos');

console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

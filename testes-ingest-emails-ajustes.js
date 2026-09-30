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

/* Resposta curta da gerente: só NF | INSTRUÇÃO, NF repetida sem instrução
   quando tem mais de um item (e-mail real de 28/09/2026). */
const instCurta = E.extrairInstrucoes(['Bom dia a todos!', 'Segue instrução.', 'NF', 'INSTRUÇÃO',
  '221115', 'EMBARCAR', '222472', 'EMBARCAR', '222472', '221127', 'DEVOLVER', '221127',
  'De: Erika', 'NF', 'INSTRUÇÃO', '221115', 'DEVOLVER']);
eq(instCurta.get('221115'), 'EMBARCAR', 'tabela curta NF|INSTRUÇÃO é lida (e vale a mensagem mais nova, em cima)');
eq(instCurta.get('222472'), 'EMBARCAR', 'NF repetida sem instrução continua com a da NF');
eq(instCurta.get('221127'), 'DEVOLVER', 'DEVOLVER na tabela curta');
/* PFA que já saiu do Pendentes (embarcada): NF vem do relatório de NFs
   Embarcadas ou, se não estiver nele, do histórico de Pendentes. */
const linhaEmb = Object.assign({}, l2[0], { pfa: '247576', nf: '222472', qtde_faltante: 1, situacao: 'FALTA PARCIAL' });
const linhaHist = Object.assign({}, l2[0], { pfa: '248000', nf: '222999', qtde_faltante: 1, situacao: 'FALTA PARCIAL' });
const linhaNada = Object.assign({}, l2[0], { pfa: '248001', nf: '223000', qtde_faltante: 1, situacao: 'FALTA PARCIAL' });
const vEmb = E.validarLinhasEmail([linhaEmb, linhaHist, linhaNada],
  { pendentes: [], embarcadas_nf: { '247576': ['222472', '2026-09-25', 868] } },
  [{ pfa: '248000', nota_fiscal: '1-1-222999', pares: 50 }]);
eq(vEmb[0].alertas, [], 'NF do relatório de NFs Embarcadas: sem alerta de "sem NF"');
eq(vEmb[1].alertas, [], 'NF do histórico de Pendentes: sem alerta');
ok(vEmb[1].nf_do_historico, '… marcada como vinda do histórico');
ok(/sem NF no sistema/.test(vEmb[2].alertas.join()), 'sem NF em lugar nenhum: continua alertando');
const antigo = Object.assign({}, l2[1], { tipo: null, data_hora_email: '2026-09-17T14:52:00Z' });
const novo = Object.assign({}, l2[1], { data_hora_email: '2026-09-17T18:00:00Z' });
eq(E.consolidarLinhasEmails([[novo], [antigo]])[0].tipo, 'AD_DEVOLUCAO', 'mesma linha em 2 e-mails: vale o mais recente, independente da ordem dos arquivos');
const respondida = Object.assign({}, l2[1], { tipo: 'BO_POS_NF', data_hora_email: '2026-09-28T12:29:00Z' });
const repetidaDepois = Object.assign({}, l2[1], { tipo: null, data_hora_email: '2026-09-28T13:00:00Z' });
eq(E.consolidarLinhasEmails([[respondida], [repetidaDepois]])[0].tipo, 'BO_POS_NF', 'e-mail posterior sem instrução não apaga a instrução já dada');


console.log('\n=== resposta do comercial "Encomenda ajustada" fecha o ajuste (243452, 24/09/2026) ===');
const respAjuste = ['Oie,', 'Segue PFA gerada.', 'Obrigada!', 'De: Carla', 'Enviada em: quinta-feira', 'Assunto: RES: PFA COM DIVERGÊNCIA', 'Boa tarde!', 'Encomenda ajustada',
  'De: Erika', 'Assunto: PFA COM DIVERGÊNCIA', 'Gentileza, ajustar pedido abaixo :',
  'PFA', 'CLIENTE', 'ENC', 'QUANT. PARES ', 'VOL', 'FAM', 'ART', 'DES', 'COR', 'TAM', 'TOTAL DE FALTAS', 'TOTAL DE FALTAS', 'SITUAÇÃO', 'COD. REP',
  '243452', 'CL-41431 VULCABRAS BA', '977576', '102', '1', '60', 'OBWWT23307', 'BERMUDA', 'PRETO', 'M', '2', '2', 'FALTA TOTAL', '99997',
  'PFA liberada para cancelamento. '].join('\n');
const lr = E.interpretarEmailAjuste({ assunto: 'RES: PFA COM DIVERGÊNCIA', remetente: 'Fernanda', data: d, corpo: respAjuste });
eq(lr.length, 1, 'uma linha');
ok(lr[0].ajustado_pelo_comercial, 'texto da mensagem mais nova ("PFA gerada") marca como respondido');
const pedidoSemResposta = respAjuste.replace('Segue PFA gerada.', 'Bom dia').replace('Encomenda ajustada', 'Estamos vendo');
ok(!E.interpretarEmailAjuste({ assunto: 'PFA COM DIVERGÊNCIA', remetente: 'Erika', data: d, corpo: pedidoSemResposta })[0].ajustado_pelo_comercial, 'sem resposta do comercial: não marca');
const vr = E.validarLinhasEmail(lr, { pendentes: [], ajustes: [{ pfa_antiga: '243452', artigo: 'OBWWT23307', cor_tam: 'PRETO M' }] });
eq(vr[0].alertas, [], 'AJUSTE cuja PFA antiga já saiu do Pendentes não gera alerta');
ok(vr[0].ja_lancado, '… e continua marcado como já lançado');
const vr2 = E.validarLinhasEmail(E.interpretarEmailAjuste({ assunto: 'PFA COM DIVERGÊNCIA', remetente: 'Erika', data: d, corpo: pedidoSemResposta }), { pendentes: [] });
ok(vr2[0].alertas.some(function (a) { return /não está no Pendentes/.test(a); }), 'ajuste novo (não lançado) fora do Pendentes continua alertando');


console.log('\n=== instrução em TEXTO LIVRE: "Esta nota devolver, 222395. As demais embarcar." (30/09/2026) ===');
const livre = E.extrairInstrucoes(['Bom dia', 'Esta nota devolver, 222395.  As demais embarcar.', 'De: Erika', 'Assunto: NFs com divergência',
  'Simoni, posso enviar essas NFs com divergência ?', 'NF', 'PFA']);
eq(livre.get('222395'), 'DEVOLVER', 'NF citada com "devolver" volta pro estoque');
eq(livre.get('*'), 'EMBARCAR', '"as demais embarcar" vira a instrução padrão das outras NFs');
const livre2 = E.extrairInstrucoes(['222395 devolver e 222307 embarcar.', 'De: E']);
eq([livre2.get('222395'), livre2.get('222307')], ['DEVOLVER', 'EMBARCAR'], 'duas NFs na mesma frase: cada uma com o verbo mais próximo');
eq(E.extrairInstrucoes(['Simoni, posso enviar a NF 216258 com divergência?', 'De: E']).size, 0, 'pergunta da assistente não é instrução');


console.log('\n=== linha já lançada com OUTRO tipo é correção, não duplicada (30/09/2026) ===');
const linhaCorr = Object.assign({}, l2[0], { tipo: 'BO_POS_NF', pfa: '248160', artigo: 'MNFRA51921', cor: 'CARCPN', tam: '33/38' });
const vc = E.validarLinhasEmail([linhaCorr], { pendentes: [], ajustes: [{ pfa_antiga: '248160', artigo: 'MNFRA51921', cor_tam: 'CARCPN 33/38', tipo: 'AD_DEVOLUCAO' }] });
ok(!vc[0].ja_lancado, 'lançada como AD e agora é envio com falta: não é duplicada');
eq(vc[0].corrige_tipo, 'AD_DEVOLUCAO', '… e informa o tipo gravado antes');
const vd = E.validarLinhasEmail([linhaCorr], { pendentes: [], ajustes: [{ pfa_antiga: '248160', artigo: 'MNFRA51921', cor_tam: 'CARCPN 33/38', tipo: 'BO_POS_NF' }] });
ok(vd[0].ja_lancado && !vd[0].corrige_tipo, 'mesmo tipo já gravado continua "já lançado"');

console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

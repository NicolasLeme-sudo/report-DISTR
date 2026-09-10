/* ============================================================================
   TESTES DO INGEST-PFAS — rode com: node testes-ingest-pfas.js
   ============================================================================
   Mesma filosofia dos outros: sem framework, sai 1 se algo falhar.

   O risco aqui não é o parse quebrar (ele quebra alto) — é somar populações
   diferentes e produzir um número que PARECE certo. Foi o que aconteceu na
   primeira versão do plano (176.727 pç somando volume conferido sem nota com
   volume já faturado). Por isso os testes abaixo insistem em separar:
     - aguardando_nf   (conferido, NOTA=0, sem data → sem FIFO)
     - aguardando_coleta (faturado, com DATA_NOTA → FIFO real)
   e em provar que PFA já embarcada sai da conta antes de qualquer soma.
   ============================================================================ */
const fs = require('fs');
const path = require('path');

global.window = global;
eval(fs.readFileSync(path.join(__dirname, 'ingest.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'ingest-ressuprimento.js'), 'utf8')); // segmentoMacro
eval(fs.readFileSync(path.join(__dirname, 'ingest-pfas.js'), 'utf8'));

let falhas = 0;
function secao(nome) { console.log('\n=== ' + nome + ' ==='); }
function ok(cond, msg) { console.log((cond ? '  ok  ' : '  XX  ') + msg); if (!cond) falhas++; }
function eq(obtido, esperado, msg) {
  const igual = typeof esperado === 'number' && typeof obtido === 'number'
    ? Math.abs(obtido - esperado) < 1e-9 : obtido === esperado;
  ok(igual, msg + (igual ? '' : '  (esperado ' + esperado + ', obtido ' + obtido + ')'));
}

const HOJE = '2026-09-08'; // referência fixa: teste não pode mudar de resultado amanhã

/* -------------------------------------------------------------------------- */
secao('data sem ano — "28/12" em 02/01 é do ano passado, não do corrente');
eq(dataDDMMComAno('28/08', '2026-09-08'), '2026-08-28', 'mês passado → ano corrente');
eq(dataDDMMComAno('08/09', '2026-09-08'), '2026-09-08', 'hoje → ano corrente');
eq(dataDDMMComAno('28/12', '2027-01-02'), '2026-12-28', 'mês no futuro → ano anterior (virada de ano)');
eq(dataDDMMComAno('09/09', '2026-09-08'), '2025-09-09', 'amanhã não existe no passado → ano anterior');
eq(dataDDMMComAno('', HOJE), null, 'campo vazio vira null, não data inventada');

secao('diasEntre — UTC, sem escorregar por fuso');
eq(diasEntre('2026-08-21', '2026-09-08'), 18, '21/08 → 08/09 = 18 dias');
eq(diasEntre('2026-02-25', '2026-09-08'), 195, '25/02 → 08/09 = 195 dias (o backlog real)');

/* -------------------------------------------------------------------------- */
secao('parsearPfasPendentes — PARES são itens, QT.VOL são volumes');
const CAB_PEND = 'ESTAB|PRE-FATURA|DATA|CLIENTE|DESCRICAO|FAM|ENCOMENDA|TRS 1PERC|DESCRICAO|TRS 2PERC|DESCRICAO|EXP|QT.VOL.|SITUACAO|DATA|NOTA FISCAL|DT. NF|VL.PND|VL.INC|VL.CLT|VL.EXP|PARES|BOX|PERS|DT.AGE.ENTREGA INICIO|DT.AGE.ENTREGA FIM|HORA AGE. INICIO|HORA AGE. FIM|DT.LIB.NF INICIO|DT.LIB.NF FIM|CLUSTER|VOLUMES PENDENTES DE COLETA';
function linhaPend(pfa, data, fam, qtVol, situacao, pares, cluster) {
  return ['DISTR', pfa, data, 'CL-1-1', 'CLIENTE TESTE LTDA', fam, 'EBM - 1 (1)', '00585', 'TRANSP X', '', '',
    'ROD', qtVol, situacao, data, '1-1-1', '01/09/26', '0', '0', '0', '1', pares, '5', 'N',
    '', '', '', '', '', '', cluster || '25', '1'].join('|');
}
const pend = parsearPfasPendentes([CAB_PEND,
  linhaPend('235651', '21/08', '102', '5', 'Leitura expedicao', '118'),
  linhaPend('242263', '01/09', '105', '3', 'Nao disp. picking', '144'),
].join('\n'), HOJE);
eq(pend.registros.length, 2, 'duas PFAs lidas');
eq(pend.registros[0].pares, 118, 'PARES vem da coluna 22 (itens)');
eq(pend.registros[0].qt_volumes, 5, 'QT.VOL vem da coluna 13 (volumes) — não é a mesma coisa que pares');
eq(pend.registros[0].situacao, 'Leitura expedicao', 'situação lida como o sistema escreve');
eq(pend.registros[0].data_importacao, '2026-08-21', 'data de importação ganha o ano certo');
eq(pend.registros[0].dias_abertos, 18, 'idade em dias calculada contra a referência');
eq(pend.registros[1].familia_codigo, '105', 'família preservada com zero à esquerda');

/* -------------------------------------------------------------------------- */
secao('parsearPfasPendentes — PFA repetida no arquivo não soma em dobro (abastecimento errado)');
const pendDup = parsearPfasPendentes([CAB_PEND,
  linhaPend('235651', '21/08', '102', '5', 'Leitura expedicao', '118'),
  linhaPend('242263', '01/09', '105', '3', 'Nao disp. picking', '144'),
  linhaPend('235651', '21/08', '102', '5', 'Em picking', '118'), // mesma PFA, etapa avançou
].join('\n'), HOJE);
eq(pendDup.registros.length, 2, 'PFA duplicada vira 1 registro só, não 2 (soma não dobra)');
eq(pendDup.pfas_duplicadas, 1, 'contador de duplicidade aponta a 1 ocorrência extra');
const linha235651 = pendDup.registros.find(function (r) { return r.pfa === '235651'; });
eq(linha235651.situacao, 'Em picking', 'fica valendo a ÚLTIMA ocorrência da PFA no arquivo, não a primeira');
const pendSemDup = parsearPfasPendentes([CAB_PEND,
  linhaPend('235651', '21/08', '102', '5', 'Leitura expedicao', '118'),
].join('\n'), HOJE);
eq(pendSemDup.pfas_duplicadas, 0, 'arquivo sem repetição não acusa duplicidade nenhuma');

/* -------------------------------------------------------------------------- */
secao('parsearPfasAnalitico — NOTA=0 é conferido SEM nota, não é nota número zero');
const CAB_ANA = 'EMPRESA;ESTABELECIMENTO;TIPCLI;CODCLI;SCDCLI;RAZAO_SOCIAL;PFA;SERIE;SUBSER;NOTA;DATA_NOTA;OPERACAO;SEQ_VOLUME;VOLUME;FAMILIA;DESC_FAMILIA;ARTIGO;DESC_ARTIGO;COR;TAMANHO;QTDE;CODBAR';
function linhaAna(pfa, nota, dataNota, volume, fam, artigo, qtde) {
  return ['VULSP', 'DISTR', 'CL', '30807', '35555', 'CLIENTE TESTE', pfa, '1', '1', nota, dataNota, '', '1',
    volume, fam, 'DESC FAM', artigo, 'DESC ART', 'PRETO', 'M', qtde, '789'].join(';');
}
const ana = parsearPfasAnalitico([CAB_ANA,
  linhaAna('196830', '175537', '25/02/2026', 'VOL1', '082', 'A1', '3,0'),
  linhaAna('242018', '0', '', 'VOL9', '060', 'A2', '2,0'),
].join('\n'));
eq(ana.registros.length, 2, 'duas linhas lidas');
eq(ana.registros[0].nota, '175537', 'nota real preservada');
eq(ana.registros[0].data_nota, '2026-02-25', 'DATA_NOTA convertida pra ISO');
eq(ana.registros[0].qtde, 3, 'QTDE com vírgula decimal ("3,0") vira 3');
eq(ana.registros[1].nota, null, 'NOTA=0 vira null — é ausência de nota, não nota zero');
eq(ana.registros[1].data_nota, null, 'sem nota, sem data pra medir FIFO');

/* -------------------------------------------------------------------------- */
secao('parsearPfasEmbarcadas');
const CAB_EMB = 'EMP;ESTABE;DATNOT;NUMPFA;CODSER;SCDSER;NUMNOT;VALTOT;QTDTOT;PWD;DATMOD';
function linhaEmb(pfa, data, nota, qtd, pwd) {
  return ['VULSP', 'DISTR', data, pfa, '1', '1', nota, '69358,14', qtd, pwd || 'CROSSDOC', data].join(';');
}
const emb = parsearPfasEmbarcadas([CAB_EMB, linhaEmb('243305', '03/09/2026', '216604', '774,0')].join('\n'));
eq(emb.registros.length, 1, 'uma nota embarcada lida');
eq(emb.registros[0].pfa, '243305', 'PFA da nota embarcada');
eq(emb.registros[0].qtd_total, 774, 'QTDTOT com vírgula decimal');
eq(emb.registros[0].operacao, 'CROSSDOC', 'PWD guardado como veio, sem interpretar');

/* -------------------------------------------------------------------------- */
secao('construirSnapshotPfas — separação das populações e exclusão do embarcado');
const mapaFamilias = new Map([
  ['102', { marca: 'MIZUNO', categoria: 'TÊNIS MIZUNO', segmento: 'TÊNIS MIZUNO' }],
  ['105', { marca: 'MIZUNO', categoria: 'MEIAS MIZUNO', segmento: 'TÊXTIL/ACESSÓRIOS MIZUNO' }],
  ['082', { marca: 'UNDER ARMOUR', categoria: 'VESTUÁRIO UNDER ARMOUR', segmento: 'TÊXTIL/ACESSÓRIOS UNDER ARMOUR' }],
  ['060', { marca: 'OLYMPIKUS', categoria: 'VESTUÁRIO OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
]);

const pendCompleto = parsearPfasPendentes([CAB_PEND,
  linhaPend('235651', '21/08', '102', '1', 'Leitura expedicao', '6'),    // 1 volume, 1 conferido -> completa
  linhaPend('236153', '28/08', '105', '2', 'Leitura expedicao', '72'),   // 2 volumes, 1 conferido -> parcial
  linhaPend('237746', '21/08', '082', '5', 'Leitura expedicao', '118'),  // nada conferido -> nao_iniciada
  linhaPend('242263', '01/09', '105', '3', 'Nao disp. picking', '144'),  // nada conferido
  linhaPend('243305', '05/09', '060', '2', 'Em picking', '500'),         // JÁ EMBARCADA: sai de tudo
].join('\n'), HOJE);

const anaCompleto = parsearPfasAnalitico([CAB_ANA,
  // 235651: 1 volume conferido, já faturado (nota antiga) -> aguardando_coleta
  linhaAna('235651', '175537', '25/02/2026', 'V-A', '102', 'A1', '6,0'),
  // 236153: 1 de 2 volumes, ainda sem nota -> aguardando_nf
  linhaAna('236153', '0', '', 'V-B', '105', 'A2', '40,0'),
  linhaAna('236153', '0', '', 'V-B', '105', 'A3', '32,0'), // mesmo volume, 2 SKUs: conta 1 volume só
  // 243305: conferida, mas a PFA já embarcou -> não pode aparecer em lugar nenhum
  linhaAna('243305', '216604', '03/09/2026', 'V-C', '060', 'A4', '500,0'),
].join('\n'));

const embCompleto = parsearPfasEmbarcadas([CAB_EMB, linhaEmb('243305', '03/09/2026', '216604', '500,0')].join('\n'));

const snap = construirSnapshotPfas(pendCompleto, anaCompleto, embCompleto, mapaFamilias, {
  arquivo_pendentes: 'p.txt', arquivo_analitico: 'a.csv', arquivo_embarcadas: 'e.csv', referencia: HOJE,
});

eq(snap.pendentes.length, 4, 'a PFA já embarcada (243305) sai do pendente');
eq(snap.stats.excluidas_por_embarque.pfas, 1, 'e o que saiu vira número visível, não sumiço silencioso');
eq(snap.stats.excluidas_por_embarque.pares, 500, 'com os pares que ela levava junto');
ok(snap.pendentes.every(function (r) { return r.pfa !== '243305'; }), '243305 não aparece em nenhuma linha de pendente');
ok(snap.aguardando_coleta.every(function (r) { return r.pfa !== '243305'; }), 'nem no aguardando coleta');

eq(snap.stats.pendentes.pares, 6 + 72 + 118 + 144, 'total de pares soma só o que continua pendente');
eq(snap.stats.pendentes.mais_antiga_dias, 18, 'PFA mais antiga = 21/08 = 18 dias');

secao('as duas populações do Analítico NUNCA se somam');
eq(snap.stats.aguardando_nf.qtde, 72, 'aguardando NF = 40+32 do volume sem nota');
eq(snap.stats.aguardando_nf.pfas, 1, 'uma PFA nessa situação');
eq(snap.stats.aguardando_coleta.qtde, 6, 'aguardando coleta = só o que tem nota emitida');
eq(snap.stats.aguardando_coleta.pfas, 1, 'uma PFA faturada esperando coleta');
eq(snap.stats.aguardando_coleta.nota_mais_antiga_dias, 195, 'FIFO da coleta usa DATA_NOTA (25/02 = 195 dias)');
eq(snap.stats.aguardando_nf.volumes, 1, 'volume distinto, não linha: V-B com 2 SKUs conta 1');

secao('conferência — volume DISTINTO lido × total de volumes da PFA');
function conf(pfa) { return snap.pendentes.filter(function (r) { return r.pfa === pfa; })[0]; }
eq(conf('235651').conferencia, 'completa', '235651: 1 de 1 volume lido → completa');
eq(conf('235651').conferencia_lidos + '/' + conf('235651').conferencia_total, '1/1', 'razão exibida na tela');
// 236153 entrou na etapa em 28/08 (11 dias parada) — parcial que passa de 3
// dias vira caso de rastreio, não fluxo normal.
eq(conf('236153').conferencia, 'parcial_rastreio',
   '236153: 1 de 2 volumes E parada há 11 dias → parcial em rastreio');
eq(conf('236153').conferencia_lidos + '/' + conf('236153').conferencia_total, '1/2', 'razão 1/2');
eq(conf('237746').conferencia, 'nao_iniciada', '237746: nenhum volume lido → não iniciada');
eq(conf('237746').conferencia_lidos + '/' + conf('237746').conferencia_total, '0/5', 'razão 0/5');

secao('enriquecimento por família (mesmo gabarito do resto do report)');
eq(conf('235651').marca, 'MIZUNO', 'família 102 → MIZUNO');
eq(conf('235651').segmento_macro, 'CALÇADO', 'família 102 → CALÇADO');
eq(conf('236153').segmento_macro, 'MEIA', 'família 105 → MEIA');
eq(conf('237746').segmento_macro, 'VESTUÁRIO', 'família 082 → VESTUÁRIO');

secao('faixas de FIFO');
eq(conf('235651').faixa_fifo, '11+', '21/08 → 08/09 = 18 dias, faixa 11+');
eq(conf('236153').faixa_fifo, '11+', '28/08 → 08/09 = 11 dias — 11 já é 11+, a faixa 6–10 fecha no 10');
eq(conf('242263').faixa_fifo, '6-10', '01/09 → 08/09 = 7 dias, faixa 6–10');

secao('etapa desconhecida não some da tela');
const pendEtapaNova = parsearPfasPendentes([CAB_PEND,
  linhaPend('999999', '05/09', '102', '1', 'Etapa Que Nao Existia', '10'),
].join('\n'), HOJE);
const snapEtapa = construirSnapshotPfas(pendEtapaNova, { registros: [] }, { registros: [] }, mapaFamilias, { referencia: HOJE });
ok(snapEtapa.etapas.indexOf('Etapa Que Nao Existia') !== -1,
   'situação fora do gabarito entra na lista de etapas em vez de ser engolida');

secao('sem arquivo de embarcadas o snapshot ainda sai (só não filtra nada)');
const snapSemEmb = construirSnapshotPfas(pendCompleto, anaCompleto, { registros: [] }, mapaFamilias, { referencia: HOJE });
eq(snapSemEmb.pendentes.length, 5, 'sem Embarcadas, a PFA que já saiu continua contando (por isso o aviso na tela)');
eq(snapSemEmb.stats.excluidas_por_embarque.pfas, 0, 'nada excluído');

/* -------------------------------------------------------------------------- */
secao('parcial recente ainda é fluxo normal — só vira rastreio a partir de 3 dias');
// Mesma PFA parcial (1 de 2 volumes), mas entrou na etapa HOJE.
const pendParcialNova = parsearPfasPendentes([CAB_PEND,
  ['DISTR', '250000', '08/09', 'CL-1-1', 'CLIENTE', '105', 'EBM', '00585', 'T', '', '', 'ROD', '2',
   'Em picking', '08/09', '', '', '0', '0', '0', '0', '10', '5', 'N', '', '', '', '', '', '', '25', '1'].join('|'),
].join('\n'), HOJE);
const anaParcialNova = parsearPfasAnalitico([CAB_ANA,
  linhaAna('250000', '0', '', 'V-Z', '105', 'A9', '5,0'),
].join('\n'));
const snapParcial = construirSnapshotPfas(pendParcialNova, anaParcialNova, { registros: [] }, mapaFamilias, { referencia: HOJE });
eq(snapParcial.pendentes[0].dias_na_etapa, 0, 'entrou na etapa hoje → 0 dias parada');
eq(snapParcial.pendentes[0].conferencia, 'parcial',
   'parcial de hoje continua "parcial" — a PFA ainda está andando, não é alarme');

secao('confirmado = está na lista VIVA de Pendentes (não mais a janela de Embarcadas)');
// 300001 continua em Pendentes mesmo com nota de 6+ meses (25/02) — ainda em
// processo, prova direta de que está em tela. 300002 tem nota BEM mais
// recente (01/09, dentro da janela do arquivo de Embarcadas) mas já SAIU de
// Pendentes — é exatamente o caso real de 09/09/2026: um arquivo de janela
// larga "confirmava" como em tela justamente quem a operação já tinha dito
// que não estava mais lá. A janela do arquivo NÃO pode mais decidir isso.
const pendConfirma = parsearPfasPendentes([CAB_PEND,
  linhaPend('300001', '01/09', '102', '1', 'Leitura expedicao', '10'),
].join('\n'), HOJE);
const anaConfirma = parsearPfasAnalitico([CAB_ANA,
  linhaAna('300001', '900001', '25/02/2026', 'V-1', '102', 'A1', '10,0'),
  linhaAna('300002', '900002', '01/09/2026', 'V-2', '102', 'A2', '20,0'),
].join('\n'));
// Janela larga (17/08 → 08/09) cobre a nota de 300002 — antes isso bastava
// pra "confirmar"; agora não basta, porque 300002 não está mais em Pendentes.
const embConfirma = parsearPfasEmbarcadas([CAB_EMB,
  linhaEmb('999001', '17/08/2026', '800001', '1,0'),
  linhaEmb('999002', '08/09/2026', '800002', '1,0'),
].join('\n'));
const snapConfirma = construirSnapshotPfas(pendConfirma, anaConfirma, embConfirma, mapaFamilias, { referencia: HOJE });
eq(snapConfirma.stats.aguardando_coleta.confirmado.qtde, 10,
   '300001 ainda está em Pendentes → confirmado mesmo com nota de 6+ meses');
eq(snapConfirma.stats.aguardando_coleta.nao_confirmado.qtde, 20,
   '300002 não está mais em Pendentes → não confirmado, mesmo com nota dentro da janela de Embarcadas');
eq(snapConfirma.stats.aguardando_coleta.qtde, 30, 'o total continua sendo a soma dos dois — nada some');
eq(snapConfirma.stats.janela_embarcadas.de, '2026-08-17', 'janela do arquivo ainda fica no payload, como contexto');
eq(snapConfirma.stats.janela_embarcadas.ate, '2026-09-08', 'contexto: só não decide mais o confirmado');

secao('operação do embarque (PWD) é contada, não interpretada');
const snapOp = construirSnapshotPfas(pendConfirma, anaConfirma, parsearPfasEmbarcadas([CAB_EMB,
  linhaEmb('999001', '20/08/2026', '800001', '1,0', 'CROSSDOC'),
  linhaEmb('999002', '21/08/2026', '800002', '1,0', 'CROSSDOC'),
  linhaEmb('999003', '22/08/2026', '800003', '1,0', 'EX000704'),
].join('\n')), mapaFamilias, { referencia: HOJE });
eq(snapOp.stats.embarcadas_por_operacao[0].operacao, 'CROSSDOC', 'operação mais frequente vem primeiro');
eq(snapOp.stats.embarcadas_por_operacao[0].notas, 2, 'com a contagem de notas');
eq(snapOp.stats.embarcadas_por_operacao.length, 2, 'duas operações distintas no arquivo');

/* -------------------------------------------------------------------------- */
secao('parsearAjustesPfa — lê a planilha manual da assistente');
const CAB_AJU = 'tipo;encomenda;pfa_antiga;pfa_nova;cliente;familia_codigo;artigo;cor;tam;qtde_total_pedido;qtde_faltante;motivo;data_solicitacao;solicitante';
function linhaAju(tipo, encomenda, pfaAntiga, pfaNova, artigo, qtdeTotal, qtdeFaltante, qtdePosIgnorado, motivo, data) {
  // qtdePosIgnorado existe só pra não ter que mexer em todo call site — o
  // modelo antigo (antes/depois) virou uma única coluna (qtde_faltante).
  return [tipo, encomenda, pfaAntiga, pfaNova || '', '46212 CHARLESTON WILLIA', '102', artigo, 'PT/PRT', 'M',
    qtdeTotal, qtdeFaltante, motivo, data || '09/09/2026', 'ERIKA DOMINGUES LEME'].join(';');
}
const aju = parsearAjustesPfa([CAB_AJU,
  linhaAju('AJUSTE', '960841', '242018', '242305', 'OIMCR24302', '60', '2', null, 'Ajuste de encomenda'),
  linhaAju('TIPO_QUE_NAO_EXISTE', '960900', '242020', '', 'OIMCR24303', '10', '2', null, 'Motivo qualquer'),
  'LIXO;SEM;CAMPOS;SUFICIENTES', // rodapé/lixo real — descartado em silêncio, mesmo critério dos outros ingests
].join('\n'));
eq(aju.registros.length, 1, 'linha válida lida; tipo desconhecido e rodapé ficam de fora');
eq(aju.linhas_invalidas, 1, 'tipo desconhecido conta como inválido (linha tem todos os campos, só o valor é ruim)');
eq(aju.registros[0].encomenda, '960841', 'encomenda preservada — é a chave que sobrevive a renumeração de PFA');
eq(aju.registros[0].pfa_nova, '242305', 'PFA nova lida');
eq(aju.registros[0].cliente, '46212 CHARLESTON WILLIA', 'cliente vem num campo só (código+nome), como o e-mail do comercial já traz');

secao('parsearAjustesPfa — sobrevive ao próprio modelo baixado (aspas em todo campo + "," de separador de lista do Windows, 10/09/2026)');
const linhaAspas = function (delim) {
  return ['tipo', 'encomenda', 'pfa_antiga', 'pfa_nova', 'cliente', 'familia_codigo',
    'artigo', 'cor', 'tam', 'qtde_total_pedido', 'qtde_faltante', 'motivo', 'data_solicitacao',
    'solicitante'].map(function (c) { return '"' + c + '"'; }).join(delim);
};
const linhaAspasDados = function (delim) {
  return ['AJUSTE', '960841', '242018', '242305', '46212 CHARLESTON WILLIA', '102', 'OIMCR24302', 'PT/PRT', 'M',
    '60', '2', 'Ajuste de encomenda', '09/09/2026', 'ERIKA DOMINGUES LEME']
    .map(function (c) { return '"' + c + '"'; }).join(delim);
};
const ajuAspasPontoVirgula = parsearAjustesPfa('﻿' + [linhaAspas(';'), linhaAspasDados(';')].join('\n'));
eq(ajuAspasPontoVirgula.registros.length, 1, 'modelo baixado (";", tudo entre aspas) — sem o fix dava 0');
eq(ajuAspasPontoVirgula.registros[0].encomenda, '960841', 'aspas removidas do campo, não fica "960841" com aspas coladas');
eq(ajuAspasPontoVirgula.registros[0].qtde_faltante, 2, 'campo numérico entre aspas também converte certo');

const ajuVirgula = parsearAjustesPfa([linhaAspas(','), linhaAspasDados(',')].join('\n'));
eq(ajuVirgula.registros.length, 1, 'Excel com separador de lista em inglês salva com "," — mesmo bug real: dava 0 antes do fix');
eq(ajuVirgula.registros[0].artigo, 'OIMCR24302', 'delimitador "," detectado e respeitado');

// Caso real reportado pelo usuário (10/09/2026): copiou/colou do Excel e o
// arquivo saiu com TAB entre os campos, sem aspas nenhuma — nem "," nem ";"
// batiam, e o parser antigo (só ; ou ,) continuava dando 0 linhas.
const linhaTab = function () {
  return ['tipo', 'encomenda', 'pfa_antiga', 'pfa_nova', 'cliente', 'familia_codigo',
    'artigo', 'cor', 'tam', 'qtde_total_pedido', 'qtde_faltante', 'motivo', 'data_solicitacao',
    'solicitante'].join('\t');
};
const linhaTabDados = function () {
  return ['AJUSTE', '960841', '242018', '244900', '46212 CHARLESTON WILLIA', '102', 'OIMCR24302', 'PT/PRT', 'M',
    '5', '2', 'Ajuste de encomenda', '09/09/2026', 'ERIKA DOMINGUES LEME'].join('\t');
};
const ajuTab = parsearAjustesPfa([linhaTab(), linhaTabDados()].join('\r\n'));
eq(ajuTab.registros.length, 1, 'planilha colada do Excel com TAB entre campos — mesmo bug real relatado 10/09/2026');
eq(ajuTab.registros[0].pfa_nova, '244900', 'delimitador TAB detectado e respeitado');

secao('parsearAjustesPfa — tipo reconhece palavra-chave, não exige grafia exata (10/09/2026)');
const ajuSinonimo = parsearAjustesPfa([CAB_AJU,
  linhaAju('cancelado', '960900', '242020', '', 'OIMCR24303', '10', '2', '0', 'Financeiro'),
  linhaAju('Devolução AD', '960901', '242021', '', 'OIMCR24303', '10', '2', '0', 'Recusa'),
  linhaAju('B.O. pós-NF', '960902', '242022', '', 'OIMCR24303', '10', '2', '0', 'Stockout'),
  linhaAju('ajustes', '960903', '242023', '242311', 'OIMCR24303', '10', '2', '0', 'Corte'),
].join('\n'));
eq(ajuSinonimo.registros.length, 4, 'as 4 grafias alternativas foram todas reconhecidas');
eq(ajuSinonimo.registros[0].tipo, 'CANCELAMENTO', '"cancelado" normaliza pro rótulo oficial');
eq(ajuSinonimo.registros[1].tipo, 'AD_DEVOLUCAO', '"Devolução AD" normaliza pro rótulo oficial');
eq(ajuSinonimo.registros[2].tipo, 'BO_POS_NF', '"B.O. pós-NF" normaliza pro rótulo oficial');
eq(ajuSinonimo.registros[3].tipo, 'AJUSTE', '"ajustes" (plural) normaliza pro rótulo oficial');

/* -------------------------------------------------------------------------- */
secao('construirSnapshotPfas + ajustes_pfa — exclusão, DE-PARA, AD e PFA retrabalhada');
const pendAju = parsearPfasPendentes([CAB_PEND,
  linhaPend('242018', '01/09', '102', '2', 'Nao disp. picking', '50'),   // baixada por AJUSTE — deve sumir
  linhaPend('242305', '08/09', '102', '1', 'Nao disp. picking', '3'),    // PFA nova, importada HOJE — dentro do SLA
  linhaPend('242410', '03/09', '102', '1', 'Nao disp. picking', '3'),    // PFA nova, importada há 3 dias úteis — atrasada
  linhaPend('239900', '01/09', '102', '1', 'Leitura expedicao', '20'),   // PFA normal, sem relação com ajuste nenhum
].join('\n'), HOJE);
const anaAju = parsearPfasAnalitico([CAB_ANA,
  linhaAna('240711', '548820', '01/09/2026', 'V-AD', '102', 'A9', '120,0'), // AD: some de aguardando_coleta
].join('\n'));
const ajustesTeste = { registros: [
  // Corte real: perda líquida = 2 (a falta já vem pronta, sem antes/depois).
  { tipo: 'AJUSTE', encomenda: '960841', pfa_antiga: '242018', pfa_nova: '242305',
    cliente: '46212 CHARLESTON WILLIA', artigo: 'OIMCR24302', cor_tam: 'PT/PRT M',
    qtde_total_pedido: 60, qtde_faltante: 2, motivo: 'Ajuste de encomenda',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  // DE-PARA: qtde_faltante = 0 (artigo substituto cobriu o corte inteiro).
  { tipo: 'AJUSTE', encomenda: '961205', pfa_antiga: '242190', pfa_nova: '242410',
    cliente: '62410 GRUPO SPORTSTYLE', artigo: 'OIVCR23110', cor_tam: 'PT M',
    qtde_total_pedido: 30, qtde_faltante: 0, motivo: 'DE-PARA (artigo substituto)',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  // Ajuste em aberto: PFA nova declarada mas NUNCA vista em nenhum arquivo de Pendentes.
  { tipo: 'AJUSTE', encomenda: '958220', pfa_antiga: '241987', pfa_nova: '242999',
    cliente: '62410 GRUPO SPORTSTYLE', artigo: 'OIVCR23110', cor_tam: 'PT M',
    qtde_total_pedido: 40, qtde_faltante: 6, motivo: 'Stockout',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  // Cancelamento sem reposição: 100% vira perda, PFA antiga some do pendente.
  { tipo: 'CANCELAMENTO', encomenda: '957004', pfa_antiga: '241902', pfa_nova: null,
    cliente: '51330 REDE CALCADOS MG', artigo: 'OIACS20044', cor_tam: 'PT M',
    qtde_total_pedido: 14, qtde_faltante: 14, motivo: 'Financeiro',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  // AD: PFA inteira sai de "aguardando coleta" (não só a diferença).
  { tipo: 'AD_DEVOLUCAO', encomenda: '955390', pfa_antiga: '240711', pfa_nova: null,
    cliente: '46212 CHARLESTON WILLIA', artigo: 'OIMCR24302', cor_tam: 'PT/PRT M',
    qtde_total_pedido: 120, qtde_faltante: 120, motivo: 'Recusa de envio parcial (AD)',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
] };
// Dicionário artigo->família: só OIMCR24302 está mapeado (família 102,
// MIZUNO CALÇADO) — OIACS20044 fica de propósito sem entrada, pra provar
// que artigo nunca visto num upload de Picking/Pulmão vira "sem marca",
// não quebra nem inventa dado.
const mapaArtFamTeste = new Map([['OIMCR24302', '102']]);
const snapAju = construirSnapshotPfas(pendAju, anaAju, { registros: [] }, mapaFamilias, { referencia: HOJE }, ajustesTeste, mapaArtFamTeste);

// Exclusão do pendente
ok(!snapAju.pendentes.some(function (r) { return r.pfa === '242018'; }), 'PFA antiga (242018) some do pendente na hora do ajuste');
ok(!snapAju.pendentes.some(function (r) { return r.pfa === '241902'; }), 'PFA cancelada (241902) some do pendente — nem chegou a este teste, mas a exclusão roda igual');
ok(snapAju.pendentes.some(function (r) { return r.pfa === '239900'; }), 'PFA sem nenhuma relação com ajuste continua normal');
eq(snapAju.stats.excluidas_por_ajuste.pfas, 1, 'contador de exclusão por ajuste bate (só 242018 estava no arquivo de teste)');

// AD tira a PFA inteira de aguardando_coleta
ok(!snapAju.aguardando_coleta.some(function (g) { return g.pfa === '240711'; }), 'AD tira a PFA inteira de aguardando_coleta, não só a diferença');
eq(snapAju.stats.excluidas_por_ad.qtde, 120, 'quantidade excluída por AD é o total (120), não a diferença');

// Perda líquida por linha, incluindo DE-PARA e cancelamento
const perdaAjusteReal = snapAju.ajustes.find(function (a) { return a.pfa_antiga === '242018'; });
eq(perdaAjusteReal.perda_liquida, 2, 'corte real: 5 - 3 = 2 pares de perda');
const perdaDePara = snapAju.ajustes.find(function (a) { return a.pfa_antiga === '242190'; });
eq(perdaDePara.perda_liquida, 0, 'DE-PARA: qtde_faltante = 0 → perda líquida zero, sem coluna extra');
const perdaCancelamento = snapAju.ajustes.find(function (a) { return a.pfa_antiga === '241902'; });
eq(perdaCancelamento.perda_liquida, 14, 'cancelamento sem reposição: 100% do valor é perda');

// Ajustes em aberto
eq(snapAju.ajustes_em_aberto, 1, 'só o ajuste com PFA nova (242999) nunca vista em Pendentes conta como em aberto');
const emAberto = snapAju.ajustes.find(function (a) { return a.pfa_nova === '242999'; });
ok(emAberto.aguardando_import_pfa_nova, 'a própria linha também carrega o selo de aguardando importação');
const jaConfirmado = snapAju.ajustes.find(function (a) { return a.pfa_nova === '242305'; });
ok(!jaConfirmado.aguardando_import_pfa_nova, 'PFA nova que já apareceu em Pendentes não fica presa em "aguardando"');

// PFA retrabalhada — dentro do SLA vs atrasada
const pfaNovaNoPrazo = snapAju.pendentes.find(function (r) { return r.pfa === '242305'; });
eq(pfaNovaNoPrazo.situacao_pfa, 'retrabalhada', 'importada hoje (0 dias úteis) — dentro do SLA de 1 dia útil');
const pfaNovaAtrasada = snapAju.pendentes.find(function (r) { return r.pfa === '242410'; });
eq(pfaNovaAtrasada.situacao_pfa, 'retrabalhada_atrasada', 'importada há 3 dias úteis — estourou o SLA de 1 dia útil');
const pfaNormal = snapAju.pendentes.find(function (r) { return r.pfa === '239900'; });
eq(pfaNormal.situacao_pfa, 'normal', 'PFA que nunca foi "pfa_nova" de nenhum ajuste é sempre normal');

/* -------------------------------------------------------------------------- */
secao('ajustes carregam marca/segmento pelo artigo — pros filtros do topo também recortarem o card de perdas');
eq(perdaAjusteReal.marca, 'MIZUNO', 'artigo OIMCR24302 resolvido pelo dicionário artigo->família');
eq(perdaAjusteReal.segmento_macro, 'CALÇADO', 'segmento também vem do mesmo cruzamento');
eq(perdaCancelamento.marca, null, 'OIACS20044 nunca apareceu num upload de Picking/Pulmão — fica sem marca, não quebra');

/* -------------------------------------------------------------------------- */
secao('familia_codigo da própria linha tem prioridade sobre o dicionário artigo->família (10/09/2026, e-mail real do comercial)');
// OIACS20044 continua sem entrada no dicionário artigo->família, mas essa
// linha específica veio com familia_codigo preenchido (105, MIZUNO
// TÊXTIL/ACESSÓRIOS) — deve resolver por aí, não ficar sem marca.
const ajustesComFamilia = { registros: [
  { tipo: 'CANCELAMENTO', encomenda: '957004', pfa_antiga: '241902', pfa_nova: null,
    cliente: '51330 REDE CALCADOS MG', familia_codigo: '105', artigo: 'OIACS20044', cor_tam: 'PT M',
    qtde_total_pedido: 14, qtde_faltante: 14, motivo: 'Financeiro',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  // Sem familia_codigo (linha antiga, upload de antes dessa coluna existir)
  // — cai no fallback por artigo, igual sempre foi.
  { tipo: 'CANCELAMENTO', encomenda: '957005', pfa_antiga: '241903', pfa_nova: null,
    cliente: '51330 REDE CALCADOS MG', artigo: 'OIMCR24302', cor_tam: 'PT M',
    qtde_total_pedido: 10, qtde_faltante: 10, motivo: 'Financeiro',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
] };
const snapComFamilia = construirSnapshotPfas(
  parsearPfasPendentes([CAB_PEND].join('\n'), HOJE),
  parsearPfasAnalitico([CAB_ANA].join('\n')),
  { registros: [] }, mapaFamilias, { referencia: HOJE }, ajustesComFamilia, mapaArtFamTeste);
const ajusteComFamiliaPropria = snapComFamilia.ajustes.find(function (a) { return a.pfa_antiga === '241902'; });
eq(ajusteComFamiliaPropria.marca, 'MIZUNO', 'familia_codigo da linha (105) resolve marca mesmo sem o artigo estar no dicionário');
eq(ajusteComFamiliaPropria.segmento_macro, 'MEIA', 'segmento também vem da família da própria linha');
const ajusteSemFamiliaPropria = snapComFamilia.ajustes.find(function (a) { return a.pfa_antiga === '241903'; });
eq(ajusteSemFamiliaPropria.marca, 'MIZUNO', 'sem familia_codigo na linha, cai no fallback por artigo (comportamento antigo preservado)');

/* -------------------------------------------------------------------------- */
secao('AJUSTE sem pfa_nova é "falta parcial" — PFA continua em Pendentes (10/09/2026, validado contra e-mail real do comercial)');
const pendFaltaParcial = parsearPfasPendentes([CAB_PEND,
  linhaPend('232722', '01/09', '102', '8', 'Em picking', '48'), // PFA com falta parcial de alguns artigos — continua ativa
].join('\n'), HOJE);
const ajustesFaltaParcial = { registros: [
  // Duas linhas de artigo em falta na MESMA PFA, nenhuma com pfa_nova — o
  // comercial ainda não gerou PFA nova nenhuma pra cobrir o corte.
  { tipo: 'AJUSTE', encomenda: '963585', pfa_antiga: '232722', pfa_nova: null,
    cliente: '963585 JC ABDON CONFECCOES', familia_codigo: '102', artigo: '102055001', cor_tam: 'VRBNMA 44',
    qtde_total_pedido: 48, qtde_faltante: 3, motivo: 'Falta parcial',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
  { tipo: 'AJUSTE', encomenda: '963585', pfa_antiga: '232722', pfa_nova: null,
    cliente: '963585 JC ABDON CONFECCOES', familia_codigo: '102', artigo: '102056002', cor_tam: 'BCNCPE 38',
    qtde_total_pedido: 48, qtde_faltante: 2, motivo: 'Falta parcial',
    data_solicitacao: '2026-09-08', solicitante: 'ERIKA' },
] };
const snapFaltaParcial = construirSnapshotPfas(pendFaltaParcial, { registros: [] }, { registros: [] }, mapaFamilias,
  { referencia: HOJE }, ajustesFaltaParcial, new Map());
ok(snapFaltaParcial.pendentes.some(function (r) { return r.pfa === '232722'; }), 'PFA com falta parcial (sem PFA nova) CONTINUA em Pendentes — ainda está ativa na operação');
eq(snapFaltaParcial.stats.excluidas_por_ajuste.pfas, 0, 'nenhuma exclusão por ajuste — falta parcial não tira a PFA da tela');
const perdaFaltaParcial = snapFaltaParcial.ajustes.reduce(function (s, a) { return s + a.perda_liquida; }, 0);
eq(perdaFaltaParcial, 5, 'a perda dos dois artigos em falta (3+2=5) continua somando certo no card de Ajustes, mesmo sem excluir a PFA');
// Assim que o comercial gerar e informar a PFA nova, volta a excluir — sem
// mudar mais nada na planilha além de preencher pfa_nova.
const ajustesComPfaNovaGerada = { registros: [
  Object.assign({}, ajustesFaltaParcial.registros[0], { pfa_nova: '233001' }),
  Object.assign({}, ajustesFaltaParcial.registros[1], { pfa_nova: '233001' }),
] };
const snapComPfaNovaGerada = construirSnapshotPfas(pendFaltaParcial, { registros: [] }, { registros: [] }, mapaFamilias,
  { referencia: HOJE }, ajustesComPfaNovaGerada, new Map());
ok(!snapComPfaNovaGerada.pendentes.some(function (r) { return r.pfa === '232722'; }), 'com a PFA nova preenchida, agora sim exclui — o corte virou renumeração de verdade');

/* -------------------------------------------------------------------------- */
secao('construirSnapshotPfas — abastecimento parcial (só Pendentes, ou só Embarcadas), sem apagar o resto (10/09/2026)');

// snap1: rodada "completa", com os 3 arquivos.
const pend1Parcial = parsearPfasPendentes([CAB_PEND,
  linhaPend('S1', '01/09', '102', '2', 'Nao disp. picking', '10'), // 2 volumes, 1 conferido -> parcial
  linhaPend('S2', '01/09', '102', '1', 'Nao disp. picking', '8'),  // com nota -> aguardando_coleta
  linhaPend('E1', '01/09', '102', '1', 'Nao disp. picking', '7'),  // vai ser embarcada
].join('\n'), HOJE);
const ana1Parcial = parsearPfasAnalitico([CAB_ANA,
  linhaAna('S1', '0', '', 'VOLA', '102', 'ART1', '4'),               // sem nota, 1 de 2 volumes lidos
  linhaAna('S2', 'N100', '01/09/2026', 'VOLB', '102', 'ART2', '6'),  // com nota
].join('\n'));
const emb1Parcial = parsearPfasEmbarcadas([CAB_EMB, linhaEmb('E1', '01/09/2026', 'N1', '5')].join('\n'));
const snap1Parcial = construirSnapshotPfas(pend1Parcial, ana1Parcial, emb1Parcial, mapaFamilias,
  { referencia: HOJE, arquivo_pendentes: 'pend1.txt', arquivo_analitico: 'ana1.csv', arquivo_embarcadas: 'emb1.csv' },
  { registros: [] }, new Map());

ok(!snap1Parcial.pendentes.some(function (r) { return r.pfa === 'E1'; }), 'E1 embarcada some do pendente na rodada completa');
eq(JSON.stringify(snap1Parcial.embarcadas_pfas), JSON.stringify(['E1']), 'PFA embarcada fica guardada no payload pra reaplicar depois');
const s1Confere = snap1Parcial.pendentes.find(function (r) { return r.pfa === 'S1'; });
eq(s1Confere.conferencia, 'parcial_rastreio', 'S1: 1 de 2 volumes lidos, parado há 7 dias na etapa -> parcial_rastreio');

// snap2: só Pendentes é reenviado (Analítico e Embarcadas ficam de fora) —
// o pedido real da operação (10/09/2026): atualizar etapa/FIFO rápido sem
// precisar ter os outros dois arquivos em mãos. Nova referência (2 dias
// depois) pra provar que o que É recalculável (dias_nota) avança mesmo sem
// reenviar o Analítico.
const pend2Parcial = parsearPfasPendentes([CAB_PEND,
  linhaPend('S1', '01/09', '102', '2', 'Em picking', '10'),  // mesma PFA, etapa avançou
  linhaPend('S3', '10/09', '102', '1', 'Nao disp. picking', '3'), // PFA nova, nunca vista antes
  linhaPend('E1', '01/09', '102', '1', 'Nao disp. picking', '7'), // fonte atrasada: E1 volta a aparecer
].join('\n'), '2026-09-10');
const snap2Parcial = construirSnapshotPfas(pend2Parcial, null, null, mapaFamilias,
  { referencia: '2026-09-10', arquivo_pendentes: 'pend2.txt' },
  { registros: [] }, new Map(), snap1Parcial);

ok(!snap2Parcial.pendentes.some(function (r) { return r.pfa === 'E1'; }), 'E1 continua excluída mesmo sem reenviar Embarcadas — reaplica embarcadas_pfas do último snapshot');
eq(snap2Parcial.arquivo_embarcadas, 'emb1.csv', 'nome do arquivo de Embarcadas carregado do último snapshot, não fica null');
const s1Novo = snap2Parcial.pendentes.find(function (r) { return r.pfa === 'S1'; });
eq(s1Novo.situacao, 'Em picking', 'S1: etapa atualizada com o Pendentes novo');
eq(s1Novo.conferencia, 'parcial_rastreio', 'S1: conferência CONGELADA no valor de quando o Analítico foi lido de verdade');
eq(s1Novo.conferencia_lidos, 1, 'volumes lidos também congelados (1 de 2)');
const s3Novo = snap2Parcial.pendentes.find(function (r) { return r.pfa === 'S3'; });
eq(s3Novo.conferencia, 'nao_iniciada', 'S3: PFA nova, nunca vista no Analítico -> honesta, não herda nada');

const semNotaCarregado = snap2Parcial.aguardando_nf.find(function (g) { return g.pfa === 'S1'; });
ok(!!semNotaCarregado, 'aguardando_nf (S1) sobrevive ao upload que não reenviou Analítico');
eq(semNotaCarregado.qtde, 4, 'quantidade do grupo carregado continua a mesma');
ok(semNotaCarregado.confirmado, 'S1 continua confirmado — ainda está no Pendentes novo');

const comNotaCarregado = snap2Parcial.aguardando_coleta.find(function (g) { return g.pfa === 'S2'; });
ok(!!comNotaCarregado, 'aguardando_coleta (S2) também sobrevive');
ok(!comNotaCarregado.confirmado, 'S2 vira NÃO confirmado — sumiu do Pendentes novo (confirmado é recalculado, não congelado)');
eq(comNotaCarregado.dias_nota, diasEntre('2026-09-01', '2026-09-10'), 'dias_nota RECALCULADO pra hoje mesmo sem Analítico novo (a data da nota é real)');

/* -------------------------------------------------------------------------- */
secao('construirSnapshotPfas — mesma PFA origem com vários artigos em falta, cada um sua linha (10/09/2026)');
const pendMultiArtigo = parsearPfasPendentes([CAB_PEND,
  linhaPend('500001', '01/09', '102', '2', 'Nao disp. picking', '10'), // PFA origem — some do pendente 1x só
  linhaPend('500099', '08/09', '102', '1', 'Nao disp. picking', '3'),  // PFA nova (renumerada), única pra toda a PFA
].join('\n'), HOJE);
const ajustesMultiArtigo = { registros: [
  // 3 artigos em falta na MESMA pfa_antiga/pfa_nova — a assistente lança uma
  // linha por artigo, cada um com sua própria quantidade.
  { tipo: 'AJUSTE', encomenda: '900001', pfa_antiga: '500001', pfa_nova: '500099',
    cliente: '900001 CLIENTE X', artigo: 'ART-A', cor_tam: 'P M',
    qtde_total_pedido: 20, qtde_faltante: 4, motivo: 'Falta de artigo A',
    data_solicitacao: '2026-09-09', solicitante: 'ERIKA' },
  { tipo: 'AJUSTE', encomenda: '900001', pfa_antiga: '500001', pfa_nova: '500099',
    cliente: '900001 CLIENTE X', artigo: 'ART-B', cor_tam: 'P G',
    qtde_total_pedido: 20, qtde_faltante: 3, motivo: 'Falta de artigo B',
    data_solicitacao: '2026-09-09', solicitante: 'ERIKA' },
  { tipo: 'AJUSTE', encomenda: '900001', pfa_antiga: '500001', pfa_nova: '500099',
    cliente: '900001 CLIENTE X', artigo: 'ART-C', cor_tam: 'P GG',
    qtde_total_pedido: 20, qtde_faltante: 0, motivo: 'DE-PARA artigo C',
    data_solicitacao: '2026-09-09', solicitante: 'ERIKA' },
] };
const snapMultiArtigo = construirSnapshotPfas(pendMultiArtigo, { registros: [] }, { registros: [] }, mapaFamilias,
  { referencia: HOJE }, ajustesMultiArtigo, new Map());

eq(snapMultiArtigo.ajustes.length, 3, 'uma linha de ajuste por artigo — nenhum é descartado como duplicata');
eq(snapMultiArtigo.stats.excluidas_por_ajuste.pfas, 1, 'a PFA origem só é contada 1x na exclusão, mesmo com 3 artigos');
ok(!snapMultiArtigo.pendentes.some(function (r) { return r.pfa === '500001'; }), 'PFA origem some do pendente (uma vez só, não 3)');
const perdaTotalMultiArtigo = snapMultiArtigo.ajustes.reduce(function (s, a) { return s + a.perda_liquida; }, 0);
eq(perdaTotalMultiArtigo, 7, 'perda soma os 3 artigos: (10-6) + (5-2) + (8-8) = 4+3+0 = 7');
const pfasDistintasMultiArtigo = new Set(snapMultiArtigo.ajustes.map(function (a) { return a.pfa_antiga; })).size;
eq(pfasDistintasMultiArtigo, 1, 'PFAs distintas nos ajustes continua 1, mesmo com 3 linhas (uma por artigo)');
const pfaNovaMultiArtigo = snapMultiArtigo.pendentes.find(function (r) { return r.pfa === '500099'; });
eq(pfaNovaMultiArtigo.situacao_pfa, 'retrabalhada', 'a PFA nova (única, compartilhada pelos 3 artigos) é reconhecida como retrabalhada certinho');

/* -------------------------------------------------------------------------- */
secao('diasUteisEntre — pula sábado e domingo');
eq(diasUteisEntre('2026-09-08', '2026-09-08'), 0, 'mesma data, zero dias úteis');
eq(diasUteisEntre('2026-09-03', '2026-09-08'), 3, 'qui 03/09 → ter 08/09 = 3 dias úteis (sex, seg, ter — fim de semana fora)');

/* -------------------------------------------------------------------------- */
console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : '\n' + falhas + ' TESTE(S) FALHARAM');
process.exit(falhas === 0 ? 0 : 1);

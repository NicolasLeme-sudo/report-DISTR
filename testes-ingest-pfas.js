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

secao('janela do Embarcadas separa o que dá pra confirmar do que não dá');
// Nota de 25/02 (bem antes da janela) × nota de 01/09 (dentro dela).
const pendJanela = parsearPfasPendentes([CAB_PEND,
  linhaPend('300001', '01/09', '102', '1', 'Leitura expedicao', '10'),
  linhaPend('300002', '01/09', '102', '1', 'Leitura expedicao', '20'),
].join('\n'), HOJE);
const anaJanela = parsearPfasAnalitico([CAB_ANA,
  linhaAna('300001', '900001', '25/02/2026', 'V-1', '102', 'A1', '10,0'), // fora da janela
  linhaAna('300002', '900002', '01/09/2026', 'V-2', '102', 'A2', '20,0'), // dentro
].join('\n'));
// Embarcadas cobre 17/08 → 08/09 (nenhuma dessas PFAs saiu)
const embJanela = parsearPfasEmbarcadas([CAB_EMB,
  linhaEmb('999001', '17/08/2026', '800001', '1,0'),
  linhaEmb('999002', '08/09/2026', '800002', '1,0'),
].join('\n'));
const snapJanela = construirSnapshotPfas(pendJanela, anaJanela, embJanela, mapaFamilias, { referencia: HOJE });
eq(snapJanela.stats.janela_embarcadas.de, '2026-08-17', 'janela começa na nota embarcada mais antiga');
eq(snapJanela.stats.janela_embarcadas.ate, '2026-09-08', 'e termina na mais recente');
eq(snapJanela.stats.aguardando_coleta.confirmado.qtde, 20,
   'nota de 01/09 está DENTRO da janela e não consta como embarcada → confirmadamente parada');
eq(snapJanela.stats.aguardando_coleta.nao_confirmado.qtde, 10,
   'nota de 25/02 é anterior à janela → não dá pra afirmar que ainda está lá');
eq(snapJanela.stats.aguardando_coleta.qtde, 30, 'o total continua sendo a soma dos dois — nada some');

secao('operação do embarque (PWD) é contada, não interpretada');
const snapOp = construirSnapshotPfas(pendJanela, anaJanela, parsearPfasEmbarcadas([CAB_EMB,
  linhaEmb('999001', '20/08/2026', '800001', '1,0', 'CROSSDOC'),
  linhaEmb('999002', '21/08/2026', '800002', '1,0', 'CROSSDOC'),
  linhaEmb('999003', '22/08/2026', '800003', '1,0', 'EX000704'),
].join('\n')), mapaFamilias, { referencia: HOJE });
eq(snapOp.stats.embarcadas_por_operacao[0].operacao, 'CROSSDOC', 'operação mais frequente vem primeiro');
eq(snapOp.stats.embarcadas_por_operacao[0].notas, 2, 'com a contagem de notas');
eq(snapOp.stats.embarcadas_por_operacao.length, 2, 'duas operações distintas no arquivo');

/* -------------------------------------------------------------------------- */
console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : '\n' + falhas + ' TESTE(S) FALHARAM');
process.exit(falhas === 0 ? 0 : 1);

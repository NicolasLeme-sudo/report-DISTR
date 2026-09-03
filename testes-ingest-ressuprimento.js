/* ============================================================================
   TESTES DO INGEST-RESSUPRIMENTO — rode com: node testes-ingest-ressuprimento.js
   ============================================================================
   Mesma filosofia do testes-ingest.js: sem framework, sem dependência, sai 1
   se algo falhar. Aqui os riscos de "número errado com cara de certo" são
   ainda maiores que no Balanço de Estoque — já foram confirmados dois de
   verdade contra o arquivo real antes deste arquivo existir:

   1. QTD.STOCK do Pulmão é o total do LOTE repetido em cada linha de volume;
      somar direto infla o total em ~7x. A coluna certa é QTD.VOLUME.
   2. Saldo negativo no Picking é reserva de separação/B.O. OU faturamento do
      fechamento cuja cativação sumiu — sem como distinguir os dois só com
      este arquivo, a operação decidiu excluir do saldo (nem soma positivo
      nem negativo), guardando o valor em qtd_gap_reservado.
   ============================================================================ */
const fs = require('fs');
const path = require('path');

global.window = global; // window.numeroBR/lerTudoPaginado == global, simples o bastante pro teste
eval(fs.readFileSync(path.join(__dirname, 'ingest.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, 'ingest-ressuprimento.js'), 'utf8'));

let falhas = 0;
function secao(nome) { console.log('\n=== ' + nome + ' ==='); }
function ok(cond, msg) { console.log((cond ? '  ok  ' : '  XX  ') + msg); if (!cond) falhas++; }
function eq(obtido, esperado, msg) {
  const igual = typeof esperado === 'number' && typeof obtido === 'number'
    ? Math.abs(obtido - esperado) < 1e-9 : obtido === esperado;
  ok(igual, msg + (igual ? '' : '  (esperado ' + esperado + ', obtido ' + obtido + ')'));
}

/* -------------------------------------------------------------------------- */
secao('parsearPicking — saldo negativo vira GAP, não soma em nenhum sentido');
const TOPO_PICK = 'VULSP - ENDERECOS DE PICKING DO EXTRE/AC190||por:EX000001|em:Set.1 ,26|';
const CAB_PICK = 'CONCAT|Fam|artigo|descricao|cor|tam|EAN|endereco|qtde_disponivel|qtde_cativado|';
function linhaPicking(rua, nivel, box, qtd) {
  return '432-PRETO-40|101|432|TENIS X|PRETO|40|7890000000000| ' + rua + ',' + nivel + ',' + box + '|' + qtd + '|0|';
}
function arquivoPicking(linhas) { return [TOPO_PICK, CAB_PICK].concat(linhas).join('\n'); }

const pNeg = parsearPicking(arquivoPicking([linhaPicking('01', '01', '001', '-5')]));
eq(pNeg.registros[0].qtd, 0, 'linha com qtde_disponivel=-5 conta ZERO no saldo (nem 5, nem -5)');
eq(pNeg.registros[0].qtd_gap_reservado, 5, 'o valor absoluto (5) fica guardado em qtd_gap_reservado');
eq(pNeg.negativas_excluidas, 1, 'contador de linhas negativas excluídas');
eq(pNeg.negativas_unidades, 5, 'soma de unidades excluídas');

const pPos = parsearPicking(arquivoPicking([linhaPicking('01', '01', '001', '12')]));
eq(pPos.registros[0].qtd, 12, 'qtd positiva não é afetada');
eq(pPos.registros[0].qtd_gap_reservado, 0, 'sem gap quando não é negativo');
eq(pPos.negativas_excluidas, 0, 'nenhuma linha negativa contada');

/* -------------------------------------------------------------------------- */
secao('parsearPulmao — QTD.VOLUME (não QTD.STOCK) e dedup por VOLUME');
const CAB_PULM = 'ARMAZEM|SUB.ARMAZEM|RUA|NIVEL|BOX|ARTIGO|COR|TAMANHO|DESCRICAO|UN.MEDIDA|FAMILIA|EM LINHA|STOCK MINIMO|QTD. STOCK|PRECO MEDIO|VALOR STOCK|VOLUME|DT. CRI.|TS|QTD. VOLUME|CODBAR';
function linhaPulmao(rua, nivel, box, qtdStock, volumeId, qtdVolume, dtCri) {
  return ['EXTRE', 'AC190', rua, nivel, box, '432', 'PRETO', '40', 'TENIS X', 'PAR', '101', 'S',
    '0,000', qtdStock, '50,00', '0,00', volumeId, dtCri || '01-01-26', 'D', qtdVolume, '7890000000000'].join('|');
}
function arquivoPulmao(linhas) { return [CAB_PULM].concat(linhas).join('\n'); }

// um "lote" de 3 volumes: QTD.STOCK repete 300 em toda linha, QTD.VOLUME soma 300
const lote = parsearPulmao(arquivoPulmao([
  linhaPulmao('1', '1', '1', '300,000', 'VOL001', '100,000'),
  linhaPulmao('1', '1', '1', '300,000', 'VOL002', '100,000'),
  linhaPulmao('1', '1', '1', '300,000', 'VOL003', '100,000'),
]));
eq(lote.registros.length, 3, 'três linhas de volume viram três registros (granularidade por volume)');
const somaQtdLote = lote.registros.reduce(function (s, r) { return s + r.qtd; }, 0);
eq(somaQtdLote, 300, 'soma de r.qtd (vem de QTD.VOLUME) bate com o total do lote — NUNCA usar QTD.STOCK direto');

// volume duplicado (mesmo VOLUME id) não conta duas vezes
const dup = parsearPulmao(arquivoPulmao([
  linhaPulmao('1', '1', '1', '100,000', 'VOLDUP', '100,000'),
  linhaPulmao('1', '1', '1', '100,000', 'VOLDUP', '100,000'), // mesmo id, linha repetida por engano
]));
eq(dup.registros.length, 1, 'volume com o mesmo id não é contado duas vezes');
eq(dup.colisoes_volume, 1, 'colisão de volume duplicado é reportada');

/* -------------------------------------------------------------------------- */
secao('classificarRuaPulmao — gabarito de ruas fornecido pela operação');
[['1', 'PULMAO'], ['14', 'PULMAO'], ['21', 'VALIDACAO'], ['24', 'VALIDACAO'], ['26', 'VALIDACAO'],
 ['27', 'VALIDACAO'], ['98', 'VALIDACAO'], ['100', 'VALIDACAO'], ['500', 'VALIDACAO'], ['600', 'VALIDACAO'],
 ['999', 'NAO_MAPEADA']].forEach(function (c) {
  eq(classificarRuaPulmao(c[0]).grupo, c[1], 'rua ' + c[0] + ' -> ' + c[1]);
});

/* -------------------------------------------------------------------------- */
secao('classificarBucket — Meia/Vestuário/Calçado a partir de segmento/categoria');
eq(classificarBucket('MEIAS MIZUNO', 'MEIAS MIZUNO'), 'meia', 'segmento com MEIA -> meia');
eq(classificarBucket('TÊNIS MIZUNO', 'TÊNIS MIZUNO'), 'calcado', 'segmento com TÊNIS -> calcado');
eq(classificarBucket('X', 'CHUTEIRA MIZUNO'), 'calcado', 'categoria CHUTEIRA -> calcado');
eq(classificarBucket('X', 'CHINELO MIZUNO'), 'calcado', 'categoria CHINELO -> calcado');
eq(classificarBucket('TÊXTIL/ACESSÓRIOS MIZUNO', 'VESTUÁRIO MIZUNO'), 'vestuario', 'segmento TÊXTIL -> vestuario');
eq(classificarBucket('Insumos Operacionais', 'Material de Insumo'), 'outros', 'insumo cai em outros (sinalizado, não silencioso)');

/* -------------------------------------------------------------------------- */
secao('construirSnapshotRessuprimento — reclassificação Picking -> Pulmão e cruzamento');
const mapaFamilias = new Map([
  ['101', { marca: 'MIZUNO', categoria: 'TÊNIS MIZUNO', segmento: 'TÊNIS MIZUNO' }],
]);

// picking com 1 linha normal + 1 linha na rua 20 (deve virar pulmão, apoio confiável)
// + 1 linha na rua 70 (deve virar pulmão, mas NÃO confiável — é sujeira de sistema)
// + 1 linha na rua 81 nivel 2 (pulmão, confiável) + rua 81 nivel 1 (continua picking)
const picking = {
  registros: [
    { familia_codigo: '101', artigo_codigo: 'A1', cor: 'PT', tamanho: '40', ean: 'EAN1', rua: '1', nivel: '1', box: '1', qtd: 50, qtd_gap_reservado: 0 },
    { familia_codigo: '101', artigo_codigo: 'A2', cor: 'PT', tamanho: '40', ean: 'EAN2', rua: '20', nivel: '1', box: '1', qtd: 10, qtd_gap_reservado: 0 },
    { familia_codigo: '101', artigo_codigo: 'A3', cor: 'PT', tamanho: '40', ean: 'EAN3', rua: '70', nivel: '1', box: '1', qtd: 7, qtd_gap_reservado: 0 },
    { familia_codigo: '101', artigo_codigo: 'A4', cor: 'PT', tamanho: '40', ean: 'EAN4', rua: '81', nivel: '2', box: '1', qtd: 3, qtd_gap_reservado: 0 },
    { familia_codigo: '101', artigo_codigo: 'A5', cor: 'PT', tamanho: '40', ean: 'EAN5', rua: '81', nivel: '1', box: '1', qtd: 4, qtd_gap_reservado: 0 },
  ],
  negativas_excluidas: 0, negativas_unidades: 0,
};
const pulmao = {
  registros: [
    // pulmão de verdade, rua 1 (grupo PULMAO), com CODBAR = EAN1 (apoio pro picking)
    { familia_codigo: '101', artigo_codigo: 'A1', cor: 'PT', tamanho: '40', rua: '1', nivel: '5', box: '9',
      qtd: 200, codbar: 'EAN1', dt_cri: new Date('2026-01-01') },
    // sujeira (rua 24) do mesmo artigo do picking rua 70 — não deveria contar como apoio
    { familia_codigo: '101', artigo_codigo: 'A3', cor: 'PT', tamanho: '40', rua: '24', nivel: '1', box: '1',
      qtd: 999, codbar: 'EAN3', dt_cri: new Date('2020-01-01') },
  ],
  colisoes_volume: 0,
};

const payload = construirSnapshotRessuprimento(picking, pulmao, mapaFamilias, {}, {
  arquivo_picking: 'teste-picking.txt', arquivo_pulmao: 'teste-pulmao.txt',
});

// árvore de picking: só deve contar A1 (rua 1, picking de verdade). A2/A3/A4 foram
// reclassificadas pro pulmão; A5 (rua 81 nível 1) continua sendo picking.
const totalArvorePicking = payload.arvore_picking.reduce(function (s, m) { return s + m.qtd; }, 0);
eq(totalArvorePicking, 50 + 4, 'árvore de picking soma só A1(50)+A5(4) — A2/A3/A4 saíram pro pulmão');

// árvore de pulmão: A1(200, rua 1) + A2(10, reclass rua20) + A3(7, reclass rua70) +
// A4(3, reclass rua81-02) + A3-sujeira(999, rua24) = 1219
const totalArvorePulmao = payload.arvore_pulmao.reduce(function (s, m) { return s + m.qtd; }, 0);
eq(totalArvorePulmao, 200 + 10 + 7 + 3 + 999, 'árvore de pulmão inclui o real + todo o reclassificado do picking');

// cruzamento: EAN1 (picking rua1, saldo 50) tem apoio real no pulmão rua1 (200) -> conta
eq(payload.ressuprimento_por_segmento.calcado.apoio_pulmao_disponivel, 200,
   'apoio confiável soma só a rua 1 (EAN1=200) — rua 20/81-02 reclassificadas não têm CODBAR neste teste, e rua 24 (sujeira) não é confiável mesmo tendo CODBAR');

// validação: a linha de sujeira (rua 24) e a reclassificada não-confiável (rua 70, A3)
// devem aparecer marcadas em_validacao
const emValidacao = payload.validacao.map(function (v) { return v.artigo_codigo; }).sort();
ok(emValidacao.indexOf('A3') !== -1, 'A3 (sujeira, rua 24 real + reclassificado rua 70) aparece em validação');

/* -------------------------------------------------------------------------- */
secao('ocupação — endereço ALOCADO conta, saldo zero não esvazia a posição');
// Confirmado contra a planilha de Ocupação da gestão (02/09/2026): pelo critério
// de alocação o Picking de meia bate EXATO (361 dos dois lados); pelo critério
// antigo, de saldo > 0, dava 240 e o armazém parecia mais vazio do que está.
const pickingComZerado = {
  registros: [
    { familia_codigo: '101', artigo_codigo: 'A5', cor: 'PT', tamanho: '40', ean: 'E5', rua: '81', nivel: '1', box: '1', qtd: 4, qtd_gap_reservado: 0 },
    { familia_codigo: '101', artigo_codigo: 'A6', cor: 'PT', tamanho: '41', ean: 'E6', rua: '81', nivel: '1', box: '2', qtd: 0, qtd_gap_reservado: 0 },
  ],
  negativas_excluidas: 0, negativas_unidades: 0,
};
const payloadOcup = construirSnapshotRessuprimento(
  pickingComZerado, { registros: [], colisoes_volume: 0 }, mapaFamilias, { picking_calcado: 10 },
  { arquivo_picking: 'p.txt', arquivo_pulmao: 'x.txt' }
);
eq(payloadOcup.ocupacao.picking_calcado.ocupado, 2,
   'endereço com SKU alocado e saldo zero continua contando como posição ocupada');
eq(payloadOcup.ocupacao.picking_calcado.capacidade, 10, 'capacidade manual da gestão é respeitada');
eq(payloadOcup.ocupacao.picking_calcado.capacidade_estimada, false,
   'zona com capacidade cadastrada não é marcada como estimada');

/* -------------------------------------------------------------------------- */
secao('ocupação — 20/70/80/81-02 são apoio de ressuprimento, não posição de ninguém');
// Confirmado pela operação (03/09/2026): essas ruas contam como Pulmão no
// CRUZAMENTO de apoio (não são posição de picking), mas ficam de fora da
// CONTAGEM de posições das duas zonas. Motivo, medido no arquivo real:
// 2.662 endereços ALOCADOS nessas ruas contra só 339 com saldo de verdade —
// contá-las por alocação (a mesma regra que acerta as outras zonas) inflava
// o Pulmão pra 156% da capacidade. A gestão não inclui essas posições nem
// nos 5.010 lugares do Pulmão nem nos 3.933 do Picking-calçado.
const pickingRua20 = {
  registros: [
    { familia_codigo: '101', artigo_codigo: 'A2', cor: 'PT', tamanho: '40', ean: 'E2', rua: '20', nivel: '1', box: '1', qtd: 10, qtd_gap_reservado: 0 },
  ],
  negativas_excluidas: 0, negativas_unidades: 0,
};
const payloadFisico = construirSnapshotRessuprimento(
  pickingRua20, { registros: [], colisoes_volume: 0 }, mapaFamilias, {},
  { arquivo_picking: 'p.txt', arquivo_pulmao: 'x.txt' }
);
eq(payloadFisico.ocupacao.pulmao.ocupado, 0,
   'rua 20 (reclassificada) NÃO ocupa posição de pulmão — não é porta-pallet fixo');
eq(payloadFisico.ocupacao.picking_calcado.ocupado, 0,
   'nem de picking — pickingReal já a exclui, e ela não volta em lugar nenhum');

/* -------------------------------------------------------------------------- */
secao('ocupação — ruas de trânsito DENTRO do Pulmão (21/24/26/27/98/100/500/600) também ficam de fora');
// Pedido da operação (05/09/2026): essas ruas são corredor de baixa/subida
// de ressuprimento, sujeira e perca -- passagem, não porta-pallet fixo. Não
// devem contar na capacidade do Pulmão (mesmo raciocínio das ruas 20/70/80/
// 81-02 reclassificadas do Picking), e viram o card de B.O. em trânsito.
const pulmaoComTransito = {
  registros: [
    { familia_codigo: '101', artigo_codigo: 'A1', cor: 'PT', tamanho: '40', descricao: 'X', unidade: 'PAR', em_linha: true, rua: '1', nivel: '5', box: '1', dt_cri: null, qtd: 10, codbar: '' },
    { familia_codigo: '101', artigo_codigo: 'A2', cor: 'PT', tamanho: '41', descricao: 'X', unidade: 'PAR', em_linha: true, rua: '500', nivel: '1', box: '1', dt_cri: null, qtd: 7, codbar: '' },
    { familia_codigo: '101', artigo_codigo: 'A3', cor: 'PT', tamanho: '42', descricao: 'X', unidade: 'PAR', em_linha: true, rua: '500', nivel: '1', box: '1', dt_cri: null, qtd: 3, codbar: '' },
    { familia_codigo: '101', artigo_codigo: 'A4', cor: 'PT', tamanho: '43', descricao: 'X', unidade: 'PAR', em_linha: true, rua: '26', nivel: '1', box: '2', dt_cri: null, qtd: 5, codbar: '' },
  ],
  colisoes_volume: 0,
};
const payloadTransito = construirSnapshotRessuprimento(
  { registros: [], negativas_excluidas: 0, negativas_unidades: 0 }, pulmaoComTransito, mapaFamilias, { pulmao: 100 },
  { arquivo_picking: 'x.txt', arquivo_pulmao: 'p.txt' }
);
eq(payloadTransito.ocupacao.pulmao.ocupado, 1,
   'só a rua 1 (Pulmão de verdade) conta na ocupação -- as de trânsito (500, 26) ficam de fora');
eq(payloadTransito.transito_pulmao.total_enderecos, 2,
   '2 endereços distintos em trânsito: 500|1|1 (A2+A3, mesmo endereço) e 26|1|2 (A4)');
eq(payloadTransito.transito_pulmao.total_qtd, 15, 'soma as peças dos 2 endereços em trânsito (7+3+5)');
const endTransito500 = payloadTransito.transito_pulmao.enderecos.find(function (e) { return e.rua === '500'; });
eq(endTransito500.qtd, 10, 'endereço 500|1|1 soma A2(7)+A3(3) = 10, mesmo endereço físico');
eq(endTransito500.skus, 2, 'e conta os 2 SKUs distintos que dividem esse endereço');
ok(/Baixar Ressuprimento/.test(endTransito500.classif_rotulo), 'carrega o rótulo da classificação da rua (500 = Baixar Ressuprimento)');

/* -------------------------------------------------------------------------- */
secao('segmentoMacro — os 6 baldes da gestão, cruzando todas as marcas');
eq(segmentoMacro('TÊXTIL/ACESSÓRIOS MIZUNO', 'VESTUÁRIO MIZUNO'), 'VESTUÁRIO',
   'vestuário não é engolido pelo "ACESSÓRIOS" que vem no nome do segmento');
eq(segmentoMacro('TÊXTIL/ACESSÓRIOS MIZUNO', 'MEIAS MIZUNO'), 'MEIA', 'meia sai do mesmo segmento têxtil');
eq(segmentoMacro('TÊXTIL/ACESSÓRIOS OLYMPIKUS', 'ACESSÓRIOS OLYMPIKUS'), 'ACESSÓRIO', 'acessório');
eq(segmentoMacro('TÊNIS MIZUNO', 'TÊNIS MIZUNO'), 'CALÇADO', 'tênis vira CALÇADO (pedido da gestão)');
eq(segmentoMacro('CHUTEIRA MIZUNO', 'CHUTEIRA MIZUNO'), 'CHUTEIRA', 'chuteira tem balde próprio, não cai em calçado');
eq(segmentoMacro('CHINELO', 'CHINELO OLYMPIKUS'), 'CHINELO', 'chinelo tem balde próprio');
eq(segmentoMacro('CHINELO', 'OPANKA'), 'CHINELO', 'OPANKA é chinelo (segmento CHINELO no gabarito)');
eq(segmentoMacro('TÊXTIL/ACESSÓRIOS MIZUNO', 'BOTAFOGO MIZUNO'), 'VESTUÁRIO',
   'BOTAFOGO é camisa de time — não pode cair em CALÇADO pelo /BOTA/');
eq(segmentoMacro('FEMININO', 'SAPATO AZALEIA'), 'CALÇADO', 'sapato vira calçado');
eq(segmentoMacro('Insumos Operacionais', 'Embalagens'), 'OUTROS', 'insumo cai em OUTROS, sinalizado');

/* -------------------------------------------------------------------------- */
secao('estatísticas — média de PEÇAS por endereço (não de SKUs)');
const payloadStats = construirSnapshotRessuprimento(
  {
    registros: [
      // dois SKUs no MESMO endereço, somando 30 peças; um terceiro sozinho com 10
      { familia_codigo: '101', artigo_codigo: 'S1', cor: 'PT', tamanho: '40', ean: 'X1', rua: '2', nivel: '1', box: '1', qtd: 20, qtd_gap_reservado: 0 },
      { familia_codigo: '101', artigo_codigo: 'S2', cor: 'PT', tamanho: '41', ean: 'X2', rua: '2', nivel: '1', box: '1', qtd: 10, qtd_gap_reservado: 0 },
      { familia_codigo: '101', artigo_codigo: 'S3', cor: 'PT', tamanho: '42', ean: 'X3', rua: '2', nivel: '1', box: '2', qtd: 10, qtd_gap_reservado: 0 },
    ],
    negativas_excluidas: 0, negativas_unidades: 0,
  },
  { registros: [], colisoes_volume: 0 }, mapaFamilias, {},
  { arquivo_picking: 'p.txt', arquivo_pulmao: 'x.txt' }
);
eq(payloadStats.stats_picking.geral.enderecos_distintos, 2, '2 endereços distintos');
eq(payloadStats.stats_picking.geral.skus_distintos, 3, '3 SKUs distintos');
eq(payloadStats.stats_picking.geral.pecas, 40, '40 peças no total');
eq(payloadStats.stats_picking.geral.media_pecas_por_endereco, 20,
   'média é 40 peças / 2 endereços = 20 (e não 3 SKUs / 2 endereços = 1,5)');

/* -------------------------------------------------------------------------- */
secao('árvore — nível 2 é GRUPO (Vestuário/Calçados), não o segmento cru');
const mapaFamiliasGrupo = new Map([
  ['060', { marca: 'OLYMPIKUS', categoria: 'VESTUÁRIO OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
  ['068', { marca: 'OLYMPIKUS', categoria: 'MEIAS OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
  ['043', { marca: 'OLYMPIKUS', categoria: 'TÊNIS OLYMPIKUS', segmento: 'TÊNIS OLYMPIKUS' }],
  ['054', { marca: 'OLYMPIKUS', categoria: 'CHINELO OLYMPIKUS', segmento: 'CHINELO' }],
]);
const pickingGrupo = {
  registros: [
    { familia_codigo: '060', artigo_codigo: 'G1', cor: 'PT', tamanho: 'M', ean: 'G1', rua: '1', nivel: '1', box: '1', qtd: 10, qtd_gap_reservado: 0 },
    { familia_codigo: '068', artigo_codigo: 'G2', cor: 'PT', tamanho: 'U', ean: 'G2', rua: '1', nivel: '1', box: '2', qtd: 5, qtd_gap_reservado: 0 },
    { familia_codigo: '043', artigo_codigo: 'G3', cor: 'PT', tamanho: '40', ean: 'G3', rua: '1', nivel: '1', box: '3', qtd: 7, qtd_gap_reservado: 0 },
    { familia_codigo: '054', artigo_codigo: 'G4', cor: 'PT', tamanho: 'U', ean: 'G4', rua: '1', nivel: '1', box: '4', qtd: 3, qtd_gap_reservado: 0 },
  ],
  negativas_excluidas: 0, negativas_unidades: 0,
};
const payloadGrupo = construirSnapshotRessuprimento(
  pickingGrupo, { registros: [], colisoes_volume: 0 }, mapaFamiliasGrupo, {},
  { arquivo_picking: 'p.txt', arquivo_pulmao: 'x.txt' }
);
const marcaOly = payloadGrupo.arvore_picking.filter(function (m) { return m.codigo === 'OLYMPIKUS'; })[0];
const gruposOly = marcaOly.segmentos.map(function (s) { return s.codigo; }).sort();
eq(gruposOly.join(','), 'CALÇADOS,VESTUÁRIO', 'só 2 grupos no nível 2, nunca o segmento cru "TÊXTIL/ACESSÓRIOS ..."');
const grupoVest = marcaOly.segmentos.filter(function (s) { return s.codigo === 'VESTUÁRIO'; })[0];
eq(grupoVest.qtd, 15, 'grupo VESTUÁRIO soma vestuário(10) + meia(5)');
eq(grupoVest.familias.length, 2, 'grupo VESTUÁRIO tem as 2 famílias (vestuário e meia) por baixo');
const grupoCalc = marcaOly.segmentos.filter(function (s) { return s.codigo === 'CALÇADOS'; })[0];
eq(grupoCalc.qtd, 10, 'grupo CALÇADOS soma tênis(7) + chinelo(3)');
eq(grupoCalc.familias.length, 2, 'grupo CALÇADOS tem as 2 famílias (tênis e chinelo) por baixo');

/* -------------------------------------------------------------------------- */
secao('upsertArtigoFamilia — dicionário artigo→família pro Kardex resolver');
(async function () {
  const upserts = [];
  const supabaseFake = {
    from: function (tabela) {
      return {
        upsert: async function (linhas, opts) {
          upserts.push({ tabela: tabela, linhas: linhas, opts: opts });
          return { error: null };
        },
      };
    },
  };
  const avisos = [];
  const avisar = function (msg) { avisos.push(msg); };

  const pickingFake = { registros: [
    { artigo_codigo: 'A1', familia_codigo: '101' },
    { artigo_codigo: 'A2', familia_codigo: '102' },
    { artigo_codigo: 'A1', familia_codigo: '101' }, // repetido, não deve duplicar
  ] };
  const pulmaoFake = { registros: [
    { artigo_codigo: 'A3', familia_codigo: '103' },
    { artigo_codigo: 'A2', familia_codigo: '102' }, // já veio do picking, mesma família
  ] };

  await upsertArtigoFamilia(supabaseFake, pickingFake, pulmaoFake, avisar);

  eq(upserts.length, 1, 'faz 1 chamada de upsert (poucos artigos, cabe num lote só)');
  eq(upserts[0].tabela, 'dim_artigo_familia', 'upsert vai pra tabela certa');
  eq(upserts[0].opts.onConflict, 'artigo_codigo', 'upsert por artigo_codigo (não duplica, atualiza)');
  eq(upserts[0].linhas.length, 3, 'A1 repetido vira 1 linha só — dedup por artigo (3 artigos distintos)');
  const porArtigo = {};
  upserts[0].linhas.forEach(function (l) { porArtigo[l.artigo_codigo] = l.familia_codigo; });
  eq(porArtigo.A1, '101', 'A1 -> família 101');
  eq(porArtigo.A2, '102', 'A2 -> família 102');
  eq(porArtigo.A3, '103', 'A3 -> família 103');
  ok(avisos.some(function (a) { return /3.*artigos/.test(a); }), 'avisa quantos artigos foram atualizados');

  // Tabela ainda não existe (quem não rodou a migração) -- não pode travar o upload.
  const supabaseSemTabela = {
    from: function () { return { upsert: async function () { return { error: { message: 'relation "dim_artigo_familia" does not exist' } }; } }; },
  };
  const avisos2 = [];
  let jogouErro = false;
  try {
    await upsertArtigoFamilia(supabaseSemTabela, pickingFake, pulmaoFake, function (m) { avisos2.push(m); });
  } catch (e) { jogouErro = true; }
  ok(!jogouErro, 'tabela ausente vira aviso, não derruba o upload de Picking/Pulmão');
  ok(avisos2.some(function (a) { return /Aviso/.test(a); }), 'o aviso explica o que não funcionou');
})().then(function () {
  console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
});

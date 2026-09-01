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

console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

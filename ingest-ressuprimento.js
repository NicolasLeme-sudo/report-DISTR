/* ============================================================================
   REPORT DISTRIBUIDORA — ingest-ressuprimento.js
   ============================================================================
   RESPONSABILIDADE ÚNICA: ler os dois relatórios de saldo (Picking e Pulmão),
   cruzar/agregar e devolver o snapshot pronto pra tela — mesma regra do
   ingest.js (README seção 1): se é sobre COMO algo aparece, é do index.html;
   se é sobre COMO o número é calculado, é daqui. Nenhum document.*, nenhum
   innerHTML.

   Por que é um arquivo separado do ingest.js: são dois relatórios totalmente
   diferentes do sistema (colunas, granularidade, até layout de endereço),
   sem nada em comum com o parser de Balanço de Estoque — só reaproveitam
   numeroBR() e lerTudoPaginado(), que ingest.js expõe em window pra isso.

   ----------------------------------------------------------------------------
   OS DOIS RELATÓRIOS
   ----------------------------------------------------------------------------
   PICKING — uma linha por SKU+endereço (chave já única no arquivo real):
     CONCAT|Fam|Artigo|Descricao|Cor|Tam|EAN|endereco|qtde_disponivel|qtde_cativado|
   endereco = "rua,nivel,box" (ex: "20,01,027").

   PULMÃO — uma linha por VOLUME/PALLETE, não por SKU+endereço. O mesmo SKU no
   mesmo endereço aparece em várias linhas, uma por volume:
     ARMAZEM|SUB.ARMAZEM|RUA|NIVEL|BOX|ARTIGO|COR|TAMANHO|DESCRICAO|UN.MEDIDA|
     FAMILIA|EM LINHA|STOCK MINIMO|QTD.STOCK|PRECO MEDIO|VALOR STOCK|VOLUME|
     DT.CRI.|TS|QTD.VOLUME|CODBAR

   ⚠️ ARMADILHA JÁ CONFIRMADA COM O ARQUIVO REAL: QTD.STOCK é o total do LOTE,
   repetido em toda linha de volume daquele lote — somar essa coluna infla o
   total em ~7x (validado: 16.016.186 contra o correto 2.226.803). A coluna
   que soma certo é QTD.VOLUME (confirmado: soma de QTD.VOLUME bate com
   QTD.STOCK do lote em 37.533 dos 37.538 grupos rua+nível+box+SKU testados).
   NUNCA some QTD.STOCK. Ver testes-ingest-ressuprimento.js.
   ============================================================================ */

/* ============================================================================
   GABARITO DE RUAS DO PULMÃO — fornecido pela operação, não inventado aqui.
   Toda rua fora dessa lista vira 'NAO_MAPEADA': aparece na tela sinalizada,
   nunca some do total sem explicação (mesma regra de dim_familias no ingest.js).

   grupo 'PULMAO'     → estoque bom, pronto pra puxar pro picking.
   grupo 'VALIDACAO'  → ainda é vendável (decisão da operação), mas precisa de
                        sinalização de FIFO: sujeira de movimentação passada,
                        material em trânsito, ou faixa "antiga" do processo.
                        Conta no total de Pulmão, mas NÃO conta como apoio
                        confiável no cruzamento de ressuprimento (função
                        pulmaoApoioPorEan abaixo).

   Prédio físico do Pulmão vai só até a rua 15 (confirmado pela operação,
   23/09/2026) — dali pra cima é rua sistêmica (trânsito, validação, chão),
   nunca porta-pallet de verdade. Por isso não entram aqui: já caem em
   'NAO_MAPEADA' ou em algum grupo explícito acima, e nenhum dos dois grupos
   conta na capacidade do Pulmão (só 'PULMAO' conta — ver pulmaoFisico).
   ============================================================================ */
const RUAS_PULMAO_BOAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '11', '12', '13', '14', '15'];
const CLASSIF_RUA_PULMAO = {};
RUAS_PULMAO_BOAS.forEach(function (r) { CLASSIF_RUA_PULMAO[r] = { grupo: 'PULMAO', rotulo: 'Pulmão' }; });
Object.assign(CLASSIF_RUA_PULMAO, {
  '10':  { grupo: 'VALIDACAO', rotulo: 'Erro de Movimentação' }, // nome da operação (23/09/2026); 09/09/2026: 136 end. / 24.584 pç de acessório que não é estoque de verdade, fora da capacidade de Acessório mas no total de Pulmão.
  '21':  { grupo: 'VALIDACAO', rotulo: 'Transitório - Ressuprimento (Antigo)' },
  '24':  { grupo: 'VALIDACAO', rotulo: 'Sujeira' },
  '26':  { grupo: 'VALIDACAO', rotulo: 'Sujeira' },
  '27':  { grupo: 'VALIDACAO', rotulo: 'Perca' },
  '98':  { grupo: 'VALIDACAO', rotulo: 'Transitório - Armazenagem/Ressuprimento' },
  // Rua 99 (23/09/2026, pedido do usuário): endereço transitório, entra no
  // card de material parado. Antes caía em "fora do gabarito".
  '99':  { grupo: 'VALIDACAO', rotulo: 'Endereço de retorno de saldo' },
  // Rua 100 (23/09/2026, operação): material do RECEBIMENTO armazenado no
  // chão, endereços criados porque faltou espaço no Pulmão. É estoque bom
  // (conta como apoio confiável), mas provisório — por isso aparece no card
  // de material parado pra acompanhamento (ver em_validacao logo abaixo,
  // em classificarPickingEPulmao), e não entra na capacidade do Pulmão por
  // não ser porta-pallet de verdade.
  '100': { grupo: 'ARMAZENAGEM_CHAO', rotulo: 'Recebimento armazenado no chão (provisório)' },
  '500': { grupo: 'VALIDACAO', rotulo: 'Baixar Ressuprimento' },
  '600': { grupo: 'VALIDACAO', rotulo: 'Subir Ressuprimento' },
});
function classificarRuaPulmao(rua) {
  return CLASSIF_RUA_PULMAO[rua] || { grupo: 'NAO_MAPEADA', rotulo: 'Rua ' + rua + ' (fora do gabarito)' };
}

/* ============================================================================
   RECLASSIFICAÇÃO: endereços que vivem DENTRO do arquivo de Picking mas são,
   fisicamente, Pulmão — confirmado com a operação, motivo por motivo. O
   `apoioConfiavel` decide se esse estoque pode ser oferecido como reposição
   pronta no cruzamento de ressuprimento: rua 20 e 81-nível-02 são estoque BOM
   que só não coube/não podia ficar no picking; ruas 70 e 80 são sujeira de
   sistema ("material não localizado") — ainda contam no total físico de
   Pulmão (decisão da operação), mas não são material confiável pra puxar.
   ============================================================================ */
const RECLASSIFICA_PICKING_PARA_PULMAO = {
  // 70/80 (corrigido pela operação, 23/09/2026): endereço de Picking que fica
  // DENTRO do Pulmão — item que não coube 100% no picking e foi alocado lá.
  // Estoque bom, não é pendência.
  '70': { motivo: 'Excedente do picking Mizuno alocado no Pulmão', apoioConfiavel: true },
  '80': { motivo: 'Excedente do picking Under Armour alocado no Pulmão', apoioConfiavel: true },
  // Rua 99 no arquivo de Picking também é transitório (23/09/2026): sai do
  // Picking e vai pro card de material parado, igual à 99 do Pulmão.
  '99': { motivo: 'Endereço de retorno de saldo', apoioConfiavel: false },
  // rua 81 é tratada à parte (abaixo): só o nível 02 reclassifica.
};
const MOTIVO_81_02 = 'Capacidade de calçados Under Armour esgotada no picking';

/* Ruas de cada segmento — planilha "Métricas e capacidade estoque - DISTR"
   da operação (24/09/2026), a mesma que deu os números de dim_capacidade_zonas:
     Picking: vestuário 1–6 (14.630), calçado 7–8 (4.352), acessório 11–13
              (1.598), meia 14–15 (408).
     Pulmão:  meia 1 e 15 (848), vestuário 2, 6 e 7 (2.136), calçado 3–5
              (2.131), acessório 11–14 (952). Rua 8 do Pulmão = insumos,
              fora da capacidade (confirmado pelo usuário). */
const RUAS_ZONA = {
  // 81 (nível 1, tênis UA) e 102 (tênis/chuteira Mizuno, níveis 1–4) não
  // estão na planilha, mas no arquivo real são picking de calçado — entram na
  // zona de calçado até a operação confirmar (24/09/2026).
  picking: { vestuario: ['1', '2', '3', '4', '5', '6'], calcado: ['7', '8', '81', '102'], acessorio: ['11', '12', '13'], meia: ['14', '15'] },
  pulmao: { meia: ['1', '15'], vestuario: ['2', '6', '7'], calcado: ['3', '4', '5'], acessorio: ['11', '12', '13', '14'] },
};
const BUCKETS_ZONA = ['meia', 'vestuario', 'acessorio', 'calcado'];

/* Ruas que NÃO são estoque e saem de tudo já na leitura (Picking e Pulmão):
   rua 20 = CROSSDOCKING, operação do recebimento sem estoque físico
   (confirmado pelo usuário, 24/09/2026 — antes era tratada como "camisas de
   time Mizuno" reclassificadas pro Pulmão). Não entra em ocupação, árvore,
   composição, endereços vazios nem saldo por endereço; a contagem do que foi
   descartado fica em payload.ruas_desconsideradas. */
const RUAS_DESCONSIDERADAS = { '20': 'Crossdocking (recebimento, sem estoque físico)' };
function novoContadorDesconsiderado() { return { linhas: 0, qtd: 0 }; }
// Mesma regra na entrada da agregação (defensivo: quem chama sem passar
// pelos parsers — testes, recálculo — também não vê a rua 20).
function semRuasDesconsideradas(parse) {
  if (!parse || !parse.registros) return parse;
  return Object.assign({}, parse, {
    registros: parse.registros.filter(function (r) { return !RUAS_DESCONSIDERADAS[String(r.rua)]; }),
  });
}

/* ============================================================================
   BUCKET Meia / Vestuário / Calçado — usado só pros cards de ocupação do
   Picking (a tela pede "Picking meia/vestuário/calçado" separados). Deriva do
   segmento/categoria de dim_familias, mesmo gabarito do Balanço de Estoque.
   'outros' é sinalizado de propósito: com o gabarito de hoje nenhuma família
   das que aparecem em Picking/Pulmão deveria cair aqui — se cair, é família
   nova que a operação ainda não classificou nesse eixo, não silenciar.
   ============================================================================ */
function classificarBucket(segmento, categoria) {
  const s = String(segmento || '').toUpperCase();
  const c = String(categoria || '').toUpperCase();
  if (s.indexOf('MEIA') !== -1 || c.indexOf('MEIA') !== -1) return 'meia';
  if (s.indexOf('TENIS') !== -1 || s.indexOf('TÊNIS') !== -1 ||
      c.indexOf('CHUTEIRA') !== -1 || c.indexOf('CHINELO') !== -1 || c.indexOf('TAMANCO') !== -1 ||
      c.indexOf('SAPATO') !== -1) return 'calcado';
  // ACESS precisa ser conferido ANTES do TÊXTIL genérico: o campo `segmento`
  // de vestuário e de acessório é o MESMO texto ("TÊXTIL/ACESSÓRIOS <marca>"
  // — vem de dim_familias), só a categoria distingue os dois. Checar TÊXTIL
  // primeiro faria todo acessório cair em vestuário (pedido da gestão,
  // 06/09/2026: acessório ganha cartão de ocupação próprio, não soma mais
  // dentro de vestuário).
  if (c.indexOf('ACESS') !== -1) return 'acessorio';
  if (s.indexOf('TEXTIL') !== -1 || s.indexOf('TÊXTIL') !== -1 || c.indexOf('VESTU') !== -1) return 'vestuario';
  return 'outros';
}

/* ============================================================================
   SEGMENTO MACRO — os 6 segmentos que a gestão usa, cruzando TODAS as marcas
   ============================================================================
   Nem `segmento` nem `categoria` de dim_familias servem direto: os dois trazem
   a marca embutida no texto ("TÊNIS MIZUNO", "TÊXTIL/ACESSÓRIOS OLYMPIKUS"),
   porque é assim que a operação organiza a FAMÍLIA. A gestão pediu a visão de
   negócio, que é marca-agnóstica e tem 6 baldes fixos (02/09/2026):

     CALÇADO · CHINELO · CHUTEIRA · VESTUÁRIO · MEIA · ACESSÓRIO

   A classificação sai da `categoria` (é ela que tem a granularidade certa:
   "MEIAS MIZUNO" e "VESTUÁRIO MIZUNO" caem no mesmo `segmento`
   "TÊXTIL/ACESSÓRIOS MIZUNO", então segmento sozinho não separaria meia de
   vestuário). A ORDEM das regras importa:

     - CHUTEIRA e CHINELO vêm ANTES de CALÇADO: os dois são calçado no sentido
       amplo, mas a gestão quer chip próprio pra cada um.
     - VESTUÁRIO vem antes de CALÇADO por causa de "BOTAFOGO MIZUNO", que
       casaria com /BOTA/ da regra de calçado — é camisa de time, não bota.

   'OUTROS' é sinalizado de propósito, nunca silencioso: hoje só deveriam cair
   ali insumos operacionais (embalagem, químico, MIP) e semi-acabado. Família
   de produto caindo em OUTROS é família nova que a operação ainda não
   classificou nesse eixo — a tela mostra, não esconde.
   ============================================================================ */
const SEGMENTOS_MACRO = ['CALÇADO', 'CHINELO', 'CHUTEIRA', 'VESTUÁRIO', 'MEIA', 'ACESSÓRIO'];

function segmentoMacro(segmento, categoria) {
  // Usa a CATEGORIA sozinha, nunca categoria + segmento concatenados: o
  // segmento de uma família de vestuário é "TÊXTIL/ACESSÓRIOS <marca>", então
  // concatenar faria "VESTUÁRIO MIZUNO" casar com /ACESS/ e o segmento
  // VESTUÁRIO inteiro sumiria dentro de ACESSÓRIO. O segmento só entra como
  // rede de segurança quando a família não tem categoria cadastrada.
  const base = String(categoria || '').trim() || String(segmento || '');
  const t = base.toUpperCase();
  if (/CHUTEIRA/.test(t)) return 'CHUTEIRA';
  if (/CHINELO|OPANKA/.test(t)) return 'CHINELO';
  if (/MEIA/.test(t)) return 'MEIA';
  if (/ACESS/.test(t)) return 'ACESSÓRIO';
  if (/VESTU|BOTAFOGO|FUTEBOL|CAMISA/.test(t)) return 'VESTUÁRIO';
  if (/TENIS|TÊNIS|SAPATO|TAMANCO|BOTA|CALCAD|CALÇAD/.test(t)) return 'CALÇADO';
  return 'OUTROS';
}

/* ============================================================================
   GRUPO DO DETALHAMENTO — o nível do meio da árvore Marca › Grupo › Família
   ============================================================================
   Pedido da gestão (03/09/2026): o nível 2 da árvore não deve mostrar o texto
   cru do `segmento` ("TÊXTIL/ACESSÓRIOS MIZUNO" — verboso e ainda carrega a
   marca, redundante com o nível 1). Vira grupos, cada um somando alguns dos 6
   segmentos macro: VESTUÁRIO reúne vestuário/meia/acessório, CALÇADOS reúne
   calçado/chuteira. A família continua mostrando o segmento_macro fino (MEIA,
   ACESSÓRIO etc.) no selo — o grupo aqui é só uma dobra a mais pra navegação,
   não substitui a granularidade que já existe embaixo.

   CHINELO ganhou grupo próprio em vez de ficar dentro de CALÇADOS (06/09/2026
   — a operação achou estranho não achar chinelo em lugar nenhum do
   detalhamento; o item sempre existiu como segmento_macro à parte, só ficava
   escondido dentro do rótulo "Calçados" nesta dobra do meio da árvore). */
function grupoDetalhamento(segMacro) {
  if (segMacro === 'VESTUÁRIO' || segMacro === 'MEIA' || segMacro === 'ACESSÓRIO') return 'VESTUÁRIO';
  if (segMacro === 'CHINELO') return 'CHINELO';
  if (segMacro === 'CALÇADO' || segMacro === 'CHUTEIRA') return 'CALÇADOS';
  return 'OUTROS';
}

/* ----------------------------------------------------------------------------
   DATA "DD-MM-AA" do relatório (DT.CRI. do Pulmão) → Date em UTC.
   Usado só pra achar "o item mais antigo" dentro de um grupo — não entra em
   nenhuma soma, então um parse que falha e devolve null é seguro: o grupo só
   fica sem data em vez de quebrar a página.
   ---------------------------------------------------------------------------- */
function parsearDataDDMMAA(s) {
  const m = String(s || '').trim().match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]) - 1, ano = 2000 + Number(m[3]);
  return new Date(Date.UTC(ano, mes, dia));
}

function chaveSku(artigo, cor, tamanho) {
  return artigo + '' + cor + '' + tamanho;
}

/* ============================================================================
   PARSE DO PICKING
   ============================================================================ */
function parsearPicking(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const registros = [];
  let comecouDados = false;
  let negativasExcluidas = 0;
  let negativasUnidades = 0;
  const desconsiderado = novoContadorDesconsiderado();

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    // A linha de cabeçalho de colunas começa com "CONCAT|" — tudo antes dela
    // é metadado do relatório (filtro aplicado, nome do arquivo), que não
    // interessa pro dado.
    if (!comecouDados) {
      if (/^CONCAT\s*\|/i.test(linha)) comecouDados = true;
      continue;
    }

    const p = linha.split('|');
    if (p.length < 10) continue; // linha de rodapé/lixo, mesmo padrão do ingest.js

    const enderecoBruto = (p[7] || '').trim();
    const partes = enderecoBruto.split(',').map(function (s) { return s.trim(); });
    if (partes.length !== 3) continue; // sem endereço reconhecível — não dá pra classificar zona

    const rua = String(parseInt(partes[0], 10));
    const nivel = String(parseInt(partes[1], 10));
    const box = partes[2];

    if (RUAS_DESCONSIDERADAS[rua]) {
      desconsiderado.linhas++;
      desconsiderado.qtd += Math.max(0, window.numeroBR(p[8])) + Math.max(0, window.numeroBR(p[9]));
      continue;
    }

    let qtd = window.numeroBR(p[8]);
    // GAP CONHECIDO (confirmado com a operação em 01/09/2026): negativo aqui
    // é uma MISTURA de duas coisas que hoje não dá pra distinguir só com este
    // arquivo — item reservado pra separação/B.O. de remanejamento (ainda vai
    // sair) e item já FATURADO no fechamento de mês, cuja cativação sumiu mas
    // a pendência ainda aparece na tela. Sem saber qual é qual, a operação
    // decidiu NÃO contar como saldo disponível (nem positivo nem negativo) —
    // zera pra fins de "quanto tem pra vender/repor", mas guarda o valor
    // absoluto em `qtd_gap_reservado` pra não desaparecer silenciosamente.
    // TODO(gap): quando existir uma forma de separar B.O. de faturamento
    // sumido (outro relatório? campo adicional?), tratar cada caso do jeito
    // certo em vez de zerar os dois.
    let qtdGapReservado = 0;
    if (qtd < 0) { qtdGapReservado = Math.abs(qtd); qtd = 0; negativasExcluidas++; negativasUnidades += qtdGapReservado; }

    // qtde_cativado (10ª coluna do relatório) — material físico já reservado
    // pelo comercial pra garantir o saldo de uma venda, com ou sem PFA gerada
    // ainda (confirmado com o usuário, 05/09/2026). É saldo REAL, só não está
    // "livre" — por isso entra na soma de saldo_picking por segmento (mesmo
    // gabarito da planilha de análise da gestão: "Soma de Qtde cativada e no
    // estoque"), mas fica em campo separado pra nunca esconder a diferença
    // entre "disponível" e "cativado".
    let qtdCativado = window.numeroBR(p[9]);
    // Cativado negativo tem o mesmo problema do disponível negativo: somado,
    // podia zerar um endereço que tem material e fazê-lo contar como vazio.
    // Mesmo tratamento: zera e guarda no gap (24/09/2026).
    if (qtdCativado < 0) {
      if (qtdGapReservado === 0) negativasExcluidas++; // linha ainda não contada pelo disponível
      qtdGapReservado += Math.abs(qtdCativado);
      negativasUnidades += Math.abs(qtdCativado);
      qtdCativado = 0;
    }

    registros.push({
      familia_codigo: window.familiaCanonica(p[1]),
      artigo_codigo: (p[2] || '').trim(),
      descricao: (p[3] || '').trim(),
      cor: (p[4] || '').trim(),
      tamanho: (p[5] || '').trim(),
      ean: (p[6] || '').trim(),
      rua: rua, nivel: nivel, box: box,
      qtd: qtd,
      qtd_cativado: qtdCativado,
      qtd_gap_reservado: qtdGapReservado,
    });
  }

  return { registros: registros, negativas_excluidas: negativasExcluidas, negativas_unidades: negativasUnidades, desconsiderado: desconsiderado };
}

/* ============================================================================
   PARSE DO PULMÃO
   ============================================================================
   Uma linha por volume: devolve UM registro por linha, com qtd = QTD.VOLUME
   (a coluna certa de somar). Dedup pelo id de VOLUME evita contar duas vezes
   se o relatório repetir uma linha por engano — defensivo, não esperado.
   ============================================================================ */
function parsearPulmao(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const registros = [];
  const volumesVistos = new Set();
  let comecouDados = false;
  let colisoesVolume = 0;
  const desconsiderado = novoContadorDesconsiderado();

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    if (!comecouDados) {
      if (/^ARMAZEM\s*\|/i.test(linha)) comecouDados = true;
      continue;
    }

    const p = linha.split('|');
    if (p.length < 21) continue;

    const volumeId = (p[16] || '').trim();
    if (volumeId && volumesVistos.has(volumeId)) { colisoesVolume++; continue; }
    if (volumeId) volumesVistos.add(volumeId);

    const rua = String(parseInt(p[2], 10));
    const nivel = String(parseInt(p[3], 10));
    const box = (p[4] || '').trim();
    if (RUAS_DESCONSIDERADAS[rua]) {
      desconsiderado.linhas++;
      desconsiderado.qtd += Math.max(0, window.numeroBR(p[19]));
      continue;
    }

    registros.push({
      familia_codigo: window.familiaCanonica(p[10]),
      artigo_codigo: (p[5] || '').trim(),
      cor: (p[6] || '').trim(),
      tamanho: (p[7] || '').trim(),
      descricao: (p[8] || '').trim(),
      unidade: (p[9] || '').trim(),
      em_linha: (p[11] || '').trim().toUpperCase() === 'S',
      rua: rua, nivel: nivel, box: box,
      volume: volumeId,
      dt_cri: parsearDataDDMMAA(p[17]),
      qtd: window.numeroBR(p[19]), // QTD.VOLUME — nunca QTD.STOCK (col. 13), ver cabeçalho do arquivo
      codbar: (p[20] || '').trim(),
    });
  }

  return { registros: registros, colisoes_volume: colisoesVolume, desconsiderado: desconsiderado };
}

/* ============================================================================
   AGREGAÇÃO
   ============================================================================
   Recebe os dois parses + o gabarito de família (mesmo dim_familias do
   Balanço de Estoque) e devolve o payload pronto pra tela: zonas de
   ocupação, árvore Marca›Segmento por filtro (Picking/Pulmão), lista de
   material em validação (FIFO) e o cruzamento de ressuprimento por segmento.

   capacidadesManual: { picking_meia, picking_vestuario, picking_acessorio,
   picking_calcado, pulmao_meia, pulmao_vestuario, pulmao_acessorio,
   pulmao_calcado } — vem de dim_capacidade_zonas (editável pela gestão), uma
   chave por zona de bucket das 2 linhas (Picking e Pulmão). Zona sem valor
   manual usa ocupado × 1.2 (decisão da operação, provisório até a capacidade
   real ser levantada).
   ============================================================================ */
/* ============================================================================
   CLASSIFICAÇÃO — separa Picking "de verdade" do que é Pulmão-dentro-do-
   picking, e enriquece os dois com marca/segmento/bucket. Extraída como
   função própria (10/09/2026): além de alimentar construirSnapshotRessuprimento,
   é a mesma base que alimenta construirSaldoEnderecos (saldo por endereço,
   persistido pra dar suporte ao relatório de gap de estoque das perdas de
   PFA) — mesma regra de classificação nos dois lugares, sem duplicar.
   ============================================================================ */
function classificarPickingEPulmao(picking, pulmao, mapaFamilias) {
  picking = semRuasDesconsideradas(picking);
  pulmao = semRuasDesconsideradas(pulmao);
  const familiasNaoMapeadas = new Set();

  function infoFamilia(codigo) {
    const f = mapaFamilias.get(codigo);
    if (!f) { familiasNaoMapeadas.add(codigo); return { marca: 'NAO MAPEADA', segmento: '—', categoria: '—' }; }
    return f;
  }

  /* ---------- Picking: separa o que é picking de verdade do que é Pulmão-dentro-do-picking ---------- */
  const pickingReal = [];      // vira ocupação/árvore de Picking e cruzamento
  const pulmaoViaPicking = []; // some pro lado do Pulmão (posição física + total)

  picking.registros.forEach(function (r) {
    const fam = infoFamilia(r.familia_codigo);
    const enriquecido = Object.assign({}, r, {
      marca: fam.marca, segmento: fam.segmento, categoria: fam.categoria,
      segmento_macro: segmentoMacro(fam.segmento, fam.categoria),
    });

    let reclass = RECLASSIFICA_PICKING_PARA_PULMAO[r.rua];
    if (r.rua === '81' && r.nivel === '2') reclass = { motivo: MOTIVO_81_02, apoioConfiavel: true };

    if (reclass) {
      pulmaoViaPicking.push(Object.assign({}, enriquecido, {
        origem: 'picking_reclassificado', motivo: reclass.motivo, apoio_confiavel: reclass.apoioConfiavel,
      }));
    } else {
      enriquecido.bucket = classificarBucket(fam.segmento, fam.categoria);
      pickingReal.push(enriquecido);
    }
  });

  /* ---------- Pulmão: junta o real com o que veio reclassificado do picking ---------- */
  const pulmaoTudo = pulmao.registros.map(function (r) {
    const fam = infoFamilia(r.familia_codigo);
    const classif = classificarRuaPulmao(r.rua);
    return Object.assign({}, r, {
      marca: fam.marca, segmento: fam.segmento, categoria: fam.categoria,
      segmento_macro: segmentoMacro(fam.segmento, fam.categoria),
      bucket: classificarBucket(fam.segmento, fam.categoria),
      origem: 'pulmao', motivo: null,
      apoio_confiavel: classif.grupo === 'PULMAO' || classif.grupo === 'ARMAZENAGEM_CHAO',
      // ARMAZENAGEM_CHAO (rua 100) voltou a aparecer no card de material
      // parado pra acompanhamento (pedido do usuário, 23/09/2026: é
      // provisório, "só está sendo utilizado por agora") — mas continua
      // fora da capacidade do Pulmão (pulmaoFisico) e conta como apoio
      // confiável, porque é estoque real, só não é porta-pallet.
      em_validacao: classif.grupo !== 'PULMAO',
      classif_grupo: classif.grupo, classif_rotulo: classif.rotulo,
    });
  }).concat(pulmaoViaPicking.map(function (r) {
    return Object.assign({}, r, {
      em_validacao: !r.apoio_confiavel, // rua 99 (transitório) entra em validação; 20/70/80/81-02 não
      classif_grupo: r.apoio_confiavel ? 'PULMAO' : 'VALIDACAO',
      classif_rotulo: r.motivo,
    });
  }));

  return { pickingReal: pickingReal, pulmaoTudo: pulmaoTudo, familias_nao_mapeadas: familiasNaoMapeadas };
}

/* ============================================================================
   SALDO POR ENDEREÇO — persistido em ressuprimento_saldo_enderecos
   ------------------------------------------------------------------------
   Pedido do usuário (10/09/2026): poder exportar, pra qualquer artigo que
   gerou perda numa PFA (AJUSTE/B.O. pós-NF), onde esse material AINDA TEM
   saldo físico no armazém — pra validar e corrigir o estoque. O upload de
   Ressuprimento é o único lugar que enxerga o endereço físico (Balanço de
   Estoque só soma por família/armazém); o resto do relatório nunca precisou
   descer a esse nível de detalhe, só este relatório de gap precisa.

   Guiado SEMPRE pelo ÚLTIMO upload (pedido explícito do usuário): a tabela é
   substituída inteira a cada Picking/Pulmão processado, nunca acumula
   histórico — processarRessuprimento apaga tudo e grava de novo.

   PICKING: já é uma linha por SKU+endereço — qtd = disponível + cativado
   (mesmo gabarito de "peças ocupadas" usado no resto do arquivo: material
   cativado é saldo real, só não está livre).
   PULMÃO: uma linha por VOLUME — soma tudo (real + reclassificado do
   Picking) por SKU+endereço antes de gravar, senão o mesmo endereço apareceria
   repetido uma vez por volume/pallete.
   classificacao é só PICKING/PULMAO (pedido do usuário) — a subdivisão fina
   de Pulmão (validação/trânsito) não importa pra "onde tem saldo físico".
   ============================================================================ */
function construirSaldoEnderecos(pickingReal, pulmaoTudo) {
  const saldos = [];

  pickingReal.forEach(function (r) {
    const qtd = (r.qtd || 0) + (r.qtd_cativado || 0);
    if (qtd <= 0) return; // endereço alocado sem saldo não ajuda a achar material físico
    saldos.push({
      artigo_codigo: r.artigo_codigo, cor: r.cor, tamanho: r.tamanho, familia_codigo: r.familia_codigo,
      rua: r.rua, nivel: r.nivel, box: r.box, classificacao: 'PICKING', qtd: qtd,
    });
  });

  const porEnderecoPulmao = new Map();
  pulmaoTudo.forEach(function (r) {
    if (!(r.qtd > 0)) return;
    const chave = [r.artigo_codigo, r.cor, r.tamanho, r.rua, r.nivel, r.box].join('|');
    if (!porEnderecoPulmao.has(chave)) {
      porEnderecoPulmao.set(chave, {
        artigo_codigo: r.artigo_codigo, cor: r.cor, tamanho: r.tamanho, familia_codigo: r.familia_codigo,
        rua: r.rua, nivel: r.nivel, box: r.box, classificacao: 'PULMAO', qtd: 0,
      });
    }
    porEnderecoPulmao.get(chave).qtd += r.qtd;
  });

  return saldos.concat(Array.from(porEnderecoPulmao.values()));
}

function construirSnapshotRessuprimento(picking, pulmao, mapaFamilias, capacidadesManual, meta, capacidadesItensManual) {
  picking = semRuasDesconsideradas(picking);
  pulmao = semRuasDesconsideradas(pulmao);
  const cap = capacidadesManual || {};
  const capItens = capacidadesItensManual || {};
  const classif = classificarPickingEPulmao(picking, pulmao, mapaFamilias);
  const pickingReal = classif.pickingReal;
  const pulmaoTudo = classif.pulmaoTudo;
  const familiasNaoMapeadas = classif.familias_nao_mapeadas;

  /* ---------- posições ocupadas = endereços ALOCADOS, não "com saldo" ----------
     Um endereço de Picking com o SKU endereçado e saldo zero continua OCUPADO:
     a posição está reservada pra aquele SKU, ela só está vazia — e é
     exatamente essa a posição que precisa de ressuprimento. Contar só quem tem
     saldo > 0 dizia que o armazém estava mais vazio do que está.

     Confirmado contra a planilha de Ocupação da gestão (02/09/2026): pelo
     critério de alocação, o Picking de meia bate EXATO (361 endereços dos dois
     lados); pelo critério de saldo dava 240. Ver testes-ingest-ressuprimento.js. */
  function posicoesOcupadas(lista) {
    const enderecos = new Set();
    lista.forEach(function (r) {
      enderecos.add(r.rua + '|' + r.nivel + '|' + r.box);
    });
    return enderecos.size;
  }
  /* Peças = qtd disponível + cativado, o mesmo gabarito de `saldo_picking`
     mais abaixo (Pulmão não tem cativado, soma só `qtd`). É uma régua
     DIFERENTE de propósito da de endereço, não um jeito alternativo de medir
     a mesma coisa: uma posição alocada com saldo zero conta 100% no
     endereço e 0 aqui — as duas visões (pedidas pela operação, 09/09/2026)
     vão divergir por isso, e é esperado. */
  function pecasOcupadas(lista) {
    return lista.reduce(function (s, r) { return s + (r.qtd || 0) + (r.qtd_cativado || 0); }, 0);
  }
  function fazZona(capMap, nome, ocupado) {
    const capacidade = capMap[nome] || Math.round(ocupado * 1.2);
    return {
      capacidade: capacidade, ocupado: ocupado,
      pct: capacidade > 0 ? (ocupado / capacidade) * 100 : 0,
      disponivel: Math.max(0, capacidade - ocupado),
      capacidade_estimada: !capMap[nome], // true = ainda é ocupado×1.2, não o número real da gestão
    };
  }
  // Mantido por compatibilidade com o resto da função (que só mede endereço).
  function zona(nome, ocupado) { return fazZona(cap, nome, ocupado); }
  /* OCUPAÇÃO: as ruas 20/70/80/81-02 contam como Pulmão no CRUZAMENTO de apoio
     (confirmado pela operação, 03/09/2026 — não são posição de picking), mas
     NÃO entram na contagem de posições de nenhuma das duas zonas. Não são
     porta-pallet fixo do Pulmão nem prateleira dedicada do Picking: são
     endereço de apoio, com uma característica que quebra a definição de
     "posição ocupada = endereço alocado" usada nas outras zonas — têm 2.662
     endereços ALOCADOS no arquivo real contra só 339 com saldo de verdade (a
     maioria é cadastro de SKU sem estoque ali). Contá-las por alocação infla o
     Pulmão pra 156% da capacidade; a gestão não as inclui nos 5.010 lugares do
     Pulmão nem nos 3.933 do Picking-calçado. Por isso a ocupação usa só o
     Pulmão físico (`pulmao.registros`, sem o reclassificado do Picking) e o
     Picking de verdade (`pickingReal`, que já exclui o reclassificado).

     Do mesmo jeito, as ruas de TRÂNSITO/VALIDAÇÃO dentro do próprio arquivo
     de Pulmão (21/24/26/27/98/100/500/600 — corredor de baixa/subida de
     ressuprimento, sujeira, perca) não são porta-pallet fixo: são passagem.
     Confirmado com a operação (05/09/2026) que elas não devem contar na
     capacidade do Pulmão — ficam de fora daqui e viram o card
     "Ressuprimento pendente em trânsito" (transito_pulmao), pra mostrar o
     B.O. sem misturar com a ocupação física real. */
  const pulmaoFisico = pulmaoTudo.filter(function (r) { return r.origem === 'pulmao' && r.classif_grupo === 'PULMAO'; });

  /* Ocupação vira 2 LINHAS (Picking e Pulmão), cada uma com as mesmas 4 zonas
     de bucket (Meia/Vestuário/Acessório/Calçado) + um Total que soma as 4
     (pedido da gestão, 06/09/2026 — antes só Picking tinha zona por bucket;
     Pulmão era um bloco só, sem segmentar). ACESSÓRIO é zona nova dos dois
     lados: até aqui vinha somado dentro de Vestuário (ver classificarBucket).

     IMPORTANTE: como isso divide zonas que antes eram uma só, os números de
     capacidade cadastrados em dim_capacidade_zonas pra 'pulmao' (5.010, uma
     zona só) e pra 'picking_vestuario' (12.980, que embutia acessório) NÃO
     valem mais pras zonas novas — ficam como capacidade_estimada=true
     (ocupado×1.2) até a gestão levantar o número real de cada bucket. */
  function zonaBucket(prefixo, bucket, lista) {
    return zona(prefixo + '_' + bucket, posicoesOcupadas(lista.filter(function (r) { return r.bucket === bucket; })));
  }
  function fazZonaBucket(capMap, medir, prefixo, bucket, lista) {
    return fazZona(capMap, prefixo + '_' + bucket, medir(lista.filter(function (r) { return r.bucket === bucket; })));
  }
  /* Ocupação POR RUA DA ZONA (24/09/2026, pedido do usuário — a régua antiga
     contava endereço com produto do segmento em QUALQUER rua e comparava com
     a capacidade da zona, o que dava 115% num segmento e "livres" em outro
     sem nenhum endereço vazio de verdade). Agora:
       capacidade = endereços das ruas do segmento (planilha de capacidade);
       ocupado    = endereços DESSAS ruas com qualquer produto;
       livre      = capacidade − ocupado (vazio de verdade).
     O detalhe (tooltip na tela) mostra o que está guardado fora do lugar:
     produto de outro segmento dentro da zona e produto do segmento fora dela.
     Rua fora de todas as zonas (Pulmão 8 = insumos, 9) não conta em nada. */
  function fazZonaRua(capMap, medir, linha, bucket, lista) {
    const ruas = RUAS_ZONA[linha][bucket];
    const naZona = lista.filter(function (r) { return ruas.indexOf(String(r.rua)) !== -1; });
    const z = fazZona(capMap, linha + '_' + bucket, medir(naZona));
    const outros = {};
    BUCKETS_ZONA.forEach(function (b) {
      if (b === bucket) return;
      const n = medir(naZona.filter(function (r) { return r.bucket === b; }));
      if (n > 0) outros[b] = n;
    });
    const foraPorRua = {};
    const doSegmentoFora = lista.filter(function (r) { return r.bucket === bucket && ruas.indexOf(String(r.rua)) === -1; });
    const ruasFora = Array.from(new Set(doSegmentoFora.map(function (r) { return String(r.rua); })));
    ruasFora.forEach(function (rua) {
      const n = medir(doSegmentoFora.filter(function (r) { return String(r.rua) === rua; }));
      if (n > 0) foraPorRua[rua] = n;
    });
    z.detalhe = {
      ruas: ruas,
      do_segmento: medir(naZona.filter(function (r) { return r.bucket === bucket; })),
      outros_segmentos: outros,
      fora_da_zona: medir(doSegmentoFora),
      fora_por_rua: foraPorRua,
    };
    return z;
  }
  function fazZonaTotal(subzonas) {
    const capacidade = subzonas.reduce(function (s, z) { return s + z.capacidade; }, 0);
    const ocupado = subzonas.reduce(function (s, z) { return s + z.ocupado; }, 0);
    return {
      capacidade: capacidade, ocupado: ocupado,
      pct: capacidade > 0 ? (ocupado / capacidade) * 100 : 0,
      disponivel: Math.max(0, capacidade - ocupado),
      capacidade_estimada: subzonas.some(function (z) { return z.capacidade_estimada; }),
    };
  }
  // Monta as 2 linhas (Picking/Pulmão) × 5 zonas (4 buckets + total) pra um
  // critério de medição só — chamada uma vez pra endereço, outra pra peça,
  // sem duplicar a árvore.
  function montarOcupacao(capMap, medir) {
    const pB = {
      meia: fazZonaRua(capMap, medir, 'picking', 'meia', pickingReal),
      vestuario: fazZonaRua(capMap, medir, 'picking', 'vestuario', pickingReal),
      acessorio: fazZonaRua(capMap, medir, 'picking', 'acessorio', pickingReal),
      calcado: fazZonaRua(capMap, medir, 'picking', 'calcado', pickingReal),
    };
    const uB = {
      meia: fazZonaRua(capMap, medir, 'pulmao', 'meia', pulmaoFisico),
      vestuario: fazZonaRua(capMap, medir, 'pulmao', 'vestuario', pulmaoFisico),
      acessorio: fazZonaRua(capMap, medir, 'pulmao', 'acessorio', pulmaoFisico),
      calcado: fazZonaRua(capMap, medir, 'pulmao', 'calcado', pulmaoFisico),
    };
    return {
      picking: Object.assign({ total: fazZonaTotal([pB.meia, pB.vestuario, pB.acessorio, pB.calcado]) }, pB),
      pulmao: Object.assign({ total: fazZonaTotal([uB.meia, uB.vestuario, uB.acessorio, uB.calcado]) }, uB),
    };
  }
  const ocupacao = montarOcupacao(cap, posicoesOcupadas);
  // Segunda árvore, mesma forma, medida em peças — recalculada do zero (não
  // é o número de endereço convertido) com a capacidade já segregada por
  // item (pedido da operação, 09/09/2026).
  const ocupacaoItens = montarOcupacao(capItens, pecasOcupadas);

  /* ---------- B.O. em trânsito: saldo parado nas ruas de trânsito/validação
     do Pulmão, por ENDEREÇO — pra gestão enxergar onde o material está
     "sumido" da ocupação (excluído da capacidade acima) mas ainda tem saldo
     físico esperando decisão/baixa. ---------- */
  const transitoPulmao = pulmaoTudo.filter(function (r) { return r.origem === 'pulmao' && r.classif_grupo !== 'PULMAO' && r.classif_grupo !== 'ARMAZENAGEM_CHAO'; });
  const transitoPorEndereco = new Map();
  transitoPulmao.forEach(function (r) {
    const chave = r.rua + '|' + r.nivel + '|' + r.box;
    if (!transitoPorEndereco.has(chave)) {
      transitoPorEndereco.set(chave, {
        rua: r.rua, nivel: r.nivel, box: r.box,
        classif_rotulo: r.classif_rotulo, qtd: 0, skus: new Set(),
      });
    }
    const e = transitoPorEndereco.get(chave);
    e.qtd += r.qtd;
    e.skus.add(chaveSku(r.artigo_codigo, r.cor, r.tamanho));
  });
  const transitoEnderecos = Array.from(transitoPorEndereco.values())
    .map(function (e) { return { rua: e.rua, nivel: e.nivel, box: e.box, classif_rotulo: e.classif_rotulo, qtd: e.qtd, skus: e.skus.size }; })
    .sort(function (a, b) { return b.qtd - a.qtd; });

  /* ---------- árvore Marca › Segmento › Família, uma por filtro (picking / pulmão / todos) ----------
     Mesma estrutura de 3 níveis do Balanço de Estoque (Armazém › Marca › Família — ver ingest.js), só
     trocando o nível 1 (lá é Armazém, aqui é Marca): a Família carrega código + nome (=categoria do
     gabarito, mesma regra do Balanço) e o segmento_macro pra render exatamente como lá ("103 VESTUÁRIO
     MIZUNO" + selo "TÊXTIL/ACESSÓRIOS"). */
  function construirArvore(lista) {
    const porMarca = new Map();
    // Peças = disponível + cativado, mesma convenção já usada em
    // pecasOcupadas/saldo_picking/construirSaldoEnderecos (cativado é saldo
    // FÍSICO real, só reservado — não some do endereço). Esta árvore somava
    // só r.qtd (disponível) e ficava contando 349 mil peças a menos que o
    // resto do sistema — achado pelo usuário, 16/09/2026, comparando com a
    // busca por artigo nova (que já seguia a convenção certa). Pulmão não
    // tem qtd_cativado, então o `|| 0` não muda nada do lado dele.
    const qtdReal = function (r) { return r.qtd + (r.qtd_cativado || 0); };
    const totalQtd = lista.reduce(function (s, r) { return s + qtdReal(r); }, 0);
    lista.forEach(function (r) {
      const qr = qtdReal(r);
      // SKU só conta com saldo (24/09/2026): SKU ALOCADO no endereço com zero
      // peça inflava a coluna — Olympikus calçados mostrava 11,5 mil SKUs
      // pra 222 peças. Ocupação por endereço continua contando a alocação.
      if (qr <= 0) return;
      if (!porMarca.has(r.marca)) porMarca.set(r.marca, { codigo: r.marca, nome: r.marca, qtd: 0, skus: new Set(), segmentos: new Map() });
      const nMarca = porMarca.get(r.marca);
      const skuKey = chaveSku(r.artigo_codigo, r.cor, r.tamanho);
      nMarca.qtd += qr;
      nMarca.skus.add(skuKey);
      const grupo = grupoDetalhamento(r.segmento_macro);
      if (!nMarca.segmentos.has(grupo)) nMarca.segmentos.set(grupo, { codigo: grupo, nome: grupo, qtd: 0, skus: new Set(), familias: new Map() });
      const nSeg = nMarca.segmentos.get(grupo);
      nSeg.qtd += qr;
      nSeg.skus.add(skuKey);
      if (!nSeg.familias.has(r.familia_codigo)) {
        nSeg.familias.set(r.familia_codigo, {
          codigo: r.familia_codigo, nome: r.categoria || r.familia_codigo,
          segmento: r.segmento, segmento_macro: r.segmento_macro, qtd: 0, skus: new Set(),
        });
      }
      const nFam = nSeg.familias.get(r.familia_codigo);
      nFam.qtd += qr;
      nFam.skus.add(skuKey);
    });
    return Array.from(porMarca.values())
      .sort(function (a, b) { return b.qtd - a.qtd; })
      .map(function (m) {
        return {
          codigo: m.codigo, nome: m.nome, qtd: m.qtd, skus: m.skus.size,
          pct: totalQtd > 0 ? (m.qtd / totalQtd) * 100 : 0,
          segmentos: Array.from(m.segmentos.values())
            .sort(function (a, b) { return b.qtd - a.qtd; })
            .map(function (s) {
              return {
                codigo: s.codigo, nome: s.nome, qtd: s.qtd, skus: s.skus.size,
                pct: m.qtd > 0 ? (s.qtd / m.qtd) * 100 : 0,
                familias: Array.from(s.familias.values())
                  .sort(function (a, b) { return b.qtd - a.qtd; })
                  .map(function (f) {
                    return {
                      codigo: f.codigo, nome: f.nome, segmento: f.segmento, segmento_macro: f.segmento_macro,
                      qtd: f.qtd, skus: f.skus.size, pct: s.qtd > 0 ? (f.qtd / s.qtd) * 100 : 0,
                    };
                  }),
              };
            }),
        };
      });
  }

  /* ---------- composição por segmento — visão macro, cruza TODAS as marcas ----------
     Independente da árvore acima: agrega direto por segmento_macro, ignorando marca —
     é o "geral do negócio" pedido, sem misturar com a composição por marca. */
  function construirPorSegmentoMacro(lista) {
    const porSeg = new Map();
    // Mesma convenção disponível+cativado de construirArvore acima — as
    // duas árvores (por marca e por segmento macro) precisam concordar
    // entre si e com o resto do sistema.
    const qtdRealSeg = function (r) { return r.qtd + (r.qtd_cativado || 0); };
    const totalQtd = lista.reduce(function (s, r) { return s + qtdRealSeg(r); }, 0);
    lista.forEach(function (r) {
      if (qtdRealSeg(r) <= 0) return; // mesma regra da árvore: SKU sem saldo não conta
      const chave = r.segmento_macro;
      if (!porSeg.has(chave)) porSeg.set(chave, { codigo: chave, nome: chave, qtd: 0, skus: new Set() });
      const n = porSeg.get(chave);
      n.qtd += qtdRealSeg(r);
      n.skus.add(chaveSku(r.artigo_codigo, r.cor, r.tamanho));
    });
    return Array.from(porSeg.values())
      .sort(function (a, b) { return b.qtd - a.qtd; })
      .map(function (s) {
        return { codigo: s.codigo, nome: s.nome, qtd: s.qtd, skus: s.skus.size,
                 pct: totalQtd > 0 ? (s.qtd / totalQtd) * 100 : 0 };
      });
  }

  /* ---------- estatísticas gerais e por segmento_macro (SKUs distintos, endereços, média) ----------
     Calculado aqui (não no navegador) porque "endereços distintos" e "média de SKUs por endereço"
     dependem do dado bruto (rua/nível/box), e o mesmo endereço físico pode guardar famílias de
     segmentos diferentes — somar contagens já agregadas por família daria overcount. */
  function estatisticas(lista) {
    function calcular(sub) {
      const skus = new Set();
      const enderecos = new Set();
      let pecas = 0;
      sub.forEach(function (r) {
        if (r.qtd <= 0) return;
        skus.add(chaveSku(r.artigo_codigo, r.cor, r.tamanho));
        enderecos.add(r.rua + '|' + r.nivel + '|' + r.box);
        pecas += r.qtd;
      });
      const nEnd = enderecos.size;
      return {
        skus_distintos: skus.size,
        enderecos_distintos: nEnd,
        pecas: pecas,
        // Peças por endereço, não SKUs por endereço (pedido da gestão,
        // 02/09/2026): o que interessa é quanta MERCADORIA cabe/está em cada
        // posição, não quantos códigos diferentes dividem a posição.
        media_pecas_por_endereco: nEnd > 0 ? pecas / nEnd : 0,
      };
    }
    const porSegmento = {};
    Array.from(new Set(lista.map(function (r) { return r.segmento_macro; }))).forEach(function (seg) {
      porSegmento[seg] = calcular(lista.filter(function (r) { return r.segmento_macro === seg; }));
    });
    return { geral: calcular(lista), por_segmento: porSegmento };
  }

  /* ---------- material em endereço de validação (sinalização de FIFO) ---------- */
  // Agrupado por ENDEREÇO + SKU (não só por SKU, como antes -- 05/09/2026, pedido
  // do usuário pra unificar este card com o de "B.O. em endereço transitório"
  // numa listagem única). O mesmo SKU parado em duas ruas de validação
  // diferentes agora vira duas linhas (uma por endereço físico), em vez de
  // somar num único total sem dizer onde está.
  const validacao = pulmaoTudo.filter(function (r) { return r.em_validacao && r.qtd > 0; });
  const validacaoPorGrupo = new Map();
  validacao.forEach(function (r) {
    const chave = r.rua + '|' + r.nivel + '|' + r.box + '|' + chaveSku(r.artigo_codigo, r.cor, r.tamanho) + '|' + r.classif_rotulo;
    if (!validacaoPorGrupo.has(chave)) {
      validacaoPorGrupo.set(chave, {
        rua: r.rua, nivel: r.nivel, box: r.box,
        artigo_codigo: r.artigo_codigo, cor: r.cor, tamanho: r.tamanho, descricao: r.descricao,
        marca: r.marca, segmento: r.segmento, classificacao: r.classif_rotulo,
        qtd: 0, mais_antigo: null, volumes: [],
      });
    }
    const g = validacaoPorGrupo.get(chave);
    g.qtd += r.qtd;
    // mais_antigo = DT. CRI. (criação do volume/1ª alocação no CD), NÃO a
    // entrada neste endereço — essa vem do Kardex, cruzada por volume na tela
    // (entradas_volume do snapshot ressuprimento_mov).
    if (r.dt_cri && (!g.mais_antigo || r.dt_cri < new Date(g.mais_antigo))) g.mais_antigo = r.dt_cri.toISOString().slice(0, 10);
    if (r.volume) g.volumes.push({ v: r.volume, q: r.qtd, cri: r.dt_cri ? r.dt_cri.toISOString().slice(0, 10) : null });
  });

  /* ---------- cruzamento de ressuprimento: Picking × apoio disponível no Pulmão, por EAN/CODBAR ---------- */
  const apoioPorCodigo = new Map(); // EAN (picking) === CODBAR (pulmão), mesma numeração de barras
  pulmaoTudo.forEach(function (r) {
    if (!r.apoio_confiavel || !r.codbar) return;
    apoioPorCodigo.set(r.codbar, (apoioPorCodigo.get(r.codbar) || 0) + r.qtd);
  });

  const ressuprimentoPorBucket = {};
  ['meia', 'vestuario', 'calcado'].forEach(function (bucket) {
    // Gabarito da gestão (planilha de análise de estoque, 05/09/2026): o
    // "saldo de calçado no picking" desconsidera as ruas 20/70/80 (que já
    // saem daqui via RECLASSIFICA_PICKING_PARA_PULMAO) E a rua 81 INTEIRA —
    // não só o nível 2 que a gente já reclassifica pro Pulmão por falta de
    // capacidade, o nível 1 também fica de fora dessa soma específica.
    // Só afeta este cruzamento de ressuprimento: a rua 81 nível 1 continua
    // contando normalmente na ocupação/árvore do Picking-Calçado.
    const doBucket = pickingReal.filter(function (r) {
      if (r.bucket !== bucket) return false;
      if (bucket === 'calcado' && r.rua === '81') return false;
      return true;
    });
    const enderecosComApoio = new Set();
    let apoioTotal = 0;
    doBucket.forEach(function (r) {
      const apoio = apoioPorCodigo.get(r.ean) || 0;
      if (apoio > 0) { enderecosComApoio.add(r.rua + '|' + r.nivel + '|' + r.box); apoioTotal += apoio; }
    });
    // saldo_picking = disponível + cativado — mesmo gabarito da planilha de
    // análise da gestão ("Soma de Qtde cativada e no estoque da família"):
    // material cativado (reservado pelo comercial, com ou sem PFA gerada
    // ainda) é saldo físico real, só não está livre pra puxar sem mais
    // conversa. Os dois ficam expostos separados também, pra nunca esconder
    // quanto do saldo total já está comprometido (05/09/2026).
    const saldoDisponivel = doBucket.reduce(function (s, r) { return s + r.qtd; }, 0);
    const saldoCativado = doBucket.reduce(function (s, r) { return s + (r.qtd_cativado || 0); }, 0);
    ressuprimentoPorBucket[bucket] = {
      saldo_picking: saldoDisponivel + saldoCativado,
      saldo_disponivel: saldoDisponivel,
      saldo_cativado: saldoCativado,
      enderecos_com_apoio_pulmao: enderecosComApoio.size,
      apoio_pulmao_disponivel: apoioTotal,
      // GAP visível (ver comentário em parsearPicking): unidades que apareciam
      // negativas e foram zeradas por não dar pra saber se é B.O. ou
      // faturamento sumido. Não entra no saldo_picking acima, mas fica aqui
      // do lado pra não desaparecer — é sinal de que o saldo real do
      // segmento pode estar um pouco diferente do que a tela mostra.
      gap_reservado_nao_contado: doBucket.reduce(function (s, r) { return s + r.qtd_gap_reservado; }, 0),
    };
  });

  /* Endereços vazios é visão POR RUA — só faz
     sentido pra rua física de verdade. O prédio do Pulmão vai até a rua 15
     (confirmado pela operação, 23/09/2026): tudo acima disso, incluindo o
     que volta reclassificado do Picking (20/70/80/81-02, apoio confiável),
     é rua sistêmica/corredor, não porta-pallet — desconsiderado aqui, ainda
     que continue contando em outros lugares (ex.: apoio de ressuprimento,
     material parado em trânsito). */
  const LIMITE_RUA_FISICA = 15;
  const dentroDaRuaFisica = function (r) { return Number(r.rua) <= LIMITE_RUA_FISICA; };
  const pickingComApoio = pickingReal
    .concat(pulmaoTudo.filter(function (r) { return r.origem !== 'pulmao' && r.apoio_confiavel; }))
    .filter(dentroDaRuaFisica);
  const pulmaoFisicoAteRua15 = pulmaoFisico.filter(dentroDaRuaFisica);

  return {
    versao: 1,
    gerado_em: new Date().toISOString(),
    arquivo_picking: meta.arquivo_picking, arquivo_pulmao: meta.arquivo_pulmao,
    gap_estoque_reservado_picking: {
      registros: picking.negativas_excluidas,
      unidades: picking.negativas_unidades,
      nota: 'Itens com saldo negativo no Picking (reserva de separação/pendência de remanejamento OU ' +
        'faturamento do fechamento cuja cativação sumiu) — não dá pra distinguir os dois casos só ' +
        'com este arquivo, então NÃO entram no saldo disponível (nem positivo, nem negativo). GAP a ' +
        'resolver quando houver como separar os dois motivos.',
    },
    ruas_desconsideradas: {
      ruas: RUAS_DESCONSIDERADAS,
      picking: picking.desconsiderado || novoContadorDesconsiderado(),
      pulmao: pulmao.desconsiderado || novoContadorDesconsiderado(),
    },
    ocupacao: ocupacao,
    ocupacao_itens: ocupacaoItens,
    // Saldo parado nas ruas de trânsito/validação do Pulmão, por endereço —
    // fica de fora da ocupação×capacidade acima, mas precisa aparecer em
    // algum lugar pra virar B.O. visível pra gestão (pedido 05/09/2026).
    transito_pulmao: {
      total_qtd: transitoEnderecos.reduce(function (s, e) { return s + e.qtd; }, 0),
      total_enderecos: transitoEnderecos.length,
      enderecos: transitoEnderecos,
    },
    arvore_picking: construirArvore(pickingReal),
    arvore_pulmao: construirArvore(pulmaoTudo),
    // "Todos": estoque completo da distribuidora — Picking + Pulmão somados (são
    // espaços físicos diferentes, então a soma direta é o total real, sem risco
    // de contar a mesma unidade duas vezes).
    arvore_todos: construirArvore(pickingReal.concat(pulmaoTudo)),
    por_segmento_macro_picking: construirPorSegmentoMacro(pickingReal),
    por_segmento_macro_pulmao: construirPorSegmentoMacro(pulmaoTudo),
    por_segmento_macro_todos: construirPorSegmentoMacro(pickingReal.concat(pulmaoTudo)),
    stats_picking: estatisticas(pickingReal),
    stats_pulmao: estatisticas(pulmaoTudo),
    stats_todos: estatisticas(pickingReal.concat(pulmaoTudo)),
    validacao: Array.from(validacaoPorGrupo.values()).sort(function (a, b) {
      return (a.mais_antigo || '9999') < (b.mais_antigo || '9999') ? -1 : 1; // mais antigo primeiro (FIFO)
    }),
    ressuprimento_por_segmento: ressuprimentoPorBucket,
    familias_nao_mapeadas: Array.from(familiasNaoMapeadas),
    // Picking inclui os endereços de Picking que ficam dentro do Pulmão
    // (20/70/80/81-02, apoio confiável) — continuam sendo posição de picking.
    // Rua > 15 (físico ou reclassificado) fica de fora — ver dentroDaRuaFisica.
    enderecos_ociosos: mapearEnderecosOciosos(pickingComApoio, pulmaoFisicoAteRua15),
  };
}

/* ============================================================================
   ENDEREÇOS VAZIOS E "PICADOS" (< 10 peças) — pedido da gestão, 23/09/2026:
   base pra avaliar compactar volumes picados em poucos endereços e liberar
   posição.
   - Picking: endereço ALOCADO (está no arquivo) com saldo físico zero
     (disponível + cativado) = vazio; 1 a 9 peças = picado.
   - Pulmão: o arquivo só lista volume existente, então vazio é INFERIDO —
     box que existe na rua (aparece ocupado em qualquer nível dela) sem
     volume neste nível. A união por rua acompanha a numeração real (ruas
     1–7 usam 1..144; 10–14 só pares ou só ímpares). Só Pulmão físico (ruas
     de trânsito/sinalização ficam fora).
   Segmento do endereço vazio = bucket predominante (em peças) da RUA.
   ============================================================================ */
const LIMITE_PICADO = 10;
function mapearEnderecosOciosos(pickingReal, pulmaoFisico) {
  function agruparPorEndereco(lista) {
    const m = new Map();
    lista.forEach(function (r) {
      const k = r.rua + '|' + r.nivel + '|' + r.box;
      if (!m.has(k)) m.set(k, { rua: r.rua, nivel: r.nivel, box: r.box, qtd: 0, gap: 0, skus: new Set(), buckets: {} });
      const e = m.get(k);
      const q = (r.qtd || 0) + (r.qtd_cativado || 0);
      e.qtd += q;
      e.gap += r.qtd_gap_reservado || 0;
      e.skus.add(r.artigo_codigo + '|' + r.cor + '|' + r.tamanho);
      // Reclassificado do Picking (20/70/80/81-02) não carrega bucket pronto.
      const b = r.bucket || classificarBucket(r.segmento, r.categoria);
      e.buckets[b] = (e.buckets[b] || 0) + Math.max(q, 1);
    });
    return m;
  }
  function predominante(buckets) {
    let melhor = null, v = -1;
    Object.keys(buckets).forEach(function (b) { if (buckets[b] > v) { v = buckets[b]; melhor = b; } });
    return melhor || 'outros';
  }
  function bucketPorRua(enderecos) {
    const porRua = {};
    enderecos.forEach(function (e) {
      if (!porRua[e.rua]) porRua[e.rua] = {};
      Object.keys(e.buckets).forEach(function (b) { porRua[e.rua][b] = (porRua[e.rua][b] || 0) + e.buckets[b]; });
    });
    const out = {};
    Object.keys(porRua).forEach(function (r) { out[r] = predominante(porRua[r]); });
    return out;
  }
  // Linhas guardadas como [rua, nivel, box, qtd, skus, segmento] — são
  // ~10 mil endereços; objeto por linha triplicava o tamanho do snapshot.
  const saida = { limite_picado: LIMITE_PICADO, colunas: ['rua', 'nivel', 'box', 'qtd', 'skus', 'segmento'],
    picking: { vazios: [], picados: [] }, pulmao: { vazios: [], picados: [], vazios_inferidos: true } };

  const endPick = agruparPorEndereco(pickingReal);
  endPick.forEach(function (e) {
    const linha = [e.rua, e.nivel, e.box, e.qtd, e.skus.size, predominante(e.buckets)];
    // Saldo negativo no Picking é zerado no parse (reserva de separação /
    // faturamento sumido — ver parsearPicking), mas o endereço NÃO está
    // vazio: tem material comprometido nele. Contava como vazio por engano
    // (usuário, 23/09/2026: "não tenho tudo isso de endereços vazios").
    if (e.gap > 0) return;
    if (e.qtd <= 0) saida.picking.vazios.push(linha);
    else if (e.qtd < LIMITE_PICADO) saida.picking.picados.push(linha);
  });

  const endPulm = agruparPorEndereco(pulmaoFisico);
  const segRuaPulm = bucketPorRua(endPulm);
  const boxesPorRua = {}, niveisPorRua = {};
  endPulm.forEach(function (e) {
    (boxesPorRua[e.rua] = boxesPorRua[e.rua] || new Set()).add(e.box);
    (niveisPorRua[e.rua] = niveisPorRua[e.rua] || new Set()).add(e.nivel);
    if (e.qtd > 0 && e.qtd < LIMITE_PICADO) {
      saida.pulmao.picados.push([e.rua, e.nivel, e.box, e.qtd, e.skus.size, predominante(e.buckets)]);
    }
  });
  Object.keys(boxesPorRua).forEach(function (rua) {
    niveisPorRua[rua].forEach(function (nivel) {
      boxesPorRua[rua].forEach(function (box) {
        if (!endPulm.has(rua + '|' + nivel + '|' + box)) {
          saida.pulmao.vazios.push([rua, nivel, box, 0, 0, segRuaPulm[rua]]);
        }
      });
    });
  });
  const ord = function (a, b) {
    return (Number(a[0]) - Number(b[0])) || (Number(a[1]) - Number(b[1])) || (Number(a[2]) - Number(b[2]));
  };
  saida.picking.vazios.sort(ord); saida.picking.picados.sort(ord);
  saida.pulmao.vazios.sort(ord); saida.pulmao.picados.sort(ord);
  return saida;
}

/* ============================================================================
   ORQUESTRAÇÃO — chamado pelo index.html (tela de Abastecimento)
   ============================================================================ */
/* ============================================================================
   DICIONÁRIO ARTIGO → FAMÍLIA (dim_artigo_familia)
   ============================================================================
   O Kardex de movimentações (ingest-movimentacoes.js) só traz o código do
   ARTIGO, nunca a família — sem ela não dá pra quebrar o ressuprimento por
   segmento. Picking e Pulmão já resolvem família por artigo linha a linha
   (é o `familia_codigo` de cada registro); esta função só GRAVA isso, em vez
   de deixar se perder depois que a árvore agrega tudo. Roda em todo upload de
   Picking/Pulmão — o dicionário vai ficando mais completo sozinho, sem passo
   manual e sem depender de nenhum outro arquivo estar em dia.

   upsert (não insert): o mesmo artigo aparece em todo upload; sobrescrever é
   o comportamento certo (o SKU não muda de família de um dia pro outro, mas
   se mudasse, upsert reflete o valor mais recente em vez de acumular lixo).
   ============================================================================ */
const LOTE_ARTIGO_FAMILIA = 500;

async function upsertArtigoFamilia(supabaseClient, picking, pulmao, avisar) {
  const mapa = new Map();
  picking.registros.forEach(function (r) {
    if (r.artigo_codigo && r.familia_codigo) mapa.set(r.artigo_codigo, r.familia_codigo);
  });
  pulmao.registros.forEach(function (r) {
    if (r.artigo_codigo && r.familia_codigo) mapa.set(r.artigo_codigo, r.familia_codigo);
  });
  const linhas = Array.from(mapa.entries()).map(function (par) {
    return { artigo_codigo: par[0], familia_codigo: par[1], atualizado_em: new Date().toISOString() };
  });

  for (let i = 0; i < linhas.length; i += LOTE_ARTIGO_FAMILIA) {
    const lote = linhas.slice(i, i + LOTE_ARTIGO_FAMILIA);
    const { error } = await supabaseClient.from('dim_artigo_familia').upsert(lote, { onConflict: 'artigo_codigo' });
    // Tabela nova (migracao_planejamento.sql) pode ainda não existir em quem
    // não rodou a migração — não pode travar o Ressuprimento por causa disso,
    // mesmo raciocínio do dim_capacidade_zonas ausente. Só avisa e segue.
    if (error) { avisar('Aviso: não deu pra atualizar o dicionário artigo→família (' + error.message + ').'); return; }
  }
  avisar(linhas.length.toLocaleString('pt-BR') + ' artigos no dicionário artigo→família atualizados.');
}

async function processarRessuprimento(supabaseClient, filePicking, filePulmao, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo Picking…');
  const textoPicking = await filePicking.text();
  const picking = parsearPicking(textoPicking);
  if (picking.registros.length === 0) {
    throw new Error('Nenhuma linha reconhecida no arquivo de Picking. Confira se é a extração de "Endereços de Picking", sem reformatação.');
  }

  avisar('Lendo Pulmão…');
  const textoPulmao = await filePulmao.text();
  const pulmao = parsearPulmao(textoPulmao);
  if (pulmao.registros.length === 0) {
    throw new Error('Nenhuma linha reconhecida no arquivo de Pulmão. Confira se é a extração de posição por volume, sem reformatação.');
  }
  avisar(
    picking.registros.length.toLocaleString('pt-BR') + ' linhas de Picking' +
    (picking.negativas_excluidas
      ? ' (' + picking.negativas_excluidas + ' com saldo negativo — ' +
        picking.negativas_unidades.toLocaleString('pt-BR') + ' un. de reserva/pendência não contadas, ver GAP)'
      : '') +
    ' · ' + pulmao.registros.length.toLocaleString('pt-BR') + ' linhas de Pulmão' +
    (pulmao.colisoes_volume ? ' (' + pulmao.colisoes_volume + ' volumes duplicados descartados)' : '') + '.'
  );
  const descPk = picking.desconsiderado, descPl = pulmao.desconsiderado;
  if (descPk.linhas + descPl.linhas) {
    avisar('Rua 20 (crossdocking, sem estoque físico) desconsiderada: ' +
      (descPk.linhas + descPl.linhas).toLocaleString('pt-BR') + ' linha(s), ' +
      (descPk.qtd + descPl.qtd).toLocaleString('pt-BR') + ' pç fora do estoque.');
  }

  avisar('Carregando gabarito de famílias e capacidades…');
  const [linhasFam, linhasCap] = await Promise.all([
    window.lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, marca, categoria, segmento'),
    supabaseClient.from('dim_capacidade_zonas').select('zona, capacidade, capacidade_itens').then(function (r) { return r.data || []; }),
  ]);
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));
  const capacidadesManual = {};
  const capacidadesItensManual = {};
  linhasCap.forEach(function (c) {
    capacidadesManual[c.zona] = c.capacidade;
    if (c.capacidade_itens != null) capacidadesItensManual[c.zona] = c.capacidade_itens;
  });

  avisar('Cruzando Picking × Pulmão…');
  const payload = construirSnapshotRessuprimento(picking, pulmao, mapaFamilias, capacidadesManual, {
    arquivo_picking: filePicking.name, arquivo_pulmao: filePulmao.name,
  }, capacidadesItensManual);

  avisar('Gravando snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'ressuprimento', payload: payload, gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  avisar('Atualizando dicionário artigo→família…');
  await upsertArtigoFamilia(supabaseClient, picking, pulmao, avisar);

  // Saldo por endereço, pra sustentar o relatório de gap de estoque das
  // perdas de PFA (Ajustes de PFA → "onde tenho saldo desse material que
  // perdi por falta"). Pedido do usuário (10/09/2026): guiar-se sempre pelo
  // ÚLTIMO upload — a tabela é substituída inteira, nunca acumula histórico.
  avisar('Atualizando saldo por endereço (Picking/Pulmão)…');
  const classif = classificarPickingEPulmao(picking, pulmao, mapaFamilias);
  const saldos = construirSaldoEnderecos(classif.pickingReal, classif.pulmaoTudo);
  await substituirSaldoEnderecos(supabaseClient, saldos, avisar);

  avisar('Concluído.');
  return payload;
}

/* Apaga tudo e grava de novo — nunca acumula histórico (pedido do usuário,
   10/09/2026: "sempre me guio pelo último upload de pulmão e picking"). Em
   lotes porque o arquivo real passa de dezenas de milhares de linhas. */
const LOTE_INSERT_SALDO = 500;
/* Mesmo raciocínio de upsertArtigoFamilia (tabela nova, quem não rodou a
   migração ou não tem permissão não pode ficar sem o Ressuprimento inteiro
   por causa disso): erro aqui vira aviso, nunca derruba o upload — o
   snapshot principal (dashboard_snapshots) já foi gravado antes desta
   chamada. Sem isso, um erro no meio dos lotes (rede caiu, RLS, etc.)
   fazia a tela inteira mostrar "ERRO" mesmo com o Ressuprimento em si já
   salvo com sucesso — confuso pra quem só queria saber se o upload foi. */
async function substituirSaldoEnderecos(supabaseClient, saldos, onProgresso) {
  const avisar = onProgresso || function () {};
  const { error: errDelete } = await supabaseClient.from('ressuprimento_saldo_enderecos').delete().gte('id', 0);
  if (errDelete) {
    avisar('Aviso: não deu pra atualizar o saldo por endereço (' + errDelete.message + ') — ' +
      'o relatório de gap de estoque das perdas de PFA vai continuar com o saldo antigo até o próximo upload que funcionar.');
    return;
  }
  for (let i = 0; i < saldos.length; i += LOTE_INSERT_SALDO) {
    const lote = saldos.slice(i, i + LOTE_INSERT_SALDO);
    const { error } = await supabaseClient.from('ressuprimento_saldo_enderecos').insert(lote);
    if (error) {
      avisar('Aviso: saldo por endereço parou de gravar no meio do caminho (' + error.message + ') — ' +
        Math.min(i, saldos.length).toLocaleString('pt-BR') + ' / ' + saldos.length.toLocaleString('pt-BR') +
        ' linhas gravadas. O relatório de gap de estoque vai ficar incompleto até reprocessar de novo.');
      return;
    }
    avisar('Gravando saldo por endereço… ' +
      Math.min(i + LOTE_INSERT_SALDO, saldos.length).toLocaleString('pt-BR') +
      ' / ' + saldos.length.toLocaleString('pt-BR'));
  }
}

/* Busca por artigo/SKU no Detalhamento de Ressuprimento (pedido do usuário,
   15/09/2026, mesmo padrão da busca de Estoque em ingest.js) — vai direto na
   FATO ressuprimento_saldo_enderecos, que guarda uma linha por artigo+cor+
   tamanho+endereço+classificação (PICKING/PULMÃO) a cada upload de Picking/
   Pulmão. Essa tabela nunca acumula histórico (sempre reflete o ÚLTIMO
   upload, ver substituirSaldoEnderecos acima), então não precisa filtrar por
   extração como a de Estoque precisa. Não tem `descricao` nem `marca` — só
   artigo/cor/tamanho/família — por isso o resultado passa por
   enriquecerDescricaoPorArtigo (ingest.js) antes de voltar; marca é resolvida
   na TELA a partir da família (mesmo dicionário dim_familias que a árvore
   principal já usa). */
const CAMPOS_BUSCA_SALDO_ENDERECO = ['artigo_codigo', 'cor', 'tamanho', 'familia_codigo'];
function filtroOrSaldoEndereco(termoBruto) {
  const termo = String(termoBruto || '').trim().replace(/[,()]/g, ' ').replace(/[%_]/g, '\\$&');
  if (!termo) return null;
  return CAMPOS_BUSCA_SALDO_ENDERECO.map(function (c) { return c + '.ilike.%' + termo + '%'; }).join(',');
}
const LIMITE_BUSCA_SALDO_ENDERECO = 200;
async function buscarSaldoEnderecos(supabaseClient, termoBruto) {
  const orFiltro = filtroOrSaldoEndereco(termoBruto);
  if (!orFiltro) return [];
  const { data, error } = await supabaseClient
    .from('ressuprimento_saldo_enderecos')
    .select('artigo_codigo, cor, tamanho, familia_codigo, rua, nivel, box, classificacao, qtd')
    .or(orFiltro)
    .order('qtd', { ascending: false })
    .limit(LIMITE_BUSCA_SALDO_ENDERECO);
  if (error) throw error;
  return window.enriquecerDescricaoPorArtigo(supabaseClient, data || []);
}
window.buscarSaldoEnderecos = buscarSaldoEnderecos;
window.LIMITE_BUSCA_SALDO_ENDERECO = LIMITE_BUSCA_SALDO_ENDERECO;

/* Mesma busca, sem o teto de 200 — pro CSV levar TODOS os endereços que
   baterem, não só os de maior quantidade mostrados na tela. */
async function buscarSaldoEnderecosCompleto(supabaseClient, termoBruto) {
  const orFiltro = filtroOrSaldoEndereco(termoBruto);
  if (!orFiltro) return [];
  const LOTE = 1000;
  let offset = 0;
  const tudo = [];
  while (true) {
    const { data, error } = await supabaseClient
      .from('ressuprimento_saldo_enderecos')
      .select('artigo_codigo, cor, tamanho, familia_codigo, rua, nivel, box, classificacao, qtd')
      .or(orFiltro)
      .order('qtd', { ascending: false })
      .range(offset, offset + LOTE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    tudo.push.apply(tudo, data);
    if (data.length < LOTE) break;
    offset += data.length;
  }
  return window.enriquecerDescricaoPorArtigo(supabaseClient, tudo);
}
window.buscarSaldoEnderecosCompleto = buscarSaldoEnderecosCompleto;

window.processarRessuprimento = processarRessuprimento;
window.upsertArtigoFamilia = upsertArtigoFamilia;
window.parsearPicking = parsearPicking;
window.parsearPulmao = parsearPulmao;
window.RUAS_ZONA = RUAS_ZONA;
window.construirSnapshotRessuprimento = construirSnapshotRessuprimento;
window.classificarPickingEPulmao = classificarPickingEPulmao;
window.construirSaldoEnderecos = construirSaldoEnderecos;
window.classificarRuaPulmao = classificarRuaPulmao;
window.classificarBucket = classificarBucket;
window.segmentoMacro = segmentoMacro;

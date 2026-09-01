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
   ============================================================================ */
const RUAS_PULMAO_BOAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'];
const CLASSIF_RUA_PULMAO = {};
RUAS_PULMAO_BOAS.forEach(function (r) { CLASSIF_RUA_PULMAO[r] = { grupo: 'PULMAO', rotulo: 'Pulmão' }; });
Object.assign(CLASSIF_RUA_PULMAO, {
  '21':  { grupo: 'VALIDACAO', rotulo: 'Transitório - Ressuprimento (Antigo)' },
  '24':  { grupo: 'VALIDACAO', rotulo: 'Sujeira' },
  '26':  { grupo: 'VALIDACAO', rotulo: 'Sujeira' },
  '27':  { grupo: 'VALIDACAO', rotulo: 'Perca' },
  '98':  { grupo: 'VALIDACAO', rotulo: 'Transitório - Armazenagem/Ressuprimento' },
  '100': { grupo: 'VALIDACAO', rotulo: 'Baixa/Subida - Ressuprimento (Antigo)' },
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
  '20': { motivo: 'Camisas de time Mizuno — visadas, risco de furto no picking', apoioConfiavel: true },
  '70': { motivo: 'Material não localizado Mizuno — sujeira de sistema', apoioConfiavel: false },
  '80': { motivo: 'Material não localizado Under Armour — sujeira de sistema', apoioConfiavel: false },
  // rua 81 é tratada à parte (abaixo): só o nível 02 reclassifica.
};
const MOTIVO_81_02 = 'Capacidade de calçados Under Armour esgotada no picking';

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
  if (s.indexOf('TEXTIL') !== -1 || s.indexOf('TÊXTIL') !== -1 ||
      c.indexOf('VESTU') !== -1 || c.indexOf('ACESS') !== -1) return 'vestuario';
  return 'outros';
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

    registros.push({
      familia_codigo: String(p[1] || '').trim(),
      artigo_codigo: (p[2] || '').trim(),
      descricao: (p[3] || '').trim(),
      cor: (p[4] || '').trim(),
      tamanho: (p[5] || '').trim(),
      ean: (p[6] || '').trim(),
      rua: rua, nivel: nivel, box: box,
      qtd: qtd,
      qtd_gap_reservado: qtdGapReservado,
    });
  }

  return { registros: registros, negativas_excluidas: negativasExcluidas, negativas_unidades: negativasUnidades };
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

    registros.push({
      familia_codigo: String(p[10] || '').trim(),
      artigo_codigo: (p[5] || '').trim(),
      cor: (p[6] || '').trim(),
      tamanho: (p[7] || '').trim(),
      descricao: (p[8] || '').trim(),
      unidade: (p[9] || '').trim(),
      em_linha: (p[11] || '').trim().toUpperCase() === 'S',
      rua: rua, nivel: nivel, box: box,
      dt_cri: parsearDataDDMMAA(p[17]),
      qtd: window.numeroBR(p[19]), // QTD.VOLUME — nunca QTD.STOCK (col. 13), ver cabeçalho do arquivo
      codbar: (p[20] || '').trim(),
    });
  }

  return { registros: registros, colisoes_volume: colisoesVolume };
}

/* ============================================================================
   AGREGAÇÃO
   ============================================================================
   Recebe os dois parses + o gabarito de família (mesmo dim_familias do
   Balanço de Estoque) e devolve o payload pronto pra tela: zonas de
   ocupação, árvore Marca›Segmento por filtro (Picking/Pulmão), lista de
   material em validação (FIFO) e o cruzamento de ressuprimento por segmento.

   capacidadesManual: { pulmao, picking_meia, picking_vestuario,
   picking_calcado } — vem de dim_capacidade_zonas (editável pela gestão). Zona
   sem valor manual usa ocupado × 1.2 (decisão da operação, provisório até a
   capacidade real ser levantada).
   ============================================================================ */
function construirSnapshotRessuprimento(picking, pulmao, mapaFamilias, capacidadesManual, meta) {
  const cap = capacidadesManual || {};
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
    const enriquecido = Object.assign({}, r, { marca: fam.marca, segmento: fam.segmento, categoria: fam.categoria });

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
      origem: 'pulmao', motivo: null,
      apoio_confiavel: classif.grupo === 'PULMAO',
      em_validacao: classif.grupo !== 'PULMAO',
      classif_grupo: classif.grupo, classif_rotulo: classif.rotulo,
    });
  }).concat(pulmaoViaPicking.map(function (r) {
    return Object.assign({}, r, {
      em_validacao: !r.apoio_confiavel, // rua 70/80 (sujeira) entra em validação; 20 e 81-02 não
      classif_grupo: r.apoio_confiavel ? 'PULMAO' : 'VALIDACAO',
      classif_rotulo: r.motivo,
    });
  }));

  /* ---------- posições ocupadas (endereço com soma de qtd > 0) ---------- */
  function posicoesOcupadas(lista) {
    const porEndereco = new Map();
    lista.forEach(function (r) {
      const chave = r.rua + '|' + r.nivel + '|' + r.box;
      porEndereco.set(chave, (porEndereco.get(chave) || 0) + r.qtd);
    });
    let n = 0;
    porEndereco.forEach(function (qtd) { if (qtd > 0) n++; });
    return n;
  }
  function zona(nome, ocupado) {
    const capacidade = cap[nome] || Math.round(ocupado * 1.2);
    return {
      capacidade: capacidade, ocupado: ocupado,
      pct: capacidade > 0 ? (ocupado / capacidade) * 100 : 0,
      disponivel: Math.max(0, capacidade - ocupado),
      capacidade_estimada: !cap[nome], // true = ainda é ocupado×1.2, não o número real da gestão
    };
  }
  const ocupacao = {
    pulmao: zona('pulmao', posicoesOcupadas(pulmaoTudo)),
    picking_meia: zona('picking_meia', posicoesOcupadas(pickingReal.filter(function (r) { return r.bucket === 'meia'; }))),
    picking_vestuario: zona('picking_vestuario', posicoesOcupadas(pickingReal.filter(function (r) { return r.bucket === 'vestuario'; }))),
    picking_calcado: zona('picking_calcado', posicoesOcupadas(pickingReal.filter(function (r) { return r.bucket === 'calcado'; }))),
  };

  /* ---------- árvore Marca › Segmento, uma por filtro (picking / pulmão) ---------- */
  function construirArvore(lista) {
    const porMarca = new Map();
    const totalQtd = lista.reduce(function (s, r) { return s + r.qtd; }, 0);
    lista.forEach(function (r) {
      if (!porMarca.has(r.marca)) porMarca.set(r.marca, { codigo: r.marca, nome: r.marca, qtd: 0, skus: new Set(), segmentos: new Map() });
      const nMarca = porMarca.get(r.marca);
      nMarca.qtd += r.qtd;
      nMarca.skus.add(chaveSku(r.artigo_codigo, r.cor, r.tamanho));
      if (!nMarca.segmentos.has(r.segmento)) nMarca.segmentos.set(r.segmento, { codigo: r.segmento, nome: r.segmento, qtd: 0, skus: new Set() });
      const nSeg = nMarca.segmentos.get(r.segmento);
      nSeg.qtd += r.qtd;
      nSeg.skus.add(chaveSku(r.artigo_codigo, r.cor, r.tamanho));
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
              return { codigo: s.codigo, nome: s.nome, qtd: s.qtd, skus: s.skus.size,
                       pct: m.qtd > 0 ? (s.qtd / m.qtd) * 100 : 0 };
            }),
        };
      });
  }

  /* ---------- material em endereço de validação (sinalização de FIFO) ---------- */
  const validacao = pulmaoTudo.filter(function (r) { return r.em_validacao && r.qtd > 0; });
  const validacaoPorGrupo = new Map();
  validacao.forEach(function (r) {
    const chave = chaveSku(r.artigo_codigo, r.cor, r.tamanho) + '' + r.classif_rotulo;
    if (!validacaoPorGrupo.has(chave)) {
      validacaoPorGrupo.set(chave, {
        artigo_codigo: r.artigo_codigo, cor: r.cor, tamanho: r.tamanho, descricao: r.descricao,
        marca: r.marca, segmento: r.segmento, classificacao: r.classif_rotulo,
        qtd: 0, mais_antigo: null,
      });
    }
    const g = validacaoPorGrupo.get(chave);
    g.qtd += r.qtd;
    if (r.dt_cri && (!g.mais_antigo || r.dt_cri < new Date(g.mais_antigo))) g.mais_antigo = r.dt_cri.toISOString().slice(0, 10);
  });

  /* ---------- cruzamento de ressuprimento: Picking × apoio disponível no Pulmão, por EAN/CODBAR ---------- */
  const apoioPorCodigo = new Map(); // EAN (picking) === CODBAR (pulmão), mesma numeração de barras
  pulmaoTudo.forEach(function (r) {
    if (!r.apoio_confiavel || !r.codbar) return;
    apoioPorCodigo.set(r.codbar, (apoioPorCodigo.get(r.codbar) || 0) + r.qtd);
  });

  const ressuprimentoPorBucket = {};
  ['meia', 'vestuario', 'calcado'].forEach(function (bucket) {
    const doBucket = pickingReal.filter(function (r) { return r.bucket === bucket; });
    const enderecosComApoio = new Set();
    let apoioTotal = 0;
    doBucket.forEach(function (r) {
      const apoio = apoioPorCodigo.get(r.ean) || 0;
      if (apoio > 0) { enderecosComApoio.add(r.rua + '|' + r.nivel + '|' + r.box); apoioTotal += apoio; }
    });
    ressuprimentoPorBucket[bucket] = {
      saldo_picking: doBucket.reduce(function (s, r) { return s + r.qtd; }, 0),
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

  return {
    versao: 1,
    gerado_em: new Date().toISOString(),
    arquivo_picking: meta.arquivo_picking, arquivo_pulmao: meta.arquivo_pulmao,
    gap_estoque_reservado_picking: {
      registros: picking.negativas_excluidas,
      unidades: picking.negativas_unidades,
      nota: 'Itens com saldo negativo no Picking (reserva de separação/B.O. de remanejamento OU ' +
        'faturamento do fechamento cuja cativação sumiu) — não dá pra distinguir os dois casos só ' +
        'com este arquivo, então NÃO entram no saldo disponível (nem positivo, nem negativo). GAP a ' +
        'resolver quando houver como separar os dois motivos.',
    },
    ocupacao: ocupacao,
    arvore_picking: construirArvore(pickingReal),
    arvore_pulmao: construirArvore(pulmaoTudo),
    validacao: Array.from(validacaoPorGrupo.values()).sort(function (a, b) {
      return (a.mais_antigo || '9999') < (b.mais_antigo || '9999') ? -1 : 1; // mais antigo primeiro (FIFO)
    }),
    ressuprimento_por_segmento: ressuprimentoPorBucket,
    familias_nao_mapeadas: Array.from(familiasNaoMapeadas),
  };
}

/* ============================================================================
   ORQUESTRAÇÃO — chamado pelo index.html (tela de Abastecimento)
   ============================================================================ */
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
        picking.negativas_unidades.toLocaleString('pt-BR') + ' un. de reserva/B.O. não contadas, ver GAP)'
      : '') +
    ' · ' + pulmao.registros.length.toLocaleString('pt-BR') + ' linhas de Pulmão' +
    (pulmao.colisoes_volume ? ' (' + pulmao.colisoes_volume + ' volumes duplicados descartados)' : '') + '.'
  );

  avisar('Carregando gabarito de famílias e capacidades…');
  const [linhasFam, linhasCap] = await Promise.all([
    window.lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, marca, categoria, segmento'),
    supabaseClient.from('dim_capacidade_zonas').select('zona, capacidade').then(function (r) { return r.data || []; }),
  ]);
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));
  const capacidadesManual = {};
  linhasCap.forEach(function (c) { capacidadesManual[c.zona] = c.capacidade; });

  avisar('Cruzando Picking × Pulmão…');
  const payload = construirSnapshotRessuprimento(picking, pulmao, mapaFamilias, capacidadesManual, {
    arquivo_picking: filePicking.name, arquivo_pulmao: filePulmao.name,
  });

  avisar('Gravando snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'ressuprimento', payload: payload, gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  avisar('Concluído.');
  return payload;
}

window.processarRessuprimento = processarRessuprimento;
window.parsearPicking = parsearPicking;
window.parsearPulmao = parsearPulmao;
window.construirSnapshotRessuprimento = construirSnapshotRessuprimento;
window.classificarRuaPulmao = classificarRuaPulmao;
window.classificarBucket = classificarBucket;

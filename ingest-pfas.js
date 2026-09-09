/* ============================================================================
   INGEST — PFAs EM TELA (pendentes · conferido · embarcado)
   ============================================================================
   Três relatórios que juntos respondem "o que está parado, em que etapa, e há
   quanto tempo" — a tela "Abastecimento — PFAs em tela" (plano aprovado em
   09/09/2026, no espírito do Outbound do e-commerce):

   1. PFAs Pendentes (.txt, delimitado por "|") — uma linha por PFA, com a
      etapa atual (SITUACAO) e a data de importação. É o FIFO do que ainda não
      saiu: "o que priorizar pro picking hoje?".

   2. Analítico de volume pendente de leitura (.csv, delimitado por ";") — uma
      linha por SKU dentro de um volume já conferido. Duas populações MUITO
      diferentes convivem aqui, e somá-las mente (erro real cometido e apontado
      pela operação, 08/09/2026):
        - NOTA = 0  → volume conferido, nota fiscal ainda não emitida. Não tem
          data nenhuma, então não dá pra medir FIFO.
        - NOTA > 0  → já faturado, esperando só a coleta física. DATA_NOTA é o
          relógio real do backlog (tem nota de 6+ meses parada).
      Por isso o payload guarda os dois separados, nunca somados.

   3. NFs Embarcadas (.csv, ";") — o que JÁ SAIU. Não vira card: é filtro de
      exclusão aplicado aos outros dois antes de qualquer soma. Sem ele, PFA
      que já embarcou continua contando como pendente (225 casos, 24.415 pares
      no arquivo real de 08/09/2026 — atraso de atualização da fonte).

   CHAVE COMUM: o número da PFA (PRE-FATURA / PFA / NUMPFA) é o mesmo nos três
   e ainda é o mesmo de `ressuprimento_planejamento.pfa` — dá pra cruzar tudo
   sem heurística de texto.
   ============================================================================ */

/* Etapas da operação, na ordem real do fluxo — a ordem importa pro funil, que
   é lido de cima pra baixo como "onde o volume empaca". Vem exatamente como o
   sistema escreve (sem acento em "expedicao"); o rótulo bonito fica na tela. */
const ORDEM_ETAPA_PFA = [
  'Nao disp. picking',
  'Disp. p/ picking',
  'Em picking',
  'Leitura expedicao',
  'Gerar Nota Fiscal',
];

/* Faixas de idade (FIFO) do que está pendente, em dias corridos desde a
   importação da PFA. Provisórias até a operação fechar o SLA por etapa
   (pergunta 04 do plano) — por isso ficam numa constante só, fácil de trocar
   sem caçar número solto no meio do código. */
const FAIXAS_FIFO_PFA = [
  { chave: '0-2', rotulo: '0–2 dias', ate: 2 },
  { chave: '3-5', rotulo: '3–5 dias', ate: 5 },
  { chave: '6-10', rotulo: '6–10 dias', ate: 10 },
  { chave: '11+', rotulo: '11+ dias', ate: Infinity },
];

/* Conferência parcial que passa disso PARADA na etapa vira caso de rastreio:
   confirmado com a operação (09/09/2026) — a partir de ~3 dias, quase sempre
   é corte sinalizado pelo separador na coleta, que o time responsável analisa
   e atende se necessário. Antes disso é fluxo normal (a PFA anda item por
   item), e por isso não pode virar alarme. */
const DIAS_PARCIAL_RASTREIO = 3;

function faixaFifoPfa(dias) {
  for (let i = 0; i < FAIXAS_FIFO_PFA.length; i++) {
    if (dias <= FAIXAS_FIFO_PFA[i].ate) return FAIXAS_FIFO_PFA[i].chave;
  }
  return FAIXAS_FIFO_PFA[FAIXAS_FIFO_PFA.length - 1].chave;
}

/* ----------------------------------------------------------------------------
   DATAS
   ----------------------------------------------------------------------------
   O relatório de Pendentes traz a data SEM ano ("28/08"). Assumir o ano
   corrente quebraria na virada: em 02/01, uma PFA de "28/12" é do ano
   passado, não do corrente (ficaria com -359 dias de idade). A regra aqui é
   simples e explícita: mês no futuro em relação à referência = ano anterior.
   ---------------------------------------------------------------------------- */
function dataDDMMComAno(txt, hojeISO) {
  const m = String(txt || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  const ref = String(hojeISO || '').split('-');
  if (ref.length !== 3) return null;
  const anoRef = Number(ref[0]), mesRef = Number(ref[1]), diaRef = Number(ref[2]);
  const ano = (mes > mesRef || (mes === mesRef && dia > diaRef)) ? anoRef - 1 : anoRef;
  return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
}

/* "DD/MM/AAAA" → "AAAA-MM-DD". Devolve null pro campo vazio/inválido em vez
   de inventar data — quem chama decide o que fazer com a ausência. */
function dataDDMMAAAA(txt) {
  const m = String(txt || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

/* Diferença em dias corridos entre duas datas "AAAA-MM-DD", sempre em UTC
   (meio-dia) — mesma proteção de fuso que diaSemanaAbrev usa no index.html:
   montar meia-noite local faria o dia escorregar em quem abre o report de
   outro fuso. */
function diasEntre(deISO, ateISO) {
  if (!deISO || !ateISO) return null;
  const a = String(deISO).split('-').map(Number);
  const b = String(ateISO).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return null;
  const ms = Date.UTC(b[0], b[1] - 1, b[2], 12) - Date.UTC(a[0], a[1] - 1, a[2], 12);
  return Math.round(ms / 86400000);
}

function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ============================================================================
   PARSE — PFAs PENDENTES (.txt, "|")
   ============================================================================
   Cabeçalho real (32 colunas):
   ESTAB|PRE-FATURA|DATA|CLIENTE|DESCRICAO|FAM|ENCOMENDA|TRS 1PERC|DESCRICAO|
   TRS 2PERC|DESCRICAO|EXP|QT.VOL.|SITUACAO|DATA|NOTA FISCAL|DT. NF|VL.PND|
   VL.INC|VL.CLT|VL.EXP|PARES|BOX|PERS|...|CLUSTER|VOLUMES PENDENTES DE COLETA

   Confirmado com a operação (08/09/2026): PARES é a quantidade de ITENS e
   QT.VOL. é a quantidade de VOLUMES (caixas) da PFA — não são a mesma coisa
   e a tela usa as duas.

   VL.PND/VL.INC/VL.CLT/VL.EXP repetem a quantidade de volumes na coluna da
   etapa correspondente (mesmo layout do "Acompanhamento Op" do e-commerce).
   Não são lidas: a etapa já vem explícita em SITUACAO, e derivar de novo por
   qual coluna está preenchida só criaria uma segunda fonte de verdade.
   ============================================================================ */
function parsearPfasPendentes(textoArquivo, referenciaISO) {
  const hoje = referenciaISO || hojeISO();
  const linhas = String(textoArquivo || '').split(/\r?\n/);
  const registros = [];
  let semData = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    // Cabeçalho (e qualquer relançamento dele no meio do arquivo).
    if (/^ESTAB\s*\|/i.test(linha)) continue;

    const p = linha.split('|');
    if (p.length < 24) continue; // rodapé/lixo — mesmo critério dos outros ingests

    const pfa = (p[1] || '').trim();
    if (!pfa) continue;

    const dataImportacao = dataDDMMComAno(p[2], hoje);
    if (!dataImportacao) semData++;

    registros.push({
      pfa: pfa,
      data_importacao: dataImportacao,
      dias_abertos: dataImportacao ? diasEntre(dataImportacao, hoje) : null,
      cliente_codigo: (p[3] || '').trim(),
      cliente_nome: (p[4] || '').trim(),
      familia_codigo: (p[5] || '').trim(),
      encomenda: (p[6] || '').trim(),
      transportadora_codigo: (p[7] || '').trim(),
      transportadora_nome: (p[8] || '').trim(),
      qt_volumes: window.numeroBR(p[12]),
      situacao: (p[13] || '').trim(),
      data_situacao: dataDDMMComAno(p[14], hoje),
      // Quanto tempo a PFA está PARADA na etapa atual — relógio diferente do
      // dias_abertos (que conta desde a importação). É este que a operação
      // usa pra decidir se a conferência parcial virou caso de rastreio.
      dias_na_etapa: (function () {
        const d = dataDDMMComAno(p[14], hoje);
        return d ? diasEntre(d, hoje) : null;
      })(),
      nota_fiscal: (p[15] || '').trim(),
      pares: window.numeroBR(p[21]),
      box: (p[22] || '').trim(),
      personalizado: (p[23] || '').trim().toUpperCase() === 'S',
      cluster: (p[30] || '').trim(),
    });
  }

  return { registros: registros, sem_data: semData };
}

/* ============================================================================
   PARSE — ANALÍTICO DE VOLUME PENDENTE DE LEITURA (.csv, ";")
   ============================================================================
   EMPRESA;ESTABELECIMENTO;TIPCLI;CODCLI;SCDCLI;RAZAO_SOCIAL;PFA;SERIE;SUBSER;
   NOTA;DATA_NOTA;OPERACAO;SEQ_VOLUME;VOLUME;FAMILIA;DESC_FAMILIA;ARTIGO;
   DESC_ARTIGO;COR;TAMANHO;QTDE;CODBAR

   QTDE vem com vírgula decimal ("3,0") — window.numeroBR resolve.
   NOTA = "0" (e DATA_NOTA vazia) marca o volume conferido ainda sem nota.
   ============================================================================ */
function parsearPfasAnalitico(textoArquivo) {
  const linhas = String(textoArquivo || '').split(/\r?\n/);
  const registros = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    if (/^EMPRESA\s*;/i.test(linha)) continue;

    const p = linha.split(';');
    if (p.length < 21) continue;

    const pfa = (p[6] || '').trim();
    if (!pfa) continue;

    const nota = (p[9] || '').trim();
    const temNota = !!nota && nota !== '0';

    registros.push({
      pfa: pfa,
      cliente_codigo: (p[3] || '').trim(),
      cliente_nome: (p[5] || '').trim(),
      nota: temNota ? nota : null,
      data_nota: temNota ? dataDDMMAAAA(p[10]) : null,
      volume: (p[13] || '').trim(),
      familia_codigo: (p[14] || '').trim(),
      artigo_codigo: (p[16] || '').trim(),
      cor: (p[18] || '').trim(),
      tamanho: (p[19] || '').trim(),
      qtde: window.numeroBR(p[20]),
    });
  }

  return { registros: registros };
}

/* ============================================================================
   PARSE — NFs EMBARCADAS (.csv, ";")
   ============================================================================
   EMP;ESTABE;DATNOT;NUMPFA;CODSER;SCDSER;NUMNOT;VALTOT;QTDTOT;PWD;DATMOD

   PWD identifica a OPERAÇÃO (ou o usuário) que fez o embarque — relatório
   novo, a operação ainda está fechando a definição exata (09/09/2026). O que
   já está confirmado: "CROSSDOC" é transferência entre DISTR e E-COMM, feita
   pra receber material sem custo fiscal extra (em vez de o e-commerce comprar,
   as outras unidades transferem pra distribuidora e a distribuidora transfere
   pro e-commerce). Ou seja: cross-docking NÃO é venda — some do pendente pelo
   mesmo motivo, mas é bom conseguir separar um do outro na hora de explicar
   um número. Por isso o campo é guardado e contado por operação.
   ============================================================================ */
function parsearPfasEmbarcadas(textoArquivo) {
  const linhas = String(textoArquivo || '').split(/\r?\n/);
  const registros = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    if (/^EMP\s*;/i.test(linha)) continue;

    const p = linha.split(';');
    if (p.length < 10) continue;

    const pfa = (p[3] || '').trim();
    if (!pfa) continue;

    registros.push({
      pfa: pfa,
      data_nota: dataDDMMAAAA(p[2]),
      nota: (p[6] || '').trim(),
      valor_total: window.numeroBR(p[7]),
      qtd_total: window.numeroBR(p[8]),
      operacao: (p[9] || '').trim(),
      data_modificacao: dataDDMMAAAA(p[10]),
    });
  }

  return { registros: registros };
}

/* ============================================================================
   AGREGAÇÃO
   ============================================================================
   Devolve o payload da tela. A filosofia é a mesma do resto do report: o que
   é caro (cruzar 30 mil linhas de SKU, contar volume distinto por PFA) sai
   pronto daqui; o que o usuário filtra na tela (marca, segmento, etapa, faixa
   de FIFO) fica em arrays por PFA, pequenos o bastante pro navegador recortar
   na hora sem ida ao banco — mesmo padrão de `validacao`/`historico`.
   ============================================================================ */
function construirSnapshotPfas(pendentes, analitico, embarcadas, mapaFamilias, meta) {
  const hoje = (meta && meta.referencia) || hojeISO();
  const familiasNaoMapeadas = new Set();

  function infoFamilia(codigo) {
    const f = mapaFamilias.get(codigo);
    if (!f) { familiasNaoMapeadas.add(codigo); return { marca: 'NAO MAPEADA', segmento: '—', categoria: '—' }; }
    return f;
  }
  function enriquecer(codigoFamilia) {
    const fam = infoFamilia(codigoFamilia);
    return {
      marca: fam.marca,
      segmento_macro: window.segmentoMacro(fam.segmento, fam.categoria),
    };
  }

  /* ---------- 1. o que já embarcou sai de cena ----------
     Exclusão por PFA, aplicada ANTES de qualquer soma (decisão do plano). O
     que foi excluído vira número visível — some do KPI, mas não some da
     conversa: é a medida do atraso da fonte de Pendentes. */
  const pfasEmbarcadas = new Set(embarcadas.registros.map(function (e) { return e.pfa; }));

  /* A JANELA do arquivo de Embarcadas importa tanto quanto o conteúdo: ele
     cobre só um intervalo (o real de 08/09/2026 vai de 17/08 a 08/09), então
     nota ANTERIOR a essa janela não pode ser confirmada nem desmentida por
     ele. A operação confirmou (09/09/2026) que o backlog de 6+ meses do
     Analítico não está mais em tela — ou saiu fora do range, ou é B.O. em
     análise. Marcar essa fatia como "não confirmada" evita que ela engorde o
     número de "aguardando coleta" como se fosse trabalho vivo. */
  const datasEmb = embarcadas.registros.map(function (e) { return e.data_nota; }).filter(Boolean).sort();
  const janelaEmbarcadas = datasEmb.length
    ? { de: datasEmb[0], ate: datasEmb[datasEmb.length - 1] }
    : null;

  const porOperacao = new Map();
  embarcadas.registros.forEach(function (e) {
    const op = e.operacao || '—';
    porOperacao.set(op, (porOperacao.get(op) || 0) + 1);
  });

  const pendentesAtivos = [];
  let excluidasPfas = 0, excluidasPares = 0;
  pendentes.registros.forEach(function (r) {
    if (pfasEmbarcadas.has(r.pfa)) { excluidasPfas++; excluidasPares += r.pares; return; }
    pendentesAtivos.push(r);
  });

  const analiticoAtivo = analitico.registros.filter(function (r) { return !pfasEmbarcadas.has(r.pfa); });

  /* ---------- 2. conferência por PFA: volumes lidos × volumes da PFA ----------
     Volume DISTINTO, não linha: o Analítico traz uma linha por SKU dentro do
     volume, então contar linha diria que uma caixa com 7 pares foi conferida
     7 vezes. Com o total de volumes da PFA (QT.VOL, do Pendentes) isso vira o
     status de 3 estados que a tela mostra. */
  const volumesPorPfa = new Map();
  analiticoAtivo.forEach(function (r) {
    if (!r.volume) return;
    if (!volumesPorPfa.has(r.pfa)) volumesPorPfa.set(r.pfa, new Set());
    volumesPorPfa.get(r.pfa).add(r.volume);
  });

  function statusConferencia(pfa, qtVolumes, diasNaEtapa) {
    const lidos = volumesPorPfa.has(pfa) ? volumesPorPfa.get(pfa).size : 0;
    const total = qtVolumes || 0;
    // Sem saber o total não dá pra dizer "completa" — trata como parcial
    // assumida em vez de fingir certeza que o dado não sustenta.
    let status = 'nao_iniciada';
    if (lidos > 0) status = (total > 0 && lidos >= total) ? 'completa' : 'parcial';
    // Parcial parada há muito tempo deixa de ser fluxo normal e vira tarefa —
    // é um status à parte pra tela poder gritar só com o que merece grito.
    if (status === 'parcial' && diasNaEtapa !== null && diasNaEtapa >= DIAS_PARCIAL_RASTREIO) {
      status = 'parcial_rastreio';
    }
    return { status: status, volumes_lidos: lidos, volumes_total: total };
  }

  /* ---------- 3. linhas de Pendentes, já enriquecidas ---------- */
  const linhasPendentes = pendentesAtivos.map(function (r) {
    const e = enriquecer(r.familia_codigo);
    const conf = statusConferencia(r.pfa, r.qt_volumes, r.dias_na_etapa);
    return {
      pfa: r.pfa,
      data_importacao: r.data_importacao,
      dias_abertos: r.dias_abertos,
      faixa_fifo: r.dias_abertos === null ? null : faixaFifoPfa(r.dias_abertos),
      situacao: r.situacao,
      data_situacao: r.data_situacao,
      dias_na_etapa: r.dias_na_etapa,
      cliente_codigo: r.cliente_codigo,
      cliente_nome: r.cliente_nome,
      familia_codigo: r.familia_codigo,
      marca: e.marca,
      segmento_macro: e.segmento_macro,
      transportadora_nome: r.transportadora_nome,
      cluster: r.cluster,
      qt_volumes: r.qt_volumes,
      pares: r.pares,
      personalizado: r.personalizado,
      conferencia: conf.status,
      conferencia_lidos: conf.volumes_lidos,
      conferencia_total: conf.volumes_total,
    };
  });

  /* ---------- 4. Analítico: as duas populações, separadas ----------
     Agrega por PFA + família: o detalhe SKU (30 mil linhas) não é usado por
     nenhum card da tela, e carregar isso no payload só engordaria o snapshot.
     Quem precisar do SKU tem o arquivo. */
  function agregarPorPfaFamilia(lista) {
    const mapa = new Map();
    lista.forEach(function (r) {
      const chave = r.pfa + '|' + r.familia_codigo + '|' + (r.nota || '');
      if (!mapa.has(chave)) {
        const e = enriquecer(r.familia_codigo);
        mapa.set(chave, {
          pfa: r.pfa, familia_codigo: r.familia_codigo,
          marca: e.marca, segmento_macro: e.segmento_macro,
          cliente_nome: r.cliente_nome,
          nota: r.nota, data_nota: r.data_nota,
          dias_nota: r.data_nota ? diasEntre(r.data_nota, hoje) : null,
          qtde: 0, volumes: new Set(), linhas: 0,
        });
      }
      const g = mapa.get(chave);
      g.qtde += r.qtde;
      g.linhas++;
      if (r.volume) g.volumes.add(r.volume);
    });
    return Array.from(mapa.values()).map(function (g) {
      return {
        pfa: g.pfa, familia_codigo: g.familia_codigo, marca: g.marca,
        segmento_macro: g.segmento_macro, cliente_nome: g.cliente_nome,
        nota: g.nota, data_nota: g.data_nota, dias_nota: g.dias_nota,
        qtde: g.qtde, volumes: g.volumes.size, linhas: g.linhas,
        // "Dentro da janela": o arquivo de Embarcadas cobre essa data, então a
        // ausência dela ali é informação de verdade (ainda não saiu). Fora da
        // janela é só falta de cobertura — não dá pra afirmar nada.
        confirmado: !!(janelaEmbarcadas && g.data_nota && g.data_nota >= janelaEmbarcadas.de),
      };
    }).sort(function (a, b) { return b.qtde - a.qtde; });
  }

  const linhasSemNota = analiticoAtivo.filter(function (r) { return !r.nota; });
  const linhasComNota = analiticoAtivo.filter(function (r) { return !!r.nota; });
  const semNota = agregarPorPfaFamilia(linhasSemNota);
  const comNota = agregarPorPfaFamilia(linhasComNota);

  function totalizar(agregado, linhasBrutas) {
    const pfas = new Set(), volumes = new Set();
    let qtde = 0;
    agregado.forEach(function (g) { pfas.add(g.pfa); qtde += g.qtde; });
    linhasBrutas.forEach(function (r) { if (r.volume) volumes.add(r.volume); });
    return { qtde: qtde, pfas: pfas.size, volumes: volumes.size, linhas: linhasBrutas.length };
  }

  const totalSemNota = totalizar(semNota, linhasSemNota);
  const totalComNota = totalizar(comNota, linhasComNota);
  // A mesma soma, partida pela cobertura do arquivo de Embarcadas.
  function somarColeta(lista) {
    const pfas = new Set();
    let qtde = 0;
    lista.forEach(function (g) { pfas.add(g.pfa); qtde += g.qtde; });
    return { qtde: qtde, pfas: pfas.size };
  }
  const coletaConfirmada = somarColeta(comNota.filter(function (g) { return g.confirmado; }));
  const coletaNaoConfirmada = somarColeta(comNota.filter(function (g) { return !g.confirmado; }));
  const notaMaisAntiga = comNota.reduce(function (mx, g) {
    return (g.dias_nota !== null && g.dias_nota > mx.dias) ? { dias: g.dias_nota, data: g.data_nota } : mx;
  }, { dias: 0, data: null });

  /* ---------- 5. totais do que está pendente ---------- */
  const totalPares = linhasPendentes.reduce(function (s, r) { return s + r.pares; }, 0);
  const totalVolumes = linhasPendentes.reduce(function (s, r) { return s + r.qt_volumes; }, 0);
  const maisAntiga = linhasPendentes.reduce(function (mx, r) {
    return (r.dias_abertos !== null && r.dias_abertos > mx.dias) ? { dias: r.dias_abertos, data: r.data_importacao } : mx;
  }, { dias: 0, data: null });

  /* ---------- 6. de onde as etapas do funil saem ----------
     A lista de etapas vem do gabarito (ORDEM_ETAPA_PFA) mais qualquer situação
     nova que apareça no arquivo — situação desconhecida NÃO pode sumir da
     tela só porque o gabarito não previu: entra no fim, visível. */
  const etapasVistas = [];
  linhasPendentes.forEach(function (r) {
    if (r.situacao && ORDEM_ETAPA_PFA.indexOf(r.situacao) === -1 && etapasVistas.indexOf(r.situacao) === -1) {
      etapasVistas.push(r.situacao);
    }
  });

  return {
    arquivo_pendentes: (meta && meta.arquivo_pendentes) || null,
    arquivo_analitico: (meta && meta.arquivo_analitico) || null,
    arquivo_embarcadas: (meta && meta.arquivo_embarcadas) || null,
    referencia: hoje,

    // Recorte por PFA — é sobre isto que a tela filtra (marca/segmento/etapa/FIFO)
    pendentes: linhasPendentes,
    // Aguardando embarque, nas duas populações que NUNCA devem ser somadas
    aguardando_nf: semNota,
    aguardando_coleta: comNota,

    etapas: ORDEM_ETAPA_PFA.concat(etapasVistas),
    faixas_fifo: FAIXAS_FIFO_PFA.map(function (f) { return { chave: f.chave, rotulo: f.rotulo }; }),

    stats: {
      pendentes: {
        pfas: linhasPendentes.length, pares: totalPares, volumes: totalVolumes,
        mais_antiga_dias: maisAntiga.dias, mais_antiga_data: maisAntiga.data,
      },
      aguardando_nf: totalSemNota,
      aguardando_coleta: Object.assign({}, totalComNota, {
        nota_mais_antiga_dias: notaMaisAntiga.dias,
        nota_mais_antiga_data: notaMaisAntiga.data,
        confirmado: coletaConfirmada,
        nao_confirmado: coletaNaoConfirmada,
      }),
      // O que o arquivo de Embarcadas tirou do pendente — a medida do atraso
      // da fonte, não um detalhe de implementação: fica visível na tela.
      excluidas_por_embarque: { pfas: excluidasPfas, pares: excluidasPares },
      embarcadas_no_arquivo: embarcadas.registros.length,
      janela_embarcadas: janelaEmbarcadas,
      embarcadas_por_operacao: Array.from(porOperacao.entries())
        .map(function (e) { return { operacao: e[0], notas: e[1] }; })
        .sort(function (a, b) { return b.notas - a.notas; }),
    },

    familias_nao_mapeadas: Array.from(familiasNaoMapeadas).sort(),
  };
}

/* ============================================================================
   UPLOAD
   ============================================================================ */
async function processarPfas(supabaseClient, filePendentes, fileAnalitico, fileEmbarcadas, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo PFAs Pendentes…');
  const pendentes = parsearPfasPendentes(await filePendentes.text());
  if (pendentes.registros.length === 0) {
    throw new Error('Nenhuma linha reconhecida no arquivo de PFAs Pendentes. Confira se é a extração com o cabeçalho ESTAB|PRE-FATURA|…, sem reformatação.');
  }

  avisar('Lendo Analítico…');
  const analitico = parsearPfasAnalitico(await fileAnalitico.text());
  if (analitico.registros.length === 0) {
    throw new Error('Nenhuma linha reconhecida no Analítico. Confira se é o CSV com o cabeçalho EMPRESA;ESTABELECIMENTO;…, sem reformatação.');
  }

  // Embarcadas é opcional: sem ele a tela funciona, só não consegue tirar do
  // pendente o que já saiu — e avisa isso na cara, em vez de silenciosamente
  // mostrar número inflado.
  let embarcadas = { registros: [] };
  if (fileEmbarcadas) {
    avisar('Lendo NFs Embarcadas…');
    embarcadas = parsearPfasEmbarcadas(await fileEmbarcadas.text());
  }

  avisar(
    pendentes.registros.length.toLocaleString('pt-BR') + ' PFAs pendentes · ' +
    analitico.registros.length.toLocaleString('pt-BR') + ' linhas no Analítico · ' +
    embarcadas.registros.length.toLocaleString('pt-BR') + ' notas embarcadas.'
  );

  avisar('Carregando gabarito de famílias…');
  const linhasFam = await window.lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, marca, categoria, segmento');
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));

  avisar('Cruzando os três arquivos…');
  const payload = construirSnapshotPfas(pendentes, analitico, embarcadas, mapaFamilias, {
    arquivo_pendentes: filePendentes.name,
    arquivo_analitico: fileAnalitico.name,
    arquivo_embarcadas: fileEmbarcadas ? fileEmbarcadas.name : null,
  });

  if (payload.stats.excluidas_por_embarque.pfas) {
    avisar(
      payload.stats.excluidas_por_embarque.pfas + ' PFA(s) já embarcadas foram tiradas do pendente (' +
      payload.stats.excluidas_por_embarque.pares.toLocaleString('pt-BR') + ' pares).'
    );
  }
  if (!fileEmbarcadas) {
    avisar('Aviso: sem o arquivo de NFs Embarcadas, o que já saiu continua contando como pendente.');
  }

  avisar('Gravando snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'pfas', payload: payload, gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  avisar('Concluído.');
  return payload;
}

window.processarPfas = processarPfas;
window.parsearPfasPendentes = parsearPfasPendentes;
window.parsearPfasAnalitico = parsearPfasAnalitico;
window.parsearPfasEmbarcadas = parsearPfasEmbarcadas;
window.construirSnapshotPfas = construirSnapshotPfas;
window.ORDEM_ETAPA_PFA = ORDEM_ETAPA_PFA;
window.FAIXAS_FIFO_PFA = FAIXAS_FIFO_PFA;

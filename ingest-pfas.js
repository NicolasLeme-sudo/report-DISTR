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

/* Dias ÚTEIS entre duas datas "AAAA-MM-DD" (conta sábado/domingo fora),
   exclusivo na ponta de início — usado só pro SLA de 1 dia útil da PFA
   retrabalhada (ver PFA_RETRABALHADA_SLA_DIAS_UTEIS abaixo). Não tenta ser
   um calendário de feriados; a operação confirmou (09/09/2026) que fim de
   semana já cobre o caso real, feriado fica pra uma 2ª rodada se aparecer. */
function diasUteisEntre(deISO, ateISO) {
  if (!deISO || !ateISO) return null;
  const de = new Date(deISO + 'T12:00:00Z');
  const ate = new Date(ateISO + 'T12:00:00Z');
  if (isNaN(de.getTime()) || isNaN(ate.getTime())) return null;
  let dias = 0;
  const cursor = new Date(de.getTime());
  while (cursor.getTime() < ate.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay(); // 0 = domingo, 6 = sábado
    if (dow !== 0 && dow !== 6) dias++;
  }
  return dias;
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
  // Chave = número da PFA, não índice de linha: é assim que o dedup abaixo
  // consegue substituir a ocorrência anterior em vez de só ignorar a repetida.
  const porPfa = new Map();
  let semData = 0;
  let linhasDuplicadas = 0; // conta OCORRÊNCIAS extras, não PFAs distintas

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    // Cabeçalho (e qualquer relançamento dele no meio do arquivo).
    if (/^ESTAB\s*\|/i.test(linha)) continue;

    const p = linha.split('|');
    if (p.length < 24) continue; // rodapé/lixo — mesmo critério dos outros ingests

    const pfa = (p[1] || '').trim();
    if (!pfa) continue;

    if (porPfa.has(pfa)) linhasDuplicadas++;

    const dataImportacao = dataDDMMComAno(p[2], hoje);
    if (!dataImportacao) semData++;

    // Uma PFA repetida no arquivo SUBSTITUI a ocorrência anterior (fica só a
    // última) em vez de as duas somarem no relatório — sem isso, cada
    // duplicata de abastecimento dobra pares/volumes silenciosamente em todo
    // KPI que soma por PFA. `sem_data` acima já contou as duas passagens de
    // propósito: a divergência de data também é sinal de arquivo mal extraído.
    porPfa.set(pfa, {
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

  return { registros: Array.from(porPfa.values()), sem_data: semData, pfas_duplicadas: linhasDuplicadas };
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

/* Estados possíveis de uma linha de ajuste, na ordem em que aparecem no
   e-mail do comercial (ver especificação validada em 09/09/2026). */
const TIPOS_AJUSTE_PFA = ['AJUSTE', 'CANCELAMENTO', 'BO_POS_NF', 'AD_DEVOLUCAO'];

/* `tipo` não precisa vir digitado igualzinho ao rótulo oficial — o operador
   que preenche a planilha não decora a lista, então reconhecemos a palavra-
   chave em vez de exigir grafia exata (pedido da operação, 10/09/2026).
   `motivo` continua 100% livre — nunca comparado, só guardado e exibido. */
function normalizarTipoAjuste(bruto) {
  const t = String(bruto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento
    .toUpperCase();
  // pra reconhecer a palavra-chave não pode importar pontuação/espaço no meio
  // ("B.O. pós-NF", "B.O pos NF" e "BOPOSNF" têm que cair no mesmo lugar).
  const soLetras = t.replace(/[^A-Z]/g, '');
  if (/DEVOL/.test(soLetras)) return 'AD_DEVOLUCAO';
  if (/CANCEL/.test(soLetras)) return 'CANCELAMENTO';
  if (/BO/.test(soLetras) && /NF/.test(soLetras)) return 'BO_POS_NF';
  if (/AJUST/.test(soLetras)) return 'AJUSTE';
  return t.trim(); // não reconhecido — cai fora na checagem contra TIPOS_AJUSTE_PFA
}

/* SLA de leadtime de uma PFA "retrabalhada" (nascida de um AJUSTE): ela não
   repete conferência nem separação, só reetiqueta — por isso o prazo real é
   bem mais curto que o FIFO normal de uma PFA original. */
const PFA_RETRABALHADA_SLA_DIAS_UTEIS = 1;

/* ============================================================================
   PARSE — AJUSTES DE PFA (.csv, ";") — planilha manual da assistente
   ============================================================================
   tipo;encomenda;pfa_antiga;pfa_nova;cliente;familia_codigo;artigo;cor;tam;
   qtde_total_pedido;qtde_faltante;motivo;data_solicitacao;solicitante

   Uma linha por evento (ajuste, cancelamento, B.O. pós-NF ou devolução por
   AD), lançada manualmente a partir do e-mail do comercial — não tem fonte
   sistêmica pra isso ainda. `encomenda` é a chave que sobrevive a uma PFA
   sendo renumerada mais de uma vez (242018→242305→242410): cruzar direto
   PFA-antiga↔PFA-nova obrigaria "andar a corrente" a cada novo ajuste.

   `cliente` (10/09/2026): código e nome vêm num campo só, exatamente como
   o e-mail/export do sistema já traz ("CL 92884 92884   JC ABDON
   CONFECCOES LTDA") — nunca foi usado pra cruzar nada (só exibição), então
   não tinha por que pedir pra assistente separar o que o sistema já junta.

   `familia_codigo` (10/09/2026, pedido da operação — validado contra um
   e-mail real de "NFs com divergência"): o e-mail do comercial já traz a
   coluna FAM por linha, então a assistente cola direto em vez do sistema
   ter que adivinhar a família pelo artigo (dim_artigo_familia só conhece
   artigo que já passou por um upload de Picking/Pulmão — com a família
   explícita, marca/segmento saem certos mesmo pra artigo nunca visto).
   Fica em branco em linhas antigas (upload anterior a essa mudança) sem
   quebrar nada — cai no fallback por artigo (ver marcaSegmentoDoAjuste).

   `cor` e `tam` (10/09/2026): o e-mail real também traz essas duas colunas
   separadas (COR, TAM), não juntas — a planilha replica o mesmo formato de
   exportação do sistema em vez de pedir pra assistente juntar à mão.
   Guardadas concatenadas em `cor_tam` (mesmo formato "PT/PRT M" de sempre)
   porque é o que o resto do sistema (chave de upsert, exibição) espera.

   `qtde_faltante` (10/09/2026): o e-mail do comercial já traz a falta
   pronta por artigo (coluna QUANT. FALTANTE) — nunca um "antes/depois" pra
   subtrair. A perda líquida agora é essa quantidade direto, sem conta
   nenhuma. DE-PARA (artigo substituto cobrindo o corte inteiro) também não
   precisa de coluna própria: a assistente preenche qtde_faltante = 0 —
   chegou tudo, não faltou nada, perda sai zero sozinha.
   ============================================================================ */
/* Split de uma linha CSV respeitando aspas — precisa disso porque o próprio
   modelo baixado (baixarModeloAjustesPfa) exporta com todo campo entre
   aspas, e um `linha.split(delim)` ingênuo deixaria as aspas coladas no
   valor (\"960841\" em vez de 960841), quebrando o cruzamento por
   encomenda/pfa/artigo mais adiante. */
function dividirLinhaCsv(linha, delim) {
  const campos = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; } else { dentroAspas = false; }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === delim) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

/* Núcleo do parser — recebe linhas JÁ separadas em campos (array de arrays),
   não texto cru. Isso é o que permite reaproveitar a MESMA validação/
   mapeamento pros dois formatos de planilha que a assistente pode mandar:
   texto delimitado (parsearAjustesPfa, abaixo) e .xlsx de verdade
   (parsearAjustesPfaXlsx, mais abaixo — 10/09/2026, formato virou Excel
   pra poder vir com cabeçalho em negrito/itálico e células centralizadas,
   coisa que texto puro não guarda). */
function parsearLinhasAjustesPfa(linhas) {
  const registros = [];
  let linhasInvalidas = 0;

  for (let i = 0; i < linhas.length; i++) {
    const p = linhas[i].map(function (c) { return String(c == null ? '' : c).trim(); });
    if (!p.some(function (v) { return v; })) continue; // linha em branco
    if (/^tipo$/i.test(p[0])) continue; // cabeçalho, com ou sem aspas
    if (p.length < 14) continue;

    const tipo = normalizarTipoAjuste(p[0]);
    const encomenda = (p[1] || '').trim();
    const pfaAntiga = (p[2] || '').trim();
    const artigo = (p[6] || '').trim();

    /* CANCELAMENTO às vezes chega do time comercial quase em branco — só
       tipo, pfa_antiga, qtde_total_pedido, data_solicitacao e solicitante
       preenchidos (encomenda/artigo/cor/tam/família/motivo ficam vazios).
       Como o material inteiro está sendo cancelado, não faz sentido exigir
       encomenda/artigo pra esse tipo: exigimos só tipo + pfa_antiga. Os
       demais tipos continuam exigindo encomenda e artigo, como antes. */
    const exigeEncomendaEArtigo = tipo !== 'CANCELAMENTO';
    if (
      TIPOS_AJUSTE_PFA.indexOf(tipo) === -1 ||
      !pfaAntiga ||
      (exigeEncomendaEArtigo && (!encomenda || !artigo))
    ) {
      linhasInvalidas++;
      continue;
    }

    const cor = (p[7] || '').trim();
    const tam = (p[8] || '').trim();
    const qtdeTotalPedido = window.numeroBR(p[9]);
    let qtdeFaltante = window.numeroBR(p[10]);
    // CANCELAMENTO sem qtde_faltante informada: cancelou tudo, então a
    // quantidade faltante é a própria quantidade total do pedido.
    if (tipo === 'CANCELAMENTO' && !qtdeFaltante && qtdeTotalPedido) {
      qtdeFaltante = qtdeTotalPedido;
    }
    registros.push({
      tipo: tipo,
      encomenda: encomenda,
      pfa_antiga: pfaAntiga,
      pfa_nova: (p[3] || '').trim() || null,
      cliente: (p[4] || '').trim(),
      familia_codigo: (p[5] || '').trim() || null,
      artigo: artigo,
      cor_tam: [cor, tam].filter(Boolean).join(' '),
      qtde_total_pedido: qtdeTotalPedido,
      qtde_faltante: qtdeFaltante,
      motivo: (p[11] || '').trim(),
      data_solicitacao: dataDDMMAAAA(p[12]),
      solicitante: (p[13] || '').trim(),
    });
  }

  return { registros: registros, linhas_invalidas: linhasInvalidas };
}

function parsearAjustesPfa(textoArquivo) {
  const linhasTexto = String(textoArquivo || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });

  // Delimitador flexível: a operação usa ";" (padrão pt-BR), mas o Excel
  // salva/cola com "," quando o separador de lista do Windows está em inglês,
  // ou com TAB quando o conteúdo vem de um copiar-e-colar de célula do Excel
  // pra um editor de texto (caso real reportado 10/09/2026) — sem detectar
  // isso a planilha inteira dá "nenhuma linha reconhecida" mesmo estando
  // correta. Decide pelo delimitador mais frequente na primeira linha.
  const primeiraLinha = linhasTexto[0] || '';
  const candidatos = [';', ',', '\t'];
  const delimitador = candidatos.reduce(function (melhor, d) {
    return primeiraLinha.split(d).length > primeiraLinha.split(melhor).length ? d : melhor;
  }, ';');

  const linhas = linhasTexto.map(function (linha) { return dividirLinhaCsv(linha, delimitador); });
  return parsearLinhasAjustesPfa(linhas);
}

/* .xlsx de verdade (10/09/2026, pedido da operação — formatação de célula
   não sobrevive em texto puro): lê via ExcelJS (window.ExcelJS, carregado
   só na página, por isso este helper é assíncrono e não roda nos testes
   Node — a validação de campo mesma é toda em parsearLinhasAjustesPfa,
   testada direto com array de linhas). Data em célula de verdade (tipo
   Date do Excel, não texto) vira "DD/MM/AAAA" antes de entrar no parser —
   o resto do pipeline nunca soube a diferença. */
async function parsearAjustesPfaXlsx(file) {
  const buffer = await file.arrayBuffer();
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const planilha = wb.worksheets[0];
  const linhas = [];
  planilha.eachRow({ includeEmpty: false }, function (linha) {
    const valores = [];
    linha.eachCell({ includeEmpty: true }, function (celula) {
      const v = celula.value;
      valores.push(v instanceof Date
        ? String(v.getUTCDate()).padStart(2, '0') + '/' + String(v.getUTCMonth() + 1).padStart(2, '0') + '/' + v.getUTCFullYear()
        : (v == null ? '' : v));
    });
    linhas.push(valores);
  });
  return parsearLinhasAjustesPfa(linhas);
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
/* pendentes/analitico/embarcadas podem vir `null` — "não abasteci esse
   pedaço agora" (pedido da operação, 10/09/2026: reprocessar só Pendentes
   pra atualizar o andamento sem precisar ter o Analítico do dia em mãos).
   `ultimoPayload` é o snapshot anterior completo, usado como fonte pro que
   não foi reenviado — sem ele, o pedaço ausente ficaria zerado no snapshot
   novo, apagando dado que ainda é válido. */
function construirSnapshotPfas(pendentes, analitico, embarcadas, mapaFamilias, meta, ajustes, mapaArtigoFamilia, ultimoPayload) {
  const hoje = (meta && meta.referencia) || hojeISO();
  const familiasNaoMapeadas = new Set();
  const ajustesLista = (ajustes && ajustes.registros) || [];
  const ultimo = ultimoPayload || null;
  const pendentesFornecido = !!pendentes;
  const analiticoFornecido = !!analitico;
  const embarcadasFornecido = !!embarcadas;

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
     conversa: é a medida do atraso da fonte de Pendentes.
     Sem arquivo novo de Embarcadas, reaplica o ÚLTIMO conjunto de PFAs
     embarcadas conhecido (payload.embarcadas_pfas) — do contrário, cada
     reprocessamento sem reenviar Embarcadas "ressuscitaria" PFA já
     embarcada como pendente de novo, desfazendo a exclusão anterior. */
  const pfasEmbarcadas = embarcadasFornecido
    ? new Set(embarcadas.registros.map(function (e) { return e.pfa; }))
    : new Set((ultimo && ultimo.embarcadas_pfas) || []);

  /* A JANELA do arquivo de Embarcadas importa tanto quanto o conteúdo: ele
     cobre só um intervalo (o real de 08/09/2026 vai de 17/08 a 08/09), então
     nota ANTERIOR a essa janela não pode ser confirmada nem desmentida por
     ele. A operação confirmou (09/09/2026) que o backlog de 6+ meses do
     Analítico não está mais em tela — ou saiu fora do range, ou é B.O. em
     análise. Marcar essa fatia como "não confirmada" evita que ela engorde o
     número de "aguardando coleta" como se fosse trabalho vivo. */
  const statsAnteriores = (ultimo && ultimo.stats) || {};
  const datasEmb = embarcadasFornecido
    ? embarcadas.registros.map(function (e) { return e.data_nota; }).filter(Boolean).sort()
    : [];
  const janelaEmbarcadas = embarcadasFornecido
    ? (datasEmb.length ? { de: datasEmb[0], ate: datasEmb[datasEmb.length - 1] } : null)
    : (statsAnteriores.janela_embarcadas || null);

  const porOperacao = new Map();
  if (embarcadasFornecido) {
    embarcadas.registros.forEach(function (e) {
      const op = e.operacao || '—';
      porOperacao.set(op, (porOperacao.get(op) || 0) + 1);
    });
  }
  const embarcadasPorOperacao = embarcadasFornecido
    ? Array.from(porOperacao.entries())
      .map(function (e) { return { operacao: e[0], notas: e[1] }; })
      .sort(function (a, b) { return b.notas - a.notas; })
    : (statsAnteriores.embarcadas_por_operacao || []);

  /* ---------- 1.5 PFA baixada por ajuste/cancelamento some do pendente ----------
     CANCELAMENTO exclui sempre: o material está mesmo fora, não vai
     reaparecer em outra PFA nenhuma. AJUSTE só exclui quando tem `pfa_nova`
     de verdade — sem ela, é uma "falta parcial" (validado contra um e-mail
     real do comercial, 10/09/2026): a PFA continua ativa na operação, só
     com a quantidade reduzida — ela NÃO é renumerada, então sumir da tela
     junto escondia uma PFA que ainda está em picking/coleta de verdade. A
     perda ainda soma certo no card de Ajustes independente disso; só a
     exclusão do Pendentes que fica condicionada a existir PFA nova.
     AD_DEVOLUCAO é tratada à parte (item 1.6): ela nunca aparece em
     Pendentes (a PFA já tem nota emitida), só em "aguardando coleta". Um
     `Set` simples de pfa_antiga já resolve o caso de ajuste em cadeia
     (242018→242305→242410) sem precisar andar pela encomenda: 242305 é
     `pfa_antiga` de uma 2ª linha o dia que for cortada de novo, e sai da
     conta sozinha quando isso acontecer. */
  const pfasAjustadas = new Set();
  ajustesLista.forEach(function (a) {
    if (a.tipo === 'CANCELAMENTO') { pfasAjustadas.add(a.pfa_antiga); return; }
    if (a.tipo === 'AJUSTE' && a.pfa_nova) pfasAjustadas.add(a.pfa_antiga);
  });
  const pfasComAD = new Set();
  ajustesLista.forEach(function (a) { if (a.tipo === 'AD_DEVOLUCAO') pfasComAD.add(a.pfa_antiga); });

  /* Sem arquivo novo de Pendentes, reconstrói as linhas "cruas" a partir do
     ÚLTIMO snapshot — o payload.pendentes já guarda todo campo que o parser
     do .txt produziria (pfa, data_importacao, situacao, etc.), então dá pra
     alimentar o resto do pipeline sem duplicar lógica nenhuma. FIFO
     (dias_abertos) fica congelado no valor de quando foi lido de verdade —
     mesmo comportamento de "não abasteci hoje", só que dirigido a um único
     pedaço da tela em vez da tela inteira. */
  const pendentesRegistros = pendentesFornecido ? pendentes.registros : ((ultimo && ultimo.pendentes) || []).map(function (r) {
    return {
      pfa: r.pfa, data_importacao: r.data_importacao, dias_abertos: r.dias_abertos,
      situacao: r.situacao, data_situacao: r.data_situacao, dias_na_etapa: r.dias_na_etapa,
      cliente_codigo: r.cliente_codigo, cliente_nome: r.cliente_nome, familia_codigo: r.familia_codigo,
      transportadora_nome: r.transportadora_nome, cluster: r.cluster, qt_volumes: r.qt_volumes,
      pares: r.pares, personalizado: r.personalizado,
    };
  });

  const todasPfasPendentesArquivo = new Set(pendentesRegistros.map(function (r) { return r.pfa; }));

  const pendentesAtivos = [];
  let excluidasPfas = 0, excluidasPares = 0;
  let excluidasPorAjustePfas = 0, excluidasPorAjustePares = 0;
  pendentesRegistros.forEach(function (r) {
    if (pfasEmbarcadas.has(r.pfa)) { excluidasPfas++; excluidasPares += r.pares; return; }
    if (pfasAjustadas.has(r.pfa)) { excluidasPorAjustePfas++; excluidasPorAjustePares += r.pares; return; }
    pendentesAtivos.push(r);
  });

  /* ---------- 1.6 devolução por AD tira a PFA inteira de "aguardando coleta" ----------
     AD_DEVOLUCAO nunca aparece em Pendentes (a PFA já tem nota emitida — o
     corte é depois da NF), então não entra na exclusão acima. Ela vive só no
     Analítico, como "com nota, aguardando coleta" — e sai de lá inteira
     (qtde_total_pedido, não só a diferença), porque o comercial recusou mandar
     o resto: o prejuízo é a PFA toda, não o que faltava originalmente. */
  let excluidasPorAdPfas = 0, excluidasPorAdQtde = 0;
  const analiticoAtivo = (analiticoFornecido ? analitico.registros : []).filter(function (r) {
    if (pfasEmbarcadas.has(r.pfa) || pfasAjustadas.has(r.pfa)) return false;
    if (pfasComAD.has(r.pfa)) { excluidasPorAdQtde += r.qtde; return false; }
    return true;
  });
  excluidasPorAdPfas = pfasComAD.size;

  /* "Em tela" pra quem já foi conferido (Analítico) significa uma coisa só:
     a PFA ainda aparece na lista VIVA de Pendentes. É prova direta — o
     próprio sistema operacional ainda está rastreando aquilo hoje — bem mais
     forte que checar se a nota caiu dentro da janela do arquivo de
     Embarcadas (prova indireta: "não vi no que saiu" não é o mesmo que "vi
     que ainda está aqui"). A troca foi motivada por um caso real (09/09/2026,
     arquivo de Embarcadas mais longo): a janela passou a cobrir quase tudo e
     "confirmou" como em tela 98 PFAs / 5.648 pç que a operação já tinha
     dito, na rodada anterior, que não estavam mais em tela — a janela larga
     escondeu exatamente o backlog que devia aparecer. */
  const pfasEmPendentes = new Set(pendentesAtivos.map(function (r) { return r.pfa; }));

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

  // Sem Analítico novo não dá pra recalcular conferência nenhuma (não tem
  // volume lido pra contar) — em vez de "esquecer" o que já tinha sido
  // conferido antes (voltando tudo pra "não iniciada"), reaproveita o
  // último valor conhecido POR PFA. PFA nova, nunca vista, fica honesta em
  // "não iniciada" mesmo assim — não tem de onde puxar histórico dela.
  const conferenciaCongelada = new Map();
  if (!analiticoFornecido && ultimo && ultimo.pendentes) {
    ultimo.pendentes.forEach(function (r) {
      conferenciaCongelada.set(r.pfa, {
        status: r.conferencia, volumes_lidos: r.conferencia_lidos, volumes_total: r.conferencia_total,
      });
    });
  }
  function statusConferenciaOuCongelada(pfa, qtVolumes, diasNaEtapa) {
    if (analiticoFornecido) return statusConferencia(pfa, qtVolumes, diasNaEtapa);
    return conferenciaCongelada.get(pfa) || { status: 'nao_iniciada', volumes_lidos: 0, volumes_total: qtVolumes || 0 };
  }

  /* PFA "nova" de um AJUSTE é reconhecida por aparecer como `pfa_nova` de
     alguma linha — não precisa de campo próprio no arquivo de Pendentes.
     O leadtime dela é o SLA curto (PFA_RETRABALHADA_SLA_DIAS_UTEIS), contado
     a partir da PRÓPRIA data de importação dela (quando entrou em Pendentes
     de verdade), não da data do e-mail — a assistente pode lançar o ajuste
     antes do sistema importar a PFA nova. */
  const pfaNovaParaAjuste = new Map();
  ajustesLista.forEach(function (a) {
    if (a.tipo === 'AJUSTE' && a.pfa_nova) pfaNovaParaAjuste.set(a.pfa_nova, a);
  });

  /* ---------- 3. linhas de Pendentes, já enriquecidas ---------- */
  const linhasPendentes = pendentesAtivos.map(function (r) {
    const e = enriquecer(r.familia_codigo);
    const conf = statusConferenciaOuCongelada(r.pfa, r.qt_volumes, r.dias_na_etapa);
    const ehRetrabalhada = pfaNovaParaAjuste.has(r.pfa);
    const diasUteisRetrabalho = ehRetrabalhada && r.data_importacao
      ? diasUteisEntre(r.data_importacao, hoje) : null;
    const situacaoPfa = !ehRetrabalhada ? 'normal'
      : (diasUteisRetrabalho !== null && diasUteisRetrabalho > PFA_RETRABALHADA_SLA_DIAS_UTEIS)
        ? 'retrabalhada_atrasada' : 'retrabalhada';
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
      // 'normal' | 'retrabalhada' | 'retrabalhada_atrasada' — só existe
      // porque esta PFA é o "pfa_nova" de algum ajuste (ver mapa acima).
      situacao_pfa: situacaoPfa,
      dias_uteis_retrabalho: diasUteisRetrabalho,
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
        // Confirmado = a própria PFA ainda está na lista viva de Pendentes.
        // Não usa mais a janela de Embarcadas pra isso (ver comentário acima).
        confirmado: pfasEmPendentes.has(g.pfa),
      };
    }).sort(function (a, b) { return b.qtde - a.qtde; });
  }

  function totalizar(agregado, linhasBrutas) {
    const pfas = new Set(), volumes = new Set();
    let qtde = 0;
    agregado.forEach(function (g) { pfas.add(g.pfa); qtde += g.qtde; });
    linhasBrutas.forEach(function (r) { if (r.volume) volumes.add(r.volume); });
    return { qtde: qtde, pfas: pfas.size, volumes: volumes.size, linhas: linhasBrutas.length };
  }
  // Sem Analítico novo, volumes/linhas não têm como ser recontados (não há
  // linha SKU nova pra somar) — mantém o último valor conhecido em vez de
  // zerar; qtde/pfas continuam corretos (vêm do grupo, não da linha bruta).
  function totalizarCongelado(agregado, statsAntigo) {
    const pfas = new Set();
    let qtde = 0;
    agregado.forEach(function (g) { pfas.add(g.pfa); qtde += g.qtde; });
    return {
      qtde: qtde, pfas: pfas.size,
      volumes: (statsAntigo && statsAntigo.volumes) || 0,
      linhas: (statsAntigo && statsAntigo.linhas) || 0,
    };
  }

  let semNota, comNota, totalSemNota, totalComNota;
  if (analiticoFornecido) {
    const linhasSemNota = analiticoAtivo.filter(function (r) { return !r.nota; });
    const linhasComNota = analiticoAtivo.filter(function (r) { return !!r.nota; });
    semNota = agregarPorPfaFamilia(linhasSemNota);
    comNota = agregarPorPfaFamilia(linhasComNota);
    totalSemNota = totalizar(semNota, linhasSemNota);
    totalComNota = totalizar(comNota, linhasComNota);
  } else {
    // Reaproveita os grupos do último snapshot, só reabrindo o que muda com
    // o tempo mesmo sem Analítico novo: `confirmado` contra o Pendentes
    // (fresco ou também congelado, tanto faz — ver pfasEmPendentes acima) e
    // `dias_nota` recontado pra HOJE (a data da nota é real, então o
    // backlog continua envelhecendo mesmo sem reenviar o arquivo).
    const recarregarGrupo = function (g) {
      return Object.assign({}, g, {
        confirmado: pfasEmPendentes.has(g.pfa),
        dias_nota: g.data_nota ? diasEntre(g.data_nota, hoje) : null,
      });
    };
    semNota = ((ultimo && ultimo.aguardando_nf) || []).map(recarregarGrupo);
    comNota = ((ultimo && ultimo.aguardando_coleta) || []).map(recarregarGrupo);
    totalSemNota = totalizarCongelado(semNota, statsAnteriores.aguardando_nf);
    totalComNota = totalizarCongelado(comNota, statsAnteriores.aguardando_coleta);
  }
  // A mesma soma, partida por quem ainda está confirmado em Pendentes. Feito
  // pras DUAS populações (não só "com nota") — é o "bate os dados" pedido
  // pela operação (09/09/2026): sem nota já bate 1:1 com Pendentes hoje, mas
  // a checagem fica pronta pra qualquer população que vier a divergir.
  function somarPorConfirmado(lista) {
    const conf = lista.filter(function (g) { return g.confirmado; });
    const naoConf = lista.filter(function (g) { return !g.confirmado; });
    function somar(l) {
      const pfas = new Set();
      let qtde = 0;
      l.forEach(function (g) { pfas.add(g.pfa); qtde += g.qtde; });
      return { qtde: qtde, pfas: pfas.size };
    }
    return { confirmado: somar(conf), nao_confirmado: somar(naoConf) };
  }
  const nfPorConfirmado = somarPorConfirmado(semNota);
  const coletaPorConfirmado = somarPorConfirmado(comNota);
  const coletaConfirmada = coletaPorConfirmado.confirmado;
  const coletaNaoConfirmada = coletaPorConfirmado.nao_confirmado;
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

  /* ---------- 7. Ajustes de PFA — perda líquida por linha ----------
     perda_liquida = qtde_faltante direto (a planilha já traz a falta
     pronta por artigo — sem "antes/depois" pra subtrair). Mesma fórmula
     pros 4 tipos — cobre DE-PARA de graça (a assistente preenche
     qtde_faltante = 0, perda sai zero) sem precisar de coluna extra. A tela
     agrega por tipo E por período (data_solicitacao), filtrando este
     array — nenhuma soma pronta aqui além da que precisa cruzar com
     Pendentes. */
  // Marca/Segmento do ajuste: preferem a `familia_codigo` da própria linha
  // (o e-mail do comercial já traz a coluna FAM — 10/09/2026) quando
  // preenchida; sem ela, cai no dicionário artigo->família que Ressuprimento
  // já mantém (linha antiga, de antes dessa coluna existir). Artigo sem
  // família dos dois jeitos fica sem marca/segmento — os filtros do topo
  // simplesmente não pegam essa linha, nunca escondida por outro motivo
  // qualquer.
  const mapaArtFam = mapaArtigoFamilia || new Map();
  function marcaSegmentoDoAjuste(a) {
    const familiaCod = a.familia_codigo || mapaArtFam.get(a.artigo);
    const fam = familiaCod ? mapaFamilias.get(familiaCod) : null;
    if (!fam) return { marca: null, segmento_macro: null };
    return { marca: fam.marca, segmento_macro: window.segmentoMacro(fam.segmento, fam.categoria) };
  }

  const ajustesPayload = ajustesLista.map(function (a) {
    const perdaLiquida = Math.max(0, a.qtde_faltante || 0);
    const ms = marcaSegmentoDoAjuste(a);
    return {
      tipo: a.tipo, encomenda: a.encomenda, pfa_antiga: a.pfa_antiga, pfa_nova: a.pfa_nova,
      cliente: a.cliente, familia_codigo: a.familia_codigo || null, artigo: a.artigo, cor_tam: a.cor_tam,
      marca: ms.marca, segmento_macro: ms.segmento_macro,
      qtde_total_pedido: a.qtde_total_pedido, qtde_faltante: a.qtde_faltante,
      perda_liquida: perdaLiquida, motivo: a.motivo, data_solicitacao: a.data_solicitacao,
      solicitante: a.solicitante,
      // Só existe pra AJUSTE com pfa_nova: a PFA nova ainda não apareceu em
      // NENHUMA extração de Pendentes até hoje (não é "não está mais ativa
      // hoje" — é "nunca foi vista"). Enquanto isso, ela conta como "em
      // aberto" em vez de virar sujeira silenciosa.
      aguardando_import_pfa_nova: a.tipo === 'AJUSTE' && !!a.pfa_nova && !todasPfasPendentesArquivo.has(a.pfa_nova),
    };
  });
  const ajustesAbertos = ajustesPayload.filter(function (a) { return a.aguardando_import_pfa_nova; });

  return {
    // Pedaço não reenviado nesta rodada → mantém o nome do arquivo que
    // alimentou ele da última vez, pra tela continuar dizendo a fonte real.
    arquivo_pendentes: pendentesFornecido ? ((meta && meta.arquivo_pendentes) || null) : ((ultimo && ultimo.arquivo_pendentes) || null),
    arquivo_analitico: analiticoFornecido ? ((meta && meta.arquivo_analitico) || null) : ((ultimo && ultimo.arquivo_analitico) || null),
    arquivo_embarcadas: embarcadasFornecido ? ((meta && meta.arquivo_embarcadas) || null) : ((ultimo && ultimo.arquivo_embarcadas) || null),
    referencia: hoje,

    // Recorte por PFA — é sobre isto que a tela filtra (marca/segmento/etapa/FIFO)
    pendentes: linhasPendentes,
    // Aguardando embarque, nas duas populações que NUNCA devem ser somadas
    aguardando_nf: semNota,
    aguardando_coleta: comNota,
    // Último conjunto de PFAs embarcadas conhecido — reaplicado sozinho
    // quando um upload futuro não reenviar o arquivo de Embarcadas.
    embarcadas_pfas: Array.from(pfasEmbarcadas),
    // Ajuste/cancelamento/B.O. pós-NF/AD — lançados manualmente, cruzados por
    // encomenda/PFA com o que está em tela. A tela agrega e filtra por
    // período em cima deste array; nada aqui já vem somado por tipo.
    ajustes: ajustesPayload,
    ajustes_em_aberto: ajustesAbertos.length,

    etapas: ORDEM_ETAPA_PFA.concat(etapasVistas),
    faixas_fifo: FAIXAS_FIFO_PFA.map(function (f) { return { chave: f.chave, rotulo: f.rotulo }; }),

    stats: {
      pendentes: {
        pfas: linhasPendentes.length, pares: totalPares, volumes: totalVolumes,
        mais_antiga_dias: maisAntiga.dias, mais_antiga_data: maisAntiga.data,
      },
      aguardando_nf: Object.assign({}, totalSemNota, {
        confirmado: nfPorConfirmado.confirmado,
        nao_confirmado: nfPorConfirmado.nao_confirmado,
      }),
      aguardando_coleta: Object.assign({}, totalComNota, {
        nota_mais_antiga_dias: notaMaisAntiga.dias,
        nota_mais_antiga_data: notaMaisAntiga.data,
        confirmado: coletaConfirmada,
        nao_confirmado: coletaNaoConfirmada,
      }),
      // Linhas repetidas no PRÓPRIO arquivo de Pendentes (mesma PFA duas vezes
      // na extração) — sinal de abastecimento errado, não de dado real. Fica
      // visível pelo mesmo motivo que excluidas_por_embarque: é medida da
      // qualidade da fonte, não detalhe de implementação escondido.
      pfas_duplicadas_no_arquivo: pendentesFornecido ? (pendentes.pfas_duplicadas || 0) : (statsAnteriores.pfas_duplicadas_no_arquivo || 0),
      // O que o arquivo de Embarcadas tirou do pendente — a medida do atraso
      // da fonte, não um detalhe de implementação: fica visível na tela.
      excluidas_por_embarque: { pfas: excluidasPfas, pares: excluidasPares },
      // PFA antiga baixada por ajuste/cancelamento — mesma lógica, fonte
      // diferente (ajustes_pfa em vez do arquivo de Embarcadas).
      excluidas_por_ajuste: { pfas: excluidasPorAjustePfas, pares: excluidasPorAjustePares },
      // Devolução por AD tirou a PFA inteira de "aguardando coleta".
      excluidas_por_ad: { pfas: excluidasPorAdPfas, qtde: excluidasPorAdQtde },
      embarcadas_no_arquivo: embarcadasFornecido ? embarcadas.registros.length : (statsAnteriores.embarcadas_no_arquivo || 0),
      janela_embarcadas: janelaEmbarcadas,
      embarcadas_por_operacao: embarcadasPorOperacao,
    },

    familias_nao_mapeadas: Array.from(familiasNaoMapeadas).sort(),
  };
}

/* ============================================================================
   UPLOAD
   ============================================================================ */
async function processarPfas(supabaseClient, filePendentes, fileAnalitico, fileEmbarcadas, onProgresso) {
  const avisar = onProgresso || function () {};

  if (!filePendentes && !fileAnalitico && !fileEmbarcadas) {
    throw new Error('Selecione pelo menos um arquivo (Pendentes, Analítico ou Embarcadas).');
  }

  // Os três agora são independentes — dá pra abastecer só Pendentes (pra
  // atualizar etapa/FIFO rápido) ou só Embarcadas (uma vez, e ele continua
  // valendo pros próximos uploads de Pendentes) sem precisar ter os outros
  // dois em mãos. O que não for enviado agora entra como `null` em
  // construirSnapshotPfas, que reaproveita o último snapshot pra aquele
  // pedaço (ver comentário lá) — busca esse último snapshot só se
  // realmente precisar dele.
  let pendentes = null;
  if (filePendentes) {
    avisar('Lendo PFAs Pendentes…');
    pendentes = parsearPfasPendentes(await filePendentes.text());
    if (pendentes.registros.length === 0) {
      throw new Error('Nenhuma linha reconhecida no arquivo de PFAs Pendentes. Confira se é a extração com o cabeçalho ESTAB|PRE-FATURA|…, sem reformatação.');
    }
    if (pendentes.pfas_duplicadas) {
      avisar(
        'Atenção: ' + pendentes.pfas_duplicadas.toLocaleString('pt-BR') +
        ' PFA(s) apareceram repetidas no arquivo de Pendentes — usada só a última ocorrência de cada. Confira a extração.'
      );
    }
  }

  let analitico = null;
  if (fileAnalitico) {
    avisar('Lendo Analítico…');
    analitico = parsearPfasAnalitico(await fileAnalitico.text());
    if (analitico.registros.length === 0) {
      throw new Error('Nenhuma linha reconhecida no Analítico. Confira se é o CSV com o cabeçalho EMPRESA;ESTABELECIMENTO;…, sem reformatação.');
    }
  }

  let embarcadas = null;
  if (fileEmbarcadas) {
    avisar('Lendo NFs Embarcadas…');
    embarcadas = parsearPfasEmbarcadas(await fileEmbarcadas.text());
  }

  let ultimoPayload = null;
  if (!pendentes || !analitico || !embarcadas) {
    avisar('Buscando o último abastecimento pra completar o que não foi reenviado agora…');
    ultimoPayload = await window.buscarUltimoPayload(supabaseClient, 'pfas');
  }

  avisar(
    (pendentes ? pendentes.registros.length.toLocaleString('pt-BR') + ' PFAs pendentes (novo) · ' : 'Pendentes mantido do último abastecimento · ') +
    (analitico ? analitico.registros.length.toLocaleString('pt-BR') + ' linhas no Analítico (novo) · ' : 'Analítico mantido do último abastecimento · ') +
    (embarcadas ? embarcadas.registros.length.toLocaleString('pt-BR') + ' notas embarcadas (novo).' : 'Embarcadas mantido do último abastecimento.')
  );

  avisar('Carregando gabarito de famílias…');
  const linhasFam = await window.lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, marca, categoria, segmento');
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));

  // ajustes_pfa é lido fresco a cada upload de PFAs — mesmo padrão de
  // dim_familias acima. Subir só a planilha de ajustes (Admin › Ajustes de
  // PFA) grava a tabela na hora, mas os cards e a exclusão do pendente só
  // refletem no PRÓXIMO upload de Pendentes/Analítico/Embarcadas — não tem
  // como recalcular sem os arquivos brutos, que não ficam guardados.
  avisar('Carregando ajustes de PFA…');
  // PK de ajustes_pfa é 'id' — não 'codigo' (default do paginador, pensado
  // pras dimensões dim_armazens/dim_familias). Sem passar isso explícito
  // a paginação tentava ORDER BY numa coluna que não existe na tabela.
  const linhasAjustes = await window.lerTudoPaginado(supabaseClient, 'ajustes_pfa',
    'tipo, encomenda, pfa_antiga, pfa_nova, cliente, familia_codigo, artigo, cor_tam, qtde_total_pedido, qtde_faltante, motivo, data_solicitacao, solicitante',
    null, 'id');
  const ajustes = { registros: linhasAjustes };

  // Dicionário artigo->família (populado a cada upload de Picking/Pulmão)
  // é o que permite os filtros de Marca/Segmento do topo da tela também
  // recortarem o card "Perdas e ajustes do período" — sem ele, ajuste não
  // tem marca/segmento nenhum pra filtrar (a planilha manual só traz o
  // código do artigo, não a família). Artigo que nunca passou por um
  // upload de Picking/Pulmão fica sem marca/segmento — visível como tal,
  // nunca escondido do card.
  // PK de dim_artigo_familia é 'artigo_codigo' — mesmo motivo acima.
  const linhasArtigoFamilia = await window.lerTudoPaginado(supabaseClient, 'dim_artigo_familia',
    'artigo_codigo, familia_codigo', null, 'artigo_codigo');
  const mapaArtigoFamiliaPfa = new Map(linhasArtigoFamilia.map(function (a) { return [a.artigo_codigo, a.familia_codigo]; }));

  avisar('Cruzando os arquivos…');
  const payload = construirSnapshotPfas(pendentes, analitico, embarcadas, mapaFamilias, {
    arquivo_pendentes: filePendentes ? filePendentes.name : null,
    arquivo_analitico: fileAnalitico ? fileAnalitico.name : null,
    arquivo_embarcadas: fileEmbarcadas ? fileEmbarcadas.name : null,
  }, ajustes, mapaArtigoFamiliaPfa, ultimoPayload);

  if (payload.stats.excluidas_por_embarque.pfas) {
    avisar(
      payload.stats.excluidas_por_embarque.pfas + ' PFA(s) já embarcadas foram tiradas do pendente (' +
      payload.stats.excluidas_por_embarque.pares.toLocaleString('pt-BR') + ' pares).'
    );
  }
  if (!embarcadas && !(ultimoPayload && ultimoPayload.embarcadas_pfas && ultimoPayload.embarcadas_pfas.length)) {
    avisar('Aviso: nenhum arquivo de NFs Embarcadas foi enviado ainda — o que já saiu continua contando como pendente.');
  }

  avisar('Gravando snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'pfas', payload: payload, gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  avisar('Concluído.');
  return payload;
}

/* ============================================================================
   UPLOAD — AJUSTES DE PFA
   ============================================================================
   Upsert, nunca insert puro: a chave natural (encomenda, pfa_antiga, artigo,
   cor_tam) é a mesma constraint UNIQUE da tabela — reenviar a planilha com
   uma linha corrigida SUBSTITUI a linha antiga em vez de duplicar o
   prejuízo. Não recalcula o snapshot de PFAs sozinho (ver comentário em
   processarPfas) — só grava a tabela; os cards atualizam no próximo upload
   de Pendentes/Analítico/Embarcadas.
   ============================================================================ */
async function processarAjustesPfa(supabaseClient, fileAjustes, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo planilha de ajustes…');
  const ehXlsx = /\.xlsx$/i.test(fileAjustes.name || '');
  const ajustes = ehXlsx ? await parsearAjustesPfaXlsx(fileAjustes) : parsearAjustesPfa(await fileAjustes.text());
  if (ajustes.registros.length === 0) {
    throw new Error('Nenhuma linha reconhecida. Confira se é o modelo baixado (.xlsx) ou o CSV com o cabeçalho tipo;encomenda;pfa_antiga;…, sem reformatação.');
  }
  if (ajustes.linhas_invalidas) {
    avisar(
      'Atenção: ' + ajustes.linhas_invalidas.toLocaleString('pt-BR') +
      ' linha(s) ignorada(s) por tipo desconhecido ou campo obrigatório vazio (encomenda/pfa_antiga/artigo).'
    );
  }

  avisar('Gravando ' + ajustes.registros.length.toLocaleString('pt-BR') + ' linha(s) em ajustes_pfa…');
  const { error } = await supabaseClient.from('ajustes_pfa')
    .upsert(ajustes.registros, { onConflict: 'encomenda,pfa_antiga,artigo,cor_tam' });
  if (error) throw error;

  avisar('Concluído — os cards da tela "PFAs em tela" atualizam no próximo upload de Pendentes/Analítico/Embarcadas.');
  return ajustes;
}

window.processarPfas = processarPfas;
window.processarAjustesPfa = processarAjustesPfa;
window.parsearPfasPendentes = parsearPfasPendentes;
window.parsearPfasAnalitico = parsearPfasAnalitico;
window.parsearPfasEmbarcadas = parsearPfasEmbarcadas;
window.parsearAjustesPfa = parsearAjustesPfa;
window.construirSnapshotPfas = construirSnapshotPfas;
window.ORDEM_ETAPA_PFA = ORDEM_ETAPA_PFA;
window.FAIXAS_FIFO_PFA = FAIXAS_FIFO_PFA;

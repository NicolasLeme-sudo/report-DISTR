/* ============================================================================
   START INICIAL — regras compartilhadas entre o report (index.html) e o telão (tv.html)
   ============================================================================
   Etapas da tela, clientes que personalizam, reclassificação das PFAs em
   Leitura expedição (aplicarEtapaPersona) e cores do funil/FIFO. Antes moravam
   dentro do index.html; vieram para cá (05/11/2026) para o telão DISTR mostrar
   exatamente os mesmos números do report. resumoStartInicial() é o resumo sem
   filtros que o telão desenha.
   ============================================================================ */
(function (raiz) {
/* Etapas na ordem da operação, numeradas (pedido do usuário, 24/09/2026).
   "Material em personalizacao" NÃO vem do arquivo: é a PFA em "Leitura
   expedicao" de cliente que personaliza (lista em Admin › Abastecimento),
   reclassificada na tela — ver aplicarEtapaPersona. */
const ETAPA_PERSONA = 'Material em personalizacao';
/* "Lido na esteira" (29/09/2026, regra do usuário): PFA em Leitura expedição
   que NÃO está no Analítico (lá só fica volume que ainda falta passar na
   esteira) e NÃO está nas NFs Embarcadas (embarcada já sai do Pendentes) =
   todos os volumes lidos, esperando o embarque. É a conferência "completa". */
const ETAPA_LIDA = 'Lido na esteira';
const ORDEM_ETAPA_TELA = ['Nao disp. picking', 'Disp. p/ picking', 'Em picking', 'Gerar Nota Fiscal', ETAPA_PERSONA, 'Leitura expedicao', ETAPA_LIDA];
const ROT_ETAPA_PFA = {
  'Nao disp. picking': '00 - Não Disp. Picking',
  'Disp. p/ picking': '01 - Disp. p/ Picking',
  'Em picking': '02 - Em Picking',
  'Gerar Nota Fiscal': '03 - Gerar Nota Fiscal',
  'Material em personalizacao': '04 - Material em Personalização',
  'Leitura expedicao': '05 - Leitura Expedição',
  'Lido na esteira': '06 - Lido na Esteira (Ag. Embarque)',
};

/* ---------- Clientes que personalizam ----------
   Lista padrão = planilha "Base de Clientes que personalizam DISTR" + 8 nomes
   sem razão social (24/09/2026). A lista em uso vem da tabela
   dim_clientes_persona (mesma carga inicial); esta constante só vale se a
   tabela não responder.
   Casamento: nome do cliente da PFA, sem acento/pontuação, CONTÉM o nome da
   lista como palavras inteiras (então "FLAMBOYAN" pega a razão social que
   tiver FLAMBOYAN). Linha "N" com o nome exato força não-persona. */
const CLIENTES_PERSONA_PADRAO = [
  ["ABYS MODAS LTDA", "S"],
  ["ADELINA MODAS LTDA", "S"],
  ["ALF COMERCIO DE CALCADOS LTDA", "S"],
  ["ALM COMERCIAL DE CALCADOS LTDA", "S"],
  ["AMAZON SERVICOS DE VAREJO DO BRASIL LTDA.", "N"],
  ["BADAN ARTIGOS ESPORTIVOS LTDA", "S"],
  ["BIG BELEM CALCADOS LTDA", "S"],
  ["BISOL CALCADOS E ARTIGOS ESPORTIVOS LTDA - EPP", "S"],
  ["CAL CENTER COM DE CALC LTDA", "S"],
  ["CAL-CENTER COMERCIO DE CALCADOS LTDA", "S"],
  ["CALZADOS ROGER S.A.", "S"],
  ["CASA BAYARD ARTIGOS PARA ESPORTES LTDA", "N"],
  ["CASA SORAYA LTDA.", "S"],
  ["CHRIS INDUSTRIA E COMERCIO DE CONFECCOES LTDA", "S"],
  ["DEP COMERCIO DE CALCADOS LTDA", "S"],
  ["DF WORK COMERCIO DE CALCADOS LTDA", "S"],
  ["DJP COMERCIAL DE CALCADOS LTDA", "S"],
  ["DREBES & CIA LTDA", "S"],
  ["DS LOG COMERCIO DE CALCADOS LTDA", "S"],
  ["DS.COM.BR COMERCIO DE CALCADOS LTDA", "S"],
  ["DSR COML DE CALCADOS LTDA", "S"],
  ["EBAZAR.COM.BR. LTDA", "N"],
  ["ECLIPSE COM.DE CALCADOS LTDA", "S"],
  ["ECLIPSE COMERCIO DE CALCADOS LTDA", "S"],
  ["ELDA COMERCIAL CALCADOS LTDA", "S"],
  ["ELI COMERCIO DE CALCADOS LTDA", "S"],
  ["ESTRATEGIA CALCADOS LTDA", "S"],
  ["EUZIMAR A. NOBRE", "S"],
  ["FCO COMERCIAL DE CALCADOS LTDA", "S"],
  ["FF.COM ESPORTES LTDA", "S"],
  ["FLYTE COM CALC LTDA", "S"],
  ["FORMOSA SUPERMERCADOS E MAGAZINE LTDA", "N"],
  ["FRANK SILVESTRIN DE SOUZA", "S"],
  ["GERALDO ALEXANDRE JANUARIO FALDAO EPP", "S"],
  ["ISA COMERCIAL DE CALCADOS LTDA", "S"],
  ["JQG COMERCIAL DE CALCADOS LTDA", "S"],
  ["JSP COMERCIAL DE CALCADOS LTDA", "S"],
  ["JULI COMERCIO DE CALCADOS LTDA", "S"],
  ["KAREN COMERCIAL DE CALCADOS LTDA", "S"],
  ["KENIAK COM DE CALC LTDA", "S"],
  ["KYRALY COM CALC LTDA", "S"],
  ["LFM COMERCIAL DE CALCADOS LTDA", "S"],
  ["LIDER COMERCIO E INDUSTRIA LTDA", "S"],
  ["LINDA COMERCIAL DE CALCADOS LTDA", "S"],
  ["LNJC COMERCIO DA MODA LTDA", "S"],
  ["LOJA VINTE E NOVE LTDA", "S"],
  ["LOJAS AVENIDA S.A", "S"],
  ["LUIS FELIPE CAGLIARI DE SOUZA", "S"],
  ["LUIZA CALCADOS LTDA", "S"],
  ["M MODAS LTDA", "S"],
  ["MARJA COMERCIO DE CALCADOS LTDA", "S"],
  ["MARJOV COMERCIO DE ROUPAS E CALCADOS LTDA", "S"],
  ["MM PAPELARIA PROMISSAO LTDA", "S"],
  ["MN COMERCIO DE CALCADOS LTDA - ME", "S"],
  ["MRM COMERCIAL DE CALCADOS LTDA", "S"],
  ["NACIONAL BREVES COMERCIO DE CALCADOS LTDA", "N"],
  ["NACIONAL CASTANHAL COMERCIO DE CALCADOS LTDA", "N"],
  ["NACIONAL MOJU COMERCIO DE CALCADOS LTDA", "N"],
  ["NACIONAL MOJU II COMERCIO DE CALCADOS", "N"],
  ["ONE CALCADOS LTDA", "S"],
  ["OSANA ANA DE LIRA GARRIDO ME", "S"],
  ["PINHEIRO TECIDOS LTDA", "S"],
  ["PITTOL CALCADOS LTDA", "S"],
  ["PIUMA CALCADOS LTDA", "S"],
  ["PK COMERCIAL DE CALCADOS LTDA", "S"],
  ["QUEIROZ COMERCIAL DE CALCADOS LTDA", "S"],
  ["R MILET COMERCIO DE CALCADOS LTDA", "S"],
  ["RED COMERCIAL DE CALCADOS LTDA", "S"],
  ["REGIONAL ALENQUER COMERCIO DE CALCADOS LTDA", "S"],
  ["REGIONAL ITAITUBA COMERCIO DE CALCADOS LTDA", "S"],
  ["REGIONAL JURITI COMERCIO DE CALCADOS LTDA", "S"],
  ["REGIONAL ORIXIMINA COMERCIO DE CALCADOS LTDA", "S"],
  ["REGIONAL VIGIA COMERCIO DE CALCADOS LTDA", "S"],
  ["REGIS COMERCIO DE CALCADOS LTDA", "S"],
  ["S.SALLUM LTDA", "S"],
  ["SBF COMERCIO DE PRODUTOS ESPORTIVOS S.A.", "N"],
  ["SNICKER COM CALC LTDA", "S"],
  ["SNICKER COMERCIO DE CALCADOS LTDA", "S"],
  ["T.A.N. MOUTINHO COMERCIO", "S"],
  ["TK COMERCIAL DE CALCADOS LTDA", "S"],
  ["TOBELLI COMERCIO DE CALCADOS LTDA", "S"],
  ["TOP COMERCIO DE CALCADOS LTDA", "S"],
  ["TWO FRIENDS COMERCIO DE CALCADOS E CONFECCOES LTDA", "S"],
  ["UBS COMERCIAL DE CALCADOS LTDA", "S"],
  ["ULTRA 1 ONLINE LTDA", "S"],
  ["VECTRA COMERCIO DE CALCADOS LTDA", "S"],
  ["VIANA COMERCIO DE CALCADOS LTDA", "S"],
  ["FLAMBOYAN", "S"],
  ["CALCENTER", "S"],
  ["LÍDER", "S"],
  ["POLICE", "S"],
  ["ZAPEC", "S"],
  ["CALZADOS ROGER", "S"],
  ["ABYS", "S"],
  ["OSCAR E ABYS", "S"]
];
function listaPadraoPersona() { return CLIENTES_PERSONA_PADRAO.map(function (r) { return { nome: r[0], personalizavel: r[1] === 'S' }; }); }
function normalizarNomeCliente(t) {
  return ' ' + String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
}
function ehClientePersona(nome, lista) {
  const clientesPersona = lista || listaPadraoPersona();
  const n = normalizarNomeCliente(nome);
  if (n.trim() === '') return false;
  let casou = false;
  for (let i = 0; i < clientesPersona.length; i++) {
    const c = clientesPersona[i], k = normalizarNomeCliente(c.nome);
    if (k.trim() === '') continue;
    if (!c.personalizavel) { if (k === n) return false; continue; }
    if (n.indexOf(k) !== -1) casou = true;
  }
  return casou;
}
/* Reclassifica Leitura expedição -> Material em personalização pelos
   clientes da lista e põe as etapas na ordem da tela. Idempotente: guarda a
   situação do arquivo em situacao_arquivo e sempre parte dela. */
function aplicarEtapaPersona(p, lista) {
  if (!p) return;
  // Data da NF de cada PFA (a mais antiga no Analítico/aguardando coleta) —
  // coluna "Data NF" da tabela e filtro "NF Emitida?" (24/09/2026).
  const notaPfa = new Map();
  (p.aguardando_coleta || []).forEach(function (r) {
    if (!r.data_nota) return;
    const atual = notaPfa.get(r.pfa);
    if (!atual || r.data_nota < atual) notaPfa.set(r.pfa, r.data_nota);
  });
  // Pendentes (NOTA FISCAL + DT. NF) é a fonte principal; Analítico cobre
  // snapshot antigo / PFA sem data no Pendentes (mescla, 24/09/2026).
  (p.pendentes || []).forEach(function (r) {
    r.data_nota = r.data_nota_pendentes || notaPfa.get(r.pfa) || null;
    r.fonte_nota = r.data_nota_pendentes ? 'pendentes' : (r.data_nota ? 'analitico' : null);
  });
  // Snapshot processado antes de 24/09/2026 leu o Analítico ao contrário
  // (volume no arquivo = lido; na verdade é o que AINDA NÃO passou na
  // esteira). conferencia_lidos desses snapshots é a contagem de pendentes —
  // reconverte aqui pra tela ficar certa sem precisar reprocessar.
  if (p.conferencia_regra !== raiz.REGRA_CONFERENCIA && raiz.statusConferenciaPorPendentes) {
    (p.pendentes || []).forEach(function (r) {
      const c = raiz.statusConferenciaPorPendentes(r.situacao_arquivo || r.situacao, r.conferencia_total,
        r.conferencia_lidos, r.dias_na_etapa);
      r.conferencia = c.status; r.conferencia_lidos = c.volumes_lidos; r.conferencia_total = c.volumes_total;
    });
    p.conferencia_regra = raiz.REGRA_CONFERENCIA;
  }
  (p.pendentes || []).forEach(function (r) {
    if (r.situacao_arquivo === undefined) r.situacao_arquivo = r.situacao;
    // Cliente que personaliza vence o "Lido na esteira": o material vai pra
    // personalização mesmo com todos os volumes lidos (27/10/2026).
    r.situacao = r.situacao_arquivo !== 'Leitura expedicao' ? r.situacao_arquivo
      : ehClientePersona(r.cliente_nome, lista) ? ETAPA_PERSONA
      : r.conferencia === 'completa' ? ETAPA_LIDA
      : r.situacao_arquivo;
  });
  const extras = (p.etapas || []).filter(function (e) { return ORDEM_ETAPA_TELA.indexOf(e) === -1; });
  p.etapas = ORDEM_ETAPA_TELA.concat(extras);
}

/* Cor da etapa no funil: não é semáforo de "ruim", é posição no fluxo — o
   material anda da esquerda (ainda nem liberado) pra direita (só falta a
   nota). Vermelho fica reservado pro fim da fila, que é onde parar dói mais. */
const COR_ETAPA_PFA = {
  'Nao disp. picking': '--red',
  'Disp. p/ picking': '--gelo',
  'Em picking': '--verde-escuro',
  'Gerar Nota Fiscal': '--laranja',
  'Material em personalizacao': '--amber',
  'Leitura expedicao': '--accent',
  'Lido na esteira': '--roxo',
};
const COR_FAIXA_FIFO = { '0-2': '--olive', '3-5': '--verde-musgo', '6-10': '--amber', '11+': '--red' };

/* Dias corridos desde uma data ISO (meio-dia a meio-dia, nunca negativo) — mesma conta do index.html. */
function diasDesdeIso(yyyymmdd, agora) {
  if (!yyyymmdd) return null;
  const p = String(yyyymmdd).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2], 12);
  const h = agora ? new Date(agora.getTime()) : new Date(); h.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((h - d) / 86400000));
}

/* Coluna da Matriz NF × Segmento: Chinelo e Chuteira entram em Calçados; o resto fora das 4 vira Outros. */
const COLS_MATRIZ_NF = [
  { chave: 'ACESSÓRIO', rotulo: 'Acessórios' }, { chave: 'CALÇADO', rotulo: 'Calçados' },
  { chave: 'MEIA', rotulo: 'Meias' }, { chave: 'VESTUÁRIO', rotulo: 'Vestuários' },
];
function colunaMatrizNf(seg) {
  if (seg === 'CHINELO' || seg === 'CHUTEIRA' || seg === 'CALÇADO') return 'CALÇADO';
  return COLS_MATRIZ_NF.some(function (c) { return c.chave === seg; }) ? seg : 'OUTROS';
}

/* Material pendente do telão (pedido do Nicolas, 05/11/2026): tudo em tela menos "00 Não Disp. Picking"
   (ainda nem liberado) e "06 Lido na Esteira" (já lido, aguardando embarque). As duas etapas continuam no funil. */
const FORA_DO_PENDENTE = ['Nao disp. picking', ETAPA_LIDA];

/* Resumo do Start Inicial SEM filtros (o telão não tem filtro). `p` já passou por aplicarEtapaPersona.
   Mesmas contas do index.html (renderizarPfas) com o recorte total:
   - NF emitida ag. coleta = PFAs em tela com data de NF; mais antiga = menor data de NF (peças da PFA inteira);
   - funil = etapas da tela na ordem, as 7 sempre (mesmo zeradas), extra só se tiver PFA;
   - FIFO = pares por faixa_fifo; matriz = data da NF (ou Sem NF) × segmento, em peças e PFAs. */
function resumoStartInicial(p, agora) {
  const pend = (p && p.pendentes) || [];
  const pares = function (l) { return l.reduce(function (s, r) { return s + (r.pares || 0); }, 0); };
  const total = { pares: pares(pend), pfas: pend.length };
  const pendLista = pend.filter(function (r) { return FORA_DO_PENDENTE.indexOf(r.situacao) === -1; });
  const pendente = { pares: pares(pendLista), pfas: pendLista.length };

  const comNota = pend.filter(function (r) { return r.data_nota; });
  const nfAgColeta = { pares: pares(comNota), pfas: new Set(comNota.map(function (r) { return r.pfa; })).size };
  const pecasPorPfa = new Map();
  comNota.forEach(function (r) { pecasPorPfa.set(r.pfa, (pecasPorPfa.get(r.pfa) || 0) + (r.pares || 0)); });
  const antiga = comNota.reduce(function (mx, r) { return (!mx || r.data_nota < mx.data_nota) ? r : mx; }, null);
  const maisAntiga = antiga ? { pfa: antiga.pfa, data_nota: antiga.data_nota, dias: diasDesdeIso(antiga.data_nota, agora),
    pecas: pecasPorPfa.get(antiga.pfa) || 0, cliente: antiga.cliente_nome || '' } : null;

  const porEtapa = new Map();
  pend.forEach(function (r) {
    if (!porEtapa.has(r.situacao)) porEtapa.set(r.situacao, { pares: 0, pfas: 0 });
    const g = porEtapa.get(r.situacao); g.pares += r.pares || 0; g.pfas++;
  });
  const etapas = [];
  ((p && p.etapas) || ORDEM_ETAPA_TELA).forEach(function (e) {
    const g = porEtapa.get(e) || (ORDEM_ETAPA_TELA.indexOf(e) !== -1 ? { pares: 0, pfas: 0 } : null);
    if (!g) return;
    etapas.push({ etapa: e, rotulo: ROT_ETAPA_PFA[e] || e, cor: COR_ETAPA_PFA[e] || '--accent', pares: g.pares, pfas: g.pfas });
  });

  const porFaixa = new Map();
  pend.forEach(function (r) {
    if (!r.faixa_fifo) return;
    if (!porFaixa.has(r.faixa_fifo)) porFaixa.set(r.faixa_fifo, { pares: 0, pfas: 0 });
    const f = porFaixa.get(r.faixa_fifo); f.pares += r.pares || 0; f.pfas++;
  });
  const fifo = ((p && p.faixas_fifo) || []).map(function (f) {
    const v = porFaixa.get(f.chave) || { pares: 0, pfas: 0 };
    return { chave: f.chave, rotulo: f.rotulo, cor: COR_FAIXA_FIFO[f.chave] || '--accent', pares: v.pares, pfas: v.pfas };
  });

  const celulas = new Map();   // linha -> col -> { pares, pfas:Set }
  let temOutros = false;
  pend.forEach(function (r) {
    const linha = r.data_nota || 'SEM', col = colunaMatrizNf(r.segmento_macro);
    if (col === 'OUTROS') temOutros = true;
    if (!celulas.has(linha)) celulas.set(linha, new Map());
    const m = celulas.get(linha);
    if (!m.has(col)) m.set(col, { pares: 0, pfas: new Set() });
    const c = m.get(col); c.pares += r.pares || 0; c.pfas.add(r.pfa);
  });
  const cols = COLS_MATRIZ_NF.concat(temOutros ? [{ chave: 'OUTROS', rotulo: 'Outros' }] : []);
  const linhasMatriz = (celulas.has('SEM') ? ['SEM'] : []).concat(Array.from(celulas.keys()).filter(function (k) { return k !== 'SEM'; }).sort());
  const matriz = { cols: cols, linhas: linhasMatriz.map(function (k) {
    const m = celulas.get(k);
    const vals = cols.map(function (c) { const x = m.get(c.chave); return x ? { pares: x.pares, pfas: x.pfas.size } : { pares: 0, pfas: 0 }; });
    return { chave: k, vals: vals, pares: vals.reduce(function (s, v) { return s + v.pares; }, 0) };
  }) };

  const porSeg = new Map();
  pend.forEach(function (r) {
    const seg = r.segmento_macro || 'SEM SEGMENTO';
    if (!porSeg.has(seg)) porSeg.set(seg, { segmento: seg, pares: 0, pfas: 0 });
    const x = porSeg.get(seg); x.pares += r.pares || 0; x.pfas++;
  });
  const segmentos = Array.from(porSeg.values()).sort(function (a, b) { return b.pares - a.pares; });

  return { total: total, pendente: pendente, nfAgColeta: nfAgColeta, maisAntiga: maisAntiga,
    etapas: etapas, fifo: fifo, matriz: matriz, segmentos: segmentos, ajustesEmAberto: (p && p.ajustes_em_aberto) || 0 };
}

raiz.StartInicialCalc = {
  ETAPA_PERSONA: ETAPA_PERSONA, ETAPA_LIDA: ETAPA_LIDA, ORDEM_ETAPA_TELA: ORDEM_ETAPA_TELA, ROT_ETAPA_PFA: ROT_ETAPA_PFA,
  CLIENTES_PERSONA_PADRAO: CLIENTES_PERSONA_PADRAO, COR_ETAPA_PFA: COR_ETAPA_PFA, COR_FAIXA_FIFO: COR_FAIXA_FIFO,
  listaPadraoPersona: listaPadraoPersona, normalizarNomeCliente: normalizarNomeCliente, ehClientePersona: ehClientePersona,
  aplicarEtapaPersona: aplicarEtapaPersona, diasDesdeIso: diasDesdeIso, colunaMatrizNf: colunaMatrizNf,
  resumoStartInicial: resumoStartInicial,
};
if (typeof module !== 'undefined' && module.exports) module.exports = raiz.StartInicialCalc;
})(typeof window !== 'undefined' ? window : globalThis);

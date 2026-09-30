/* ============================================================================
   REPORT DISTRIBUIDORA — ingest-emails-ajustes.js
   ============================================================================
   Lê os e-mails (.msg do Outlook) que a assistente troca com o comercial e
   devolve as linhas de ajuste já no formato da planilha de Ajustes de PFA,
   com validação contra o último snapshot de PFAs (pedido da gestão,
   23/09/2026: "ela baixa os e-mails e o sistema valida").

   Dois formatos reais (e-mails de 16–21/09/2026):
   - "PFA COM DIVERGÊNCIA" (sem NF): PFA|CLIENTE|ENC|QUANT. PARES|VOL|FAM|ART|
     DES|COR|TAM|QUANT. FALTANTE|TOTAL FALTAS(PFA)|SITUAÇÃO|COD. REP.
     "FALTA TOTAL" é do ITEM: vira CANCELAMENTO só quando a soma das faltas
     cobre o pedido inteiro; senão AJUSTE (PFA refeita sem o item).
   - "NFs COM DIVERGÊNCIA" (com NF): mesma tabela com NF na 1ª coluna. A
     resposta do comercial na mesma thread traz NF|PFA|CLIENTE|SITUAÇÃO|
     COD. REP|INSTRUÇÃO: EMBARCAR -> BO_POS_NF (envio faltante com NF),
     DEVOLVER -> AD_DEVOLUCAO. Sem instrução ainda: fica "aguardando comercial".

   O .msg é um arquivo OLE/CFB; o corpo em texto fica no stream
   __substg1.0_1000001F (UTF-16LE). Lido com XLSX.CFB (SheetJS, já carregado
   na página) — nenhuma dependência nova. No texto, cada célula da tabela vira
   uma linha; célula mesclada vazia aparece como "." ou some (às vezes deixando
   um TAB no começo da célula seguinte) — por isso o parser ancora no início
   do registro (NF/PFA de 6 dígitos + cliente "CL") e na SITUAÇÃO, não em
   contagem fixa de linhas no fim do registro.
   ============================================================================ */

const RE_6DIG = /^\d{6}$/;
const RE_SITUACAO = /^\s*FALTA\s+(TOTAL|PARCIAL)\b/i;
const RE_INSTRUCAO = /^\s*(EMBARCAR|DEVOLVER|DEVOLU[CÇ][AÃ]O|CANCELAR|ENVIAR)\b/i;

function decodificarUtf16(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder('utf-16le').decode(u8).replace(/\u0000+$/, '');
}

/* PR_CLIENT_SUBMIT_TIME (0x0039, FILETIME) no stream de propriedades da
   mensagem principal: cabeçalho de 32 bytes + entradas de 16. */
function dataEnvioMsg(cfb, XLSX) {
  const e = XLSX.CFB.find(cfb, '__properties_version1.0');
  if (!e || !e.content) return null;
  const b = e.content instanceof Uint8Array ? e.content : new Uint8Array(e.content);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let off = 32; off + 16 <= b.length; off += 16) {
    if (dv.getUint32(off, true) === 0x00390040) {
      const lo = dv.getUint32(off + 8, true), hi = dv.getUint32(off + 12, true);
      const ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
      return new Date(ms);
    }
  }
  return null;
}

function lerMsg(arrayBuffer, XLSX) {
  const cfb = XLSX.CFB.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const corpo = XLSX.CFB.find(cfb, '__substg1.0_1000001F');
  const assunto = XLSX.CFB.find(cfb, '__substg1.0_0037001F');
  const remetente = XLSX.CFB.find(cfb, '__substg1.0_0C1A001F');
  return {
    assunto: assunto ? decodificarUtf16(assunto.content).trim() : '',
    remetente: remetente ? decodificarUtf16(remetente.content).trim() : '',
    data: dataEnvioMsg(cfb, XLSX),
    corpo: corpo ? decodificarUtf16(corpo.content) : '',
  };
}

function numeroCelula(t) {
  const s = String(t || '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/* Registros de divergência (com ou sem NF). `comNf` = a 1ª coluna é NF. */
function extrairRegistrosDivergencia(linhas, comNf) {
  const out = [];
  const n = linhas.length;
  const tam = comNf ? 13 : 12; // campos fixos antes de TOTAL/SITUAÇÃO
  for (let i = 0; i < n; i++) {
    const a = linhas[i].trim();
    if (!RE_6DIG.test(a)) continue;
    const idxCliente = comNf ? i + 2 : i + 1;
    if (comNf && !RE_6DIG.test((linhas[i + 1] || '').trim())) continue;
    if (!/^CL[\s-]/i.test((linhas[idxCliente] || '').trim())) continue;
    // procura a SITUAÇÃO dentro de uma janela curta (TOTAL pode faltar)
    let idxSit = -1;
    for (let j = i + tam - 1; j <= i + tam + 1 && j < n; j++) {
      if (RE_SITUACAO.test(linhas[j])) { idxSit = j; break; }
    }
    if (idxSit === -1) continue;
    const c = linhas.slice(i, i + tam).map(function (x) { return x.trim(); });
    const o = comNf ? 1 : 0;
    // A tabela de INSTRUÇÃO do comercial também começa com NF+PFA+CL — o que
    // separa é a encomenda (5–7 dígitos) e a quantidade do pedido logo depois.
    if (!/^\d{5,7}$/.test(c[o + 2] || '') || numeroCelula(c[o + 3]) === null) continue;
    out.push({
      nf: comNf ? c[0] : null,
      pfa: c[o],
      cliente: c[o + 1],
      encomenda: c[o + 2],
      qtde_total_pedido: numeroCelula(c[o + 3]),
      volume: c[o + 4],
      familia_codigo: c[o + 5],
      artigo: c[o + 6],
      descricao: c[o + 7],
      cor: c[o + 8],
      tam: c[o + 9],
      qtde_faltante: numeroCelula(c[o + 10]),
      situacao: RE_SITUACAO.exec(linhas[idxSit])[1].toUpperCase() === 'TOTAL' ? 'FALTA TOTAL' : 'FALTA PARCIAL',
      cod_rep: (linhas[idxSit + 1] || '').trim(),
    });
    i = idxSit + 1;
  }
  return out;
}

/* Tabela de instrução do comercial: NF|PFA|CLIENTE|SITUAÇÃO|COD. REP|INSTRUÇÃO
   (a INSTRUÇÃO pode vir só na 1ª linha de uma NF repetida). */
function extrairInstrucoes(linhas) {
  const out = new Map(); // nf -> { inst, pos }
  const guardar = function (nf, inst, pos) {
    // Em thread a mensagem mais nova vem em cima: vale a 1ª ocorrência.
    if (!out.has(nf) || pos < out.get(nf).pos) out.set(nf, { inst: inst, pos: pos });
  };
  const normalizar = function (t) {
    const m = RE_INSTRUCAO.exec(t)[1].toUpperCase();
    return /^DEVOL/.test(m) ? 'DEVOLVER' : m;
  };
  for (let i = 0; i + 4 < linhas.length; i++) {
    const nf = linhas[i].trim();
    if (!RE_6DIG.test(nf) || !RE_6DIG.test((linhas[i + 1] || '').trim())) continue;
    if (!/^CL[\s-]/i.test((linhas[i + 2] || '').trim())) continue;
    if (!RE_SITUACAO.test(linhas[i + 3] || '')) continue;
    const talvez = (linhas[i + 5] || '').trim();
    if (RE_INSTRUCAO.test(talvez)) guardar(nf, normalizar(talvez), i);
  }
  /* Tabela CURTA (28/09/2026): a gerente responde só NF | INSTRUÇÃO, com a NF
     repetida em linhas sem instrução quando ela tem mais de um item (a
     instrução vale pra NF inteira). Termina na 1ª linha que não é NF nem
     instrução (ex.: "De: ..." da mensagem citada). */
  for (let i = 0; i + 1 < linhas.length; i++) {
    if (linhas[i].trim().toUpperCase() !== 'NF' || !/^\s*INSTRU[CÇ][AÃ]O\s*$/i.test(linhas[i + 1])) continue;
    let nfAtual = null;
    for (let j = i + 2; j < linhas.length; j++) {
      const t = linhas[j].trim();
      if (RE_6DIG.test(t)) { nfAtual = t; continue; }
      if (nfAtual && RE_INSTRUCAO.test(t)) { guardar(nfAtual, normalizar(t), j); continue; }
      break;
    }
  }
  /* TEXTO LIVRE da mensagem mais nova (30/09/2026): "Esta nota devolver, 222395.
     As demais embarcar." — sem tabela. Só vale o que está ACIMA do primeiro "De:"
     (ou do 1º cabeçalho de tabela); pergunta ("posso enviar…?") não é instrução.
     Cada NF citada recebe o verbo mais próximo; "demais/restantes/outras" +
     verbo vira a instrução padrão das NFs não citadas (chave '*'). */
  let fimTopo = linhas.findIndex(function (l) { return /^\s*De:\s/i.test(l) || /^\s*NF\s*$/i.test(l); });
  if (fimTopo === -1) fimTopo = 0; // sem "De:" nem tabela: não arrisca ler texto livre
  const RE_VERBO = /\b(devolver|devolu[cç][aã]o|devolva|cancelar|cancele|embarcar|embarque|enviar|envie)\b/gi;
  const normVerbo = function (v) { return /^(devol|cancel)/i.test(v) ? 'DEVOLVER' : 'EMBARCAR'; };
  linhas.slice(0, fimTopo).join('\n').split(/[.!;\n]+/).forEach(function (frase) {
    if (frase.indexOf('?') !== -1) return;
    const verbos = [];
    let m;
    RE_VERBO.lastIndex = 0;
    while ((m = RE_VERBO.exec(frase))) verbos.push({ i: m.index, inst: normVerbo(m[1]), padrao: /(demais|restantes?|outras?|todas?|todos|resto)[^,]{0,15}$/i.test(frase.slice(Math.max(0, m.index - 20), m.index)) });
    if (!verbos.length) return;
    verbos.filter(function (v) { return v.padrao; }).forEach(function (v) { if (!out.has('*')) out.set('*', { inst: v.inst, pos: -1 }); });
    const diretos = verbos.filter(function (v) { return !v.padrao; });
    if (!diretos.length) return;
    const reNf = /\b\d{6}\b/g;
    while ((m = reNf.exec(frase))) {
      let melhor = diretos[0];
      diretos.forEach(function (v) { if (Math.abs(v.i - m.index) < Math.abs(melhor.i - m.index)) melhor = v; });
      out.set(m[0], { inst: melhor.inst, pos: -1 });
    }
  });
  const saida = new Map();
  out.forEach(function (v, nf) { saida.set(nf, v.inst); });
  return saida;
}

/* NFs citadas em TEXTO LIVRE da conversa ("a Nota 215880 falta total também")
   DEPOIS da tabela de instrução — em thread a mensagem mais nova fica em
   cima, então só conta o que está acima do cabeçalho INSTRUÇÃO. Sinal de que
   a instrução pode ter mudado. */
function nfsCitadasNoTexto(linhas) {
  const out = new Set();
  const idxInstrucao = linhas.findIndex(function (l) { return /^\s*INSTRU[CÇ][AÃ]O\s*$/i.test(l); });
  if (idxInstrucao === -1) return out;
  linhas.slice(0, idxInstrucao).forEach(function (l) {
    if (RE_6DIG.test(l.trim())) return;
    const re = /\b(?:NF|Nota)\s*(?:n[ºo°.]*\s*)?(\d{6})\b/gi;
    let m;
    while ((m = re.exec(l))) out.add(m[1]);
  });
  return out;
}

/* Um e-mail -> linhas de ajuste. Em thread, o mesmo corpo repete as mensagens
   antigas: registros iguais (NF/PFA/artigo/cor/tam) são deduplicados.
   "FALTA TOTAL" no e-mail é do ITEM, não da PFA (PFA 246191: 225 pares, 18
   faltando, "FALTA TOTAL") — só vira CANCELAMENTO quando a soma das faltas
   cobre o pedido inteiro; senão é AJUSTE (PFA refeita sem o item). */
function interpretarEmailAjuste(msg) {
  const linhas = msg.corpo.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  const temNf = /\bNFs?\b/i.test(msg.assunto) || linhas.some(function (l) { return l.trim() === 'NF'; });
  const registros = extrairRegistrosDivergencia(linhas, temNf);
  const instrucoes = temNf ? extrairInstrucoes(linhas) : new Map();
  const citadas = temNf ? nfsCitadasNoTexto(linhas) : new Set();
  const vistos = new Set();
  const faltaPorPfa = new Map();
  const unicos = new Set();
  // Chave com VOLUME: o mesmo SKU pode faltar em 2 volumes da PFA (246191:
  // 3 no vol. 2 + 15 no vol. 3) — são linhas diferentes, não repetição de thread.
  registros.forEach(function (r) {
    const k = [r.nf, r.pfa, r.artigo, r.cor, r.tam, r.volume].join('|');
    if (unicos.has(k)) return;
    unicos.add(k);
    faltaPorPfa.set(r.pfa, (faltaPorPfa.get(r.pfa) || 0) + (r.qtde_faltante || 0));
  });
  const liberadaCancelamento = /liberada para cancelamento/i.test(msg.corpo);
  /* Resposta do comercial ("Encomenda ajustada", "Segue PFA gerada"): só vale o
     texto da mensagem MAIS NOVA (acima do primeiro "De:" citado). Quando ela
     traz um nº de PFA diferente das do quadro, é a PFA nova. */
  const iDe = linhas.findIndex(function (l) { return /^\s*De:\s/i.test(l); });
  const topo = (iDe === -1 ? linhas : linhas.slice(0, iDe)).join('\n');
  const ajustadoPeloComercial = /encomenda\s+ajustada|pfa\s+(gerada|criada|nova)|ajuste\s+(realizado|conclu[ií]do|feito)|\bajustad[oa]\b/i.test(topo);
  const pfasDoQuadro = new Set(registros.map(function (r) { return r.pfa; }));
  const novasNoTopo = (topo.match(/\b\d{6}\b/g) || []).filter(function (n) { return !pfasDoQuadro.has(n); });
  const pfaNovaEmail = novasNoTopo.length === 1 ? novasNoTopo[0] : null;
  const data = msg.data ? new Date(msg.data.getTime() - msg.data.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null;
  const saida = [];
  const porSku = new Map();
  registros.forEach(function (r) {
    const chaveVol = [r.nf, r.pfa, r.artigo, r.cor, r.tam, r.volume].join('|');
    if (vistos.has(chaveVol)) return;
    vistos.add(chaveVol);
    // Planilha de Ajustes guarda UMA linha por PFA+artigo+cor+tam: soma volumes.
    const chaveSku = [r.nf, r.pfa, r.artigo, r.cor, r.tam].join('|');
    if (porSku.has(chaveSku)) {
      const ja = porSku.get(chaveSku);
      ja.qtde_faltante = (ja.qtde_faltante || 0) + (r.qtde_faltante || 0);
      ja.volume = ja.volume + ',' + r.volume;
      return;
    }
    let tipo, status;
    if (r.nf) {
      const inst = instrucoes.get(r.nf) || instrucoes.get('*');
      if (inst === 'EMBARCAR' || inst === 'ENVIAR') { tipo = 'BO_POS_NF'; status = 'Comercial autorizou embarcar com falta'; }
      else if (inst === 'DEVOLVER' || inst === 'CANCELAR') { tipo = 'AD_DEVOLUCAO'; status = 'Comercial pediu devolução'; }
      else { tipo = null; status = 'Aguardando instrução do comercial'; }
      if (citadas.has(r.nf)) status += ' — NF citada de novo na conversa: conferir se a instrução mudou';
    } else {
      const pedidoTodo = r.qtde_total_pedido != null && (faltaPorPfa.get(r.pfa) || 0) >= r.qtde_total_pedido;
      tipo = pedidoTodo ? 'CANCELAMENTO' : 'AJUSTE';
      status = liberadaCancelamento
        ? (pedidoTodo ? 'PFA liberada para cancelamento (falta o pedido inteiro)' : 'PFA liberada para refazer sem o item faltante')
        : 'Solicitado ajuste';
    }
    const respondido = ajustadoPeloComercial && tipo === 'AJUSTE';
    if (respondido) status = 'Comercial informou: encomenda ajustada / PFA gerada' + (pfaNovaEmail ? ' (' + pfaNovaEmail + ')' : '');
    const linha = Object.assign({}, r, {
      ajustado_pelo_comercial: respondido, pfa_nova_email: respondido ? pfaNovaEmail : null,
      tipo: tipo, status: status, data_solicitacao: data,
      data_hora_email: msg.data ? msg.data.toISOString() : '',
      assunto: msg.assunto, solicitante: msg.remetente,
    });
    porSku.set(chaveSku, linha);
    saida.push(linha);
  });
  return saida;
}

/* Vários e-mails de uma vez: a mesma linha (NF/PFA/artigo/cor/tam) pode vir
   em mais de um (thread encaminhada). Vale a do e-mail MAIS RECENTE. */
function consolidarLinhasEmails(listas) {
  const porChave = new Map();
  listas.reduce(function (a, l) { return a.concat(l); }, [])
    .sort(function (a, b) { return String(a.data_hora_email || '').localeCompare(String(b.data_hora_email || '')) || (a._ordem || 0) - (b._ordem || 0); })
    .forEach(function (l) {
      const k = [l.nf, l.pfa, l.artigo, l.cor, l.tam].join('|');
      const ja = porChave.get(k);
      // Linha COM NF que já tem instrução do comercial não volta pra "sem
      // instrução" só porque um e-mail posterior (encaminhamento, nova
      // cobrança, resposta da assistente) repetiu a tabela sem a resposta
      // (28/09/2026). Instrução nova (EMBARCAR -> DEVOLVER) continua valendo.
      if (ja && l.nf && ja.tipo && !l.tipo) return;
      porChave.set(k, l);
    });
  return Array.from(porChave.values());
}

/* Validação contra o último snapshot de PFAs (pendentes + analítico com
   nota). Cada linha ganha `alertas` (lista de textos) — nada é bloqueado. */
/* Número da NF comparável entre as fontes: Pendentes traz "1-1-217831"
   (estab-série-número), Analítico e e-mail trazem só "217831". */
function numeroNf(nf) {
  const partes = String(nf == null ? '' : nf).trim().split('-');
  const n = partes[partes.length - 1].replace(/\D/g, '').replace(/^0+/, '');
  return n || null;
}
function validarLinhasEmail(linhas, snapshotPfas, historicoNf) {
  const pend = new Map(), notaPorPfa = new Map(), pfasComNota = new Map(), notaDoHistorico = new Set();
  ((snapshotPfas && snapshotPfas.pendentes) || []).forEach(function (r) {
    pend.set(String(r.pfa), r);
    // NF do Pendentes (24/09/2026) — cobre PFA faturada que já saiu do Analítico.
    if (r.nota_fiscal) {
      notaPorPfa.set(String(r.pfa), numeroNf(r.nota_fiscal));
      pfasComNota.set(String(r.pfa), r.pares || 0);
    }
  });
  ((snapshotPfas && snapshotPfas.aguardando_coleta) || []).forEach(function (r) {
    if (!r.nota || notaPorPfa.has(String(r.pfa))) return;
    notaPorPfa.set(String(r.pfa), numeroNf(r.nota));
    pfasComNota.set(String(r.pfa), (pfasComNota.get(String(r.pfa)) || 0) + (r.qtde || 0));
  });
  // PFA embarcada: NF do relatório de NFs Embarcadas (notas_expedidas).
  const emb = (snapshotPfas && snapshotPfas.embarcadas_nf) || {};
  Object.keys(emb).forEach(function (pfa) {
    if (notaPorPfa.has(pfa) || !emb[pfa] || !emb[pfa][0]) return;
    notaPorPfa.set(pfa, numeroNf(emb[pfa][0]));
    pfasComNota.set(pfa, Number(emb[pfa][2]) || 0);
  });
  // PFA que já saiu do Pendentes atual (expedida): NF do histórico de
  // Pendentes (função nf_historico_pfas no banco, 28/09/2026).
  (historicoNf || []).forEach(function (h) {
    const k = String(h.pfa);
    if (!h.nota_fiscal || notaPorPfa.has(k)) return;
    notaPorPfa.set(k, numeroNf(h.nota_fiscal));
    pfasComNota.set(k, Number(h.pares) || 0);
    notaDoHistorico.add(k);
  });
  // chave (PFA|artigo|cor+tam) -> tipo já gravado. Linha já lançada com OUTRO tipo
  // não é "duplicada": é correção (30/09/2026 — NF lançada como AD que devia embarcar).
  const tipoLancado = new Map();
  ((snapshotPfas && snapshotPfas.ajustes) || []).forEach(function (a) {
    tipoLancado.set([a.pfa_antiga, a.artigo, (a.cor_tam || '').replace(/\s+/g, ' ').trim()].join('|'), a.tipo);
  });
  const jaLancados = { has: function (k) { return tipoLancado.has(k); } };
  // Soma de falta por PFA (FALTA TOTAL tem que bater com o total da PFA)
  const faltaPorPfa = new Map();
  linhas.forEach(function (l) { faltaPorPfa.set(l.pfa, (faltaPorPfa.get(l.pfa) || 0) + (l.qtde_faltante || 0)); });
  return linhas.map(function (l) {
    const alertas = [];
    const p = pend.get(String(l.pfa));
    if (l.qtde_faltante == null) alertas.push('quantidade faltante ilegível no e-mail');
    else if (l.qtde_total_pedido != null && l.qtde_faltante > l.qtde_total_pedido) alertas.push('falta maior que o pedido');
    if (l.nf) {
      const nfSnap = notaPorPfa.get(String(l.pfa));
      if (!nfSnap) alertas.push('PFA sem NF no sistema (nem no Pendentes, Analítico, NFs Embarcadas ou histórico)');
      else if (nfSnap !== numeroNf(l.nf)) alertas.push('NF do e-mail (' + l.nf + ') ≠ NF no sistema (' + nfSnap + ')');
      // "FALTA TOTAL" no e-mail com NF é do ITEM (o item inteiro não foi), não
      // da NF — comparar com a qtde da NF inteira dava alerta falso (28/09/2026:
      // falta 1 × NF de 124). Só alerta falta MAIOR que a NF, que é erro.
      if (pfasComNota.has(String(l.pfa)) && pfasComNota.get(String(l.pfa)) > 0 && faltaPorPfa.get(l.pfa) > pfasComNota.get(String(l.pfa))) {
        alertas.push('soma das faltas (' + faltaPorPfa.get(l.pfa) + ') maior que a qtde da NF no sistema (' + pfasComNota.get(String(l.pfa)) + ')');
      }
    } else {
      // Num AJUSTE já lançado (ou respondido pelo comercial) a PFA antiga sai do
      // Pendentes de propósito: a PFA nova nasce com o mesmo nº de encomenda.
      const ajusteEsperadoForaPendentes = l.tipo === 'AJUSTE' &&
        (l.ajustado_pelo_comercial || jaLancados.has([l.pfa, l.artigo, (l.cor + ' ' + l.tam).trim()].join('|')));
      if (!p) { if (!ajusteEsperadoForaPendentes) alertas.push('PFA não está no Pendentes atual'); }
      else if (l.situacao === 'FALTA TOTAL' && faltaPorPfa.get(l.pfa) !== p.pares) {
        alertas.push('FALTA TOTAL: soma das faltas (' + faltaPorPfa.get(l.pfa) + ') ≠ pares da PFA em Pendentes (' + p.pares + ')');
      }
      if (p && l.qtde_total_pedido != null && p.pares && l.qtde_total_pedido !== p.pares && l.situacao === 'FALTA TOTAL') {
        alertas.push('pedido no e-mail (' + l.qtde_total_pedido + ') ≠ pares em Pendentes (' + p.pares + ')');
      }
    }
    const chave = [l.pfa, l.artigo, (l.cor + ' ' + l.tam).trim()].join('|');
    const tipoAnterior = tipoLancado.get(chave);
    const corrigeTipo = tipoAnterior && l.tipo && tipoAnterior !== l.tipo ? tipoAnterior : null;
    const duplicado = tipoLancado.has(chave) && !corrigeTipo;
    return Object.assign({}, l, { alertas: alertas, ja_lancado: duplicado, corrige_tipo: corrigeTipo,
      nf_do_historico: notaDoHistorico.has(String(l.pfa)) });
  });
}

/* Linha no formato da planilha de Ajustes (mesma ordem do modelo). */
function linhaPlanilhaAjuste(l) {
  // Família do e-mail vem sem zero à esquerda ("83") — dim_familias usa "083".
  const fam = /^\d+$/.test(l.familia_codigo || '') ? String(l.familia_codigo).padStart(3, '0') : (l.familia_codigo || '');
  return [l.tipo || '', l.encomenda || '', l.pfa || '', '', l.cliente || '', fam,
    l.artigo || '', l.cor || '', l.tam || '', l.qtde_total_pedido == null ? '' : l.qtde_total_pedido,
    l.qtde_faltante == null ? '' : l.qtde_faltante,
    (l.nf ? 'NF ' + l.nf + ' — ' : '') + l.situacao + ' — ' + l.status,
    l.data_solicitacao ? l.data_solicitacao.split('-').reverse().join('/') : '', l.solicitante || ''];
}

if (typeof window !== 'undefined') {
  window.lerMsg = lerMsg;
  window.interpretarEmailAjuste = interpretarEmailAjuste;
  window.validarLinhasEmail = validarLinhasEmail;
  window.linhaPlanilhaAjuste = linhaPlanilhaAjuste;
  window.consolidarLinhasEmails = consolidarLinhasEmails;
}
if (typeof module !== 'undefined') {
  module.exports = { lerMsg: lerMsg, interpretarEmailAjuste: interpretarEmailAjuste, validarLinhasEmail: validarLinhasEmail,
    linhaPlanilhaAjuste: linhaPlanilhaAjuste, consolidarLinhasEmails: consolidarLinhasEmails, extrairRegistrosDivergencia: extrairRegistrosDivergencia, extrairInstrucoes: extrairInstrucoes };
}

/* ============================================================================
   EMBARQUE — setor novo (02/10/2026)
   ----------------------------------------------------------------------------
   Mesmo gráfico do Report E-commerce (Expedição × Forecast / Análise Prevista
   de Backlog), com os dados da DISTR:

   - Realizado: tabela embarque_diario, alimentada pela base histórica do
     Embarque (modelo antigo de backlog, aba "Plan1": EXPEDIÇÃO, BACKLOG,
     SEPARAÇÃO e FATURAMENTO em peças, uma coluna por dia). Subir a base de novo
     nunca duplica (upsert por dia).
   - Forecast: tabela embarque_forecast_mensal — peças embarcadas previstas no
     MÊS, divididas por igual entre os dias úteis (seg–sex, menos os dias de
     folga informados). Ex.: out/2026 = 731.000 peças em 22 dias úteis =
     33.227 por dia (o resto da divisão vai 1 a 1 nos primeiros dias, pra o
     mês fechar exato).
   - Entrada prevista no backlog: a informada no forecast; vazia = o próprio forecast ÷ dias úteis.
     Sem ela o backlog dos dias futuros NÃO é projetado — não inventamos.
   ============================================================================ */
(function () {
  'use strict';

  const SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const pad2 = function (n) { return String(n).padStart(2, '0'); };

  /* ---------- datas (sempre ISO "AAAA-MM-DD", em UTC ao meio-dia) ---------- */
  function isoDeUTC(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function somaDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDeUTC(d); }
  function diaDaSemana(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
  function hojeLocalISO() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function rotuloDia(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }

  /* Célula de data da planilha: serial do Excel (número), Date, "dd/mm/aaaa" ou ISO. */
  function dataDeCelula(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : isoDeUTC(new Date(v.getTime() + 12 * 3600 * 1000));
    if (typeof v === 'number') {
      if (!(v > 30000 && v < 80000)) return null;           // fora do que é data de verdade (número de semana, etc.)
      return isoDeUTC(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000 + 12 * 3600 * 1000));
    }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]) : null;
  }
  function numeroDeCelula(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v)) return Math.round(Number(v.replace(',', '.')));
    return null;                                            // "#N/A", vazio, texto
  }
  const normaliza = function (s) {
    return String(s == null ? '' : s).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  };

  /* ============================================================================
     LEITURA DA BASE HISTÓRICA (linhas = matriz da aba, uma linha por array)
     ============================================================================ */
  const SECOES_BASE = { EXPEDICAO: 'expedido', BACKLOG: 'backlog', SEPARACAO: 'separacao', FATURAMENTO: 'faturamento' };

  function parsearBaseEmbarque(linhas) {
    const avisos = [];
    // linha das datas = a que mais tem célula de data (a de "semana" tem só números pequenos)
    let iDatas = -1, melhor = 0;
    (linhas || []).forEach(function (l, i) {
      const n = (l || []).slice(1).filter(function (c) { return dataDeCelula(c) !== null; }).length;
      if (n > melhor) { melhor = n; iDatas = i; }
    });
    if (iDatas < 0 || melhor < 10) throw new Error('Não achei a linha de datas da base (esperado: uma linha com os dias, um por coluna).');
    const datas = linhas[iDatas].map(dataDeCelula);

    // cada seção: rótulo na coluna A ("EXPEDIÇÃO") e a linha "Peças" logo abaixo
    const linhaDe = {};
    linhas.forEach(function (l, i) {
      const campo = SECOES_BASE[normaliza(l && l[0])];
      if (!campo || linhaDe[campo] !== undefined) return;
      for (let k = i + 1; k <= i + 3 && k < linhas.length; k++) {
        if (normaliza(linhas[k] && linhas[k][0]) === 'PECAS') { linhaDe[campo] = k; return; }
      }
    });
    if (linhaDe.expedido === undefined) throw new Error('Não achei a seção EXPEDIÇÃO (linha "Peças") na base.');
    Object.keys(SECOES_BASE).forEach(function (k) {
      const campo = SECOES_BASE[k];
      if (linhaDe[campo] === undefined) avisos.push('Seção ' + k + ' não encontrada — esse dado fica de fora.');
    });

    const registros = [];
    for (let j = 1; j < datas.length; j++) {
      if (!datas[j]) continue;
      const r = { dia: datas[j], expedido: null, backlog: null, separacao: null, faturamento: null };
      let algum = false;
      Object.keys(linhaDe).forEach(function (campo) {
        const v = numeroDeCelula(linhas[linhaDe[campo]][j]);
        if (v !== null) { r[campo] = v; algum = true; }
      });
      if (algum) registros.push(r);
    }
    registros.sort(function (a, b) { return a.dia < b.dia ? -1 : 1; });
    const comExp = registros.filter(function (r) { return r.expedido !== null; });
    return {
      registros: registros, avisos: avisos,
      periodo: registros.length ? { de: registros[0].dia, ate: registros[registros.length - 1].dia } : null,
      total_expedido: comExp.reduce(function (s, r) { return s + r.expedido; }, 0),
      dias_com_expedicao: comExp.length,
    };
  }

  /* "731" ou "731,5" = milhares de peças (731.000 / 731.500); a partir de 100.000 já é o número de peças. */
  function lerMilPecas(txt) {
    const t = String(txt == null ? '' : txt).trim();
    if (t === '') return null;
    const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!isFinite(n) || n < 0) return NaN;
    return Math.round(n >= 100000 ? n : n * 1000);
  }
  /* Reparte `total` (inteiro) pelas proporções [{nome,pct}] com a soma EXATA (maiores restos). */
  function repartir(total, props) {
    const lista = (props || []).filter(function (p) { return p && p.nome && Number(p.pct) > 0; });
    const soma = lista.reduce(function (s2, p) { return s2 + Number(p.pct); }, 0);
    if (!lista.length || !(total >= 0) || !soma) return [];
    const bruto = lista.map(function (p) { return total * Number(p.pct) / soma; });
    const out = bruto.map(Math.floor);
    let resto = Math.round(total) - out.reduce(function (s2, v) { return s2 + v; }, 0);
    bruto.map(function (b, i) { return [b - Math.floor(b), i]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; })
      .forEach(function (x) { if (resto > 0) { out[x[1]]++; resto--; } });
    return lista.map(function (p, i) { return { nome: p.nome, pct: Number(p.pct), valor: out[i] }; });
  }

  /* ============================================================================
     FORECAST — mês dividido pelos dias úteis
     ============================================================================ */
  function diasUteisDoMes(mes, folgas) {
    const p = String(mes).split('-').map(Number);
    const n = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    const fol = new Set((folgas || []).map(function (f) { return String(f).slice(0, 10); }));
    const dias = [];
    for (let d = 1; d <= n; d++) {
      const iso = p[0] + '-' + pad2(p[1]) + '-' + pad2(d), dow = diaDaSemana(iso);
      if (dow >= 1 && dow <= 5 && !fol.has(iso)) dias.push(iso);
    }
    return dias;
  }
  // Divide `total` em partes inteiras que somam EXATO o total (o resto vai 1 a 1 nos primeiros dias).
  function distribuirNosDias(total, dias) {
    const out = {}, n = dias.length;
    if (!n) return out;
    const base = Math.floor(total / n), resto = total - base * n;
    dias.forEach(function (d, i) { out[d] = base + (i < resto ? 1 : 0); });
    return out;
  }
  // forecasts = linhas de embarque_forecast_mensal -> { saida: {dia: peças}, entrada: {dia: peças} }.
  // Dia útil recebe a parte; fim de semana/folga do mês com forecast fica em 0 (a linha desce, como no E-commerce).
  function forecastPorDia(forecasts) {
    const saida = {}, entrada = {};
    (forecasts || []).forEach(function (f) {
      const uteis = diasUteisDoMes(f.mes, f.dias_folga);
      const todos = (function () {
        const p = String(f.mes).split('-').map(Number), n = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(), l = [];
        for (let d = 1; d <= n; d++) l.push(p[0] + '-' + pad2(p[1]) + '-' + pad2(d));
        return l;
      })();
      const dist = distribuirNosDias(Number(f.pecas_embarque) || 0, uteis);
      todos.forEach(function (d) { saida[d] = dist[d] || 0; });
      // entrada prevista: a informada no forecast; sem ela, vale o próprio forecast dividido pelos dias úteis
      const distE = f.pecas_entrada !== null && f.pecas_entrada !== undefined ? distribuirNosDias(Number(f.pecas_entrada) || 0, uteis) : dist;
      todos.forEach(function (d) { entrada[d] = distE[d] || 0; });
    });
    return { saida: saida, entrada: entrada };
  }

  /* ============================================================================
     SÉRIE DO GRÁFICO — D-30 a D+30 (61 dias), mesmo formato do E-commerce
     ============================================================================ */
  function propsDoMes(forecasts, dia, campo) {
    const f = (forecasts || []).filter(function (x) { return x.mes === dia.slice(0, 7); })[0];
    return f && Array.isArray(f[campo]) ? f[campo] : [];
  }
  function montarSerieEmbarque(diario, forecasts, hojeISO, ultimos, emTela) {
    const dias = [];
    for (let i = -30; i <= 30; i++) dias.push(somaDias(hojeISO, i));
    const porDia = {};
    (diario || []).forEach(function (r) { porDia[r.dia] = r; });
    ultimos = ultimos || {};
    let ultExp = ultimos.expedido || null, ultBk = ultimos.backlog || null;
    (diario || []).forEach(function (r) {
      if (r.expedido !== null && r.expedido !== undefined && (!ultExp || r.dia > ultExp.dia)) ultExp = { dia: r.dia, valor: r.expedido };
      if (r.backlog !== null && r.backlog !== undefined && (!ultBk || r.dia > ultBk.dia)) ultBk = { dia: r.dia, valor: r.backlog };
    });
    const fc = forecastPorDia(forecasts);

    // backlog dos dias seguintes à última posição conhecida: backlog(D+1) = backlog(D) + entrada(D) − saída(D).
    // Projeta enquanto houver entrada E saída prevista (entrada não informada = o próprio forecast do dia).
    // Âncora: HOJE = peças em tela (PFAs pendentes do Start Inicial); sem isso, o último backlog da base.
    const temEmTela = emTela && Number.isFinite(Number(emTela.total));
    const ancora = temEmTela ? { dia: hojeISO, valor: Number(emTela.total) } : ultBk;
    const naoDisp = temEmTela ? Number((emTela.por_situacao || {})['Nao disp. picking'] || 0) : 0;
    const backlogPrev = {};
    if (ancora) {
      let b = ancora.valor, d = ancora.dia;
      const fim = dias[dias.length - 1];
      while (d < fim) {
        const e = fc.entrada[d], s = fc.saida[d];
        if (e === undefined || s === undefined) break;
        b = Math.max(0, b + e - s);
        d = somaDias(d, 1);
        backlogPrev[d] = Math.round(b);
      }
    }

    const nv = function (v) { return v === undefined ? null : v; };
    return {
      dias: dias.map(rotuloDia),
      dias_iso: dias,
      dias_semana: dias.map(function (d) { return SEM[diaDaSemana(d)]; }),
      // expedido: dia sem lançamento DENTRO do período da base = 0 (fim de semana/feriado); depois do último dia da base = null
      expedido: dias.map(function (d) {
        if (!ultExp || d > ultExp.dia) return null;
        const r = porDia[d];
        return r && r.expedido !== null && r.expedido !== undefined ? r.expedido : 0;
      }),
      forecast: dias.map(function (d) { return nv(fc.saida[d]); }),
      entrada: dias.map(function (d) { return nv(fc.entrada[d]); }),
      saida: dias.map(function (d) { return nv(fc.saida[d]); }),
      backlog_efetivo: dias.map(function (d) {
        if (temEmTela && d === hojeISO) return Number(emTela.total);
        const r = porDia[d];
        return r && r.backlog !== null && r.backlog !== undefined ? r.backlog : null;
      }),
      // parte do backlog de hoje que está "Não disp. picking" (coluna empilhada em vermelho)
      backlog_nao_disp: dias.map(function (d) { return temEmTela && d === hojeISO ? naoDisp : null; }),
      backlog_hoje: temEmTela ? { total: Number(emTela.total), nao_disp: naoDisp, gerado_em: emTela.gerado_em || null } : null,
      // saída efetiva (expedido) enquanto o dia já passou; só depois dela vale a prevista
      saida_efetiva: dias.map(function (d) {
        if (!ultExp || d > ultExp.dia) return null;
        const r = porDia[d];
        return r && r.expedido !== null && r.expedido !== undefined ? r.expedido : 0;
      }),
      forecast_marca: dias.map(function (d) { return repartir(fc.saida[d] || 0, propsDoMes(forecasts, d, 'prop_marca')); }),
      forecast_segmento: dias.map(function (d) { return repartir(fc.saida[d] || 0, propsDoMes(forecasts, d, 'prop_segmento')); }),
      backlog_previsto: dias.map(function (d) { return nv(backlogPrev[d]); }),
      backlog: dias.map(function (d) {
        if (temEmTela && d === hojeISO) return Number(emTela.total);
        const r = porDia[d];
        if (r && r.backlog !== null && r.backlog !== undefined) return r.backlog;
        return backlogPrev[d] === undefined ? null : backlogPrev[d];
      }),
      hoje_idx: 30,
      ultimo_dia_expedicao: ultExp ? ultExp.dia : null,
      ultimo_dia_backlog: ultBk ? ultBk.dia : null,
      tem_entrada_prevista: Object.keys(fc.entrada).length > 0,
      tem_forecast: Object.keys(fc.saida).length > 0,
    };
  }


  /* ============================================================================
     NOTAS EMBARCADAS (detalhado por marca, segmento e transportadora)
     ============================================================================ */
  const SEG_FILTRO = { CHUTEIRA: 'CALÇADO', CHINELO: 'CALÇADO' };   // como no resto do sistema: chuteira/chinelo contam como calçado
  const semAcento = function (t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); };

  // "DISPLAN ENCOMENDAS URGENTES LTDA" -> "DISPLAN"; "TECMAR TRANSPORTES LTDA." -> "TECMAR"; "VITORIA PROVEDORA..." -> "VITÓRIA"
  const PALAVRAS_GENERICAS = /^(LTDA\.?|S\/A|SA|ME|EPP|EIRELI|TRANSPORTES?|TRANSPORTADORA|TRANSP\.?|ENCOMENDAS?|URGENTES?|EXPRESSA|EXPRESS|LOGISTICA|PROVEDORA|SERVICOS?|CARGAS?|E|DE|DA|DO)$/;
  const NOMES_COM_ACENTO = { VITORIA: 'VITÓRIA' };
  function nomeCurtoTransportadora(nome) {
    const t = semAcento(nome);
    if (!t) return 'SEM TRANSPORTADORA';
    if (/^S\/\s*CARRO$/.test(t)) return 'SEM TRANSPORTADORA';
    const palavras = t.replace(/[.,]/g, ' ').split(/\s+/).filter(function (w) { return w && !PALAVRAS_GENERICAS.test(w); });
    const curto = palavras[0] || t.split(/\s+/)[0];
    return NOMES_COM_ACENTO[curto] || curto;
  }
  function segmentoMacroLocal(segmento, categoria) {
    const t = String(String(categoria || '').trim() || String(segmento || '')).toUpperCase();
    if (/CHUTEIRA/.test(t)) return 'CHUTEIRA';
    if (/CHINELO|OPANKA/.test(t)) return 'CHINELO';
    if (/MEIA/.test(t)) return 'MEIA';
    if (/ACESS/.test(t)) return 'ACESSÓRIO';
    if (/VESTU|BOTAFOGO|FUTEBOL|CAMISA/.test(t)) return 'VESTUÁRIO';
    if (/TENIS|TÊNIS|SAPATO|TAMANCO|BOTA|CALCAD|CALÇAD/.test(t)) return 'CALÇADO';
    return 'OUTROS';
  }
  function segmentoParaFiltro(seg) { const x = String(seg || '').toUpperCase(); return SEG_FILTRO[x] || x; }
  function marcaDoTexto(t) { return /olymp/i.test(t) ? 'OLYMPIKUS' : /mizuno/i.test(t) ? 'MIZUNO' : /under/i.test(t) ? 'UNDER ARMOUR' : null; }

  /* Planilha "Notas Embarcadas" (Embarcador, Destinatário, Nota Fiscal, Emissão, Embarque, Valor NF, Vol., Peças,
     Família, Marca, Cód.Transp., Transportadora). `familias` = { '068': { marca, categoria, segmento } } de dim_familias.
     O nome do destinatário NÃO é guardado. */
  function parsearNotasEmbarcadas(linhas, familias) {
    familias = familias || {};
    const avisos = [];
    let iCab = -1;
    (linhas || []).forEach(function (l, i) { if (iCab < 0 && (l || []).some(function (c) { return semAcento(c) === 'NOTA FISCAL'; })) iCab = i; });
    if (iCab < 0) throw new Error('Não achei o cabeçalho da planilha de notas embarcadas (coluna "Nota Fiscal").');
    const col = {};
    linhas[iCab].forEach(function (c, j) {
      const n = semAcento(c);
      if (n === 'NOTA FISCAL') col.nf = j; else if (n === 'EMISSAO') col.emissao = j; else if (n.indexOf('EMBARQUE') === 0) col.embarque = j;
      else if (n === 'VALOR NF') col.valor = j; else if (n === 'VOL.' || n === 'VOL') col.vol = j; else if (n === 'PECAS') col.pecas = j;
      else if (n === 'FAMILIA') col.familia = j; else if (n === 'MARCA') col.marca = j; else if (n === 'TRANSPORTADORA') col.transp = j;
    });
    ['nf', 'embarque', 'pecas', 'familia'].forEach(function (k) { if (col[k] === undefined) throw new Error('Coluna obrigatória ausente na planilha: ' + k); });
    const registros = [], semFamilia = new Set(), vistos = new Set();
    let duplicadas = 0, semData = 0;
    for (let i = iCab + 1; i < linhas.length; i++) {
      const l = linhas[i] || [];
      const nf = String(l[col.nf] == null ? '' : l[col.nf]).trim();
      const pecas = numeroDeCelula(l[col.pecas]);
      if (!nf || pecas === null) continue;
      const embarque = dataDeCelula(l[col.embarque]);
      if (!embarque) { semData++; continue; }
      if (vistos.has(nf)) { duplicadas++; continue; }
      vistos.add(nf);
      const cod = String(l[col.familia] == null ? '' : l[col.familia]).trim().padStart(3, '0');
      const f = familias[cod];
      const marca = (f && f.marca ? String(f.marca).toUpperCase() : null) || marcaDoTexto(l[col.marca]) || 'OUTRAS';
      let seg = 'OUTROS';
      if (f) seg = segmentoParaFiltro(segmentoMacroLocal(f.segmento, f.categoria)); else semFamilia.add(cod);
      registros.push({
        nf: nf, embarque: embarque, emissao: col.emissao !== undefined ? dataDeCelula(l[col.emissao]) : null, pecas: pecas,
        volumes: col.vol !== undefined ? numeroDeCelula(l[col.vol]) : null,
        valor: col.valor !== undefined && typeof l[col.valor] === 'number' ? Math.round(l[col.valor] * 100) / 100 : null,
        familia: cod, marca: marca, segmento: seg,
        transportadora: col.transp !== undefined && l[col.transp] != null ? String(l[col.transp]).trim() : null,
      });
    }
    if (semFamilia.size) avisos.push('Família(s) fora do cadastro (segmento "OUTROS"): ' + Array.from(semFamilia).join(', '));
    if (duplicadas) avisos.push(duplicadas + ' nota(s) repetida(s) no arquivo — ficou uma só.');
    if (semData) avisos.push(semData + ' linha(s) sem data de embarque ignorada(s).');
    registros.sort(function (a, b) { return a.embarque < b.embarque ? -1 : a.embarque > b.embarque ? 1 : 0; });
    return {
      registros: registros, avisos: avisos,
      periodo: registros.length ? { de: registros[0].embarque, ate: registros[registros.length - 1].embarque } : null,
      total_pecas: registros.reduce(function (t, r) { return t + r.pecas; }, 0),
    };
  }

  /* ---------- filtros (Marca / Segmento / Transportadora) ---------- */
  function filtroAtivo(F) { return !!F && ((F.marca || []).length || (F.seg || []).length || (F.transp || []).length) > 0; }
  // linha do detalhado: {m, s, t}; opções de ignorar uma dimensão (o ranking de transportadora ignora o próprio filtro)
  function casaFiltro(m, seg, t, F, ignora) {
    if (!F) return true;
    if (ignora !== 'marca' && (F.marca || []).length && F.marca.indexOf(String(m || '').toUpperCase()) === -1) return false;
    if (ignora !== 'seg' && (F.seg || []).length && F.seg.indexOf(segmentoParaFiltro(seg)) === -1) return false;
    if (ignora !== 'transp' && (F.transp || []).length && F.transp.indexOf(nomeCurtoTransportadora(t)) === -1) return false;
    return true;
  }
  function shareProps(forecasts, dia, campo, selecionados) {
    if (!(selecionados || []).length) return 1;
    const props = propsDoMes(forecasts, dia, campo);
    if (!props.length) return null;
    return props.filter(function (x) { return selecionados.indexOf(String(x.nome).toUpperCase()) !== -1; }).reduce(function (t, x) { return t + Number(x.pct); }, 0) / 100;
  }

  /* Série com os filtros aplicados. Sem filtro devolve a própria série.
     - realizado (expedido / saída efetiva): do detalhado de notas (só nos dias que ele cobre; fora disso, sem dado);
     - forecast: previsto do dia × proporção de marca × proporção de segmento (cadastradas) × participação histórica da transportadora;
     - backlog: só o de hoje (peças em tela), filtrado; o histórico da base antiga não tem marca/segmento/transportadora. */
  function aplicarFiltrosNaSerie(base, ctx) {
    const F = ctx && ctx.filtros;
    if (!filtroAtivo(F)) return base;
    const agg = ctx.agg || [];
    const out = Object.assign({}, base);
    const n = base.dias_iso.length, hi = base.hoje_idx;
    out.filtro_ativo = true;
    // realizado
    let minD = null, maxD = null, totAll = 0, totTransp = 0;
    const porDia = {};
    agg.forEach(function (r) {
      if (!minD || r.d < minD) minD = r.d;
      if (!maxD || r.d > maxD) maxD = r.d;
      totAll += r.p;
      if (!(F.transp || []).length || F.transp.indexOf(nomeCurtoTransportadora(r.t)) !== -1) totTransp += r.p;
      if (casaFiltro(r.m, r.s, r.t, F)) porDia[r.d] = (porDia[r.d] || 0) + r.p;
    });
    out.detalhe = minD ? { de: minD, ate: maxD } : null;
    const real = base.dias_iso.map(function (d) { return minD && d >= minD && d <= maxD ? (porDia[d] || 0) : null; });
    out.expedido = real; out.saida_efetiva = real;
    // forecast e entrada previstos, reduzidos pela proporção
    const shT = (F.transp || []).length ? (totAll ? totTransp / totAll : null) : 1;
    const fator = base.dias_iso.map(function (d) {
      const a = shareProps(ctx.forecasts, d, 'prop_marca', F.marca), b = shareProps(ctx.forecasts, d, 'prop_segmento', F.seg);
      return a === null || b === null || shT === null ? null : a * b * shT;
    });
    const escala = function (arr) { return arr.map(function (v, i) { return v == null || fator[i] === null ? null : Math.round(v * fator[i]); }); };
    out.forecast = escala(base.forecast); out.saida = escala(base.saida); out.entrada = escala(base.entrada);
    // backlog de hoje filtrado
    const eT = ctx.emTela, grupos = eT && Array.isArray(eT.grupos) ? eT.grupos : null;
    out.backlog_efetivo = base.dias_iso.map(function () { return null; });
    out.backlog_nao_disp = base.dias_iso.map(function () { return null; });
    out.backlog = base.dias_iso.map(function () { return null; });
    out.backlog_previsto = base.dias_iso.map(function () { return null; });
    out.backlog_hoje = null;
    if (grupos) {
      let tot = 0, nd = 0;
      grupos.forEach(function (g) {
        if (!casaFiltro(g.m, g.s, g.t, F)) return;
        tot += Number(g.p) || 0;
        if (g.sit === 'Nao disp. picking') nd += Number(g.p) || 0;
      });
      out.backlog_hoje = { total: tot, nao_disp: nd, gerado_em: eT.gerado_em || null };
      out.backlog_efetivo[hi] = tot; out.backlog[hi] = tot; out.backlog_nao_disp[hi] = nd;
      let b = tot;
      for (let i = hi; i < n - 1; i++) {
        if (out.entrada[i] == null || out.saida[i] == null) break;
        b = Math.max(0, b + out.entrada[i] - out.saida[i]);
        out.backlog_previsto[i + 1] = Math.round(b); out.backlog[i + 1] = Math.round(b);
      }
    }
    out.tem_forecast = out.forecast.some(function (v) { return v != null; });
    out.tem_entrada_prevista = out.entrada.some(function (v) { return v != null; });
    out.ultimo_dia_expedicao = maxD;
    return out;
  }

  /* ---------- mix do embarque (matriz marca × segmento + ranking de transportadoras) ---------- */
  function montarMix(agg, F, periodo) {
    const no = function (r) { return !periodo || periodo === 'tudo' || (Array.isArray(periodo) ? periodo.indexOf(String(r.d).slice(0, 7)) !== -1 : String(r.d).slice(0, 7) === periodo); };
    const total = { p: 0, v: 0, n: 0 }, cel = {}, linhaM = {}, colS = {}, transp = {};
    let totTranspBase = 0;
    (agg || []).forEach(function (r) {
      if (!no(r)) return;
      const seg = segmentoParaFiltro(r.s), t = nomeCurtoTransportadora(r.t);
      if (casaFiltro(r.m, r.s, r.t, F, 'transp')) {            // ranking: respeita marca e segmento, ignora o próprio filtro
        const x = transp[t] || (transp[t] = { nome: t, p: 0, v: 0, n: 0 });
        x.p += r.p; x.v += r.v; x.n += r.n; totTranspBase += r.p;
      }
      if (!casaFiltro(r.m, r.s, r.t, F)) return;                // matriz e totais: respeitam os três
      total.p += r.p; total.v += r.v; total.n += r.n;
      const k = r.m + '|' + seg;
      cel[k] = (cel[k] || 0) + r.p; linhaM[r.m] = (linhaM[r.m] || 0) + r.p; colS[seg] = (colS[seg] || 0) + r.p;
    });
    const ord = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); };
    const rank = Object.keys(transp).map(function (k) { return transp[k]; }).sort(function (a, b) { return b.p - a.p; })
      .map(function (x) { return Object.assign(x, { pct: totTranspBase ? x.p / totTranspBase * 100 : 0 }); });
    return { total: total, marcas: ord(linhaM), segs: ord(colS), cel: cel, linhaM: linhaM, colS: colS, transportadoras: rank };
  }

  /* ============================================================================
     GRÁFICO (adaptado do Report E-commerce — mesmo traço, mesmas cores)
     ============================================================================ */
  function fmtN(n) { return Math.round(Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }

  // Curva suave que NÃO ultrapassa os valores (interpolação cúbica monotônica, Fritsch–Carlson)
  function pathMonotono(pts) {
    const n = pts.length;
    if (n < 3) return pts.length === 2 ? 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1) + ' L' + pts[1][0].toFixed(1) + ',' + pts[1][1].toFixed(1) : '';
    const dx = [], m = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const h3 = dx[i] / 3;
      d += ' C' + (pts[i][0] + h3).toFixed(1) + ',' + (pts[i][1] + t[i] * h3).toFixed(1) + ' ' +
        (pts[i + 1][0] - h3).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h3).toFixed(1) + ' ' +
        pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
    }
    return d;
  }
  // Curva suave (Catmull-Rom -> Bézier cúbica) — usada na visão Forecast × Expedição
  function pathSuave(pts) {
    if (!pts || pts.length < 2) return '';
    if (pts.length === 2) return 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1) + ' L' + pts[1][0].toFixed(1) + ',' + pts[1][1].toFixed(1);
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }
  // Rótulo de dado com fundo (chip), legível sobre linhas/outros rótulos
  function labelComFundo(svg, x, y, texto, opts) {
    opts = opts || {};
    const fs = opts.fontSize || 10, anchor = opts.anchor || 'middle';
    const corTexto = opts.cor || 'var(--text)';
    const corFundo = opts.fundo || 'color-mix(in srgb, ' + corTexto + ' 32%, var(--bg-card) 68%)';
    const txt = String(texto);
    const largura = txt.length * fs * 0.62 + 8, altura = fs + 6;
    const rx = anchor === 'middle' ? x - largura / 2 : (anchor === 'end' ? x - largura : x);
    const NS = 'http://www.w3.org/2000/svg';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', rx.toFixed(1)); rect.setAttribute('y', (y - fs - 1).toFixed(1));
    rect.setAttribute('width', largura.toFixed(1)); rect.setAttribute('height', altura.toFixed(1));
    rect.setAttribute('rx', '4'); rect.setAttribute('fill', corFundo);
    svg.appendChild(rect);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('text-anchor', anchor);
    t.setAttribute('font-size', fs); t.setAttribute('font-weight', opts.peso || '700'); t.setAttribute('fill', corTexto);
    t.textContent = txt; svg.appendChild(t);
    return t;
  }

  let arrastou = false, modoFc = 'pecas', visao = 'forecast', janela = 15, serie = null, bruto = null, serieBase = null;
  const filtros = { marca: [], seg: [], transp: [] };
  let periodoMix = { modo: 'tudo', meses: [], ano: null, aberto: false, rascunho: [] };

  function injetarCss() {
    if (document.getElementById('embCss')) return;
    const st = document.createElement('style'); st.id = 'embCss';
    st.textContent =
      '.emb-filtros{background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:14px}' +
      '.emb-filtros .filtros{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:5px 0}' +
      '.emb-filtros .rot-filtro{font-size:11px;color:var(--text-label);text-transform:uppercase;letter-spacing:.06em;width:115px;flex:none}' +
      '.emb-mix{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:28px;margin-top:6px}' +
      '@media(max-width:1000px){.emb-mix{grid-template-columns:1fr}}' +
      '.emb-fcbtn{margin-left:auto}.emb-filtros .emb-rodape{display:flex;justify-content:flex-end;margin-top:6px}' +
      '.emb-modal{position:fixed;z-index:1000;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);width:min(560px,calc(100vw - 16px))}' +
      '.emb-modal-box{position:relative;padding:0 22px 18px;max-height:85vh;overflow:auto}' +
      '.emb-modal-barra{cursor:move;user-select:none;touch-action:none;padding:14px 30px 8px 0;margin:0 -22px 4px;padding-left:22px}' +
      '.emb-modal-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-right:40px}.emb-modal-barra .section-title{display:inline-block;padding-right:14px}.emb-modal-barra{flex:1;min-width:0;padding-right:0}.emb-modal-ctl{flex:none;margin:12px 0 0}.emb-modal-dia{margin:0 0 12px;min-height:6px}' +
      '.emb-modal-x{position:absolute;top:12px;right:22px;padding:0;background:none;border:0;color:var(--text-muted);font-size:16px;cursor:pointer}' +
      '.emb-fc{border-spacing:2px}.emb-fc th{font-size:9px;letter-spacing:0;padding:4px 1px}.emb-fc th.l{font-size:10px;white-space:nowrap;padding-right:4px}.emb-fc td{padding:10px 0;font-size:12px}' +
      '.emb-sub{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-label);font-weight:600;margin-bottom:8px}' +
      '.emb-matriz{border-collapse:separate;border-spacing:3px;width:100%;font-size:13px}' +
      '.emb-matriz th{font-size:11px;color:var(--text-label);font-weight:600;padding:4px 6px;text-align:center;text-transform:uppercase;letter-spacing:.04em}' +
      '.emb-matriz th.l{text-align:left;white-space:nowrap}' +
      '.emb-matriz td{text-align:center;padding:12px 6px;border-radius:6px;font-weight:600}' +
      '.emb-matriz{--emb-linha:color-mix(in srgb,var(--text) 22%,transparent)}' +
      '.emb-matriz .sepcol,.emb-matriz tr.seplin>*{border-radius:0}' +
      '.emb-matriz .sepcol{box-shadow:inset 1px 0 0 var(--emb-linha)}' +
      '.emb-matriz tr.seplin>*{box-shadow:inset 0 1px 0 var(--emb-linha)}' +
      '.emb-matriz tr.seplin>.sepcol{box-shadow:inset 1px 0 0 var(--emb-linha),inset 0 1px 0 var(--emb-linha)}' +
      '.emb-matriz td.az{color:#fff;padding:8px 6px}' +
      '.emb-matriz td.az b{display:block;font-size:13px}' +
      '.emb-matriz td.az small{display:block;font-size:11px;font-weight:600;opacity:.85}' +
      '.emb-col-esq{display:flex;flex-direction:column;gap:18px;min-width:0}' +
      '.emb-popwrap{position:relative;display:inline-block}' +
      '.emb-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:50;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.45);min-width:230px}' +
      '.emb-pop .ano{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-label);font-weight:600;margin-bottom:8px;display:flex;gap:6px;align-items:center}' +
      '.emb-pop .grade{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}' +
      '.emb-pop .grade .seg-btn{text-align:center}' +
      '.emb-pop .rod{display:flex;justify-content:flex-end;margin-top:10px}' +
      '.emb-legenda-per{font-size:11px;color:var(--text-muted);margin-top:14px;text-align:left}' +
      '.emb-meses{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-2px 0 14px}' +
      '.emb-meses .ano{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-label);font-weight:600;margin-right:4px}' +
      '.emb-meses .seg-btn.off{opacity:.35;cursor:default;pointer-events:none}' +
      '.emb-sep{width:1px;height:18px;background:var(--border);margin:0 8px}' +
      '.emb-matriz td.tot,.emb-matriz th.tot{color:var(--text);background:transparent;font-weight:700}' +
      '.emb-matriz td.vz{color:var(--text-muted);font-weight:400}' +
      '.emb-transp{overflow-y:auto;padding-right:8px;scrollbar-width:thin;scrollbar-color:var(--text-muted) transparent}' +
      '.emb-t-dica{font-size:11px;color:var(--text-muted);margin-top:4px}' +
      '.emb-t-row{padding:6px 10px 7px;border:1px solid transparent;border-radius:8px;cursor:pointer;margin-bottom:4px}' +
      '.emb-t-row:hover{background:var(--bg-input)}' +
      '.emb-t-row.on{border-color:var(--accent);background:var(--accent-soft)}' +
      '.emb-t-top{display:flex;justify-content:space-between;align-items:baseline;font-weight:700;font-size:13px}' +
      '.emb-t-top b{font-size:15px}' +
      '.emb-t-bar{height:16px;border-radius:5px;background:var(--bg-input);margin:4px 0 3px;overflow:hidden}' +
      '.emb-t-bar i{display:block;height:100%;background:color-mix(in srgb,var(--olive) 62%,transparent);border-radius:5px}' +
      '.emb-t-meta{font-size:12px;color:var(--text-muted)}';
    document.head.appendChild(st);
  }

  const fmtPct1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') + '%'; };
  function opcoesDoDetalhe(agg) {
    const m = {}, sg = {}, t = {};
    (agg || []).forEach(function (r) {
      m[r.m] = (m[r.m] || 0) + r.p; const g = segmentoParaFiltro(r.s); sg[g] = (sg[g] || 0) + r.p;
      const k = nomeCurtoTransportadora(r.t); t[k] = (t[k] || 0) + r.p;
    });
    const ord = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }); };
    return { marca: ord(m), seg: ord(sg), transp: ord(t) };
  }
  function desenharFiltros() {
    const alvo = document.getElementById('embFiltros');
    if (!alvo) return;
    const agg = bruto ? bruto.agg : [];
    if (!agg.length) {
      alvo.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">Filtros por marca, segmento e transportadora ficam disponíveis depois que o detalhado de notas embarcadas for carregado (Abastecimento › Embarque).</div>';
      return;
    }
    const op = opcoesDoDetalhe(agg);
    const grupo = function (rot, campo, lista, todas) {
      return '<div class="filtros"><span class="rot-filtro">' + rot + '</span><span class="chip' + (!filtros[campo].length ? ' on' : '') + '" data-f="' + campo + '" data-v="">' + todas + '</span>' +
        lista.map(function (v) { return '<span class="chip' + (filtros[campo].indexOf(v) !== -1 ? ' on' : '') + '" data-f="' + campo + '" data-v="' + v + '">' + v + '</span>'; }).join('') + '</div>';
    };
    const chips = function (campo, lista, todas) {
      return '<span class="chip' + (!filtros[campo].length ? ' on' : '') + '" data-f="' + campo + '" data-v="">' + todas + '</span>' +
        lista.map(function (v) { return '<span class="chip' + (filtros[campo].indexOf(v) !== -1 ? ' on' : '') + '" data-f="' + campo + '" data-v="' + v + '">' + v + '</span>'; }).join('');
    };
    const per = periodoAtual();
    alvo.innerHTML =
      '<div class="filtros"><span class="rot-filtro">Período</span><div class="emb-popwrap"><div class="seg-toggle" id="embMixPeriodo">' +
        '<button type="button" class="seg-btn' + (periodoMix.modo === 'tudo' ? ' ativo' : '') + '" data-modo="tudo">Todo o período</button>' +
        '<button type="button" class="seg-btn' + (periodoMix.modo === 'sel' ? ' ativo' : '') + '" data-modo="sel">Selecionar período</button>' +
      '</div>' + (periodoMix.aberto ? popoverMeses(per.meses, per.anos) : '') + '</div></div>' +
      '<div class="filtros"><span class="rot-filtro">Marca</span>' + chips('marca', op.marca, 'Todas') +
        '<span class="emb-sep"></span><span class="rot-filtro" style="width:auto">Segmento</span>' + chips('seg', op.seg, 'Todos') + '</div>' +
      grupo('Transportadora', 'transp', op.transp, 'Todas') +
      '<div class="emb-rodape" style="justify-content:space-between;align-items:center"><span>' + (filtroAtivo(filtros) ? '<span class="chip" style="color:var(--red)" data-limpar="1">✕ Limpar filtros</span>' : '') + '</span>' +
        '<span class="chip emb-fcbtn" data-fcabrir="1" style="margin:0">Clique para visualizar o forecast</span></div>';
    const bt = alvo.querySelector('[data-fcabrir]'); if (bt) bt.addEventListener('click', abrirForecast);
    alvo.querySelectorAll('#embMixPeriodo .seg-btn').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (b.dataset.modo === 'tudo') { periodoMix.modo = 'tudo'; periodoMix.aberto = false; atualizarPeriodo(); return; }
        periodoMix.aberto = !periodoMix.aberto; if (periodoMix.aberto) periodoMix.rascunho = periodoMix.modo === 'sel' ? periodoMix.meses.slice() : [];
        desenharFiltros();
      });
    });
    const pop = alvo.querySelector('.emb-pop');
    if (pop) {
      pop.addEventListener('click', function (e) { e.stopPropagation(); });
      pop.querySelectorAll('[data-mes]').forEach(function (b) {
        b.addEventListener('click', function () {
          const i = periodoMix.rascunho.indexOf(b.dataset.mes);
          if (i === -1) periodoMix.rascunho.push(b.dataset.mes); else periodoMix.rascunho.splice(i, 1);
          desenharFiltros();
        });
      });
      pop.querySelectorAll('[data-ano]').forEach(function (b) { b.addEventListener('click', function () { periodoMix.ano = b.dataset.ano; desenharFiltros(); }); });
      const ok = pop.querySelector('[data-ok]');
      if (ok) ok.addEventListener('click', function () {
        if (!periodoMix.rascunho.length) return;
        periodoMix.meses = periodoMix.rascunho.slice().sort(); periodoMix.modo = 'sel'; periodoMix.aberto = false; atualizarPeriodo();
      });
    }
    alvo.querySelectorAll('.chip[data-f]').forEach(function (c) { c.addEventListener('click', function () { alternarFiltro(c.dataset.f, c.dataset.v); }); });
    const lim = alvo.querySelector('[data-limpar]'); if (lim) lim.addEventListener('click', function () { filtros.marca = []; filtros.seg = []; filtros.transp = []; aplicar(); });
  }
  function alternarFiltro(campo, valor) {
    if (!valor) filtros[campo] = [];
    else { const i = filtros[campo].indexOf(valor); if (i === -1) filtros[campo].push(valor); else filtros[campo].splice(i, 1); }
    aplicar();
  }
  function aplicar() {
    if (!bruto || !serieBase) return;
    serie = aplicarFiltrosNaSerie(serieBase, { filtros: filtros, agg: bruto.agg, forecasts: bruto.forecasts, emTela: bruto.emTela });
    desenharFiltros(); desenhar(); desenharMix();
  }

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function rotuloMes(x) { return MESES[Number(x.slice(5)) - 1] + '/' + x.slice(2, 4); }
  // Forecast só traz total por marca e por segmento: o cruzamento é estimado (IPF) partindo do mix realizado no histórico
  function matrizPrevista(fc, agg) {
    const pm = repartir(fc.pecas_embarque, fc.prop_marca), ps = repartir(fc.pecas_embarque, fc.prop_segmento);
    if (!pm.length || !ps.length) return null;
    const semente = {};
    (agg || []).forEach(function (r) { const k = r.m + '|' + segmentoParaFiltro(r.s); semente[k] = (semente[k] || 0) + r.p; });
    const x = {};
    pm.forEach(function (a) { ps.forEach(function (g) { x[a.nome + '|' + g.nome] = semente[a.nome + '|' + g.nome] || 0; }); });
    pm.forEach(function (a) { if (!ps.some(function (g) { return x[a.nome + '|' + g.nome] > 0; })) ps.forEach(function (g) { x[a.nome + '|' + g.nome] = 1; }); });
    ps.forEach(function (g) { if (!pm.some(function (a) { return x[a.nome + '|' + g.nome] > 0; })) pm.forEach(function (a) { x[a.nome + '|' + g.nome] = 1; }); });
    for (let it = 0; it < 200; it++) {
      pm.forEach(function (a) { let t = 0; ps.forEach(function (g) { t += x[a.nome + '|' + g.nome]; }); if (t) ps.forEach(function (g) { x[a.nome + '|' + g.nome] *= a.valor / t; }); });
      ps.forEach(function (g) { let t = 0; pm.forEach(function (a) { t += x[a.nome + '|' + g.nome]; }); if (t) pm.forEach(function (a) { x[a.nome + '|' + g.nome] *= g.valor / t; }); });
    }
    return { marcas: pm.slice().sort(function (a, b) { return b.valor - a.valor; }), segs: ps.slice().sort(function (a, b) { return b.valor - a.valor; }), cel: x, total: fc.pecas_embarque };
  }
  const COR_AZ = function (a) { return 'color-mix(in srgb,#2f6fd0 ' + a + '%,transparent)'; };
  const COR_VD = function (a) { return 'color-mix(in srgb,var(--olive) ' + a + '%,transparent)'; };
  function tabelaPrevista(mx, modo, cor) {
    cor = cor || COR_AZ;
    const T = mx.total || 1;
    const val = function (v) { return modo === 'pct' ? fmtPct1(v / T * 100) : fmtN(v); };
    const maxCel = Math.max(1, Math.max.apply(null, Object.keys(mx.cel).map(function (k) { return mx.cel[k]; })));
    let h = '<table class="emb-matriz"><tr><th></th>' + mx.segs.map(function (g) { return '<th>' + g.nome + '</th>'; }).join('') + '<th class="tot sepcol">Total</th></tr>';
    mx.marcas.forEach(function (a) {
      h += '<tr><th class="l">' + a.nome + '</th>' + mx.segs.map(function (g) {
        const v = mx.cel[a.nome + '|' + g.nome] || 0;
        if (v < 0.5) return '<td class="vz">—</td>';
        const al = 0.1 + 0.55 * v / maxCel;
        return '<td style="background:' + cor(Math.round(al * 100)) + '" title="' + a.nome + ' · ' + g.nome + ': ' + fmtN(v) + ' peças">' + val(v) + '</td>';
      }).join('') + '<td class="tot sepcol">' + val(a.valor) + '</td></tr>';
    });
    return h + '<tr class="seplin"><th class="l tot">Total</th>' + mx.segs.map(function (g) { return '<td class="tot">' + val(g.valor) + '</td>'; }).join('') + '<td class="tot sepcol">' + (modo === 'pct' ? '100%' : fmtN(mx.total)) + '</td></tr></table>';
  }
  // realizado (notas embarcadas) de um dia — ou do período todo quando dia = null
  function matrizRealizada(agg, dia, sel) {
    const cel = {}, lm = {}, cs = {};
    let total = 0;
    (agg || []).forEach(function (r) {
      if (dia && String(r.d).slice(0, 10) !== dia) return;
      if (!dia && sel && sel !== 'tudo' && sel.indexOf(String(r.d).slice(0, 7)) === -1) return;
      const sg = segmentoParaFiltro(r.s);
      cel[r.m + '|' + sg] = (cel[r.m + '|' + sg] || 0) + r.p; lm[r.m] = (lm[r.m] || 0) + r.p; cs[sg] = (cs[sg] || 0) + r.p; total += r.p;
    });
    if (!total) return null;
    const lista = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return { nome: k, valor: o[k] }; }); };
    return { marcas: lista(lm), segs: lista(cs), cel: cel, total: total };
  }
  let modalDia = null, modalModo = 'fc';
  function rotuloDiaCompleto(iso) {
    const i = serieBase ? serieBase.dias_iso.indexOf(iso) : -1;
    return (i >= 0 ? serieBase.dias_semana[i] + ' ' + serieBase.dias[i] : iso.slice(8) + '/' + iso.slice(5, 7)) + (serieBase && i === serieBase.hoje_idx ? ' · hoje' : '');
  }
  function fecharForecast() { const m = document.getElementById('embFcModal'); if (m) m.remove(); document.removeEventListener('keydown', escForecast); modalDia = null; destacarDia(); }
  function escForecast(e) { if (e.key === 'Escape') fecharForecast(); }
  function destacarDia() {
    const sc = document.getElementById('embScroll');
    if (!sc || !serie) return;
    const sl = sc.scrollLeft; desenhar(); sc.scrollLeft = sl;
  }
  function selecionarDia(iso) {
    if (!document.getElementById('embFcModal')) return;
    modalDia = modalDia === iso ? null : iso;
    preencherForecast(); destacarDia();
  }
  function preencherForecast() {
    const m = document.getElementById('embFcModal');
    if (!m || !bruto) return;
    const mesAtual = String(bruto.hoje).slice(0, 7);
    let titulo = '', sub = '', corpo = '';
    const msg = function (t) { return '<div style="font-size:12px;color:var(--text-muted);padding:6px 0">' + t + '</div>'; };
    const blocos = function (mx, cor) {
      return '<div class="emb-sub">Quantidade de peças</div>' + tabelaPrevista(mx, 'pecas', cor) +
        '<div class="emb-sub" style="margin-top:22px">% das peças</div>' + tabelaPrevista(mx, 'pct', cor);
    };
    const mes = modalDia ? modalDia.slice(0, 7) : mesAtual;
    const fc = (bruto.forecasts || []).filter(function (f) { return f.mes === mes; })[0];
    const rotMes = MESES_LONGOS[Number(mes.slice(5)) - 1] + '/' + mes.slice(2, 4);
    if (modalModo === 'fc') {
      titulo = 'Forecast · marca × segmento';
      let totalDia = fc ? fc.pecas_embarque : null;
      if (modalDia) {
        const i = serieBase ? serieBase.dias_iso.indexOf(modalDia) : -1;
        totalDia = i >= 0 ? serieBase.forecast[i] : null;
        sub = rotuloDiaCompleto(modalDia) + (totalDia ? ' · ' + fmtN(totalDia) + ' peças previstas no dia' : '');
      } else sub = rotMes + (fc ? ' · ' + fmtN(fc.pecas_embarque) + ' peças no mês' : '');
      if (!fc) corpo = msg('Sem forecast informado para ' + rotMes + ' (Abastecimento › Embarque).');
      else if (modalDia && !totalDia) corpo = msg('Sem forecast neste dia (fim de semana ou folga).');
      else {
        const mx = matrizPrevista(Object.assign({}, fc, { pecas_embarque: totalDia }), bruto.agg);
        corpo = mx ? blocos(mx, COR_AZ): msg('Informe as proporções de marca e segmento do forecast (Abastecimento › Embarque).');
      }
    } else {
      titulo = 'Realizado · marca × segmento';
      const perJ = periodoAtual();
      const mx = matrizRealizada(bruto.agg, modalDia, perJ.sel);
      const dias = Array.from(new Set((bruto.agg || []).map(function (r) { return String(r.d).slice(0, 10); }))).sort();
      if (modalDia) {
        const iD = serieBase ? serieBase.dias_iso.indexOf(modalDia) : -1, expBase = iD >= 0 ? serieBase.expedido[iD] : null;
        sub = rotuloDiaCompleto(modalDia) + (mx ? ' · ' + fmtN(mx.total) + ' peças embarcadas' : expBase ? ' · ' + fmtN(expBase) + ' peças expedidas (base do Embarque)' : '');
        corpo = mx ? blocos(mx, COR_VD) : expBase ? msg('Sem detalhe de marca × segmento para este dia: o detalhado de notas cobre ' + (dias.length ? rotuloDia(dias[0]) + ' a ' + rotuloDia(dias[dias.length - 1]) : 'nenhum dia') + '.') : msg(dias.length ? 'Sem notas embarcadas neste dia no detalhado (as notas cobrem ' + rotuloDia(dias[0]) + ' a ' + rotuloDia(dias[dias.length - 1]) + ').' : 'Sem detalhado de notas embarcadas.');
      } else {
        sub = (perJ.sel === 'tudo' ? (dias.length ? 'Todo o período · ' + rotuloDia(dias[0]) + ' a ' + rotuloDia(dias[dias.length - 1]) : '') : 'Período selecionado: ' + textoMeses(perJ.sel)) + (mx ? ' · ' + fmtN(mx.total) + ' peças' : '');
        corpo = mx ? blocos(mx, COR_VD) : msg('Sem detalhado de notas embarcadas.');
      }
    }
    m.querySelector('.emb-modal-barra').innerHTML = '<div class="section-title" style="margin-bottom:4px;border-bottom-width:2px;border-bottom-color:' + (modalModo === 'real' ? 'var(--olive)' : '#2f6fd0') + '">' + titulo + '</div><div class="emb-t-dica" style="margin:0">' + sub + '</div>';
    m.querySelector('.emb-modal-ctl').innerHTML =
      '<div class="seg-toggle"><button type="button" class="seg-btn' + (modalModo === 'fc' ? ' ativo' : '') + '" data-mm="fc">Forecast</button><button type="button" class="seg-btn' + (modalModo === 'real' ? ' ativo' : '') + '" data-mm="real">Realizado</button></div>' +
      '';
    m.querySelector('.emb-modal-dia').innerHTML = modalDia ? '<span class="chip" data-mm="mes">✕ Dia ' + rotuloDiaCompleto(modalDia).split(' · ')[0] + ' · voltar à visão geral</span>' : '';
    m.querySelector('.emb-modal-corpo').innerHTML = corpo;
    m.querySelectorAll('[data-mm]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.mm === 'mes') { modalDia = null; preencherForecast(); destacarDia(); }
        else { modalModo = b.dataset.mm; preencherForecast(); }
      });
    });
  }
  function abrirForecast() {
    if (document.getElementById('embFcModal')) { fecharForecast(); return; }
    if (!bruto) return;
    modalDia = null;
    const m = document.createElement('div');
    m.id = 'embFcModal'; m.className = 'emb-modal';
    m.innerHTML = '<div class="emb-modal-box"><button type="button" class="emb-modal-x" aria-label="Fechar">✕</button>' +
      '<div class="emb-modal-topo"><div class="emb-modal-barra" title="Arraste para mover a janela"></div><div class="emb-modal-ctl"></div></div>' +
      '<div class="emb-modal-dia"></div><div class="emb-modal-corpo"></div></div>';
    m.querySelector('.emb-modal-x').addEventListener('click', fecharForecast);
    document.addEventListener('keydown', escForecast);
    document.body.appendChild(m);
    preencherForecast();
    const W = m.offsetWidth;
    m.style.left = Math.max(8, window.innerWidth - W - 24) + 'px';
    m.style.top = Math.max(8, Math.min(window.innerHeight - 120, 90)) + 'px';
    const barra = m.querySelector('.emb-modal-barra');
    let dx = 0, dy = 0, mov = false;
    barra.addEventListener('pointerdown', function (e) { mov = true; dx = e.clientX - m.offsetLeft; dy = e.clientY - m.offsetTop; barra.setPointerCapture(e.pointerId); e.preventDefault(); });
    barra.addEventListener('pointermove', function (e) {
      if (!mov) return;
      m.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)) + 'px';
      m.style.top = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dy)) + 'px';
    });
    barra.addEventListener('pointerup', function () { mov = false; });
    barra.addEventListener('pointercancel', function () { mov = false; });
  }
  // período geral do relatório (Todo o período / meses escolhidos): vale para o Mix e para a janela do forecast
  function periodoAtual() {
    const agg = bruto ? bruto.agg : [];
    const meses = Array.from(new Set(agg.map(function (r) { return String(r.d).slice(0, 7); }))).sort();
    const anos = Array.from(new Set(meses.map(function (x) { return x.slice(0, 4); }))).sort();
    if (meses.length && (!periodoMix.ano || anos.indexOf(periodoMix.ano) === -1)) periodoMix.ano = anos[anos.length - 1];
    if (periodoMix.modo === 'sel') {
      periodoMix.meses = periodoMix.meses.filter(function (x) { return meses.indexOf(x) !== -1; });
      if (!periodoMix.meses.length) periodoMix.meses = meses.length ? [meses[meses.length - 1]] : [];
    }
    return { meses: meses, anos: anos, sel: periodoMix.modo === 'sel' ? periodoMix.meses.slice().sort() : 'tudo' };
  }
  function atualizarPeriodo() { desenharFiltros(); desenharMix(); if (document.getElementById('embFcModal')) preencherForecast(); }
  function popoverMeses(meses, anos) {
    const rasc = periodoMix.rascunho;
    return '<div class="emb-pop"><div class="ano">' +
      (anos.length > 1 ? anos.map(function (a2) { return '<button type="button" class="seg-btn' + (periodoMix.ano === a2 ? ' ativo' : '') + '" data-ano="' + a2 + '">' + a2 + '</button>'; }).join('') : periodoMix.ano) +
      '</div><div class="grade">' +
      MESES.map(function (nome, i) {
        const x = periodoMix.ano + '-' + String(i + 1).padStart(2, '0'), tem = meses.indexOf(x) !== -1;
        return '<button type="button" class="seg-btn' + (rasc.indexOf(x) !== -1 ? ' ativo' : '') + (tem ? '' : ' off') + '" data-mes="' + x + '"' + (tem ? '' : ' tabindex="-1" aria-disabled="true"') + '>' + nome + '</button>';
      }).join('') + '</div><div class="rod"><button type="button" class="seg-btn ativo" data-ok="1"' + (rasc.length ? '' : ' disabled style="opacity:.4"') + '>Ok</button></div></div>';
  }
  // "Jan a Jun", "Jan, Mar a Mai", "Jul e Ago" (meses consecutivos viram intervalo)
  function textoMeses(sel) {
    const idx = function (x) { return Number(x.slice(0, 4)) * 12 + Number(x.slice(5)) - 1; };
    const anosSel = Array.from(new Set(sel.map(function (x) { return x.slice(0, 4); })));
    const rot = function (x) { return anosSel.length > 1 ? rotuloMes(x) : MESES[Number(x.slice(5)) - 1]; };
    const runs = [];
    sel.slice().sort().forEach(function (x) {
      const r = runs[runs.length - 1];
      if (r && idx(x) === idx(r[r.length - 1]) + 1) r.push(x); else runs.push([x]);
    });
    return runs.map(function (r) {
      return r.length === 1 ? rot(r[0]) : r.length === 2 ? rot(r[0]) + ' e ' + rot(r[1]) : rot(r[0]) + ' a ' + rot(r[r.length - 1]);
    }).join(', ') + (anosSel.length === 1 ? '/' + anosSel[0].slice(2) : '');
  }
  if (typeof document !== 'undefined') document.addEventListener('click', function () { if (periodoMix.aberto) { periodoMix.aberto = false; desenharFiltros(); } });
  function desenharMix() {
    const alvo = document.getElementById('embMix');
    if (!alvo) return;
    const agg = bruto ? bruto.agg : [];
    if (!agg.length) { alvo.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">Sem detalhado de notas embarcadas ainda. Suba o arquivo em Abastecimento › Embarque › Notas embarcadas.</div>'; return; }
    const per = periodoAtual(), meses = per.meses, sel = per.sel;
    const m = montarMix(agg, filtros, sel);
    const T = m.total.p || 1;
    const maxCel = Math.max(1, Math.max.apply(null, Object.keys(m.cel).map(function (k) { return m.cel[k]; })));
    const periodoTxt = sel === 'tudo' ? rotuloMes(meses[0]) + ' a ' + rotuloMes(meses[meses.length - 1]) : sel.map(rotuloMes).join(', ');
    let html =
      '<div class="week-head" style="margin-bottom:12px">' +
        '<div class="section-title" style="margin-bottom:0">Mix do embarque</div>' +
        '<div class="week-totais"><div class="item"><div class="lab">Peças</div><div class="val">' + fmtN(m.total.p) + '</div></div>' +
          '<div class="item"><div class="lab">Volumes</div><div class="val">' + fmtN(m.total.v) + '</div></div>' +
          '<div class="item"><div class="lab">Notas</div><div class="val">' + fmtN(m.total.n) + '</div></div></div>' +
      '</div>';
    html += '<div class="emb-mix"><div>';
    // --- realizado: matriz marca × segmento (% do total), verde
    html += '<div><div class="emb-sub">Realizado · marca × segmento · % das peças · ' + periodoTxt + '</div>';
    if (!m.marcas.length) html += '<div style="font-size:12px;color:var(--text-muted)">Nenhuma nota nesse recorte.</div>';
    else {
      html += '<table class="emb-matriz"><tr><th></th>' + m.segs.map(function (g) { return '<th>' + g + '</th>'; }).join('') + '<th class="tot sepcol">Total</th></tr>';
      m.marcas.forEach(function (mk) {
        html += '<tr><th class="l">' + mk + '</th>' + m.segs.map(function (g) {
          const v = m.cel[mk + '|' + g] || 0;
          if (!v) return '<td class="vz">—</td>';
          const a = 0.1 + 0.55 * v / maxCel;
          return '<td style="background:color-mix(in srgb,var(--olive) ' + Math.round(a * 100) + '%,transparent)" title="' + mk + ' · ' + g + ': ' + fmtN(v) + ' peças">' + fmtPct1(v / T * 100) + '</td>';
        }).join('') + '<td class="tot sepcol">' + fmtPct1(m.linhaM[mk] / T * 100) + '</td></tr>';
      });
      html += '<tr class="seplin"><th class="l tot">Total</th>' + m.segs.map(function (g) { return '<td class="tot">' + fmtPct1(m.colS[g] / T * 100) + '</td>'; }).join('') + '<td class="tot sepcol">100%</td></tr></table>';
    }
    html += '</div></div>';
    // --- ranking de transportadoras (rolagem; 4 visíveis)
    const VISIVEIS = 3;
    html += '<div><div class="emb-sub">Transportadoras · clique para filtrar</div><div class="emb-transp">';
    const maxP = Math.max(1, m.transportadoras.length ? m.transportadoras[0].p : 1);
    if (!m.transportadoras.length) html += '<div style="font-size:12px;color:var(--text-muted)">Nenhuma nota nesse recorte.</div>';
    m.transportadoras.forEach(function (x) {
      html += '<div class="emb-t-row' + (filtros.transp.indexOf(x.nome) !== -1 ? ' on' : '') + '" data-t="' + x.nome + '">' +
        '<div class="emb-t-top"><span>' + x.nome + '</span><b>' + fmtPct1(x.pct) + '</b></div>' +
        '<div class="emb-t-bar"><i style="width:' + Math.max(1.5, x.p / maxP * 100) + '%"></i></div>' +
        '<div class="emb-t-meta">' + fmtN(x.p) + ' peças · ' + fmtN(x.v) + ' volumes</div></div>';
    });
    const extra = m.transportadoras.length - VISIVEIS;
    html += '</div>' + (extra > 0 ? '<div class="emb-t-dica">▼ Role para ver ' + (extra === 1 ? 'a outra transportadora' : 'as outras ' + extra + ' transportadoras') + '</div>' : '') + '</div></div>';
    html += '<div class="emb-legenda-per">Período selecionado: ' + (sel === 'tudo' ? 'Todo o período' : textoMeses(sel)) + '</div>';
    alvo.innerHTML = html;
    const caixa = alvo.querySelector('.emb-transp'), linhasT = alvo.querySelectorAll('.emb-t-row');
    if (caixa && linhasT.length > VISIVEIS) caixa.style.maxHeight = (VISIVEIS * (linhasT[0].getBoundingClientRect().height + 4)) + 'px';
    alvo.querySelectorAll('.emb-t-row').forEach(function (r) { r.addEventListener('click', function () { alternarFiltro('transp', r.dataset.t); }); });
  }

  function esconderTip() { const t = document.getElementById('embTip'); if (t) t.style.display = 'none'; }
  function mostrarTip(html, e, largo) {
    let t = document.getElementById('embTip');
    if (!t) { t = document.createElement('div'); t.id = 'embTip'; t.className = 'exp-tip'; document.body.appendChild(t); }
    t.innerHTML = html; t.classList.toggle('largo', !!largo); t.style.display = 'block';
    const w = t.offsetWidth, hh = t.offsetHeight;
    t.style.left = Math.max(8, Math.min(e.clientX + 16, window.innerWidth - w - 8)) + 'px';
    t.style.top = Math.max(8, Math.min(e.clientY - hh / 2, window.innerHeight - hh - 8)) + 'px';
  }

  function desenhar() {
    const svg = document.getElementById('embSvg'), sc = document.getElementById('embScroll');
    if (!svg || !sc) return;
    document.querySelectorAll('#embVisao .seg-btn').forEach(function (b) { b.classList.toggle('ativo', b.dataset.visao === visao); });
    document.querySelectorAll('#embJanela .seg-btn').forEach(function (b) { b.classList.toggle('ativo', Number(b.dataset.janela) === janela); });
    document.getElementById('embTitulo').textContent = visao === 'forecast' ? 'Expedição × Forecast' : 'Análise Prevista de Backlog';
    const nota = document.getElementById('embNota'), tot = document.getElementById('embTotais'), leg = document.getElementById('embLegenda');
    svg.innerHTML = '';
    esconderTip();
    if (!serie) { nota.textContent = 'Carregando…'; return; }

    const nAll = serie.dias.length, hiAll = serie.hoje_idx;
    const ia = Math.max(0, hiAll - janela), ib = Math.min(nAll - 1, hiAll + janela);
    const d = {};
    Object.keys(serie).forEach(function (k) { d[k] = Array.isArray(serie[k]) && serie[k].length === nAll ? serie[k].slice(ia, ib + 1) : serie[k]; });
    const n = d.dias.length, hi = hiAll - ia;

    const w0 = sc.clientWidth || 1000, h = 320, pL = 34, pR = 34, pT = 62, pB = 54, FS = 12;
    const vis = Math.max(2, Math.min(15, n));
    const step = (w0 - pL - pR) / (vis - 1);
    const W = pL + pR + (n - 1) * step;
    svg.setAttribute('width', W); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + h);
    const NS = 'http://www.w3.org/2000/svg';
    const el = function (tag, attrs, txt) {
      const e = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (txt != null) e.textContent = txt;
      svg.appendChild(e); return e;
    };
    const defs = el('defs', {}), cp = document.createElementNS(NS, 'clipPath');
    cp.setAttribute('id', 'embClip');
    const cr = document.createElementNS(NS, 'rect');
    cr.setAttribute('x', 0); cr.setAttribute('y', 0); cr.setAttribute('width', W); cr.setAttribute('height', h - pB + 1.5);
    cp.appendChild(cr); defs.appendChild(cp);

    const series = visao === 'forecast' ? [d.expedido, d.forecast] : [d.entrada, d.saida, d.saida_efetiva, d.backlog];
    const mx = Math.max(1, ...series.flat().filter(function (v) { return v != null; })) * 1.18;
    const xF = function (i) { return pL + i * step; }, yF = function (v) { return (h - pB) - (v / mx) * (h - pT - pB); };

    if (hi < n - 1) {
      el('rect', { x: xF(hi), y: pT - 40, width: W - xF(hi) - 4, height: h - pB - pT + 40, fill: 'var(--accent-soft)', opacity: 0.55, rx: 6 });
      el('text', { x: xF(hi) + 34, y: pT - 30, 'font-size': 11, 'font-weight': 700, fill: 'var(--text-muted)' }, 'PREVISTO — somente forecast');
    }
    el('line', { x1: pL, x2: W - pR, y1: h - pB, y2: h - pB, stroke: 'var(--border)', 'stroke-width': 1 });
    el('line', { x1: xF(hi), x2: xF(hi), y1: pT - 34, y2: h - pB, stroke: 'var(--amber)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });

    const rotulos = [];
    const rot = function (x, y, txt, cor) { rotulos.push(function () { labelComFundo(svg, x, Math.min(y, h - pB - 8), txt, { fontSize: FS, cor: cor }); }); };
    const linha = function (vals, cor, dash, suave) {
      const pts = vals.map(function (v, i) { return v == null ? null : [xF(i), yF(v), v, i]; }).filter(Boolean);
      if (pts.length > 1) el('path', { d: suave ? pathMonotono(pts) : pathSuave(pts), fill: 'none', 'clip-path': 'url(#embClip)',
        stroke: cor, 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dash || '' });
      if (!suave) pts.forEach(function (pt) { el('circle', { cx: pt[0], cy: pt[1], r: 4.2, fill: cor }); });
      return pts;
    };
    const mostra = function (i) { return step >= 58 || i === hi || (i - hi) % 2 === 0; };
    const num = function (v) { return v == null ? '—' : fmtN(v); };

    if (visao === 'forecast') {
      const pF = linha(d.forecast, 'var(--accent)'), pE = linha(d.expedido, 'var(--olive)');
      const byI = function (a) { const m = {}; a.forEach(function (p) { m[p[3]] = p; }); return m; }, mF = byI(pF), mE = byI(pE);
      for (let i = 0; i < n; i++) {
        if (!mostra(i)) continue;
        const a = mF[i], b = mE[i];
        if (a && b) {
          let oA = 12, oB = 22; const dist = Math.abs(a[1] - b[1]);
          if (dist < 30) { const ex = (30 - dist) / 2 + 4; oA += ex; oB += ex; }
          const fAlto = a[1] <= b[1];
          rot(a[0], fAlto ? a[1] - oA : a[1] + oB, fmtN(a[2]), 'var(--accent)');
          rot(b[0], fAlto ? b[1] + oB : b[1] - oA, fmtN(b[2]), 'var(--olive)');
        } else if (a) rot(a[0], a[1] - 12, fmtN(a[2]), 'var(--accent)');
        else if (b) rot(b[0], b[1] - 12, fmtN(b[2]), 'var(--olive)');
      }
      // totais comparam os MESMOS dias: do início da janela até hoje, só onde há expedido E forecast
      // (o forecast só existe nos meses informados — comparar 17 dias de expedição com 2 de forecast enganaria)
      const comuns = [];
      for (let i = 0; i <= hi; i++) if (d.expedido[i] != null && d.forecast[i] != null) comuns.push(i);
      const soma = function (arr, idx) { return fmtN(idx.reduce(function (s2, i) { return s2 + arr[i]; }, 0)); };
      if (comuns.length) {
        const per = d.dias[comuns[0]] + (comuns.length > 1 ? ' a ' + d.dias[comuns[comuns.length - 1]] : '');
        tot.innerHTML = '<div class="item"><div class="lab">Expedido · ' + per + '</div><div class="val">' + soma(d.expedido, comuns) + '</div></div>' +
          '<div class="item"><div class="lab">Forecast · ' + per + '</div><div class="val">' + soma(d.forecast, comuns) + '</div></div>';
      } else {
        const idxE = []; for (let i = 0; i <= hi; i++) if (d.expedido[i] != null) idxE.push(i);
        tot.innerHTML = '<div class="item"><div class="lab">Expedido · ' + (idxE.length ? d.dias[idxE[0]] + ' a ' + d.dias[idxE[idxE.length - 1]] : 'sem dado') + '</div><div class="val">' + (idxE.length ? soma(d.expedido, idxE) : '—') + '</div></div>' +
          '<div class="item"><div class="lab">Forecast · mesmo período</div><div class="val">—</div></div>';
      }
      leg.innerHTML = '<span><i style="background:var(--olive)"></i>Expedido (peças)</span><span><i style="background:var(--accent)"></i>Forecast</span>';
      nota.textContent = '';
    } else {
      const bw = Math.min(40, step * 0.6);
      d.backlog.forEach(function (v, i) {
        if (v == null) return;
        el('rect', { x: xF(i) - bw / 2, y: yF(v), width: bw, height: Math.max(1, (h - pB) - yF(v)), rx: 4,
          fill: 'color-mix(in srgb, var(--amber) 30%, transparent)', stroke: 'var(--amber)', 'stroke-width': 1.2 });
        // coluna empilhada: a parte "Não disp. picking" do que está em tela fica em vermelho, na base da coluna
        const nd = d.backlog_nao_disp[i];
        if (nd > 0) {
          const hv = Math.max(2, (h - pB) - yF(Math.min(nd, v)));
          el('rect', { x: xF(i) - bw / 2, y: (h - pB) - hv, width: bw, height: hv, rx: 4,
            fill: 'color-mix(in srgb, var(--red) 55%, transparent)', stroke: 'var(--red)', 'stroke-width': 1.2 });
          if (hv >= 18) rot(xF(i), (h - pB) - hv / 2 + 4, fmtN(nd), 'var(--red)');
        }
        if (mostra(i)) rot(xF(i), yF(v) - 9, fmtN(v), 'var(--amber)');
      });
      linha(d.entrada, 'var(--accent)', '', true);
      // saída: TRACEJADA sempre — nos dias que já passaram é o realizado (expedido); de hoje em diante é o forecast
      const saidaUnica = d.saida.map(function (v, i) { return d.saida_efetiva[i] != null ? d.saida_efetiva[i] : v; });
      linha(saidaUnica, 'var(--olive)', '6 4', true);
      const bh = serie.backlog_hoje;
      const dataEmTela = bh && bh.gerado_em ? String(bh.gerado_em).slice(0, 10) : null;
      const rotBk = !bh ? 'sem dado' : (dataEmTela && dataEmTela !== serie.dias_iso[hiAll] ? 'em tela ' + rotuloDia(dataEmTela) : 'hoje');
      tot.innerHTML = '<div class="item"><div class="lab">Backlog · ' + rotBk + '</div><div class="val">' + (bh ? fmtN(bh.total) : '—') + '</div>' +
          (bh && bh.nao_disp > 0 ? '<div style="font-size:10.5px;color:var(--red);font-weight:600">' + fmtN(bh.nao_disp) + ' não disp. picking</div>' : '') + '</div>' +
        '<div class="item"><div class="lab">Saída prevista · hoje</div><div class="val">' + num(d.saida[hi]) + '</div></div>';
      leg.innerHTML = '<span><i style="background:var(--amber)"></i>Backlog (peças em tela)</span>' +
        '<span><i style="background:var(--red)"></i>Não disp. p/ picking</span>' +
        '<span><i style="background:var(--accent)"></i>Entrada prevista</span>' +
        '<span><i style="background:repeating-linear-gradient(90deg,var(--olive) 0 4px,transparent 4px 7px)"></i>Saída: dia que passou = realizado · de hoje em diante = forecast</span>';
      nota.textContent = '';
    }
    rotulos.forEach(function (f) { f(); });
    labelComFundo(svg, xF(hi), pT - 40, 'HOJE', { fontSize: FS, cor: '#111', fundo: 'var(--amber)' });
    d.dias.forEach(function (lab, i) {
      el('text', { x: xF(i), y: h - 28, 'text-anchor': 'middle', 'font-size': 12, fill: i === hi ? 'var(--amber)' : 'var(--text-label)', 'font-weight': i === hi ? 700 : 500 }, lab);
      el('text', { x: xF(i), y: h - 12, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-muted)', 'font-weight': 400 }, d.dias_semana[i]);
    });

    if (!serie.ultimo_dia_expedicao) nota.textContent += ' ⚠ Nenhuma expedição carregada ainda — suba a base em Abastecimento › Embarque.';
    if (!serie.tem_forecast) nota.textContent += ' Sem forecast informado para este período (Abastecimento › Embarque).';

    // hover: tooltip do dia
    const pct = function (ef, pr) { return (ef == null || !pr) ? null : (ef / pr - 1) * 100; };
    const fmtPct = function (p) { return p == null ? '—' : (p > 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + '%'; };
    const corPct = function (p) { return p == null ? 'var(--text-muted)' : Math.abs(p) <= 10 ? 'var(--olive)' : 'var(--amber)'; };
    const lin = function (r, v, cor) { return '<div class="et-l"><span>' + r + '</span><b' + (cor ? ' style="color:' + cor + '"' : '') + '>' + v + '</b></div>'; };
    d.dias_iso.forEach(function (iso, i) {
      if (iso === modalDia) el('rect', { x: xF(i) - step / 2 + 2, y: pT - 40, width: step - 4, height: h - pB - pT + 44, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5, rx: 6, 'pointer-events': 'none' });
    });
    d.dias.forEach(function (lab, i) {
      let largo = false;
      let html = '<div class="et-h">' + lab + ' · ' + d.dias_semana[i] + (i === hi ? ' · hoje' : '') + '</div>';
      if (visao === 'forecast') {
        const p = pct(d.expedido[i], d.forecast[i]);
        html += lin('Forecast', num(d.forecast[i]), 'var(--accent)') + lin('Expedido', num(d.expedido[i]), 'var(--olive)') +
          (p == null ? '' : lin('Diferença', fmtPct(p) + ' · ' + fmtN(d.expedido[i] - d.forecast[i]), corPct(p)));
      } else {
        const parcial = i === hi;
        const bloco = function (titulo, cor, pr, ef, ehBacklog) {
          const sub = parcial && !ehBacklog;
          const p = (sub || ef == null) ? null : pct(ef, pr);
          return '<div class="et-c"><div class="et-t" style="color:' + cor + '">' + titulo + '</div>' +
            '<div class="et-k">Previsto</div><div class="et-v">' + num(pr) + '</div>' +
            '<div class="et-k">Efetivo' + (sub && ef != null ? ' (parcial)' : '') + '</div><div class="et-v">' + num(ef) + '</div>' +
            '<div class="et-k">Diferença</div><div class="et-v"' + (p == null ? '' : ' style="color:' + corPct(p) + '"') + '>' + (p == null ? '—' : fmtPct(p)) + '</div></div>';
        };
        html += '<div class="et-cols">' +
          bloco('Backlog', 'var(--amber)', d.backlog_previsto[i], d.backlog_efetivo[i], true) +
          bloco('Entrada', 'var(--accent)', d.entrada[i], null, false) +
          bloco('Saída', 'var(--olive)', d.saida[i], d.expedido[i], false) + '</div>';
        if (d.backlog_nao_disp[i] > 0) {
          html += '<div class="et-l" style="margin-top:8px"><span>Não disp. picking (em tela)</span><b style="color:var(--red)">' + fmtN(d.backlog_nao_disp[i]) +
            ' · ' + (d.backlog_nao_disp[i] / d.backlog[i] * 100).toFixed(1).replace('.', ',') + '%</b></div>';
        }
        largo = true;
      }
      const col = el('rect', { x: xF(i) - step / 2, y: 0, width: step, height: h - pB + 4, class: 'exp-col' });
      col.addEventListener('mouseenter', function (e) { mostrarTip(html, e, largo); });
      col.addEventListener('mousemove', function (e) { mostrarTip(html, e, largo); });
      col.addEventListener('mouseleave', esconderTip);
      col.addEventListener('click', function () { if (!arrastou && document.getElementById('embFcModal')) selecionarDia(d.dias_iso[i]); });
      if (document.getElementById('embFcModal')) col.style.cursor = 'pointer';
    });
    sc.scrollLeft = Math.max(0, xF(hi) - w0 / 2);
  }

  /* ============================================================================
     TELA (seção Embarque) — monta o card e carrega os dados do Supabase
     ============================================================================ */
  let dataSnapshot = null;

  async function carregarDados(supabaseClient) {
    const hoje = hojeLocalISO();
    const de = somaDias(hoje, -31), ate = somaDias(hoje, 31);
    const res = await Promise.all([
      supabaseClient.from('embarque_diario').select('dia, expedido, backlog, atualizado_em').gte('dia', de).lte('dia', ate).order('dia'),
      supabaseClient.from('embarque_diario').select('dia, expedido').not('expedido', 'is', null).order('dia', { ascending: false }).limit(1),
      supabaseClient.from('embarque_diario').select('dia, backlog').not('backlog', 'is', null).order('dia', { ascending: false }).limit(1),
      supabaseClient.from('embarque_forecast_mensal').select('mes, pecas_embarque, pecas_entrada, dias_folga, prop_marca, prop_segmento, atualizado_em'),
      supabaseClient.rpc('embarque_backlog_em_tela'),
      supabaseClient.rpc('embarque_notas_agregado', { p_de: somaDias(hoje, -400) }),
    ]);
    res.slice(0, 4).forEach(function (r) { if (r.error) throw r.error; });
    if (res[4].error) console.warn('Backlog em tela indisponível (rode migracao_embarque.sql):', res[4].error.message);
    const diario = res[0].data || [];
    const ult = function (r, campo) { return r.data && r.data[0] ? { dia: r.data[0].dia, valor: r.data[0][campo] } : null; };
    const forecasts = res[3].data || [];
    let maisRecente = '';
    diario.concat(forecasts).forEach(function (r) { if (r.atualizado_em && r.atualizado_em > maisRecente) maisRecente = r.atualizado_em; });
    dataSnapshot = maisRecente || null;
    if (res[5].error) console.warn('Detalhado de notas indisponível (rode migracao_embarque.sql):', res[5].error.message);
    return { hoje: hoje, agg: res[5].error || !Array.isArray(res[5].data) ? [] : res[5].data, emTela: res[4].error ? null : res[4].data, diario: diario, forecasts: forecasts, ultimos: { expedido: ult(res[1], 'expedido'), backlog: ult(res[2], 'backlog') } };
  }

  async function iniciar(rootId, supabaseClient) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML =
      '<div class="kicker">Embarque</div>' +
      '<div class="emb-filtros" id="embFiltros"></div>' +
      '<div class="card emb-chart">' +
        '<div class="week-head">' +
          '<div class="section-title" style="margin-bottom:0" id="embTitulo">Expedição × Forecast</div>' +
          '<div class="week-ctrl">' +
            '<div class="seg-toggle" id="embVisao">' +
              '<button type="button" class="seg-btn ativo" data-visao="forecast">Forecast × Expedição</button>' +
              '<button type="button" class="seg-btn" data-visao="backlog">Análise Prevista de Backlog</button>' +
            '</div>' +
            '<div class="seg-toggle" id="embJanela" title="Quantos dias ficam disponíveis para arrastar (15 dias visíveis: 7 antes e 7 depois de hoje)">' +
              '<button type="button" class="seg-btn ativo" data-janela="15">15 dias</button>' +
              '<button type="button" class="seg-btn" data-janela="30">30 dias</button>' +
            '</div>' +
          '</div>' +
          '<div class="week-totais" id="embTotais"></div>' +
        '</div>' +
        '<div class="week-scroll" id="embScroll"><svg id="embSvg"></svg></div>' +
        '<div class="legend-line" id="embLegenda"></div>' +
        '<div class="week-nota" id="embNota">Carregando…</div>' +
      '</div>' +
      '<div class="card" id="embMix"></div>';
    injetarCss();
    document.querySelectorAll('#embVisao .seg-btn').forEach(function (b) { b.addEventListener('click', function () { visao = b.dataset.visao; desenhar(); }); });
    document.querySelectorAll('#embJanela .seg-btn').forEach(function (b) { b.addEventListener('click', function () { janela = Number(b.dataset.janela); desenhar(); }); });
    const sc = document.getElementById('embScroll');   // arrastar com o mouse para rolar
    let x0 = 0, s0 = 0, ativo = false;
    sc.addEventListener('mousedown', function (e) { ativo = true; arrastou = false; x0 = e.clientX; s0 = sc.scrollLeft; });
    window.addEventListener('mousemove', function (e) { if (ativo) { if (Math.abs(e.clientX - x0) > 4) arrastou = true; sc.scrollLeft = s0 - (e.clientX - x0); } });
    window.addEventListener('mouseup', function () { ativo = false; });
    let t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t); t = setTimeout(function () { if (document.getElementById('secao-embarque').classList.contains('ativa')) desenhar(); }, 200);
    });
    await recarregar(supabaseClient);
  }

  async function recarregar(supabaseClient) {
    try {
      bruto = await carregarDados(supabaseClient);
      serieBase = montarSerieEmbarque(bruto.diario, bruto.forecasts, bruto.hoje, bruto.ultimos, bruto.emTela);
      serie = aplicarFiltrosNaSerie(serieBase, { filtros: filtros, agg: bruto.agg, forecasts: bruto.forecasts, emTela: bruto.emTela });
      desenharFiltros(); desenhar(); desenharMix();
      if (window.dataSnapshotEmbarqueDefinir) window.dataSnapshotEmbarqueDefinir(dataSnapshot);
    } catch (e) {
      console.error(e);
      const nota = document.getElementById('embNota');
      if (nota) nota.textContent = 'Erro ao carregar o Embarque: ' + (e && e.message ? e.message : e) +
        ' — as tabelas embarque_diario / embarque_forecast_mensal existem? (migracao_embarque.sql)';
    }
  }

  /* ============================================================================
     ADMIN — subir a base histórica e informar o forecast mensal
     ============================================================================ */
  async function processarBaseEmbarque(supabaseClient, arquivo, avisar) {
    avisar = avisar || function () {};
    if (!window.XLSX) throw new Error('Biblioteca de planilhas (XLSX) não carregou — recarregue a página.');
    avisar('Lendo a planilha…');
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets['Plan1'] || wb.Sheets[wb.SheetNames[0]];
    const linhas = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const parsed = parsearBaseEmbarque(linhas);
    parsed.avisos.forEach(function (a) { avisar('⚠ ' + a); });
    avisar(fmtN(parsed.registros.length) + ' dia(s) com dado, de ' + rotuloDia(parsed.periodo.de) + '/' + parsed.periodo.de.slice(0, 4) +
      ' a ' + rotuloDia(parsed.periodo.ate) + '/' + parsed.periodo.ate.slice(0, 4) + ' · ' + fmtN(parsed.total_expedido) + ' peças expedidas no total.');
    for (let i = 0; i < parsed.registros.length; i += 300) {
      const lote = parsed.registros.slice(i, i + 300).map(function (r) { return Object.assign({}, r, { atualizado_em: new Date().toISOString() }); });
      const { error } = await supabaseClient.from('embarque_diario').upsert(lote, { onConflict: 'dia' });
      if (error) throw error;
      avisar('Gravando… ' + fmtN(Math.min(i + 300, parsed.registros.length)) + ' / ' + fmtN(parsed.registros.length));
    }
    return parsed;
  }

  async function processarNotasEmbarcadas(supabaseClient, arquivo, avisar) {
    avisar = avisar || function () {};
    if (!window.XLSX) throw new Error('Biblioteca de planilhas (XLSX) não carregou — recarregue a página.');
    avisar('Lendo a planilha de notas embarcadas…');
    const wb = window.XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    const linhas = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const fam = await supabaseClient.from('dim_familias').select('codigo, marca, categoria, segmento');
    if (fam.error) throw fam.error;
    const familias = {};
    (fam.data || []).forEach(function (f) { familias[String(f.codigo).padStart(3, '0')] = f; });
    const parsed = parsearNotasEmbarcadas(linhas, familias);
    parsed.avisos.forEach(function (a) { avisar('⚠ ' + a); });
    if (!parsed.registros.length) throw new Error('Nenhuma nota reconhecida na planilha.');
    avisar(fmtN(parsed.registros.length) + ' nota(s), embarque de ' + rotuloDia(parsed.periodo.de) + '/' + parsed.periodo.de.slice(0, 4) + ' a ' +
      rotuloDia(parsed.periodo.ate) + '/' + parsed.periodo.ate.slice(0, 4) + ' · ' + fmtN(parsed.total_pecas) + ' peças.');
    const agora = new Date().toISOString();
    for (let i = 0; i < parsed.registros.length; i += 500) {
      const lote = parsed.registros.slice(i, i + 500).map(function (r) { return Object.assign({}, r, { atualizado_em: agora }); });
      const { error } = await supabaseClient.from('embarque_notas').upsert(lote, { onConflict: 'nf' });
      if (error) throw error;
      avisar('Gravando… ' + fmtN(Math.min(i + 500, parsed.registros.length)) + ' / ' + fmtN(parsed.registros.length));
    }
    return parsed;
  }

  function lerFolgas(txt) {
    const out = [];
    String(txt || '').split(/[\s,;]+/).forEach(function (t) {
      if (!t) return;
      const d = dataDeCelula(t);
      if (!d) throw new Error('Data de folga inválida: "' + t + '" (use dd/mm/aaaa ou aaaa-mm-dd).');
      out.push(d);
    });
    return out;
  }
  /* Proporções [{nome,pct}]: linhas vazias somem; se houver alguma, precisam somar 100%. */
  function validarProporcoes(rotulo, linhas) {
    const lista = (linhas || []).map(function (l) {
      return { nome: String(l.nome || '').trim().toUpperCase(), pct: Number(String(l.pct).replace(',', '.')) };
    }).filter(function (l) { return l.nome || (l.pct && l.pct > 0); });
    if (!lista.length) return [];
    lista.forEach(function (l) {
      if (!l.nome) throw new Error(rotulo + ': tem proporção sem nome.');
      if (!(l.pct > 0)) throw new Error(rotulo + ': "' + l.nome + '" está sem proporção.');
    });
    if (new Set(lista.map(function (l) { return l.nome; })).size !== lista.length) throw new Error(rotulo + ': nome repetido.');
    const soma = lista.reduce(function (t, l) { return t + l.pct; }, 0);
    if (Math.abs(soma - 100) > 0.05) throw new Error(rotulo + ': as proporções somam ' + String(Math.round(soma * 100) / 100).replace('.', ',') + '%, precisam somar 100%.');
    return lista;
  }
  async function salvarForecast(supabaseClient, f) {
    if (!/^\d{4}-\d{2}$/.test(f.mes || '')) throw new Error('Escolha o mês e o ano.');
    const pecas = lerMilPecas(f.pecas);
    if (pecas === null || isNaN(pecas)) throw new Error('Informe o forecast do mês (em mil peças).');
    const entrada = lerMilPecas(f.entrada);
    if (entrada !== null && isNaN(entrada)) throw new Error('Entrada prevista inválida.');
    const { error } = await supabaseClient.from('embarque_forecast_mensal').upsert(
      { mes: f.mes, pecas_embarque: pecas, pecas_entrada: entrada, dias_folga: lerFolgas(f.folgas),
        prop_marca: validarProporcoes('Marca', f.marcas), prop_segmento: validarProporcoes('Segmento', f.segmentos),
        atualizado_em: new Date().toISOString() },
      { onConflict: 'mes' });
    if (error) throw error;
  }

  let adminLigado = false;
  function ligarAdmin(supabaseClient) {
    if (adminLigado || !document.getElementById('inputBaseEmbarque')) return;
    adminLigado = true;
    const $ = function (id) { return document.getElementById(id); };
    // ---- base histórica ----
    let arquivo = null;
    const estado = function () {
      $('btnProcessarBaseEmbarque').disabled = !arquivo;
      $('dropzoneBaseEmbarqueTexto').textContent = arquivo ? '✓ ' + arquivo.name : 'Clique para selecionar o .xlsx da base de Embarque';
    };
    $('dropzoneBaseEmbarque').addEventListener('click', function () { $('inputBaseEmbarque').click(); });
    $('inputBaseEmbarque').addEventListener('change', function (e) { arquivo = (e.target.files && e.target.files[0]) || null; estado(); });
    $('btnProcessarBaseEmbarque').addEventListener('click', async function () {
      const log = $('logBaseEmbarque'), ok = $('okBaseEmbarque');
      ok.style.display = 'none'; log.textContent = '';
      const escrever = function (m) { log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
      $('btnProcessarBaseEmbarque').disabled = true;
      try {
        await processarBaseEmbarque(supabaseClient, arquivo, escrever);
        ok.textContent = '✔ Base gravada — o gráfico do Embarque já usa esses dias (reabra a aba se ela estiver aberta).';
        ok.style.display = '';
        arquivo = null; $('inputBaseEmbarque').value = ''; estado();
        if (bruto) recarregar(supabaseClient);
      } catch (e) {
        escrever('ERRO: ' + (e && e.message ? e.message : String(e))); console.error(e);
        $('btnProcessarBaseEmbarque').disabled = false;
      }
    });
    // ---- notas embarcadas (detalhado) ----
    let arqNotas = null;
    const estadoNotas = function () {
      $('btnProcessarNotasEmb').disabled = !arqNotas;
      $('dropzoneNotasEmbTexto').textContent = arqNotas ? '✓ ' + arqNotas.name : 'Clique para selecionar o .xls/.xlsx de Notas Embarcadas';
    };
    $('dropzoneNotasEmb').addEventListener('click', function () { $('inputNotasEmb').click(); });
    $('inputNotasEmb').addEventListener('change', function (e) { arqNotas = (e.target.files && e.target.files[0]) || null; estadoNotas(); });
    $('btnProcessarNotasEmb').addEventListener('click', async function () {
      const log = $('logNotasEmb'), ok = $('okNotasEmb');
      ok.style.display = 'none'; log.textContent = '';
      const escrever = function (m) { log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
      $('btnProcessarNotasEmb').disabled = true;
      try {
        await processarNotasEmbarcadas(supabaseClient, arqNotas, escrever);
        ok.textContent = '✔ Notas gravadas — os filtros e o mix do Embarque já usam esses dias (reabra a aba se ela estiver aberta).';
        ok.style.display = '';
        arqNotas = null; $('inputNotasEmb').value = ''; estadoNotas();
        if (bruto) recarregar(supabaseClient);
      } catch (e) {
        escrever('ERRO: ' + (e && e.message ? e.message : String(e))); console.error(e);
        $('btnProcessarNotasEmb').disabled = false;
      }
    });
    estadoNotas();
    // ---- forecast mensal ----
    const linhaProp = function (cont, nome, pct) {
      const div = document.createElement('div');
      div.className = 'emb-prop-linha';
      div.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
      div.innerHTML = '<input type="text" class="emb-prop-nome" list="' + (cont.id === 'embPropMarca' ? 'dlEmbMarcas' : 'dlEmbSegmentos') + '" placeholder="' +
          (cont.id === 'embPropMarca' ? 'Marca' : 'Segmento') + '" style="padding:6px 10px;width:170px;border-radius:6px;background:var(--bg-input);color:var(--text);border:1px solid var(--border)">' +
        '<input type="text" class="emb-prop-pct" placeholder="%" style="padding:6px 10px;width:70px;border-radius:6px;background:var(--bg-input);color:var(--text);border:1px solid var(--border)">' +
        '<button type="button" class="btn-mini" title="Remover">×</button>';
      div.querySelector('.emb-prop-nome').value = nome || '';
      div.querySelector('.emb-prop-pct').value = pct == null ? '' : String(pct).replace('.', ',');
      div.querySelector('button').addEventListener('click', function () { div.remove(); prever(); });
      div.querySelectorAll('input').forEach(function (i) { i.addEventListener('input', prever); });
      cont.appendChild(div);
    };
    const lerLinhas = function (cont) {
      return Array.from(cont.querySelectorAll('.emb-prop-linha')).map(function (l) {
        return { nome: l.querySelector('.emb-prop-nome').value, pct: l.querySelector('.emb-prop-pct').value };
      });
    };
    const somaTxt = function (cont, el) {
      const t = lerLinhas(cont).reduce(function (a2, l) { const v = Number(String(l.pct).replace(',', '.')); return a2 + (v > 0 ? v : 0); }, 0);
      el.textContent = t > 0 ? 'Soma: ' + String(Math.round(t * 100) / 100).replace('.', ',') + '%' : '';
      el.style.color = Math.abs(t - 100) <= 0.05 ? 'var(--olive)' : 'var(--amber)';
    };
    const prever = function () {
      const mes = $('embMes').value, pecas = lerMilPecas($('embPecas').value);
      let txt = '';
      try {
        if (/^\d{4}-\d{2}$/.test(mes)) {
          const dias = diasUteisDoMes(mes, lerFolgas($('embFolgas').value));
          txt = fmtN(dias.length) + ' dia(s) útil(eis) (seg–sex)';
          if (pecas && !isNaN(pecas) && dias.length) txt = '= ' + fmtN(pecas) + ' peças · ' + txt + ' · ' + fmtN(Math.floor(pecas / dias.length)) + ' peças por dia';
        }
      } catch (e) { txt = e.message; }
      $('embPreview').textContent = txt;
      somaTxt($('embPropMarca'), $('embSomaMarca')); somaTxt($('embPropSeg'), $('embSomaSeg'));
    };
    ['embMes', 'embPecas', 'embEntrada', 'embFolgas'].forEach(function (id) { $(id).addEventListener('input', prever); });
    $('btnAddMarca').addEventListener('click', function () { linhaProp($('embPropMarca')); });
    $('btnAddSeg').addEventListener('click', function () { linhaProp($('embPropSeg')); });
    const limparForm = function () {
      $('embPropMarca').innerHTML = ''; $('embPropSeg').innerHTML = '';
      linhaProp($('embPropMarca')); linhaProp($('embPropSeg'));
    };
    limparForm();
    const resumoProp = function (arr) { return (arr || []).map(function (x) { return x.nome + ' ' + String(x.pct).replace('.', ',') + '%'; }).join(' · '); };
    const listar = async function () {
      const { data, error } = await supabaseClient.from('embarque_forecast_mensal').select('*').order('mes', { ascending: false });
      if (error) { $('embForecastLista').textContent = error.message; return; }
      $('embForecastLista').innerHTML = (data || []).length ? data.map(function (f) {
        const n = diasUteisDoMes(f.mes, f.dias_folga).length;
        return '<div class="cap-item" style="margin:8px 0"><div style="display:flex;gap:10px;align-items:center"><span><strong>' + f.mes.slice(5, 7) + '/' + f.mes.slice(0, 4) + '</strong> — ' + fmtN(f.pecas_embarque) +
          ' peças em ' + n + ' dias úteis (' + fmtN(Math.floor(f.pecas_embarque / Math.max(n, 1))) + '/dia)' +
          (f.pecas_entrada != null ? ' · entrada ' + fmtN(f.pecas_entrada) : '') +
          '</span><button class="btn-mini" data-mes="' + f.mes + '" title="Editar">Editar</button>' +
          '<button class="btn-mini" data-del="' + f.mes + '" title="Remover">×</button></div>' +
          ((f.prop_marca || []).length ? '<div style="margin-left:2px">Marca: ' + resumoProp(f.prop_marca) + '</div>' : '') +
          ((f.prop_segmento || []).length ? '<div style="margin-left:2px">Segmento: ' + resumoProp(f.prop_segmento) + '</div>' : '') + '</div>';
      }).join('') : 'Nenhum forecast informado.';
      $('embForecastLista').querySelectorAll('button[data-mes]').forEach(function (b) {
        b.addEventListener('click', function () {
          const f = data.find(function (x) { return x.mes === b.dataset.mes; });
          $('embMes').value = f.mes; $('embPecas').value = f.pecas_embarque / 1000;
          $('embEntrada').value = f.pecas_entrada == null ? '' : f.pecas_entrada / 1000;
          $('embFolgas').value = (f.dias_folga || []).join(', ');
          $('embPropMarca').innerHTML = ''; $('embPropSeg').innerHTML = '';
          (f.prop_marca || []).forEach(function (x) { linhaProp($('embPropMarca'), x.nome, x.pct); });
          (f.prop_segmento || []).forEach(function (x) { linhaProp($('embPropSeg'), x.nome, x.pct); });
          if (!(f.prop_marca || []).length) linhaProp($('embPropMarca'));
          if (!(f.prop_segmento || []).length) linhaProp($('embPropSeg'));
          prever();
        });
      });
      $('embForecastLista').querySelectorAll('button[data-del]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Remover o forecast de ' + b.dataset.del + '?')) return;
          const r = await supabaseClient.from('embarque_forecast_mensal').delete().eq('mes', b.dataset.del);
          if (r.error) { $('logForecastEmbarque').textContent = 'ERRO: ' + r.error.message; return; }
          listar(); if (bruto) recarregar(supabaseClient);
        });
      });
    };
    $('btnSalvarForecastEmbarque').addEventListener('click', async function () {
      const log = $('logForecastEmbarque'); log.textContent = '';
      try {
        await salvarForecast(supabaseClient, { mes: $('embMes').value, pecas: $('embPecas').value, entrada: $('embEntrada').value, folgas: $('embFolgas').value,
          marcas: lerLinhas($('embPropMarca')), segmentos: lerLinhas($('embPropSeg')) });
        log.textContent = '✔ Forecast salvo.';
        listar(); if (bruto) recarregar(supabaseClient);
      } catch (e) { log.textContent = 'ERRO: ' + (e && e.message ? e.message : String(e)); }
    });
    estado(); listar(); prever();
  }

  const api = {
    iniciar: iniciar, ligarAdmin: ligarAdmin, processarBaseEmbarque: processarBaseEmbarque, salvarForecast: salvarForecast,
    parsearBaseEmbarque: parsearBaseEmbarque, diasUteisDoMes: diasUteisDoMes, distribuirNosDias: distribuirNosDias,
    forecastPorDia: forecastPorDia, validarProporcoes: validarProporcoes, nomeCurtoTransportadora: nomeCurtoTransportadora,
    parsearNotasEmbarcadas: parsearNotasEmbarcadas, aplicarFiltrosNaSerie: aplicarFiltrosNaSerie, montarMix: montarMix, processarNotasEmbarcadas: processarNotasEmbarcadas, montarSerieEmbarque: montarSerieEmbarque, lerMilPecas: lerMilPecas, repartir: repartir, dataDeCelula: dataDeCelula,
    dataSnapshot: function () { return dataSnapshot; },
  };
  if (typeof window !== 'undefined') window.Embarque = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();


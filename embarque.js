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
   - Entrada prevista no backlog: opcional (ainda não informada pelo Embarque).
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
      if (f.pecas_entrada !== null && f.pecas_entrada !== undefined) {
        const distE = distribuirNosDias(Number(f.pecas_entrada) || 0, uteis);
        todos.forEach(function (d) { entrada[d] = distE[d] || 0; });
      }
    });
    return { saida: saida, entrada: entrada };
  }

  /* ============================================================================
     SÉRIE DO GRÁFICO — D-30 a D+30 (61 dias), mesmo formato do E-commerce
     ============================================================================ */
  function montarSerieEmbarque(diario, forecasts, hojeISO, ultimos) {
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
    // Só projeta enquanto houver entrada E saída prevista — sem entrada informada não há projeção.
    const backlogPrev = {};
    if (ultBk) {
      let b = ultBk.valor, d = ultBk.dia;
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
        const r = porDia[d];
        return r && r.backlog !== null && r.backlog !== undefined ? r.backlog : null;
      }),
      backlog_previsto: dias.map(function (d) { return nv(backlogPrev[d]); }),
      backlog: dias.map(function (d) {
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

  let visao = 'forecast', janela = 15, serie = null, bruto = null;

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

    const series = visao === 'forecast' ? [d.expedido, d.forecast] : [d.entrada, d.saida, d.backlog];
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
      nota.textContent = 'Passe o mouse sobre um dia para ver expedido × forecast e a diferença. Arraste ou use a barra para ver outros dias. ' +
        'Forecast = previsto do mês dividido pelos dias úteis (seg–sex).';
    } else {
      const bw = Math.min(40, step * 0.6);
      d.backlog.forEach(function (v, i) {
        if (v == null) return;
        el('rect', { x: xF(i) - bw / 2, y: yF(v), width: bw, height: Math.max(1, (h - pB) - yF(v)), rx: 4,
          fill: 'color-mix(in srgb, var(--amber) 30%, transparent)', stroke: 'var(--amber)', 'stroke-width': 1.2 });
        if (mostra(i)) rot(xF(i), yF(v) - 9, fmtN(v), 'var(--amber)');
      });
      linha(d.entrada, 'var(--accent)', '', true); linha(d.saida, 'var(--olive)', '6 4', true);
      const bkUlt = serie.ultimo_dia_backlog ? serie.backlog_efetivo[serie.dias_iso.indexOf(serie.ultimo_dia_backlog)] : null;
      tot.innerHTML = '<div class="item"><div class="lab">Backlog · ' + (serie.ultimo_dia_backlog ? rotuloDia(serie.ultimo_dia_backlog) : 'sem dado') + '</div><div class="val">' + num(bkUlt) + '</div></div>' +
        '<div class="item"><div class="lab">Saída prevista · hoje</div><div class="val">' + num(d.saida[hi]) + '</div></div>';
      leg.innerHTML = '<span><i style="background:var(--amber)"></i>Backlog (amanhecer no dia)</span>' +
        '<span><i style="background:var(--accent)"></i>Entrada prevista</span>' +
        '<span><i style="background:var(--olive)"></i>Saída prevista (forecast de embarque)</span>';
      nota.textContent = 'Passe o mouse sobre um dia para ver previsto × efetivo. Backlog = peças aguardando embarque (base do Embarque). ' +
        (serie.tem_entrada_prevista
          ? 'Dias futuros: backlog do dia seguinte = backlog + entrada prevista − saída prevista.'
          : 'A entrada prevista ainda não foi informada pelo Embarque: o backlog dos dias futuros não é projetado até lá (Admin › Embarque › Forecast).');
    }
    rotulos.forEach(function (f) { f(); });
    labelComFundo(svg, xF(hi), pT - 40, 'HOJE', { fontSize: FS, cor: '#111', fundo: 'var(--amber)' });
    d.dias.forEach(function (lab, i) {
      el('text', { x: xF(i), y: h - 28, 'text-anchor': 'middle', 'font-size': 12, fill: i === hi ? 'var(--amber)' : 'var(--text-label)', 'font-weight': i === hi ? 700 : 500 }, lab);
      el('text', { x: xF(i), y: h - 12, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-muted)', 'font-weight': 400 }, d.dias_semana[i]);
    });

    // aviso de base desatualizada (dados do realizado param antes de hoje)
    const hojeIso = serie.dias_iso[hiAll];
    if (serie.ultimo_dia_expedicao && serie.ultimo_dia_expedicao < somaDias(hojeIso, -1)) {
      nota.textContent += ' ⚠ Base de Embarque atualizada só até ' + rotuloDia(serie.ultimo_dia_expedicao) + ' — suba a base atual em Abastecimento › Embarque para completar os dias seguintes.';
    } else if (!serie.ultimo_dia_expedicao) {
      nota.textContent += ' ⚠ Nenhuma expedição carregada ainda — suba a base em Abastecimento › Embarque.';
    }
    if (!serie.tem_forecast) nota.textContent += ' Sem forecast informado para este período (Abastecimento › Embarque).';

    // hover: tooltip do dia
    const pct = function (ef, pr) { return (ef == null || !pr) ? null : (ef / pr - 1) * 100; };
    const fmtPct = function (p) { return p == null ? '—' : (p > 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + '%'; };
    const corPct = function (p) { return p == null ? 'var(--text-muted)' : Math.abs(p) <= 10 ? 'var(--olive)' : 'var(--amber)'; };
    const lin = function (r, v, cor) { return '<div class="et-l"><span>' + r + '</span><b' + (cor ? ' style="color:' + cor + '"' : '') + '>' + v + '</b></div>'; };
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
        largo = true;
      }
      const col = el('rect', { x: xF(i) - step / 2, y: 0, width: step, height: h - pB + 4, class: 'exp-col' });
      col.addEventListener('mouseenter', function (e) { mostrarTip(html, e, largo); });
      col.addEventListener('mousemove', function (e) { mostrarTip(html, e, largo); });
      col.addEventListener('mouseleave', esconderTip);
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
      supabaseClient.from('embarque_forecast_mensal').select('mes, pecas_embarque, pecas_entrada, dias_folga, atualizado_em'),
    ]);
    res.forEach(function (r) { if (r.error) throw r.error; });
    const diario = res[0].data || [];
    const ult = function (r, campo) { return r.data && r.data[0] ? { dia: r.data[0].dia, valor: r.data[0][campo] } : null; };
    const forecasts = res[3].data || [];
    let maisRecente = '';
    diario.concat(forecasts).forEach(function (r) { if (r.atualizado_em && r.atualizado_em > maisRecente) maisRecente = r.atualizado_em; });
    dataSnapshot = maisRecente || null;
    return { hoje: hoje, diario: diario, forecasts: forecasts, ultimos: { expedido: ult(res[1], 'expedido'), backlog: ult(res[2], 'backlog') } };
  }

  async function iniciar(rootId, supabaseClient) {
    const root = document.getElementById(rootId);
    if (!root) return;
    root.innerHTML =
      '<div class="kicker">Embarque</div>' +
      '<div class="card">' +
        '<div class="week-head">' +
          '<div class="section-title" style="margin-bottom:0" id="embTitulo">Expedição × Forecast</div>' +
          '<div class="week-ctrl">' +
            '<div class="seg-toggle" id="embVisao">' +
              '<button type="button" class="seg-btn ativo" data-visao="forecast">Forecast × Expedição</button>' +
              '<button type="button" class="seg-btn" data-visao="backlog">Análise Prevista de Backlog</button>' +
            '</div>' +
            '<div class="seg-toggle" id="embJanela" title="Quantos dias aparecem de uma vez (o resto fica na rolagem)">' +
              '<button type="button" class="seg-btn ativo" data-janela="15">15 dias</button>' +
              '<button type="button" class="seg-btn" data-janela="30">30 dias</button>' +
            '</div>' +
          '</div>' +
          '<div class="week-totais" id="embTotais"></div>' +
        '</div>' +
        '<div class="week-scroll" id="embScroll"><svg id="embSvg"></svg></div>' +
        '<div class="legend-line" id="embLegenda"></div>' +
        '<div class="week-nota" id="embNota">Carregando…</div>' +
      '</div>';
    document.querySelectorAll('#embVisao .seg-btn').forEach(function (b) { b.addEventListener('click', function () { visao = b.dataset.visao; desenhar(); }); });
    document.querySelectorAll('#embJanela .seg-btn').forEach(function (b) { b.addEventListener('click', function () { janela = Number(b.dataset.janela); desenhar(); }); });
    const sc = document.getElementById('embScroll');   // arrastar com o mouse para rolar
    let x0 = 0, s0 = 0, ativo = false;
    sc.addEventListener('mousedown', function (e) { ativo = true; x0 = e.clientX; s0 = sc.scrollLeft; });
    window.addEventListener('mousemove', function (e) { if (ativo) sc.scrollLeft = s0 - (e.clientX - x0); });
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
      serie = montarSerieEmbarque(bruto.diario, bruto.forecasts, bruto.hoje, bruto.ultimos);
      desenhar();
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
  async function salvarForecast(supabaseClient, f) {
    if (!/^\d{4}-\d{2}$/.test(f.mes || '')) throw new Error('Escolha o mês.');
    const pecas = Math.round(Number(String(f.pecas).replace(/\./g, '').replace(',', '.')));
    if (!(pecas >= 0)) throw new Error('Informe as peças embarcadas previstas do mês.');
    let entrada = null;
    if (String(f.entrada || '').trim() !== '') {
      entrada = Math.round(Number(String(f.entrada).replace(/\./g, '').replace(',', '.')));
      if (!(entrada >= 0)) throw new Error('Entrada prevista inválida.');
    }
    const { error } = await supabaseClient.from('embarque_forecast_mensal').upsert(
      { mes: f.mes, pecas_embarque: pecas, pecas_entrada: entrada, dias_folga: lerFolgas(f.folgas), atualizado_em: new Date().toISOString() },
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
    // ---- forecast mensal ----
    const prever = function () {
      const mes = $('embMes').value, pecas = Math.round(Number(String($('embPecas').value).replace(/\./g, '').replace(',', '.')));
      let txt = '';
      try {
        if (/^\d{4}-\d{2}$/.test(mes)) {
          const dias = diasUteisDoMes(mes, lerFolgas($('embFolgas').value));
          txt = fmtN(dias.length) + ' dia(s) útil(eis) (seg–sex)';
          if (pecas > 0 && dias.length) txt += ' · ' + fmtN(Math.floor(pecas / dias.length)) + ' peças por dia';
        }
      } catch (e) { txt = e.message; }
      $('embPreview').textContent = txt;
    };
    ['embMes', 'embPecas', 'embFolgas'].forEach(function (id) { $(id).addEventListener('input', prever); });
    const listar = async function () {
      const { data, error } = await supabaseClient.from('embarque_forecast_mensal').select('*').order('mes', { ascending: false });
      if (error) { $('embForecastLista').textContent = error.message; return; }
      $('embForecastLista').innerHTML = (data || []).length ? data.map(function (f) {
        const n = diasUteisDoMes(f.mes, f.dias_folga).length;
        return '<div class="cap-item" style="display:flex;gap:10px;align-items:center;margin:4px 0"><span>' + f.mes.slice(5, 7) + '/' + f.mes.slice(0, 4) + ' — ' + fmtN(f.pecas_embarque) +
          ' peças em ' + n + ' dias úteis (' + fmtN(Math.floor(f.pecas_embarque / Math.max(n, 1))) + '/dia)' +
          (f.pecas_entrada != null ? ' · entrada ' + fmtN(f.pecas_entrada) : '') +
          '</span><button class="btn-mini" data-mes="' + f.mes + '" title="Editar">Editar</button>' +
          '<button class="btn-mini" data-del="' + f.mes + '" title="Remover">×</button></div>';
      }).join('') : 'Nenhum forecast informado.';
      $('embForecastLista').querySelectorAll('button[data-mes]').forEach(function (b) {
        b.addEventListener('click', function () {
          const f = data.find(function (x) { return x.mes === b.dataset.mes; });
          $('embMes').value = f.mes; $('embPecas').value = f.pecas_embarque;
          $('embEntrada').value = f.pecas_entrada == null ? '' : f.pecas_entrada;
          $('embFolgas').value = (f.dias_folga || []).join(', '); prever();
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
        await salvarForecast(supabaseClient, { mes: $('embMes').value, pecas: $('embPecas').value, entrada: $('embEntrada').value, folgas: $('embFolgas').value });
        log.textContent = '✔ Forecast salvo.';
        listar(); if (bruto) recarregar(supabaseClient);
      } catch (e) { log.textContent = 'ERRO: ' + (e && e.message ? e.message : String(e)); }
    });
    estado(); listar();
  }

  const api = {
    iniciar: iniciar, ligarAdmin: ligarAdmin, processarBaseEmbarque: processarBaseEmbarque, salvarForecast: salvarForecast,
    parsearBaseEmbarque: parsearBaseEmbarque, diasUteisDoMes: diasUteisDoMes, distribuirNosDias: distribuirNosDias,
    forecastPorDia: forecastPorDia, montarSerieEmbarque: montarSerieEmbarque, dataDeCelula: dataDeCelula,
    dataSnapshot: function () { return dataSnapshot; },
  };
  if (typeof window !== 'undefined') window.Embarque = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

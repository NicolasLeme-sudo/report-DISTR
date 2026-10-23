/* ============================================================
   HEATMAP OPERACIONAL — PLANTA 3D DA DISTR (23/10/2026)

   Mesmo traço da planta do Report E-commerce (planta3d.js de lá), com o
   estoque da distribuidora:
   - Duas regiões: ruas 01–08 à direita (rua 01 encostada no estoque do
     E-commerce) e ruas 11–15 no canto esquerdo, com metade do comprimento.
     O estoque do E-commerce não é desenhado: no lugar dele fica só a
     divisória, como a divisão de módulos da planta do e-comm.
   - Cada rua é um corredor com a longarina ímpar à esquerda e a par à
     direita (rua de um lado só, como a 11 do Pulmão, desenha só o lado que
     existe). Box 001 no fundo do galpão; a numeração cresce para a frente.
   - Picking embaixo (níveis 1–7) e Pulmão em cima (níveis 8–12).
   - Frente: colmeias pretas (2 por par de longarinas encostadas), caixas
     de faturamento e eclusas.

   Dados: payload.mapa_enderecos do snapshot de Picking + Pulmão (ver
   montarMapaEnderecos em ingest-ressuprimento.js) e ocupacao_por_rua para a
   ocupação oficial de cada rua (capacidade da planilha).

   Uso: montarPlanta3DDistr(container, { mapa, opr, gerado_em, arquivos })
   Three.js r128 é carregado sob demanda na primeira vez.
   ============================================================ */
(function () {
'use strict';

const URL_THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const URL_ORBIT = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

const P3 = { estado: null, ui: { zona: 'geral', nivel: 0, topo: false, faixas: false, visao: 'calor', cam: null } };

/* ---------------- utilidades ---------------- */
const fmtI = v => Math.round(v).toLocaleString('pt-BR');
const fmtP = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const pad = (v, n) => String(v).padStart(n || 2, '0');
function carregarScript(src) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar ' + src));
    document.head.appendChild(s);
  });
}
async function garantirThree() {
  if (window.THREE && window.THREE.OrbitControls) return;
  if (!window.THREE) await carregarScript(URL_THREE);
  if (!window.THREE.OrbitControls) await carregarScript(URL_ORBIT);
}

/* ---------------- planta (unidade ≈ 1 m) ---------------- */
const D = 1.1, A = 3.2, G = .3, PASSO = 2 * D + A + G;   // longarina, corredor, folga entre longarinas encostadas
const L_LONGA = 72, L_CURTA = 36;                         // ruas 01–08 e 11–15 (metade)
const RUAS_ESQ = ['11', '12', '13', '14', '15'], RUAS_DIR = ['1', '2', '3', '4', '5', '6', '7', '8'];
const XL = 0, X_DIV = XL + RUAS_ESQ.length * PASSO + 4, XR = X_DIV + 4.5;   // divisória larga no lugar do estoque do e-comm
const PK_TOPO = 4.2, PU_BASE = 4.5, PU_PASSO = 1.35, PU_H = 1.1, ALT = PU_BASE + 5 * PU_PASSO + .3;
const BLOCO = 6;                                          // trecho de ~6 m da longarina = uma célula do calor
function geoRua(rua) {
  const esq = RUAS_ESQ.indexOf(rua), i = esq >= 0 ? esq : RUAS_DIR.indexOf(rua);
  const x0 = (esq >= 0 ? XL : XR) + i * PASSO;
  return { xImpar: x0 + D / 2, xPar: x0 + D + A + D / 2, xCorr: x0 + D + A / 2, L: esq >= 0 ? L_CURTA : L_LONGA };
}
const Z_FRENTE = L_LONGA;
const VIEWS = {
  geral:   { t: [45, 2, 46], o: [-22, 64, 92], top: 185 },
  pulmao:  { t: [45, 6, 40], o: [-20, 56, 80], top: 150 },
  picking: { t: [45, 1, 44], o: [-18, 44, 70], top: 150 }
};

/* ---------------- cores ---------------- */
const RAMPS = {
  dark:  [[0, '#1E7A4A'], [.6, '#45C645'], [.72, '#C6D23A'], [.82, '#F6BD00'], [.92, '#F28322'], [1, '#E0283E']],
  light: [[0, '#2A8F55'], [.6, '#4DB84D'], [.72, '#BFC232'], [.82, '#E9A800'], [.92, '#E06A1B'], [1, '#B5122B']]
};
const INFRA = {
  dark:  { esteira: '#10161F', estr: '#7C92AC', estrut: '#2F5F9E', longarina: '#E8830D', parede: '#5A6F88', chao: '#18233A', corredor: '#1E2B40',
           colmeia: '#0B0D10', pallet: '#9A7350', carga: '#CDB48C', caixa: '#C9A36A', eclusa: '#33516E', piso: '#22344A', perna: '#55657A', fora: '#3A4A5E', neutro: '#6F7F96' },
  light: { esteira: '#3A4656', estr: '#8EA3BA', estrut: '#3A6AAE', longarina: '#D9730A', parede: '#9DB0C4', chao: '#E3E9F0', corredor: '#D3DCE6',
           colmeia: '#1A1C20', pallet: '#9A7350', carga: '#D9C4A0', caixa: '#B98E52', eclusa: '#C4D3E2', piso: '#D6DFE9', perna: '#8A99AA', fora: '#B4C0CE', neutro: '#8C9AAD' }
};
// Visão "Endereço": uma cor por estado do endereço
const ESTADOS = {
  dark:  { livre: '#45C645', ocupado: '#E0283E', picado: '#F6BD00', semSaldo: '#F28322', reservado: '#A77BEA' },
  light: { livre: '#2E9E2E', ocupado: '#B5122B', picado: '#C9960A', semSaldo: '#D9730A', reservado: '#7C4DC4' }
};
const NOME_ESTADO = {
  pulmao: { '0': 'Vazio', '1': 'Ocupado', '2': 'Picado (poucas peças)', x: 'Fora da capacidade (passagem / não existe)' },
  picking: { l: 'Livre (sem SKU cadastrado)', '0': 'Alocado sem saldo', '1': 'Com saldo', '2': 'Picado (poucas peças)', r: 'Reservado (saldo comprometido)', x: 'Sem parametrização (fora da capacidade)' }
};
const corEstado = st => {
  const e = ESTADOS[tema()];
  return st === '1' ? e.ocupado : st === '2' ? e.picado : st === '0' ? null : st === 'r' ? e.reservado : e.livre;
};
const tema = () => document.documentElement.getAttribute('data-tema') === 'claro' ? 'light' : 'dark';
const hex2 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function corRGB(pct) {
  let t = Math.max(0, Math.min(1, pct / 100));
  if (P3.ui.faixas) t = pct < 70 ? .6 : pct < 85 ? .8 : pct < 95 ? .9 : 1;
  const r = RAMPS[tema()];
  for (let i = 1; i < r.length; i++) if (t <= r[i][0]) {
    const a = r[i - 1], b = r[i], k = (t - a[0]) / (b[0] - a[0] || 1), ca = hex2(a[1]), cb = hex2(b[1]);
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
  }
  return hex2(r[r.length - 1][1]);
}
const corCSS = pct => 'rgb(' + corRGB(pct).join(',') + ')';

/* ---------------- dados ---------------- */
const NOME_ZONA = { meia: 'Meia', vestuario: 'Vestuário', calcado: 'Calçado', acessorio: 'Acessório' };
function zonaDaRua(mapa, lado, rua) {
  const z = (mapa.zonas || {})[lado] || {};
  return Object.keys(z).filter(k => (z[k] || []).indexOf(rua) !== -1)[0] || null;
}
// Pulmão sem zona = fora da capacidade (8 = insumos; 15 = alocação da reversa)
function foraCapPulmao(mapa, rua) {
  if ((mapa.insumos_pulmao || []).indexOf(rua) !== -1) return 'Insumos — fora da capacidade do Pulmão';
  if (!zonaDaRua(mapa, 'pulmao', rua)) return 'Fora da capacidade do Pulmão' + (rua === '15' ? ' (alocação da reversa)' : '');
  return null;
}
// Ocupação oficial por rua: mesma régua do card "Endereços livres por rua" da tela Estoque
function ocupRua(opr, lado, rua) {
  if (!opr) return null;
  const cap = ((window.CAPACIDADE_RUA && window.CAPACIDADE_RUA[lado]) || (opr.capacidade || {})[lado] || {})[rua] || 0;
  const desc = (lado === 'picking' && opr.desconto_picking && opr.desconto_picking[rua]) || 0;
  const c = cap - desc, o = (opr[lado] || {})[rua] || 0;
  return c > 0 ? { cap: c, ocup: o, livres: Math.max(0, c - o), pct: o / c * 100 } : null;
}
function ocupLado(opr, lado) {
  let c = 0, o = 0, l = 0;
  RUAS_DIR.concat(RUAS_ESQ).forEach(r => { const x = ocupRua(opr, lado, r); if (x) { c += x.cap; o += x.ocup; l += x.livres; } });
  return c ? { pct: o / c * 100, livres: l, cap: c, ocup: o } : null;
}
/* Endereços → itens desenháveis + grupos do calor (rua × lado × nível × trecho de ~6 m). */
function montarItens(mapa) {
  const itens = [], grupos = new Map();
  function grupo(zona, rua, lado, nivel, bloco, foraCap) {
    const k = zona + '|' + rua + '|' + lado + '|' + nivel + '|' + bloco;
    let g = grupos.get(k);
    if (!g) { g = { zona, rua, lado, nivel, foraCap, n: 0, ocup: 0, saldo: 0, sem: 0, res: 0, livres: 0, fora: 0, pecas: 0, b0: Infinity, b1: 0 }; grupos.set(k, g); }
    return g;
  }
  ['pulmao', 'picking'].forEach(zona => {
    const lista = mapa[zona] || {};
    Object.keys(lista).forEach(rua => {
      if (RUAS_DIR.indexOf(rua) === -1 && RUAS_ESQ.indexOf(rua) === -1) return;
      const R = lista[rua], geo = geoRua(rua), foraCap = zona === 'pulmao' ? foraCapPulmao(mapa, rua) : null;
      const nPk = zona === 'picking' ? Math.max(1, ...Object.keys(R.niveis).map(Number)) : 0;
      Object.keys(R.niveis).forEach(nv => {
        const N = R.niveis[nv], lv = Number(nv), maxB = N.max || R.max || N.e.length;
        const nPos = Math.max(1, Math.ceil(maxB / 2)), passo = geo.L / nPos, q = (N.q || '').split(',');
        const hb = zona === 'picking' ? PK_TOPO / nPk : PU_PASSO;
        const y = zona === 'picking' ? (lv - 1) * hb : PU_BASE + (lv - 8) * PU_PASSO;
        const h = zona === 'picking' ? Math.max(.25, hb * .78) : PU_H;
        for (let i = 0; i < N.e.length; i++) {
          const st = N.e[i]; if (st === '-') continue;
          const box = i + 1, lado = box % 2 ? 'impar' : 'par', k = Math.ceil(box / 2);
          const z = (k - .5) * passo, bloco = Math.floor(z / BLOCO);
          const g = grupo(zona, rua, lado, lv, bloco, foraCap), pc = q[i] ? parseInt(q[i], 36) : 0;
          g.b0 = Math.min(g.b0, box); g.b1 = Math.max(g.b1, box); g.pecas += pc;
          if (st === 'x') g.fora++;
          else {
            g.n++;
            if (st === '1' || st === '2') { g.ocup++; g.saldo++; }
            else if (st === 'r') { g.ocup++; g.res++; }
            else if (st === '0') { if (zona === 'picking') { g.ocup++; g.sem++; } else g.livres++; }
            else if (st === 'l') g.livres++;
          }
          itens.push({ zona, rua, nivel: lv, box, lado, st, pc, g,
            x: lado === 'impar' ? geo.xImpar : geo.xPar, y, z, w: D * .84, h, d: Math.max(.1, passo * .86) });
        }
      });
    });
  });
  grupos.forEach(g => { g.pct = g.n ? g.ocup / g.n * 100 : 0; });
  return { itens, grupos };
}

/* ---------------- CSS e HTML ---------------- */
function injetaCSS() {
  if (document.getElementById('p3d-css')) return;
  const st = document.createElement('style'); st.id = 'p3d-css';
  st.textContent = `
.p3-card { padding: 0; overflow: hidden; }
.p3-bar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.p3-ctrls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.p3-grp { display: flex; gap: 4px; align-items: center; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; }
.p3-grp .sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
.p3-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 99px; padding: 3px; background: var(--bg-input); }
.p3-seg button { all: unset; cursor: pointer; padding: 6px 16px; border-radius: 99px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.p3-seg button[aria-pressed="true"] { background: var(--amber); color: #142032; }
.p3-chip { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border); font-size: 12.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.p3-chip.n { padding: 4px 8px; min-width: 12px; text-align: center; }
.p3-chip[aria-pressed="true"] { background: var(--amber); border-color: var(--amber); color: #142032; font-weight: 700; }
.p3-seg button:focus-visible, .p3-chip:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.p3-kpi { font-size: 12.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.p3-kpi b { color: var(--text); font-weight: 600; }
.p3-stage { position: relative; height: clamp(440px, 66vh, 700px); background: radial-gradient(120% 90% at 50% 0%, var(--bg-card) 0%, var(--bg) 100%); }
.p3-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.p3-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.p3-lbl { position: absolute; transform: translate(-50%, -50%); font-size: 11px; font-weight: 700; color: var(--text-muted); white-space: nowrap; letter-spacing: .04em; text-shadow: 0 0 5px var(--bg), 0 0 2px var(--bg); }
.p3-lbl.big { font-size: 13px; color: var(--text); }
.p3-lbl.inf { color: var(--text); font-weight: 600; background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; text-shadow: none; }
.p3-hint { position: absolute; left: 12px; bottom: 10px; font-size: 11.5px; color: var(--text-muted); pointer-events: none; }
.p3-reset { position: absolute; right: 12px; bottom: 10px; background: var(--bg-card); }
.p3-msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted); padding: 20px; text-align: center; font-size: 13px; }
.p3-legend { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
.p3-ramp { width: min(340px, 100%); }
.p3-ramp .g { height: 10px; border-radius: 3px; }
.p3-ramp .ticks { position: relative; height: 16px; font-variant-numeric: tabular-nums; }
.p3-ramp .ticks span { position: absolute; top: 2px; transform: translateX(-50%); font-size: 10.5px; }
.p3-sw { display: inline-flex; gap: 6px; align-items: center; }
.p3-sw i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.p3-base { padding: 0 14px 12px; font-size: 11.5px; color: var(--text-muted); }
.p3-tip { position: fixed; z-index: 9999; pointer-events: none; background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 11px;
  font-size: 12.5px; min-width: 200px; max-width: 330px; box-shadow: var(--shadow); font-variant-numeric: tabular-nums; }
.p3-tip .t { font-weight: 700; margin-bottom: 2px; }
.p3-tip .p { font-size: 20px; font-weight: 300; }
.p3-tip .s { color: var(--text-muted); }
@media (max-width: 720px) { .p3-hint { display: none; } }
.p3-tela { display: inline-flex; align-items: center; gap: 6px; }
.p3-tela svg { width: 14px; height: 14px; }
.p3-card:fullscreen, .p3-card.p3-max { display: flex; flex-direction: column; width: 100vw; height: 100vh; border-radius: 0; border: 0; background: var(--bg-card); }
.p3-card.p3-max { position: fixed; inset: 0; z-index: 9000; }
.p3-card:fullscreen .p3-stage, .p3-card.p3-max .p3-stage { flex: 1 1 auto; height: auto; min-height: 0; }
.p3-card:fullscreen .p3-base, .p3-card.p3-max .p3-base { display: none; }`;
  document.head.appendChild(st);
}
function htmlPlanta() {
  const chips = (a, b) => { let h = ''; for (let n = a; n <= b; n++) h += '<button class="p3-chip n" type="button" data-n="' + n + '">' + n + '</button>'; return h; };
  return '<div class="p3-bar">'
    + '<div class="p3-seg" role="group" aria-label="Zona"><button type="button" data-m="geral">Geral</button><button type="button" data-m="pulmao">Pulmão</button><button type="button" data-m="picking">Picking</button></div>'
    + '<span class="p3-kpi" data-k="kpi"></span>'
    + '<div class="p3-ctrls">'
    + '<div class="p3-grp">Visão<button class="p3-chip" type="button" data-c="calor" title="Cor pela % de ocupação de cada trecho de ~6 m da longarina">Calor</button><button class="p3-chip" type="button" data-c="endereco" title="Cor pelo estado de cada endereço">Endereço</button></div>'
    + '<div class="p3-grp">Nível<button class="p3-chip" type="button" data-n="0">Todos</button>'
    + '<span data-k="nvPk" style="display:contents">' + chips(1, 7) + '</span><span class="sep" data-k="nvSep"></span>'
    + '<span data-k="nvPu" style="display:contents">' + chips(8, 12) + '</span></div>'
    + '<div class="p3-grp">Vista<button class="p3-chip" type="button" data-v="3d">3D</button><button class="p3-chip" type="button" data-v="topo">Planta</button></div>'
    + '<button class="p3-chip p3-tela" type="button" data-k="tela" title="Abrir a planta em tela cheia (Esc para sair)"></button></div></div>'
    + '<div class="p3-stage" data-k="stage"><canvas aria-label="Planta 3D com a ocupação de cada endereço do Picking e do Pulmão"></canvas><div class="p3-labels" data-k="labels"></div>'
    + '<div class="p3-msg" data-k="msg">Carregando planta 3D…</div>'
    + '<div class="p3-hint">Role para aproximar onde está o mouse · duplo clique aproxima (até 2×), o próximo volta · arraste para girar (na Planta, para mover)</div>'
    + '<button class="p3-chip p3-reset" type="button" data-k="reset">Centralizar</button></div>'
    + '<div class="p3-legend" data-k="legend"></div>'
    + '<div class="p3-base" data-k="base"></div>';
}

/* ---------------- tooltip (um só por página) ---------------- */
function tipEl() {
  let t = document.getElementById('p3d-tip');
  if (!t) { t = document.createElement('div'); t.id = 'p3d-tip'; t.className = 'p3-tip'; t.hidden = true; document.body.appendChild(t); }
  return t;
}
function mostraTip(x, y, html) {
  const tip = tipEl(); tip.innerHTML = html; tip.hidden = false;
  const host = document.fullscreenElement || document.body;
  if (tip.parentNode !== host) host.appendChild(tip);
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px';
  tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 14)) + 'px';
}
const escondeTip = () => { const t = document.getElementById('p3d-tip'); if (t) t.hidden = true; };
const tipInfo = (t, s) => '<div class="t">' + t + '</div><div class="s">' + s + '</div>';
const nomeZona = z => z === 'pulmao' ? 'Pulmão' : 'Picking';
function linhaGrupo(g) {
  if (!g.n) return 'Sem endereço dentro da capacidade neste trecho';
  if (g.zona === 'pulmao') return fmtI(g.ocup) + ' de ' + fmtI(g.n) + ' endereços ocupados · ' + fmtI(g.livres) + ' vazios';
  return fmtI(g.saldo) + ' com saldo · ' + fmtI(g.sem) + ' alocados sem saldo' + (g.res ? ' · ' + fmtI(g.res) + ' reservados' : '') + ' · ' + fmtI(g.livres) + ' livres';
}
function tipGrupo(g) {
  const tit = 'Rua ' + pad(g.rua) + ' · ' + nomeZona(g.zona) + ' · nível ' + pad(g.nivel) + ' · lado ' + (g.lado === 'par' ? 'par' : 'ímpar');
  const faixa = 'Boxes ' + pad(g.b0, 3) + ' a ' + pad(g.b1, 3) + (g.fora ? ' · ' + g.fora + ' fora da capacidade' : '');
  const pct = g.foraCap ? '<div class="s">' + g.foraCap + '</div>'
    : g.n ? '<div class="p" style="color:' + corCSS(g.pct) + '">' + fmtP(g.pct) + '</div>' : '';
  return '<div class="t">' + tit + '</div>' + pct + '<div class="s">' + linhaGrupo(g) + (g.pecas ? ' · ' + fmtI(g.pecas) + ' peças' : '') + '<br>' + faixa + '</div>';
}
function tipEndereco(it) {
  const end = pad(it.rua) + '-' + pad(it.nivel) + '-' + pad(it.box, 3);
  const est = NOME_ESTADO[it.zona][it.st] || it.st;
  const g = it.g;
  return '<div class="t">' + end + ' · ' + nomeZona(it.zona) + '</div>'
    + '<div class="s" style="color:var(--text);font-weight:600">' + est + (it.pc ? ' · ' + fmtI(it.pc) + ' peças' : '') + '</div>'
    + '<div class="s">Rua ' + pad(it.rua) + ' · lado ' + (it.lado === 'par' ? 'par' : 'ímpar') + ' · nível ' + pad(it.nivel)
    + (g.foraCap ? '<br>' + g.foraCap : g.n ? '<br>Trecho (boxes ' + pad(g.b0, 3) + '–' + pad(g.b1, 3) + '): ' + fmtP(g.pct) + ' ocupado' : '') + '</div>';
}

/* ---------------- ciclo de vida ---------------- */
function destruir() {
  const e = P3.estado; if (!e) return;
  try { P3.ui.cam = { p: e.camera.position.toArray(), t: e.controls.target.toArray() }; } catch (x) { /* sem câmera */ }
  cancelAnimationFrame(e.raf); cancelAnimationFrame(e.voo);
  if (e.ro) e.ro.disconnect();
  if (e.mo) e.mo.disconnect();
  if (e.desliga) e.desliga();
  try { e.controls.dispose(); e.renderer.dispose(); } catch (x) { /* já liberado */ }
  escondeTip();
  P3.estado = null;
}

window.montarPlanta3DDistr = async function (container, dados) {
  if (!container) return;
  injetaCSS();
  destruir();
  container.classList.add('p3-card');
  container.innerHTML = htmlPlanta();
  const q = k => container.querySelector('[data-k="' + k + '"]');
  const stage = q('stage'), cv = stage.querySelector('canvas'), labelsEl = q('labels'), msg = q('msg');
  const ui = P3.ui, mapa = dados && dados.mapa, opr = dados && dados.opr;

  function desenhaLegenda() {
    const lg = q('legend'), t = tema(), E = ESTADOS[t], I = INFRA[t];
    const sw = (c, txt) => '<span class="p3-sw"><i style="background:' + c + '"></i>' + txt + '</span>';
    let h = '';
    if (ui.visao === 'calor') {
      let grad;
      if (ui.faixas) {
        const st = [[0, 70, 69], [70, 85, 80], [85, 95, 90], [95, 100, 99]];
        grad = 'linear-gradient(90deg,' + st.map(s => corCSS(s[2]) + ' ' + s[0] + '% ' + s[1] + '%').join(',') + ')';
      } else {
        const p = []; for (let i = 0; i <= 20; i++) p.push(corCSS(i * 5) + ' ' + (i * 5) + '%');
        grad = 'linear-gradient(90deg,' + p.join(',') + ')';
      }
      h += '<div class="p3-ramp"><div class="g" style="background:' + grad + '"></div><div class="ticks">'
        + [0, 50, 70, 85, 95].map(v => '<span style="left:' + v + '%">' + v + '%</span>').join('') + '</div></div>'
        + '<span>Ocupação de cada trecho de ~6 m da longarina · verde: espaço para armazenar · vermelho: cheio</span>'
        + '<div class="p3-grp">Escala<button class="p3-chip" type="button" data-e="0">Contínua</button><button class="p3-chip" type="button" data-e="1">Faixas do report</button></div>';
    } else {
      h += sw(E.livre, 'Vazio / livre') + sw(E.picado, 'Picado (< ' + ((mapa && mapa.limite_picado) || 10) + ' pç)') + sw(E.ocupado, 'Ocupado')
        + sw(E.semSaldo, 'Picking alocado sem saldo') + sw(E.reservado, 'Reservado');
    }
    h += sw(I.neutro, 'Fora da capacidade (insumos, reversa)') + sw(I.fora, 'Passagem / sem parametrização') + sw(I.colmeia, 'Colmeias');
    lg.innerHTML = h;
    lg.querySelectorAll('[data-e]').forEach(b => {
      b.setAttribute('aria-pressed', String((b.dataset.e === '1') === ui.faixas));
      b.addEventListener('click', () => { ui.faixas = b.dataset.e === '1'; desenhaLegenda(); repinta(); });
    });
  }
  let repinta = () => {};
  function kpis() {
    const pu = ocupLado(opr, 'pulmao'), pk = ocupLado(opr, 'picking');
    const t = (nome, o) => o ? nome + ' <b>' + fmtP(o.pct) + '</b> · ' + fmtI(o.livres) + ' livres' : '';
    const partes = ui.zona === 'pulmao' ? [t('Pulmão', pu)] : ui.zona === 'picking' ? [t('Picking', pk)] : [t('Pulmão', pu), t('Picking', pk)];
    q('kpi').innerHTML = partes.filter(Boolean).join(' &nbsp;|&nbsp; ');
  }
  function marcaBotoes() {
    container.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === ui.zona)));
    container.querySelectorAll('[data-n]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.n === ui.nivel)));
    container.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'topo') === ui.topo)));
    container.querySelectorAll('[data-c]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === ui.visao)));
    q('nvPk').style.display = ui.zona === 'pulmao' ? 'none' : 'contents';
    q('nvPu').style.display = ui.zona === 'picking' ? 'none' : 'contents';
    q('nvSep').style.display = ui.zona === 'geral' ? '' : 'none';
  }
  // nível escolhido que não existe na zona nova volta para "Todos"
  const nivelValido = () => { if ((ui.zona === 'pulmao' && ui.nivel && ui.nivel < 8) || (ui.zona === 'picking' && ui.nivel >= 8)) ui.nivel = 0; };
  nivelValido(); desenhaLegenda(); kpis(); marcaBotoes();

  if (!mapa || (!mapa.pulmao && !mapa.picking)) {
    msg.innerHTML = 'Ainda não há mapa de endereços.<br>Reprocesse <strong>Picking + Pulmão</strong> em Admin › Abastecimento para montar a planta.';
    return;
  }
  const { itens, grupos } = montarItens(mapa);
  const fora = mapa.fora_do_desenho || {};
  q('base').textContent = 'Posição de Picking + Pulmão' + (dados.gerado_em && window.formatarDataHora ? ' de ' + window.formatarDataHora(dados.gerado_em) : '')
    + (dados.arquivos ? ' (' + dados.arquivos + ')' : '') + '. Cada cubo é um endereço: Picking nos níveis 1 a 7, Pulmão nos níveis 8 a 12; box 001 no fundo do galpão. '
    + 'Calor = % de endereços ocupados em cada trecho de ~6 m da longarina (no Picking, endereço alocado conta como ocupado, como na tela Estoque). '
    + 'No Picking, o endereço sem SKU cadastrado não vem no arquivo: os livres são deduzidos pela numeração até o maior box de cada nível. '
    + 'A ocupação no topo é a oficial por rua (capacidade da planilha, mesma régua do card de endereços livres).'
    + ((fora.pulmao || fora.picking) ? ' Fora do desenho (box do lado que a rua não tem): ' + fmtI(fora.pulmao || 0) + ' no Pulmão e ' + fmtI(fora.picking || 0) + ' no Picking.' : '');

  try { await garantirThree(); }
  catch (e) { console.error(e); msg.textContent = 'Não foi possível montar a planta 3D: ' + e.message; return; }
  if (!container.isConnected || !stage.isConnected) return;

  const THREE = window.THREE;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); }
  catch (e) { msg.textContent = 'Este navegador não abriu o 3D.'; return; }
  msg.remove();
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  const controls = new THREE.OrbitControls(camera, cv);
  controls.enableDamping = false;
  controls.rotateSpeed = .45; controls.panSpeed = .6;
  controls.maxPolarAngle = Math.PI * .49; controls.screenSpacePanning = true;
  controls.enableZoom = false;
  const est = { renderer, camera, controls, raf: 0, voo: 0, ro: null, mo: null, nivelZoom: 0 };
  P3.estado = est;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7c90, .95));
  const dl = new THREE.DirectionalLight(0xffffff, .55); dl.position.set(.5, 1.4, 1); scene.add(dl);
  const objs = [], labels = [];
  const cor = nome => new THREE.Color(INFRA[tema()][nome]);
  function reg(obj, seg, nivel, pinta, alvo) { objs.push({ obj, seg, nivel: nivel || 0, pinta, alvo }); scene.add(obj); if (pinta) pinta(); return obj; }
  function rotulo(txt, x, y, z, seg, cls, nivel) {
    const el = document.createElement('div'); el.className = 'p3-lbl' + (cls ? ' ' + cls : ''); el.textContent = txt;
    labelsEl.appendChild(el); labels.push({ el, pos: new THREE.Vector3(x, y, z), seg, nivel: nivel || 0 });
  }
  function caixa(x0, z0, x1, z1, y, h, nomeCor, seg, opts) {
    opts = opts || {};
    const mat = new THREE.MeshLambertMaterial({ transparent: opts.op != null, opacity: opts.op != null ? opts.op : 1, depthWrite: opts.op == null });
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), h, Math.abs(z1 - z0)), mat);
    m.position.set((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2);
    m.userData.tip = opts.tip; m.userData.baseOp = mat.opacity;
    return reg(m, seg, opts.nivel, () => mat.color.copy(cor(nomeCor)), !!opts.tip);
  }
  function lote(lista, seg, nivel, corDe) {
    if (!lista.length) return null;
    const mat = new THREE.MeshLambertMaterial({ transparent: false, opacity: 1 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, lista.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    lista.forEach((it, i) => { m4.makeScale(it.w, it.h, it.d); m4.setPosition(it.x, it.y + it.h / 2, it.z); mesh.setMatrixAt(i, m4); });
    mesh.userData.itens = lista; mesh.userData.baseOp = 1;
    const pinta = () => {
      lista.forEach((it, i) => { const v = corDe ? corDe(it) : (it.hex || INFRA[tema()][it.corNome]); if (Array.isArray(v)) c.setRGB(v[0] / 255, v[1] / 255, v[2] / 255); else c.set(v); mesh.setColorAt(i, c); });
      mesh.instanceColor.needsUpdate = true;
    };
    return reg(mesh, seg, nivel, pinta, lista.some(it => it.tip || it.g));
  }

  /* ---------- chão, corredores e divisória ---------- */
  caixa(XL - 3, -4, XR + RUAS_DIR.length * PASSO + 10, Z_FRENTE + 24, -.3, .3, 'chao', 'comum');
  RUAS_ESQ.concat(RUAS_DIR).forEach(r => {
    const g = geoRua(r);
    caixa(g.xCorr - A / 2 + .1, 0, g.xCorr + A / 2 - .1, g.L, 0, .02, 'corredor', 'comum');
  });
  caixa(X_DIV - 1.1, -4, X_DIV + 1.1, Z_FRENTE + 4, 0, ALT + 3, 'parede', 'comum',
    { op: .45, tip: tipInfo('Divisão — estoque do E-commerce', 'O estoque do E-commerce fica entre a rua 15 e a rua 01 e não entra nesta planta. À esquerda, ruas 11 a 15 (canto do galpão); à direita, ruas 01 a 08.') });

  /* ---------- endereços: um cubo por endereço, um lote por zona × rua × nível ---------- */
  const corItem = it => {
    if (it.st === 'x') return INFRA[tema()].fora;
    if (it.g.foraCap) return INFRA[tema()].neutro;
    if (ui.visao === 'calor') return corRGB(it.g.pct);
    if (it.st === '0') return it.zona === 'picking' ? ESTADOS[tema()].semSaldo : ESTADOS[tema()].livre;
    return corEstado(it.st);
  };
  const porLote = new Map();
  itens.forEach(it => { const k = it.zona + '|' + it.rua + '|' + it.nivel; (porLote.get(k) || porLote.set(k, []).get(k)).push(it); });
  porLote.forEach((lista, k) => { const p = k.split('|'); lote(lista, p[0], +p[2], corItem); });

  /* ---------- estrutura das longarinas: montantes e vigas por rua ---------- */
  const montantes = [], montantesPu = [], vigas = [];
  const tipRua = r => () => {
    const pu = ocupRua(opr, 'pulmao', r), pk = ocupRua(opr, 'picking', r), fc = foraCapPulmao(mapa, r);
    const zP = zonaDaRua(mapa, 'pulmao', r), zK = zonaDaRua(mapa, 'picking', r);
    const l = (nome, o, z) => nome + (z ? ' (' + NOME_ZONA[z] + ')' : '') + ': ' + (o ? '<b style="color:' + corCSS(o.pct) + '">' + fmtP(o.pct) + '</b> · ' + fmtI(o.ocup) + ' de ' + fmtI(o.cap) + ' · ' + fmtI(o.livres) + ' livres' : 'sem capacidade cadastrada');
    return '<div class="t">Rua ' + pad(r) + '</div><div class="s">' + (fc && (mapa.pulmao || {})[r] ? 'Pulmão: ' + fc : l('Pulmão', pu, zP)) + '<br>' + l('Picking', pk, zK) + '</div>';
  };
  RUAS_ESQ.concat(RUAS_DIR).forEach(r => {
    const g = geoRua(r), lados = [];
    const temLado = (zona, l) => { const R = (mapa[zona] || {})[r]; return R && (R.lados === 'ip' || R.lados === l); };
    if (temLado('pulmao', 'i') || temLado('picking', 'i')) lados.push(g.xImpar);
    if (temLado('pulmao', 'p') || temLado('picking', 'p')) lados.push(g.xPar);
    const tip = tipRua(r);
    lados.forEach(x => {
      // montante em duas partes: até o topo do Picking (sempre) e o resto, que some no modo Picking
      for (let z = 0; z <= g.L + .01; z += 3) [-1, 1].forEach(s => {
        montantes.push({ x: x + s * D * .46, y: 0, z, w: .1, h: PK_TOPO + .2, d: .1, corNome: 'estrut', tip });
        montantesPu.push({ x: x + s * D * .46, y: PK_TOPO + .2, z, w: .1, h: ALT - PK_TOPO - .2, d: .1, corNome: 'estrut', tip });
      });
      [PU_BASE - .1].concat([1, 2, 3, 4].map(i => PU_BASE + i * PU_PASSO - .1)).forEach(y => [-1, 1].forEach(s =>
        vigas.push({ x: x + s * D * .46, y, z: g.L / 2, w: .09, h: .12, d: g.L, corNome: 'longarina', tip })));
    });
  });
  lote(montantes, 'comum', 0); lote(montantesPu, 'pulmao', 0); lote(vigas, 'pulmao', 0);

  /* ---------- frente do galpão ---------- */
  // colmeias: uma na ponta de cada longarina de um par encostado (2 por par), continuando a longarina para a frente
  const esc = [], tampas = [];
  const NC = 6, NN = 5, LC = 2.4, HN = .42;
  for (let i = 0; i < RUAS_DIR.length - 1; i++) {
    const a = geoRua(RUAS_DIR[i]), b = geoRua(RUAS_DIR[i + 1]);
    [[a.xPar, 'Rua ' + pad(RUAS_DIR[i]) + ' · lado par'], [b.xImpar, 'Rua ' + pad(RUAS_DIR[i + 1]) + ' · lado ímpar']].forEach(([x, onde], li) => {
      const z0 = Z_FRENTE + .4, num = 2 * i + li + 1;
      const tip = () => tipInfo('Colmeia ' + pad(num), 'Na frente da longarina da ' + onde + ' · ' + NN + ' × ' + NC + ' escaninhos');
      for (let c = 0; c < NC; c++) for (let n = 0; n < NN; n++)
        esc.push({ x, y: n * HN, z: z0 + (c + .5) * LC / NC, w: D * .8, h: HN * .86, d: LC / NC * .9, corNome: 'colmeia', tip });
      tampas.push({ x, y: NN * HN, z: z0 + LC / 2, w: D * .86, h: .08, d: LC, corNome: 'colmeia', tip });
    });
  }
  lote(esc, 'comum', 0); lote(tampas, 'comum', 0);
  const xE1 = geoRua('8').xPar + 4.5;
  // caixas de faturamento: na frente da rua 08
  const cx0 = xE1 - .2, cz0 = Z_FRENTE + 1.2, tipCx = tipInfo('Caixas de faturamento', 'Na frente da rua 08 · volumes fechados aguardando faturamento');
  const cxs = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) for (let n = 0; n < 3; n++)
    cxs.push({ x: cx0 + .8 + i * 1.1, y: n * .55, z: cz0 + .6 + j * 1.1, w: .95, h: .5, d: .95, corNome: 'caixa', tip: () => tipCx });
  lote(cxs, 'comum', 0);
  caixa(cx0 + .2, cz0, cx0 + 4.9, cz0 + 3.6, 0, .05, 'piso', 'comum', { tip: tipCx });
  // eclusas: 2 colunas × 5 fileiras de pallets, na frente do galpão (posições fixas: não mudam a cada carga)
  const pal = [], car = [], vagas = [];
  let semente = 11;
  const sorteio = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
  function eclusa(x0, nome) {
    const z0 = Z_FRENTE + 8, x1 = x0 + 5.5, z1 = z0 + 10, n = 10, cheias = new Set();
    while (cheias.size < 3 + Math.floor(sorteio() * 5)) cheias.add(Math.floor(sorteio() * n));
    caixa(x0, z0, x1, z1, 0, .05, 'eclusa', 'comum', { tip: tipInfo(nome, 'Frente do galpão · ' + cheias.size + ' de ' + n + ' posições com pallet (ilustrativo)') });
    const px = (x1 - x0) / 2, pz = (z1 - z0) / 5, lado = Math.min(px, pz) * .78;
    for (let c = 0; c < 2; c++) for (let l = 0; l < 5; l++) {
      const i = l * 2 + c, x = x0 + (c + .5) * px, z = z0 + (l + .5) * pz;
      const t = () => tipInfo(nome, 'Posição ' + (i + 1) + ' de ' + n + (cheias.has(i) ? ' · com pallet' : ' · vazia'));
      if (cheias.has(i)) {
        pal.push({ x, y: .05, z, w: lado, h: .2, d: lado, corNome: 'pallet', tip: t });
        car.push({ x, y: .25, z, w: lado * .88, h: 1.2, d: lado * .88, corNome: 'carga', tip: t });
      } else vagas.push({ x, y: .05, z, w: lado, h: .02, d: lado, corNome: 'piso', tip: t });
    }
  }
  const nE = 7, xIniE = XR + 1, passoE = (RUAS_DIR.length * PASSO - 6) / (nE - 1);
  for (let i = 0; i < nE; i++) eclusa(xIniE + i * passoE, 'Eclusa ' + (i + 1));
  eclusa(XL + 4, 'Eclusa ' + (nE + 1)); eclusa(XL + 14, 'Eclusa ' + (nE + 2));
  lote(pal, 'comum', 0); lote(car, 'comum', 0); lote(vagas, 'comum', 0);

  /* ---------- rótulos ---------- */
  RUAS_ESQ.concat(RUAS_DIR).forEach(r => { const g = geoRua(r); rotulo(pad(r), g.xCorr, ALT + 1.2, -1.5, 'comum', 'big'); });
  const gD = geoRua('8');
  rotulo('PULMÃO · níveis 8–12', gD.xPar + 5, PU_BASE + 2.5 * PU_PASSO, Z_FRENTE - 14, 'pulmao', 'big');
  rotulo('PICKING · níveis 1–7', gD.xPar + 5, PK_TOPO / 2, Z_FRENTE - 14, 'picking', 'big');
  rotulo('Box 001 (fundo)', gD.xPar + 3, .6, 2, 'comum');
  rotulo('Frente →', gD.xPar + 2.5, .6, Z_FRENTE - 3, 'comum');
  rotulo('Divisão · estoque do E-commerce', X_DIV, ALT + 4.4, 20, 'comum', 'inf');
  rotulo('Colmeias', (geoRua('4').xPar + geoRua('5').xImpar) / 2, 3.2, Z_FRENTE + 1.6, 'comum', 'inf');
  rotulo('Caixas de faturamento', cx0 + 2.6, 2.4, cz0 + 1.8, 'comum', 'inf');
  rotulo('Eclusas', XR + RUAS_DIR.length * PASSO / 2, 2.4, Z_FRENTE + 13, 'comum', 'inf');
  rotulo('RUAS 11–15', XL + RUAS_ESQ.length * PASSO / 2, ALT + 3.4, -1.5, 'comum', 'inf');
  rotulo('RUAS 01–08', XR + RUAS_DIR.length * PASSO / 2, ALT + 3.4, -1.5, 'comum', 'inf');

  /* ---------- visibilidade / câmera ---------- */
  function aplica() {
    nivelValido();
    objs.forEach(o => {
      o.obj.visible = o.seg === 'comum' || ui.zona === 'geral' || o.seg === ui.zona;
      const dim = o.seg !== 'comum' && ui.nivel && o.nivel && o.nivel !== ui.nivel;
      const m = o.obj.material, op = dim ? .04 : o.obj.userData.baseOp, tr = op < 1;
      if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
      m.opacity = op;
    });
    labels.forEach(l => { l.vis = l.seg === 'comum' || ui.zona === 'geral' || l.seg === ui.zona; });
    kpis(); marcaBotoes();
  }
  repinta = () => objs.forEach(o => o.pinta && o.pinta());
  function voar(alvo, cam) {
    const ini = { t: controls.target.clone(), c: camera.position.clone() }, t0 = performance.now();
    const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
    cancelAnimationFrame(est.voo);
    (function passo(now) {
      const u = dur ? Math.min(1, (now - t0) / dur) : 1, k = u * u * (3 - 2 * u);
      controls.target.lerpVectors(ini.t, alvo, k); camera.position.lerpVectors(ini.c, cam, k); controls.update();
      if (u < 1) est.voo = requestAnimationFrame(passo);
    })(t0);
  }
  function configuraArraste() {
    controls.enableRotate = !ui.topo;
    controls.mouseButtons = { LEFT: ui.topo ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: ui.topo ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  function enquadra(animado) {
    const v = VIEWS[ui.zona], alvo = new THREE.Vector3(v.t[0], v.t[1], v.t[2]);
    const w = stage.clientWidth, h = stage.clientHeight, k = w && h ? Math.max(1, 1.9 / (w / h)) : 1;
    const cam = ui.topo ? new THREE.Vector3(v.t[0], v.top * k, v.t[2] + .01) : new THREE.Vector3(v.t[0] + v.o[0] * k, v.t[1] + v.o[1] * k, v.t[2] + v.o[2] * k);
    est.nivelZoom = 0; configuraArraste();
    if (animado === true) { voar(alvo, cam); return; }
    cancelAnimationFrame(est.voo);
    controls.target.copy(alvo); camera.position.copy(cam); controls.update();
  }
  function tamanho() {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const v3 = new THREE.Vector3();
  function loop() {
    est.raf = requestAnimationFrame(loop);
    if (!stage.isConnected) { if (P3.estado === est) destruir(); else cancelAnimationFrame(est.raf); return; }
    if (stage.offsetParent === null && !document.fullscreenElement) return;
    controls.update(); renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    labels.forEach(l => {
      if (!l.vis) { l.el.style.display = 'none'; return; }
      v3.copy(l.pos).project(camera); const vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      l.el.style.display = vis ? '' : 'none'; if (vis) { l.el.style.left = ((v3.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - v3.y) / 2 * h) + 'px'; }
    });
  }
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), chao = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
  function raio(ev) {
    const r = cv.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
  }
  function acerto(ev) {
    raio(ev);
    const hits = ray.intersectObjects(objs.filter(o => o.alvo && o.obj.visible && o.obj.material.opacity > .2).map(o => o.obj), false);
    for (const h of hits) {
      if (h.instanceId != null) {
        const it = h.object.userData.itens[h.instanceId];
        if (it && it.g) return ui.visao === 'calor' ? tipGrupo(it.g) : tipEndereco(it);
        if (it && it.tip) return it.tip();
      } else if (h.object.userData.tip) return h.object.userData.tip;
    }
    return null;
  }
  function pontoSob(ev) {
    raio(ev);
    const hits = ray.intersectObjects(objs.filter(o => o.obj.visible && o.obj.material.opacity > .2).map(o => o.obj), false);
    if (hits.length) return hits[0].point.clone();
    chao.constant = -controls.target.y;
    return ray.ray.intersectPlane(chao, tmp) ? tmp.clone() : null;
  }

  /* ---------- eventos ---------- */
  let pendente = null;   // tooltip no máximo 1× por quadro (são ~30 mil endereços para testar)
  cv.addEventListener('pointermove', e => {
    if (pendente) { pendente = e; return; }
    pendente = e;
    requestAnimationFrame(() => { const ev = pendente; pendente = null; const t = acerto(ev); if (t) mostraTip(ev.clientX, ev.clientY, t); else escondeTip(); });
  });
  cv.addEventListener('pointerleave', () => { pendente = null; escondeTip(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const pt = pontoSob(e); if (!pt) return;
    const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * .0013), k = 1 - 1 / f, dist = camera.position.distanceTo(pt);
    if ((k > 0 && dist * (1 - k) < 2) || (k < 0 && camera.position.distanceTo(controls.target) > 500)) return;
    camera.position.lerp(pt, k); controls.target.lerp(pt, k); controls.update();
  }, { passive: false });
  cv.addEventListener('dblclick', e => {
    if (est.nivelZoom >= 2) { enquadra(true); return; }
    const pt = pontoSob(e); if (!pt) return;
    const off = camera.position.clone().sub(controls.target);
    voar(pt, pt.clone().add(off.multiplyScalar(.45)));
    est.nivelZoom++;
  });
  q('reset').addEventListener('click', () => enquadra(true));
  // tela cheia: Fullscreen API; sem suporte, o card cobre a janela inteira
  const btnTela = q('tela');
  const ICO_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const ICO_FECHA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  const emTela = () => document.fullscreenElement === container || container.classList.contains('p3-max');
  const rotuloTela = () => { btnTela.innerHTML = emTela() ? ICO_FECHA + 'Sair da tela cheia' : ICO_ABRE + 'Tela cheia'; btnTela.setAttribute('aria-pressed', String(emTela())); };
  let rolagem = null;
  function guardaRolagem() {
    const lista = [{ el: null, top: window.scrollY, left: window.scrollX }];
    for (let el = container.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) lista.push({ el, top: el.scrollTop, left: el.scrollLeft });
    }
    rolagem = lista;
  }
  function voltaRolagem() {
    if (!rolagem) return;
    const r = rolagem;
    const volta = () => r.forEach(x => { if (x.el) { x.el.scrollTop = x.top; x.el.scrollLeft = x.left; } else window.scrollTo(x.left, x.top); });
    volta(); requestAnimationFrame(volta); setTimeout(volta, 150); setTimeout(() => { volta(); rolagem = null; }, 400);
  }
  function aoMudarTela() {
    rotuloTela(); escondeTip();
    if (!emTela()) voltaRolagem();
    setTimeout(() => { tamanho(); enquadra(true); }, 80);
  }
  btnTela.addEventListener('click', async () => {
    if (!emTela()) guardaRolagem();
    let viaClasse = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (container.classList.contains('p3-max')) { container.classList.remove('p3-max'); viaClasse = true; }
      else if (container.requestFullscreen) await container.requestFullscreen({ navigationUI: 'hide' });
      else { container.classList.add('p3-max'); viaClasse = true; }
    } catch (e) { container.classList.toggle('p3-max'); viaClasse = true; }
    if (viaClasse) aoMudarTela();
  });
  const aoTecla = e => { if (e.key === 'Escape' && container.classList.contains('p3-max')) { container.classList.remove('p3-max'); aoMudarTela(); } };
  const aoFull = () => { if (container.isConnected) aoMudarTela(); };
  document.addEventListener('keydown', aoTecla);
  document.addEventListener('fullscreenchange', aoFull);
  est.desliga = () => { document.removeEventListener('keydown', aoTecla); document.removeEventListener('fullscreenchange', aoFull); };
  rotuloTela();
  container.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { ui.zona = b.dataset.m; aplica(); enquadra(true); }));
  container.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => { ui.nivel = +b.dataset.n; aplica(); }));
  container.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { ui.topo = b.dataset.v === 'topo'; aplica(); enquadra(true); }));
  container.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { ui.visao = b.dataset.c; desenhaLegenda(); repinta(); marcaBotoes(); }));
  // troca de tema: repinta tudo (o fundo e os textos já vêm do CSS)
  est.mo = new MutationObserver(() => { desenhaLegenda(); repinta(); });
  est.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

  aplica(); enquadra();
  if (P3.ui.cam) { camera.position.fromArray(P3.ui.cam.p); controls.target.fromArray(P3.ui.cam.t); controls.update(); P3.ui.cam = null; }
  est.ro = new ResizeObserver(tamanho); est.ro.observe(stage);
  tamanho(); loop();
};
window.Planta3DDistr = { montarItens, geoRua, ocupRua, ocupLado };
})();

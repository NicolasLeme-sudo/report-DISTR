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
   - Frente: colmeias pretas (2 por par de longarinas encostadas, menos no
     par 04/05, que tem o hidrante), placas das marcas (Olympikus na 04,
     Mizuno na 06, Under Armour na 08), caixa de faturamento na frente das
     ruas 07 e 08 (esteira de roletes com 4 mesas) e eclusas.
   - Picking: bins no lado direito, caixas sob medida nos acessórios
     (11–13) e gaiolas nas meias (14–15, 2 endereços por gaiola).

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

const P3 = { estado: null, ui: { zona: 'geral', nivel: 0, topo: false, faixas: false, visao: 'endereco', cam: null } };

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
// divisão dos módulos do galpão, logo depois da rua 08 (atrás do almoxarifado): ali acaba o galpão da DISTR
const X_FIM = XR + (RUAS_DIR.length - 1) * PASSO + 2 * D + A + 1.4;
const PK_TOPO = 2.3, PU_BASE = 2.5, PU_PASSO = 1.75, PU_H = 1.5, ALT = PU_BASE + 5 * PU_PASSO + .3;
const BLOCO = 6;
// Formato do Picking (fotos da operação): bins brancos no lado direito, caixas sob medida nos
// acessórios (11–13) e gaiolas aramadas nas meias (14–15) — cada gaiola guarda 2 endereços.
const FORMATO_PK = { '11': 'caixa', '12': 'caixa', '13': 'caixa', '14': 'gaiola', '15': 'gaiola' };
const NOME_FORMATO = { bin: 'Bin', caixa: 'Caixa sob medida', gaiola: 'Gaiola (2 endereços)' };                                          // trecho de ~6 m da longarina = uma célula do calor
function geoRua(rua) {
  const esq = RUAS_ESQ.indexOf(rua), i = esq >= 0 ? esq : RUAS_DIR.indexOf(rua);
  const x0 = (esq >= 0 ? XL : XR) + i * PASSO;
  return { xImpar: x0 + D / 2, xPar: x0 + D + A + D / 2, xCorr: x0 + D + A / 2, L: esq >= 0 ? L_CURTA : L_LONGA };
}
const Z_FRENTE = L_LONGA;
const VIEWS = {
  geral:   { t: [50, 2, 46], o: [-24, 66, 96], top: 195 },
  pulmao:  { t: [48, 6, 40], o: [-20, 56, 80], top: 150 },
  picking: { t: [48, 1, 44], o: [-22, 58, 90], top: 180 }
};

/* ---------------- cores ---------------- */
const RAMPS = {
  dark:  [[0, '#1E7A4A'], [.6, '#45C645'], [.72, '#C6D23A'], [.82, '#F6BD00'], [.92, '#F28322'], [1, '#E0283E']],
  light: [[0, '#2A8F55'], [.6, '#4DB84D'], [.72, '#BFC232'], [.82, '#E9A800'], [.92, '#E06A1B'], [1, '#B5122B']]
};
const INFRA = {
  dark:  { esteira: '#10161F', estr: '#7C92AC', estrut: '#2F5F9E', longarina: '#6E5238', montante: '#3B5478', passagem: '#2B3A50', outro: '#8592A6', parede: '#5A6F88', chao: '#18233A', corredor: '#1E2B40',
           colmeia: '#0B0D10', pallet: '#9A7350', carga: '#CDB48C', caixa: '#C9A36A', faixa: '#F6BD00', mesa: '#E6EAEF', monitor: '#0E141E', tela: '#2F7DE0', rolete: '#2A2F38', hidrante: '#C8102E', coluna: '#E8ECF1', grade: '#9AA6B4', guarda: '#F6BD00', eclusa: '#33516E', piso: '#22344A', perna: '#55657A', fora: '#3A4A5E', neutro: '#6F7F96' },
  light: { esteira: '#3A4656', estr: '#8EA3BA', estrut: '#3A6AAE', longarina: '#C9A786', montante: '#8EA6C8', passagem: '#C9D3DE', outro: '#9AA8BA', parede: '#9DB0C4', chao: '#E3E9F0', corredor: '#D3DCE6',
           colmeia: '#1A1C20', pallet: '#9A7350', carga: '#D9C4A0', caixa: '#B98E52', faixa: '#C9960A', mesa: '#FFFFFF', monitor: '#1B2533', tela: '#2F7DE0', rolete: '#4A5160', hidrante: '#C0392B', coluna: '#FFFFFF', grade: '#8A96A4', guarda: '#D9A300', eclusa: '#C4D3E2', piso: '#D6DFE9', perna: '#8A99AA', fora: '#B4C0CE', neutro: '#8C9AAD' }
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
/* Posição física de um endereço de Picking — mapeamento da operação (26/10/2026):
   - rua 11: todos os endereços (pares e ímpares) na longarina da direita (par), menos o primeiro quadrante perto
     das eclusas, que não é usado; a esquerda é da Reversa/Qualidade.
   - rua 12: malas e acessórios (endereços da rua 12) só na longarina da esquerda (ímpar).
   - meias (endereços da rua 15 do sistema) fazem um zigue-zague em gaiolas, da menor para a maior:
       001–032  rua 14, longarina ímpar, do fundo para a frente;
       033–102  rua 13, longarina da direita (vista das eclusas), da frente para o fundo;
       103–168  rua 13, longarina da esquerda (ímpar), do fundo para a frente;
       169 em diante  rua 12, longarina da direita (par), da frente para o fundo.
   Devolve { rua (física), lado, frac (0 = fundo, 1 = frente), n (posições no trecho) }. */
const ZIGUE_MEIAS = [
  { de: 1, ate: 32, rua: '14', lado: 'impar', sentido: 'fundo' },     // 001 no fundo
  { de: 33, ate: 102, rua: '13', lado: 'par', sentido: 'frente' },    // 033 na frente
  { de: 103, ate: 168, rua: '13', lado: 'impar', sentido: 'fundo' },  // 101 no fundo
  { de: 169, ate: Infinity, rua: '12', lado: 'par', sentido: 'frente' } // 169 na frente
];
function posPicking(rua, box, maxB) {
  const k = Math.ceil(box / 2), lado = box % 2 ? 'impar' : 'par';
  // rua 11: o primeiro quadrante (vão de ~2,7 m) perto das eclusas não é usado no Picking (operação, 26/10/2026)
  if (rua === '11') return { rua: '11', lado: 'par', frac: (box - .5) / maxB * (L_CURTA - 2.7) / L_CURTA, n: maxB * L_CURTA / (L_CURTA - 2.7) };
  if (rua === '12') return { rua: '12', lado: 'impar', frac: (box - .5) / maxB, n: maxB };
  if (rua === '15') {
    const t = ZIGUE_MEIAS.find(z => box >= z.de && box <= z.ate);
    const fim = Math.min(t.ate, Math.max(maxB, t.de)), n = fim - t.de + 1, i = box - t.de + .5;
    return { rua: t.rua, lado: t.lado, frac: t.sentido === 'fundo' ? i / n : 1 - i / n, n };
  }
  const n = Math.max(1, Math.ceil(maxB / 2));
  return { rua, lado, frac: (k - .5) / n, n };
}
// Lado de longarina que existe mas não é da DISTR: vira bloco translúcido (estrutura não usada)
const OUTRO_SETOR = [{ rua: '11', lado: 'impar', nome: 'Reversa/Qualidade' }];
// Ruas do estoque novo (11–15): o Pulmão vai até o nível 11 — o 12 não é desenhado (fica acima da estrutura)
// Rua 08 do Pulmão: almoxarifado e insumos — fora da ocupação e da capacidade; desenhada cheia, com pallets
// de cores próprias (ilustrativo), para não se confundir com o estoque da DISTR.
const RUA_ALMOX = '8';
const CORES_ALMOX = { dark: ['#5B6CC9', '#8E6CC9', '#3FA7B5', '#B07ACF', '#4C8BB8', '#6F7FB0', '#2F8F9D'],
                      light: ['#4A5BB5', '#7A58B8', '#2E95A3', '#9C66BC', '#3D79A6', '#5E6E9E', '#25808D'] };
const NIVEL_MAX_PU = r => RUAS_ESQ.indexOf(r) !== -1 ? 11 : 12;
const altRua = r => PU_BASE + (NIVEL_MAX_PU(r) - 7) * PU_PASSO + .3;
/* Passagens de empilhadeira: pelo gabarito da operação (foraCapacidadePulmao = 'passagem' nos níveis 08
   e 09 do mesmo box). A passagem atravessa a longarina do chão até o nível 09: nada é desenhado ali. */
function passagens(mapa) {
  const out = [];
  if (typeof window.foraCapacidadePulmao !== 'function') return out;
  Object.keys(mapa.pulmao || {}).forEach(rua => {
    const R = mapa.pulmao[rua], max = R.max || 0, nPos = Math.max(1, Math.ceil(max / 2)), L = geoRua(rua).L;
    for (let b = 1; b <= max; b++) {
      if (window.foraCapacidadePulmao(rua, 8, b) === 'passagem' && window.foraCapacidadePulmao(rua, 9, b) === 'passagem') {
        const k = Math.ceil(b / 2), lado = b % 2 ? 'impar' : 'par';
        out.push({ rua, lado, box: b, z0: (k - 1) * L / nPos, z1: k * L / nPos });
      }
    }
  });
  return out;
}
/* Endereços → itens desenháveis + grupos do calor (rua física × lado × nível × trecho de ~6 m). */
function montarItens(mapa) {
  const itens = [], grupos = new Map(), foraNum = { pulmao: 0, picking: 0, passagem: 0 };
  const pass = passagens(mapa);
  const naPassagem = (rua, lado, z) => pass.some(p => p.rua === rua && p.lado === lado && z > p.z0 - .05 && z < p.z1 + .05);
  function grupo(zona, rua, lado, nivel, bloco, foraCap) {
    const k = zona + '|' + rua + '|' + lado + '|' + nivel + '|' + bloco;
    let g = grupos.get(k);
    if (!g) { g = { zona, rua, lado, nivel, foraCap, n: 0, ocup: 0, saldo: 0, sem: 0, res: 0, livres: 0, fora: 0, pecas: 0, b0: Infinity, b1: 0, ruaSis: new Set() }; grupos.set(k, g); }
    return g;
  }
  ['pulmao', 'picking'].forEach(zona => {
    const lista = mapa[zona] || {};
    Object.keys(lista).forEach(rua => {
      if (RUAS_DIR.indexOf(rua) === -1 && RUAS_ESQ.indexOf(rua) === -1) return;
      const R = lista[rua], foraCap = zona === 'pulmao' ? foraCapPulmao(mapa, rua) : null;
      const nPk = zona === 'picking' ? Math.max(1, ...Object.keys(R.niveis).map(Number)) : 0;
      // Box muito fora da numeração da rua (ex.: rua 06 nível 1 com box 880, quando a rua vai até ~340)
      // esticaria o nível inteiro: o comprimento usa a numeração típica da rua e o box fora dela é só contado.
      const maxNiveis = Object.keys(R.niveis).map(nv => R.niveis[nv].max || R.max || R.niveis[nv].e.length).sort((a, b) => a - b);
      const tipico = maxNiveis[Math.floor((maxNiveis.length - 1) / 2)] || 0;
      Object.keys(R.niveis).forEach(nv => {
        const N = R.niveis[nv], lv = Number(nv), maxN = N.max || R.max || N.e.length;
        if (zona === 'pulmao' && rua === RUA_ALMOX) return;            // desenhada à parte (almoxarifado/insumos)
        if (zona === 'pulmao' && lv > NIVEL_MAX_PU(rua)) {          // nível acima da estrutura do estoque novo
          for (let i = 0; i < N.e.length; i++) if ('12'.indexOf(N.e[i]) !== -1 && N.e[i] !== '') foraNum.pulmao++;
          return;
        }
        const maxB = maxN > tipico * 1.3 ? tipico : maxN, q = (N.q || '').split(',');
        const hb = zona === 'picking' ? PK_TOPO / nPk : PU_PASSO;
        const y = zona === 'picking' ? (lv - 1) * hb : PU_BASE + (lv - 8) * PU_PASSO;
        const fmt = zona === 'picking' ? (FORMATO_PK[rua] || 'bin') : 'pallet';
        const h = fmt === 'gaiola' ? hb * .92 : fmt === 'caixa' ? hb * .8 : fmt === 'bin' ? Math.max(.12, hb * .7) : PU_H;
        const dk = fmt === 'gaiola' ? .97 : fmt === 'caixa' ? .92 : .86;
        for (let i = 0; i < N.e.length; i++) {
          const st = N.e[i]; if (st === '-') continue;
          if (i + 1 > maxB) { if (st !== 'l') foraNum[zona]++; continue; }
          // meias 169–176: podem nem existir fisicamente — só aparecem se o endereço está no arquivo (alocado)
          if (zona === 'picking' && rua === '15' && i + 1 >= 169 && i + 1 <= 176 && st === 'l') continue;
          const box = i + 1;
          const pp = zona === 'picking' ? posPicking(rua, box, maxB)
            : { rua, lado: box % 2 ? 'impar' : 'par', frac: (Math.ceil(box / 2) - .5) / Math.max(1, Math.ceil(maxB / 2)), n: Math.max(1, Math.ceil(maxB / 2)) };
          const geo = geoRua(pp.rua), passo = geo.L / pp.n, k = Math.round(pp.frac * pp.n + .5);
          // gaiola: os 2 endereços ficam colados (uma gaiola), com folga entre gaiolas
          const z = pp.frac * geo.L + (fmt === 'gaiola' ? (k % 2 ? .04 : -.04) * passo : 0);
          // passagem de empilhadeira: do chão ao nível 09 a longarina é vazada
          if ((zona === 'picking' || lv <= 9) && naPassagem(pp.rua, pp.lado, z)) { if (st !== 'l' && st !== 'x' && st !== '0') foraNum.passagem++; continue; }
          const bloco = Math.floor(z / BLOCO);
          const g = grupo(zona, pp.rua, pp.lado, lv, bloco, foraCap), pc = q[i] ? parseInt(q[i], 36) : 0;
          g.ruaSis.add(rua);
          g.b0 = Math.min(g.b0, box); g.b1 = Math.max(g.b1, box); g.pecas += pc;
          if (st === 'x') g.fora++;
          else {
            g.n++;
            if (st === '1' || st === '2') { g.ocup++; g.saldo++; }
            else if (st === 'r') { g.ocup++; g.res++; }
            else if (st === '0') { if (zona === 'picking') { g.ocup++; g.sem++; } else g.livres++; }
            else if (st === 'l') g.livres++;
          }
          itens.push({ zona, rua, ruaFis: pp.rua, nivel: lv, box, lado: pp.lado, st, pc, g, fmt,
            x: pp.lado === 'impar' ? geo.xImpar : geo.xPar, y, z, w: D * (fmt === 'bin' ? .84 : .9), h, d: Math.max(.1, passo * dk) });
        }
      });
    });
  });
  grupos.forEach(g => { g.pct = g.n ? g.ocup / g.n * 100 : 0; });
  return { itens, grupos, foraNum, pass };
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
  const sis = [...(g.ruaSis || [])].filter(r => r !== g.rua);
  const tit = 'Rua ' + pad(g.rua) + ' · ' + nomeZona(g.zona) + ' · nível ' + pad(g.nivel) + ' · lado ' + (g.lado === 'par' ? 'par' : 'ímpar')
    + (sis.length ? ' <span style="font-weight:400;color:var(--text-muted)">(endereços da rua ' + sis.map(r => pad(r)).join('/') + ' no sistema)</span>' : '');
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
    + (it.fmt && it.fmt !== 'pallet' ? '<div class="s">' + NOME_FORMATO[it.fmt] + '</div>' : '')
    + '<div class="s">' + (it.ruaFis && it.ruaFis !== it.rua ? 'Fisicamente na rua ' + pad(it.ruaFis) : 'Rua ' + pad(it.rua)) + ' · lado ' + (it.lado === 'par' ? 'par' : 'ímpar') + ' · nível ' + pad(it.nivel)
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
    h += sw(CORES_ALMOX[t][0], 'Almoxarifado / insumos (rua 08, fora da capacidade)') + sw(I.neutro, 'Fora da capacidade') + sw(I.fora, 'Passagem / sem parametrização') + sw(I.colmeia, 'Colmeias');
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
  const { itens, grupos, foraNum, pass } = montarItens(mapa);
  const fora = { pulmao: ((mapa.fora_do_desenho || {}).pulmao || 0) + foraNum.pulmao, picking: ((mapa.fora_do_desenho || {}).picking || 0) + foraNum.picking };
  q('base').textContent = 'Posição de Picking + Pulmão' + (dados.gerado_em && window.formatarDataHora ? ' de ' + window.formatarDataHora(dados.gerado_em) : '')
    + (dados.arquivos ? ' (' + dados.arquivos + ')' : '') + '. Cada cubo é um endereço: Picking nos níveis 1 a 7, Pulmão nos níveis 8 a 12; box 001 no fundo do galpão. '
    + 'Calor = % de endereços ocupados em cada trecho de ~6 m da longarina (no Picking, endereço alocado conta como ocupado, como na tela Estoque). '
    + 'No Picking, o endereço sem SKU cadastrado não vem no arquivo: os livres são deduzidos pela numeração até o maior box de cada nível. '
    + 'A ocupação no topo é a oficial por rua (capacidade da planilha, mesma régua do card de endereços livres).'
    + ' Ruas 11 a 15 no físico: rua 11 com o Picking todo na longarina da direita; rua 12 com malas/acessórios na esquerda; meias (rua 15 do sistema) em zigue-zague — 001–032 na rua 14, 033–102 e 103–168 nos dois lados da rua 13 e 169 em diante na direita da rua 12.'
    + ((fora.pulmao || fora.picking) ? ' Fora do desenho (lado que a rua não tem, numeração fora do padrão ou nível 12 do estoque novo): ' + fmtI(fora.pulmao || 0) + ' no Pulmão e ' + fmtI(fora.picking || 0) + ' no Picking.' : '')
    + (foraNum.passagem ? ' ' + fmtI(foraNum.passagem) + ' endereço(s) com saldo dentro de passagem de empilhadeira não aparecem.' : '');

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
  controls.rotateSpeed = .22; controls.panSpeed = .32;   // menos sensível: mexer pouco o mouse mexe pouco a imagem
  controls.maxPolarAngle = Math.PI * .49; controls.screenSpacePanning = true;
  controls.enableZoom = false;
  const est = { renderer, camera, controls, raf: 0, voo: 0, ro: null, mo: null, nivelZoom: 0 };
  P3.estado = est;
  window.__planta3d = est;   // acesso para testes no navegador (câmera/controles)

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
  caixa(XL - 3, -4, X_FIM + .5, Z_FRENTE + 24, -.3, .3, 'chao', 'comum');
  caixa(X_FIM - .2, -4, X_FIM + .5, Z_FRENTE + 24, 0, ALT + 3, 'parede', 'comum',
    { op: .45, tip: tipInfo('Divisão de módulos do galpão', 'Logo depois da rua 08 (almoxarifado e insumos): aqui termina o galpão da DISTR.') });
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
  // lados de longarina com endereço desenhado (no físico) — rua de um lado só não ganha estrutura no outro
  const ladosUsados = new Set(itens.map(it => (it.ruaFis || it.rua) + '|' + it.lado).concat([RUA_ALMOX + '|impar', RUA_ALMOX + '|par']));
  RUAS_ESQ.concat(RUAS_DIR).forEach(r => {
    const g = geoRua(r), tip = tipRua(r), alt = altRua(r), nMax = NIVEL_MAX_PU(r);
    const fecha = (lado, z) => pass.some(p => p.rua === r && p.lado === lado && z > p.z0 - .05 && z < p.z1 + .05);
    [['impar', g.xImpar], ['par', g.xPar]].forEach(([lado, x]) => {
      if (!ladosUsados.has(r + '|' + lado)) return;
      // montante em duas partes: até o topo do Picking (sempre) e o resto, que some no modo Picking
      for (let z = 0; z <= g.L + .01; z += 2.7) [-1, 1].forEach(sd => {
        montantes.push({ x: x + sd * D * .46, y: 0, z, w: .09, h: PK_TOPO + .2, d: .09, corNome: 'montante', tip });
        montantesPu.push({ x: x + sd * D * .46, y: PK_TOPO + .2, z, w: .09, h: alt - PK_TOPO - .2, d: .09, corNome: 'montante', tip });
      });
      // vigas por nível; nos níveis 08 e 09 a viga é cortada onde há passagem de empilhadeira
      for (let nv = 8; nv <= nMax; nv++) {
        const y = PU_BASE + (nv - 8) * PU_PASSO - .1;
        const cortes = nv <= 9 ? pass.filter(p => p.rua === r && p.lado === lado).map(p => [p.z0, p.z1]).sort((u, v) => u[0] - v[0]) : [];
        let z0 = 0;
        cortes.concat([[g.L, g.L]]).forEach(([c0, c1]) => {
          if (c0 - z0 > .2) [-1, 1].forEach(sd => vigas.push({ x: x + sd * D * .46, y, z: (z0 + c0) / 2, w: .07, h: .09, d: c0 - z0, corNome: 'longarina', tip }));
          z0 = Math.max(z0, c1);
        });
      }
    });
  });
  lote(montantes, 'comum', 0); lote(montantesPu, 'pulmao', 0); lote(vigas, 'pulmao', 0);

  /* ---------- passagens de empilhadeira (gabarito da operação) ---------- */
  const marcas = [];
  const blocosPass = [];   // passagens vizinhas (mesma rua e lado) viram uma só
  pass.slice().sort((u, v) => (u.rua + u.lado).localeCompare(v.rua + v.lado) || u.z0 - v.z0).forEach(p => {
    const ult = blocosPass[blocosPass.length - 1];
    if (ult && ult.rua === p.rua && ult.lado === p.lado && p.z0 <= ult.z1 + .05) { ult.z1 = p.z1; ult.boxes.push(p.box); }
    else blocosPass.push({ rua: p.rua, lado: p.lado, z0: p.z0, z1: p.z1, boxes: [p.box] });
  });
  blocosPass.forEach(p => {
    const g = geoRua(p.rua), x = p.lado === 'impar' ? g.xImpar : g.xPar;
    const t = () => tipInfo('Passagem de empilhadeira', 'Rua ' + pad(p.rua) + ' · lado ' + (p.lado === 'par' ? 'par' : 'ímpar') + ' · boxes ' + p.boxes.map(b => pad(b, 3)).join(', ')
      + '<br>A longarina é vazada do chão até o nível 09 (endereços fora da capacidade, pelo gabarito da operação)');
    [[p.z0, p.z0 + .12], [p.z1 - .12, p.z1]].forEach(([a2, b2]) => marcas.push({ x, y: .02, z: (a2 + b2) / 2, w: D + .6, h: .03, d: b2 - a2, corNome: 'faixa', tip: t }));
    marcas.push({ x, y: .015, z: (p.z0 + p.z1) / 2, w: D + .6, h: .02, d: p.z1 - p.z0 - .24, corNome: 'passagem', tip: t });
  });
  lote(marcas, 'comum', 0);

  /* ---------- rua 08: almoxarifado e insumos (ilustrativo, fora da ocupação e da capacidade) ---------- */
  {
    const g = geoRua(RUA_ALMOX), nPos = 72, passo = g.L / nPos;
    let sem = 3;
    const sort2 = () => (sem = (sem * 9301 + 49297) % 233280) / 233280;
    const tipA = () => tipInfo('Rua 08 · Almoxarifado e insumos', 'Material de almoxarifado e insumos · fica fora da ocupação e da capacidade do Pulmão (desenho ilustrativo: as cores só diferenciam do estoque da DISTR)');
    for (let nv = 8; nv <= NIVEL_MAX_PU(RUA_ALMOX); nv++) {
      const base = [], carga = [], y = PU_BASE + (nv - 8) * PU_PASSO;
      [g.xImpar, g.xPar].forEach(x => {
        for (let k = 1; k <= nPos; k++) {
          if (sort2() < .08) continue;                                   // poucas posições vazias
          const z = (k - .5) * passo, cor = Math.floor(sort2() * 7), alt = PU_H * (.6 + sort2() * .35);
          base.push({ x, y, z, w: D * .86, h: .14, d: passo * .86, corNome: 'pallet', tip: tipA });
          carga.push({ x, y: y + .14, z, w: D * .8, h: alt - .14, d: passo * .8, cor, tip: tipA });
        }
      });
      lote(base, 'pulmao', nv);
      lote(carga, 'pulmao', nv, it => CORES_ALMOX[tema()][it.cor]);
    }
    rotulo('Almoxarifado / insumos', g.xCorr, altRua(RUA_ALMOX) + .8, g.L / 2, 'pulmao', 'inf');
  }

  /* ---------- lados de longarina de outro setor (não usados pela DISTR) ---------- */
  OUTRO_SETOR.forEach(o => {
    const g = geoRua(o.rua), x = o.lado === 'impar' ? g.xImpar : g.xPar;
    caixa(x - D / 2, 0, x + D / 2, g.L, 0, altRua(o.rua), 'outro', 'comum', { op: .32,
      tip: tipInfo(o.nome, 'Rua ' + pad(o.rua) + ' · lado ' + (o.lado === 'par' ? 'par' : 'ímpar') + ' · estrutura da ' + o.nome + ', não usada pela DISTR (a rua 11 é uma meia rua: o Picking e o Pulmão ficam só no lado par)') });
    rotulo(o.nome, x, altRua(o.rua) + .8, g.L / 2, 'comum', 'inf');
  });

  /* ---------- frente do galpão ---------- */
  // colmeias (fotos): 2 na ponta de cada par de longarinas encostadas, a partir do par 01/02, numeradas
  // da esquerda para a direita; o par 04/05 não tem colmeia (estrutura de hidrante). Pretas, com o
  // móvel da impressora na ponta e guarda-corpo amarelo em volta.
  const esc = [], tampas = [], guardas = [];
  const NC = 6, NN = 4, LC = 3.2, HN = .5;
  const PARES_COLMEIA = [['1', '2'], ['2', '3'], ['3', '4'], ['5', '6'], ['6', '7'], ['7', '8']];
  PARES_COLMEIA.forEach(([ra, rb], i) => {
    const a = geoRua(ra), b = geoRua(rb);
    [[a.xPar, 'Rua ' + pad(ra) + ' · lado par'], [b.xImpar, 'Rua ' + pad(rb) + ' · lado ímpar']].forEach(([x, onde], li) => {
      const z0 = Z_FRENTE + .3, num = 2 * i + li + 1;
      const tip = () => tipInfo('Colmeia ' + num, 'Na ponta da longarina da ' + onde + ' · ' + NN + ' × ' + NC + ' escaninhos · móvel da impressora na ponta');
      for (let c = 0; c < NC; c++) for (let n = 0; n < NN; n++)
        esc.push({ x, y: n * HN, z: z0 + (c + .5) * LC / NC, w: D * .8, h: HN * .88, d: LC / NC * .92, corNome: 'colmeia', tip });
      tampas.push({ x, y: NN * HN, z: z0 + LC / 2, w: D * .86, h: .06, d: LC, corNome: 'colmeia', tip });
      tampas.push({ x, y: 0, z: z0 + LC + .4, w: D * .7, h: 1.05, d: .7, corNome: 'colmeia', tip });          // móvel da impressora
      tampas.push({ x, y: 1.05, z: z0 + LC + .35, w: .4, h: .3, d: .4, corNome: 'monitor', tip });           // impressora
    });
    // guarda-corpo amarelo em volta do par de colmeias
    const x0 = a.xPar - D / 2 - .25, x1 = b.xImpar + D / 2 + .25, z1 = Z_FRENTE + .3 + LC + .9;
    [[x0, Z_FRENTE + .3, x0 + .08, z1], [x1 - .08, Z_FRENTE + .3, x1, z1], [x0, z1 - .08, x1, z1]].forEach(([p, q2, r2, t]) =>
      guardas.push({ x: (p + r2) / 2, y: .35, z: (q2 + t) / 2, w: r2 - p, h: .08, d: t - q2, corNome: 'guarda' }));
  });
  lote(esc, 'comum', 0); lote(tampas, 'comum', 0); lote(guardas, 'comum', 0);
  // colunas estruturais brancas do galpão que atravessam o estoque (fotos/operação, 26/10/2026)
  [{ rua: '4', box: 36 }, { rua: '13', box: 35 }].forEach(c => {
    const g = geoRua(c.rua), R = (mapa.pulmao || {})[c.rua], max = (R && R.max) || (g.L === L_LONGA ? 144 : 68);
    const nPos = Math.ceil(max / 2), z = (Math.ceil(c.box / 2) - .5) * g.L / nPos, x = c.box % 2 ? g.xImpar : g.xPar;
    caixa(x - .3, z - .3, x + .3, z + .3, 0, ALT + 3, 'coluna', 'comum',
      { tip: tipInfo('Coluna estrutural', 'Rua ' + pad(c.rua) + ' · box ' + pad(c.box, 3) + ' · coluna do galpão que atravessa o estoque — essas posições não guardam pallet') });
  });
  // hidrante entre as ruas 04 e 05 (no lugar das colmeias)
  const xH = (geoRua('4').xPar + geoRua('5').xImpar) / 2, tipH = tipInfo('Hidrante', 'Entre as ruas 04 e 05 · por isso esse par de longarinas não tem colmeia');
  caixa(xH - .5, Z_FRENTE + .4, xH + .5, Z_FRENTE + .9, 0, 1.3, 'hidrante', 'comum', { tip: tipH });
  caixa(xH - .08, Z_FRENTE + .55, xH + .08, Z_FRENTE + .71, 1.3, ALT + 1.5, 'hidrante', 'comum', { tip: tipH });

  // placas das marcas: banner azul na ponta do par de longarinas onde a marca começa
  // Placas das marcas, como no CD: faixa azul com o ícone da marca em cima e o nome na vertical. As logos
  // (img/marcas) são pintadas de branco na hora (a da Mizuno vem azul) e giradas 90° inteiras, como no CD;
  // a da Under Armour junta o ícone e o nome, que vêm em arquivos separados.
  // f = espessura da logo girada em fração da largura da faixa; topo = onde ela começa (fração da altura).
  // Medido nas fotos do CD (26/10/2026): a logo inteira (ícone + nome) é só girada 90°, estreita, perto do topo.
  const LOGOS = {
    Olympikus: { arq: 'img/marcas/olympikus.png', f: .26, topo: .17 },
    Mizuno: { arq: 'img/marcas/mizuno.png', f: .32, topo: .22 },
    'Under Armour': { icone: 'img/marcas/under-armour-icone.webp', nome: 'img/marcas/under-armour-nome.webp', f: .2, topo: .12 }
  };
  const carregaImg = src => new Promise((ok, erro) => { const im = new Image(); im.onload = () => ok(im); im.onerror = erro; im.src = src; });
  // imagem → canvas branco recortado no que tem desenho (alfa > 20)
  function branca(im) {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
    return recorta(c, 0, c.width);
  }
  function recorta(c, x0, x1) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let a = Infinity, b = -1, t = Infinity, u = -1;
    for (let y = 0; y < c.height; y++) for (let x = x0; x < x1; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { a = Math.min(a, x); b = Math.max(b, x); t = Math.min(t, y); u = Math.max(u, y); }
    if (b < 0) return null;
    const o = document.createElement('canvas'); o.width = b - a + 1; o.height = u - t + 1;
    o.getContext('2d').drawImage(c, a, t, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }


  // UA: o ícone e o nome vêm separados — monta a logo horizontal (ícone da altura do nome, um vão, o nome)
  function juntaUA(icone, nome) {
    const h = nome.height, ki = h * 1.05 / icone.height, wi = icone.width * ki, vao = h * .45;
    const c = document.createElement('canvas'); c.width = Math.ceil(wi + vao + nome.width); c.height = Math.ceil(Math.max(h, icone.height * ki));
    const g = c.getContext('2d');
    g.drawImage(icone, 0, (c.height - icone.height * ki) / 2, wi, icone.height * ki);
    g.drawImage(nome, wi + vao, (c.height - h) / 2);
    return c;
  }
  function desenhaFaixa(cvs, marca, logo, L) {
    const W = cvs.width, H = cvs.height, g = cvs.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#26406B'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, W, H * .006); g.fillRect(0, H * .994, W, H * .006);   // barras do banner
    g.save();
    if (logo) {                                    // logo inteira girada 90°: o começo (ícone) fica em cima
      const k = Math.min(W * L.f / logo.height, H * .76 / logo.width);
      g.translate(W / 2, H * L.topo); g.rotate(Math.PI / 2);
      g.drawImage(logo, 0, -logo.height * k / 2, logo.width * k, logo.height * k);
    } else {
      g.translate(W / 2, H * .5); g.rotate(Math.PI / 2);
      g.fillStyle = '#F2F4F7'; g.font = '800 ' + Math.round(W * .18) + 'px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(marca.toUpperCase(), 0, 4);
    }
    g.restore();
  }
  function placa(ra, rb, marca) {
    const xc = (geoRua(ra).xPar + geoRua(rb).xImpar) / 2, w = 2.1, y0 = PU_BASE + .2, hP = ALT - y0 - .2;
    const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = Math.round(512 * hP / w);
    desenhaFaixa(cvs, marca, null, null);          // nome em texto até as logos carregarem
    const tex = new THREE.CanvasTexture(cvs);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hP), mat);
    m.position.set(xc, y0 + hP / 2, Z_FRENTE + .12);
    m.userData.tip = tipInfo('Placa ' + marca, 'Ponta das longarinas das ruas ' + pad(ra) + ' e ' + pad(rb) + ' · início das ruas ' + marca);
    m.userData.baseOp = 1;
    reg(m, 'pulmao', 0, null, true);
    const L = LOGOS[marca];
    if (!L) return;
    const pronto = L.arq ? carregaImg(L.arq).then(branca)
      : Promise.all([carregaImg(L.icone), carregaImg(L.nome)]).then(([a, b]) => juntaUA(branca(a), branca(b)));
    pronto.then(logo => { desenhaFaixa(cvs, marca, logo, L); tex.needsUpdate = true; })
      .catch(e => console.warn('Logo da placa ' + marca + ' não carregou:', e));
  }
  placa('3', '4', 'Olympikus'); placa('5', '6', 'Mizuno'); placa('7', '8', 'Under Armour');

  // caixa de faturamento (fotos + operação): na frente das ruas 07 e 08, no lugar das eclusas. Esteira de
  // roletes larga no meio; de cada lado dela, da direita para a esquerda, uma mesa com 2 telas e uma com 1
  // tela; na ponta da esteira, os pallets de caixas sendo montados. As mesas ficam de lado.
  const fxA = geoRua('7').xImpar - D / 2, fxB = geoRua('8').xPar + D / 2;
  const xR = fxB - .3, fz = Z_FRENTE + 11.5, LARG = 2.2;           // esteira: ~2,5× a largura anterior
  const xEst0 = xR - 5.4, xEst1 = xR;                              // esteira corre da direita para a esquerda
  const tipCx = tipInfo('Caixa de faturamento', 'Esteira de roletes no meio · mesas de conferência ao lado · na ponta da esteira a caixa é lacrada e o pallet é montado');
  caixa(xEst0, fz - LARG / 2, xEst1, fz + LARG / 2, .66, .1, 'rolete', 'comum', { tip: tipCx });
  const rol = [], pern = [], mesas = [], pcs = [];
  for (let x = xEst0 + .15; x < xEst1; x += .28) rol.push({ x, y: .76, z: fz, w: .11, h: .05, d: LARG - .16, corNome: 'grade', tip: () => tipCx });
  for (let x = xEst0 + .3; x < xEst1; x += 1.6) [fz - LARG / 2 + .1, fz + LARG / 2 - .18].forEach(z => pern.push({ x, y: 0, z, w: .08, h: .66, d: .08, corNome: 'perna' }));
  // monitor de frente para +x (lado = 1) ou −x (lado = −1): tela no plano z-y
  function monitor(x, z, lado, t) {
    pcs.push({ x, y: .91, z, w: .05, h: .38, d: .5, corNome: 'monitor', tip: t });
    pcs.push({ x: x + lado * .035, y: .95, z, w: .02, h: .3, d: .44, corNome: 'tela', tip: t });
  }
  // 4 mesas: em cada lado da esteira, uma com 2 telas (uma de cada lado, conferentes frente a frente) à
  // direita e uma com 1 tela à esquerda. Mesas de lado: 1,2 m (x) × 2 m (z), encostadas na esteira.
  function mesa(xc, zM, nome, detalhe) {
    const t = () => tipInfo(nome, detalhe);
    mesas.push({ x: xc, y: .85, z: zM, w: 1.2, h: .06, d: 2, corNome: 'mesa', tip: t });
    [[-.5, -.9], [.5, -.9], [-.5, .9], [.5, .9]].forEach(([dx, dz]) => pern.push({ x: xc + dx, y: 0, z: zM + dz, w: .07, h: .85, d: .07, corNome: 'mesa' }));
    return t;
  }
  const xM1 = xR - .9, xM2 = xM1 - 2.2;
  [[fz + LARG / 2 + .35 + 1, 'da frente'], [fz - LARG / 2 - .35 - 1, 'do fundo']].forEach(([zM, lado], i) => {
    const t1 = mesa(xM1, zM, 'Mesa de conferência ' + (2 * i + 1), '2 telas, uma de cada lado · as conferentes ficam uma de frente para a outra · lado ' + lado + ' da esteira');
    monitor(xM1 + .12, zM, 1, t1); monitor(xM1 - .12, zM, -1, t1);
    const t2 = mesa(xM2, zM, 'Mesa de conferência ' + (2 * i + 2), '1 tela · lado ' + lado + ' da esteira');
    monitor(xM2 - .3, zM, 1, t2);
  });
  lote(rol, 'comum', 0); lote(pern, 'comum', 0); lote(mesas, 'comum', 0); lote(pcs, 'comum', 0);
  // pallets de caixas sendo montados, na ponta da esteira
  const cxs = [];
  [[xEst0 - .9, fz - .65, 3], [xEst0 - .9, fz + .65, 2], [xEst0 - 2.2, fz, 1]].forEach(([x, z, n]) => {
    cxs.push({ x, y: 0, z, w: 1.1, h: .15, d: 1.1, corNome: 'pallet', tip: () => tipCx });
    for (let i = 0; i < n; i++) cxs.push({ x, y: .15 + i * .45, z, w: .95, h: .42, d: .95, corNome: 'caixa', tip: () => tipCx });
  });
  lote(cxs, 'comum', 0);
  const fx0 = xEst0, LE = xEst1 - xEst0;
  // eclusas: 2 colunas × 5 fileiras de pallets, na frente do galpão (posições fixas: não mudam a cada carga)
  const pal = [], car = [], faixas = [];
  let semente = 11;
  const sorteio = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;
  function eclusa(x0, nome, op) {
    op = op || {};
    const z0 = op.z0 != null ? op.z0 : Z_FRENTE + 8, x1 = x0 + (op.larg || 5.5), z1 = z0 + (op.comp || 10), NL = op.linhas || 5, n = 2 * NL, cheias = new Set();
    const onde = op.onde || 'Frente do galpão';
    const oc = op.ocupacao || [.3, .7];          // faixa de ocupação ilustrativa (mín., máx.)
    while (cheias.size < Math.round(n * (oc[0] + sorteio() * (oc[1] - oc[0])))) cheias.add(Math.floor(sorteio() * n));
    caixa(x0, z0, x1, z1, 0, .05, 'eclusa', 'comum', { tip: tipInfo(nome, onde + ' · ' + cheias.size + ' de ' + n + ' posições com pallet (ilustrativo)') });
    const px = (x1 - x0) / 2, pz = (z1 - z0) / NL, lado = Math.min(px, pz) * .78;
    for (let c = 0; c < 2; c++) for (let l = 0; l < NL; l++) {
      const i = l * 2 + c, x = x0 + (c + .5) * px, z = z0 + (l + .5) * pz;
      const t = () => tipInfo(nome, 'Posição ' + (i + 1) + ' de ' + n + (cheias.has(i) ? ' · com pallet' : ' · vazia'));
      if (cheias.has(i)) {
        pal.push({ x, y: .05, z, w: lado, h: .2, d: lado, corNome: 'pallet', tip: t });
        car.push({ x, y: .25, z, w: lado * .88, h: 1.2, d: lado * .88, corNome: 'carga', tip: t });
      }
    }
    // layout da eclusa: retângulo marcado no chão com um risco no meio, de ponta a ponta (frente ao fundo)
    const e = .14, tl = () => tipInfo(nome, onde + ' · ' + cheias.size + ' de ' + n + ' posições com pallet (ilustrativo)');
    [[x0, z0, x1, z0 + e], [x0, z1 - e, x1, z1], [x0, z0, x0 + e, z1], [x1 - e, z0, x1, z1], [(x0 + x1) / 2 - e / 2, z0, (x0 + x1) / 2 + e / 2, z1]]
      .forEach(([a, b, c, d]) => faixas.push({ x: (a + c) / 2, y: .05, z: (b + d) / 2, w: c - a, h: .03, d: d - b, corNome: 'faixa', tip: tl }));
  }
  // eclusas só até a rua 06: a frente das ruas 07 e 08 é da caixa de faturamento
  const xFimE = fxA - 1, nE = Math.floor((xFimE - (XR + 1) + .9) / 6.4), xIniE = XR + 1, passoE = nE > 1 ? (xFimE - 5.5 - xIniE) / (nE - 1) : 0;
  for (let i = 0; i < nE; i++) eclusa(xIniE + i * passoE, 'Eclusa ' + (i + 1));
  // eclusas do recebimento (desenho da operação, 26/10/2026): 3 fileiras na frente das ruas 11–15, uma embaixo
  // de cada par de longarinas encostadas (11/12, 12/13, 13/14, 14/15), entre o estoque e a frente do galpão
  let nRec = 0;
  [['11', '12'], ['12', '13'], ['13', '14'], ['14', '15']].forEach(([ra, rb]) => {
    const xc = (geoRua(ra).xPar + geoRua(rb).xImpar) / 2, larg = 4.4;
    // compridas, 3 fileiras iguais: do fim das ruas até a linha das eclusas da frente do galpão
    const zIni = L_CURTA + 2.5, zFim = Z_FRENTE + 18, vao = 2, comp = (zFim - zIni - 2 * vao) / 3;
    [0, 1, 2].forEach(i => eclusa(xc - larg / 2, 'Eclusa do recebimento ' + (++nRec),
      { z0: zIni + i * (comp + vao), larg, comp, linhas: 8, ocupacao: [.85, 1], onde: 'Recebimento · frente das ruas ' + pad(ra) + ' e ' + pad(rb) }));
  });
  lote(pal, 'comum', 0); lote(car, 'comum', 0); lote(faixas, 'comum', 0);

  /* ---------- rótulos ---------- */
  RUAS_ESQ.concat(RUAS_DIR).forEach(r => { const g = geoRua(r); rotulo(pad(r), g.xCorr, ALT + 1.2, -1.5, 'comum', 'big'); });
  const gD = geoRua('8');
  rotulo('PULMÃO · níveis 8–12', X_FIM + 1.2, PU_BASE + 2.5 * PU_PASSO, Z_FRENTE - 34, 'pulmao', 'big');
  rotulo('PICKING · níveis 1–7', X_FIM + 1.2, PK_TOPO / 2, Z_FRENTE - 34, 'picking', 'big');
  rotulo('Box 001 (fundo)', gD.xCorr, .6, -1, 'comum');
  rotulo('Frente →', gD.xCorr, .6, Z_FRENTE + .5, 'comum');
  rotulo('Divisão de módulos', X_FIM, ALT + 4.4, 20, 'comum', 'inf');
  rotulo('Divisão · estoque do E-commerce', X_DIV, ALT + 4.4, 20, 'comum', 'inf');
  rotulo('Colmeias', (geoRua('2').xPar + geoRua('3').xImpar) / 2, 2.8, Z_FRENTE + 2, 'comum', 'inf');
  rotulo('Hidrante', xH, 2.2, Z_FRENTE + .6, 'comum', 'inf');
  rotulo('Caixa de faturamento', fx0 + LE / 2, 2.2, fz, 'comum', 'inf');
  rotulo('Eclusas', (XR + xFimE) / 2, 2.4, Z_FRENTE + 13, 'comum', 'inf');
  rotulo('Eclusas do recebimento', (geoRua('12').xPar + geoRua('14').xImpar) / 2, 2.4, (L_CURTA + Z_FRENTE + 20.5) / 2, 'comum', 'inf');
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
    const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * .0008), k = 1 - 1 / f, dist = camera.position.distanceTo(pt);
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

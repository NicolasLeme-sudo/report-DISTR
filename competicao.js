/* =========================================================================
   COMPETICAO.JS — tela "Competição" do report DISTR (Placar e Ranking por time)
   Lê competicao_times, competicao_pontos e ressuprimento_operador_diario e usa
   RegrasBlack (regras-black.js) para toda a conta. Aqui só se monta e se desenha.
   Funções puras no fim (api) para o teste em node (testes-competicao.js).
   ========================================================================= */
(function (global) {
'use strict';

var R = function () { return global.RegrasBlack; };
var MSG_TABELAS = 'As tabelas da competição ainda não existem no banco. Rode migracao_competicao.sql no SQL Editor do Supabase DISTR e abra a tela de novo.';

function tabelaInexistente(e) {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(e.message || ''));
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }
function ddmm(iso) { var p = String(iso).slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
function somaDias(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return R().isoLocal(d); }
function dia10(v) { return String(v).slice(0, 10); }

/* ---------- dados ---------- */
async function lerTudo(sb, tabela, cols, aplicar) {
  var out = [], de = 0, PAG = 1000;
  for (;;) {
    var q = sb.from(tabela).select(cols);
    if (aplicar) q = aplicar(q);
    var r = await q.range(de, de + PAG - 1);
    if (r.error) throw r.error;
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < PAG) break;
    de += PAG;
  }
  return out;
}

async function carregarDados(sb) {
  var hoje = R().diaOperacional(), de = somaDias(hoje, -35);
  var rT = await sb.from('competicao_times').select('id, usuario_wms, nome, turno, time, observacao, lider, presenca').order('time').order('id');
  if (rT.error) throw rT.error;
  var rL = await sb.from('competicao_pontos').select('id, dia, turno, time, categoria, item, pontos, motivo, registrado_email, criado_em').order('criado_em');
  if (rL.error && !tabelaInexistente(rL.error)) throw rL.error;
  var producao = await lerTudo(sb, 'ressuprimento_operador_diario', 'dia, turno, login, nome, pecas, atualizado_em', function (q) { return q.gte('dia', de).order('dia').order('turno').order('login'); });
  var snap = producao.reduce(function (a, r) { return r.atualizado_em && r.atualizado_em > a ? r.atualizado_em : a; }, '');
  return { cadastro: rT.data || [], lanc: rL.error ? [] : (rL.data || []), producao: producao, hoje: hoje, snap: snap || null, lidoEm: Date.now() };
}

/* ---------- conta (puras) ---------- */
function temAtividade(d, dia) {
  return (d.producao || []).some(function (r) { return dia10(r.dia) === dia && +r.pecas > 0; }) ||
    (d.lanc || []).some(function (l) { return dia10(l.dia) === dia; }) ||
    (d.cadastro || []).some(function (r) { return r.presenca && r.presenca[dia]; });
}
function diasDisponiveis(d) {
  var set = {};
  R().DIAS.forEach(function (x) { set[x[0]] = 1; });
  (d.producao || []).forEach(function (r) { if (+r.pecas > 0) set[dia10(r.dia)] = 1; });
  (d.lanc || []).forEach(function (l) { set[dia10(l.dia)] = 1; });
  return Object.keys(set).sort().reverse();
}
function diaPadrao(dias, hoje) {
  if (dias.indexOf(hoje) !== -1) return hoje;
  var antes = dias.filter(function (x) { return x <= hoje; });
  return antes.length ? antes[0] : dias[dias.length - 1];
}
function calcularDia(d, dia, turno) {
  var c = R().calcularCompeticao(d.producao, d.cadastro, dia);
  var lanc = (d.lanc || []).filter(function (l) { return dia10(l.dia) === dia && l.turno === turno; });
  return { c: c, p: R().placarDoDia({ c: c, dia: dia, turno: turno, cadastro: d.cadastro, lanc: lanc }) };
}
// Um bloco por turno, os 3 times em ordem de pódio (peças do dia; empate: pontos, depois número).
function montarBlocos(d, dia, turnoSel) {
  var turnos = turnoSel === 'ambos' ? ['1º Turno', '2º Turno'] : [turnoSel];
  return turnos.map(function (turno) {
    var x = calcularDia(d, dia, turno), porN = {};
    x.p.linhas.forEach(function (r) { porN[r.n] = r; });
    var ordemPts = x.p.linhas.slice().sort(function (a, b) { return b.total - a.total || a.n - b.n; }).map(function (r) { return r.n; });
    var linhas = x.c.times.filter(function (t) { return porN[t.n]; }).sort(function (a, b) {
      return (a.pos || 99) - (b.pos || 99) || porN[b.n].total - porN[a.n].total || a.n - b.n;
    }).map(function (t) { return { t: t, r: porN[t.n], posPts: ordemPts.indexOf(t.n) + 1 }; });
    var comProducao = (d.producao || []).some(function (r) { return dia10(r.dia) === dia && +r.pecas > 0; });
    return { turno: turno, rot: R().TURNOS[turno].rot, linhas: linhas, temDados: comProducao };
  });
}
function acumuladoDosDias(d) {
  var placares = [];
  R().DIAS.forEach(function (x) {
    if (!temAtividade(d, x[0])) return;
    Object.keys(R().TURNOS).forEach(function (turno) { placares.push(calcularDia(d, x[0], turno).p); });
  });
  return R().acumulado(placares);
}

/* ---------- HTML (puro) ---------- */
function presencaMap(cadastro, dia) {
  var m = {};
  (cadastro || []).forEach(function (r) { m[r.usuario_wms] = r.presenca && r.presenca[dia] || ''; });
  return m;
}
var ROT_PRES = { P: 'Presente', A: 'Atraso', F: 'Falta' };
function cardTimeHtml(L, dia, pres) {
  var t = L.t, r = L.r, meta = t.meta || 1, pct = Math.min(100, t.total / meta * 100);
  var linhasPts = [
    ['Produtividade', r.produtividade], ['Meta batida', r.metaBatida], ['Assiduidade', r.assiduidade],
    ['Desafios', r.desafios], ['Vistoria', r.segQual], ['Destaque', r.destaque], ['Ajustes', r.ajustes]
  ].map(function (x) {
    return '<li class="' + (x[1] ? (x[1] < 0 ? 'neg' : '') : 'zero') + '"><span>' + x[0] + '</span><b>' + (x[1] > 0 && x[0] !== 'Produtividade' ? '+' : '') + fmt(x[1]) + '</b></li>';
  }).join('');
  var topValor = t.lista.reduce(function (a, m) { return m.valor > a ? m.valor : a; }, 0);
  var membros = t.lista.map(function (m) {
    var p = pres[m.usuario] || '';
    return '<li class="' + (m.vago ? 'vago' : '') + '"><span class="nm">' + esc(m.vago ? 'Novato (vaga)' : (m.nome || m.usuario)) +
      (p ? ' <i class="pr pr-' + p + '" title="' + ROT_PRES[p] + '">' + p + '</i>' : '') +
      (topValor > 0 && m.valor === topValor ? ' <i class="dest" title="Destaque do turno">★</i>' : '') +
      '</span><b>' + fmt(m.valor) + '</b></li>';
  }).join('');
  return '<article class="cmp-card' + (t.pos === 1 && t.total > 0 ? ' lider' : '') + '" data-flip="time-' + t.n + '" style="--tc:' + esc(t.cor) + '">' +
    '<header><span class="pos">' + (t.pos || '–') + 'º</span><h4>Time ' + esc(t.nome) + '</h4>' +
    (r.metaBatida ? '<span class="sel">Meta batida</span>' : '') + '</header>' +
    '<div class="cmp-pecas"><b>' + fmt(t.total) + '</b><span>/ ' + fmt(t.meta) + ' peças</span><em>' + Math.round(t.total / meta * 100) + '%</em></div>' +
    '<div class="cmp-barra"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<div class="cmp-pts"><div class="tot"><span>Pontos do dia</span><b>' + fmt(r.total) + '</b><small>' + L.posPts + 'º em pontos</small></div><ul>' + linhasPts + '</ul></div>' +
    '<p class="cmp-sub">Operadores · ' + t.lista.filter(function (m) { return !m.vago; }).length + ' no time</p>' +
    '<ol class="cmp-membros">' + (membros || '<li class="vago"><span class="nm">Sem membros</span></li>') + '</ol></article>';
}
function blocoHtml(b, dia, pres) {
  if (!b.linhas.length) return '<section class="cmp-bloco"><p class="cmp-faixa">' + esc(b.rot) + '</p><div class="cmp-vazio">Os times deste turno ainda não foram montados.</div></section>';
  return '<section class="cmp-bloco"><p class="cmp-faixa">' + esc(b.rot) + (b.temDados ? '' : ' · sem produção em ' + ddmm(dia)) + '</p><div class="cmp-linha">' +
    b.linhas.map(function (L) { return cardTimeHtml(L, dia, pres); }).join('') + '</div></section>';
}
function acumuladoHtml(acc, d) {
  var ns = Object.keys(acc);
  if (!ns.length) return '<div class="cmp-vazio">O acumulado começa no primeiro dia da Black (27/11) com produção, presença ou lançamentos.</div>';
  var tab = R().GRUPOS.map(function (G) {
    var linhas = G.times.filter(function (n) { return acc[n]; }).map(function (n) { return acc[n]; }).sort(function (a, b) { return b.total - a.total || a.n - b.n; });
    if (!linhas.length) return '';
    return '<table class="cmp-acc"><caption>' + esc(G.rot) + '</caption><thead><tr><th>#</th><th>Time</th><th>Dias</th><th>Trinca Perfeita</th><th>Pontos</th></tr></thead><tbody>' +
      linhas.map(function (a, i) {
        var T = R().TIMES[a.n];
        return '<tr><td>' + (i + 1) + 'º</td><td><span class="bola" style="background:' + esc(T.cor) + '"></span>Time ' + esc(T.nome) + '</td><td>' + a.dias + '</td><td>' + (a.trinca ? '+' + a.trinca : '—') + '</td><td><b>' + fmt(a.total) + '</b></td></tr>';
      }).join('') + '</tbody></table>';
  }).join('');
  return '<div class="cmp-acc-grade">' + tab + '</div><p class="cmp-nota">Soma dos dias da Black com atividade. Trinca Perfeita: +' + R().P.trincaPerfeita + ' para o time com 100% de presença nos 3 dias.</p>';
}

/* ---------- tela ---------- */
var CSS = [
  '.cmp-filtros{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:10px 0 18px}',
  '.cmp-filtros label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-right:6px}',
  '.cmp-filtros select{background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}',
  '.cmp-faixa{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-label);font-weight:700;margin:22px 0 10px}',
  '.cmp-linha{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
  '@media(max-width:1100px){.cmp-linha{grid-template-columns:1fr}}',
  '.cmp-card{background:var(--bg-card);border:1px solid var(--border);border-top:4px solid var(--tc);border-radius:12px;padding:14px 16px;position:relative}',
  '.cmp-card.lider{box-shadow:0 0 0 1px var(--tc),0 6px 22px rgba(0,0,0,.28)}',
  '.cmp-card header{display:flex;align-items:center;gap:10px}',
  '.cmp-card h4{margin:0;font-size:16px;flex:1}',
  '.cmp-card .pos{font-size:22px;font-weight:800;color:var(--tc)}',
  '.cmp-card .sel{font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--olive-soft);color:var(--olive);border:1px solid var(--olive)}',
  '.cmp-pecas{display:flex;align-items:baseline;gap:8px;margin-top:10px}',
  '.cmp-pecas b{font-size:26px;font-weight:700}.cmp-pecas span{font-size:12.5px;color:var(--text-muted)}.cmp-pecas em{margin-left:auto;font-style:normal;font-weight:700;color:var(--tc)}',
  '.cmp-barra{height:8px;border-radius:99px;background:var(--bg-input);overflow:hidden;margin-top:6px}',
  '.cmp-barra i{display:block;height:100%;background:var(--tc);border-radius:99px;transition:width .9s cubic-bezier(.22,.8,.26,1)}',
  '.cmp-pts{display:grid;grid-template-columns:auto 1fr;gap:14px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}',
  '.cmp-pts .tot{display:flex;flex-direction:column;gap:2px}.cmp-pts .tot span{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em}',
  '.cmp-pts .tot b{font-size:28px;font-weight:700;line-height:1.05}.cmp-pts .tot small{font-size:11.5px;color:var(--text-muted)}',
  '.cmp-pts ul,.cmp-membros{list-style:none;margin:0;padding:0}',
  '.cmp-pts li{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0;gap:10px}.cmp-pts li.zero{color:var(--text-muted)}.cmp-pts li.neg b{color:var(--red)}',
  '.cmp-sub{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:14px 0 4px;font-weight:700}',
  '.cmp-membros li{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)}.cmp-membros li:last-child{border-bottom:0}',
  '.cmp-membros li.vago{color:var(--text-muted);font-style:italic}',
  '.cmp-membros .pr{font-style:normal;font-size:10px;font-weight:700;padding:1px 5px;border-radius:5px;margin-left:4px}',
  '.pr-P{background:var(--olive-soft);color:var(--olive)}.pr-A{background:var(--amber-soft);color:var(--amber)}.pr-F{background:var(--red-soft);color:var(--red)}',
  '.cmp-membros .dest{font-style:normal;color:var(--amber)}',
  '.cmp-vazio{border:1px dashed var(--border);border-radius:12px;padding:22px;color:var(--text-muted);text-align:center;font-size:13px}',
  '.cmp-erro{border:1px solid var(--amber);background:var(--amber-soft);color:var(--text);border-radius:12px;padding:16px;font-size:13px}',
  '.cmp-acc-grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media(max-width:1100px){.cmp-acc-grade{grid-template-columns:1fr}}',
  '.cmp-acc{width:100%;border-collapse:collapse;font-size:13px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px}',
  '.cmp-acc caption{caption-side:top;text-align:left;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-label);font-weight:700;padding:0 0 6px}',
  '.cmp-acc th,.cmp-acc td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--border)}.cmp-acc th{font-size:11px;color:var(--text-muted);text-transform:uppercase}',
  '.cmp-acc .bola{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}',
  '.cmp-nota{font-size:11.5px;color:var(--text-muted);margin:8px 0 0}',
  '.cmp-card.comp-flip{z-index:3}'
].join('\n');
function injetarCss() {
  if (typeof document === 'undefined' || document.getElementById('cmpCss')) return;
  var s = document.createElement('style'); s.id = 'cmpCss'; s.textContent = CSS; document.head.appendChild(s);
}

// Transição de posição (FLIP, 0,9 s): só com os mesmos filtros (dado novo chegando).
function flipGuardar(raiz) {
  var pos = {};
  if (raiz) raiz.querySelectorAll('[data-flip]').forEach(function (el) { var r = el.getBoundingClientRect(); pos[el.getAttribute('data-flip')] = [r.left, r.top]; });
  return pos;
}
function flipAnimar(raiz, antes) {
  if (!raiz || (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  raiz.querySelectorAll('[data-flip]').forEach(function (el) {
    var a = antes[el.getAttribute('data-flip')]; if (!a) return;
    var r = el.getBoundingClientRect(), dx = a[0] - r.left, dy = a[1] - r.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    el.classList.add('comp-flip');
    el.style.transition = 'none'; el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.style.transition = 'transform .9s cubic-bezier(.22,.8,.26,1)'; el.style.transform = '';
      setTimeout(function () { el.style.transition = ''; el.classList.remove('comp-flip'); }, 950);
    }); });
  });
}

var S = { sb: null, raiz: null, dados: null, dia: null, turno: 'ambos', assinatura: '', timer: null };

function estrutura() {
  return '<div class="kicker">Competição Black · DISTR</div>' +
    '<div class="cmp-filtros"><div><label for="cmpDia">Dia</label><select id="cmpDia"></select></div>' +
    '<div class="seg-toggle" id="cmpTurno"><button type="button" class="seg-btn" data-turno="ambos">Os dois turnos</button>' +
    '<button type="button" class="seg-btn" data-turno="1º Turno">1º Turno</button><button type="button" class="seg-btn" data-turno="2º Turno">2º Turno</button></div></div>' +
    '<div id="cmpRes"><div class="loading-msg">Carregando…</div></div>' +
    '<div class="section-title" style="margin-top:28px">Acumulado dos 3 dias</div><div id="cmpAcc"></div>';
}
function desenhar() {
  var res = S.raiz && S.raiz.querySelector('#cmpRes'); if (!res || !S.dados) return;
  var d = S.dados, assin = S.dia + '|' + S.turno, animar = assin === S.assinatura, antes = animar ? flipGuardar(res) : {};
  S.assinatura = assin;
  var pres = presencaMap(d.cadastro, S.dia), blocos = montarBlocos(d, S.dia, S.turno);
  res.innerHTML = d.cadastro.length ? blocos.map(function (b) { return blocoHtml(b, S.dia, pres); }).join('')
    : '<div class="cmp-vazio">Nenhum time montado ainda. Monte em Admin &gt; Abastecimento &gt; Competição.</div>';
  S.raiz.querySelector('#cmpAcc').innerHTML = acumuladoHtml(acumuladoDosDias(d), d);
  if (animar) flipAnimar(res, antes);
  S.raiz.querySelectorAll('#cmpTurno .seg-btn').forEach(function (b) { b.classList.toggle('ativo', b.getAttribute('data-turno') === S.turno); });
}
function preencherDias() {
  var sel = S.raiz.querySelector('#cmpDia'), dias = diasDisponiveis(S.dados);
  if (!S.dia || dias.indexOf(S.dia) === -1) S.dia = diaPadrao(dias, S.dados.hoje);
  var preto = {}; R().DIAS.forEach(function (x) { preto[x[0]] = x[2]; });
  sel.innerHTML = dias.map(function (x) { return '<option value="' + x + '">' + ddmm(x) + (preto[x] ? ' · ' + esc(preto[x]) : '') + '</option>'; }).join('');
  sel.value = S.dia;
}
async function recarregar() {
  try {
    S.dados = await carregarDados(S.sb);
    preencherDias(); desenhar();
    if (global.atualizarSubtituloSecao) global.atualizarSubtituloSecao('competicao');
  } catch (e) {
    var el = S.raiz.querySelector('#cmpRes');
    el.innerHTML = '<div class="cmp-erro">' + esc(tabelaInexistente(e) ? MSG_TABELAS : 'Erro ao carregar a competição: ' + (e && e.message || e)) + '</div>';
    S.raiz.querySelector('#cmpAcc').innerHTML = '';
  }
}
async function iniciar(rootId, sb) {
  S.raiz = document.getElementById(rootId); S.sb = sb; if (!S.raiz) return;
  injetarCss();
  S.raiz.innerHTML = estrutura();
  S.raiz.querySelector('#cmpDia').addEventListener('change', function (e) { S.dia = e.target.value; desenhar(); });
  S.raiz.querySelectorAll('#cmpTurno .seg-btn').forEach(function (b) { b.addEventListener('click', function () { S.turno = b.getAttribute('data-turno'); desenhar(); }); });
  await recarregar();
  S.timer = setInterval(function () { if (S.raiz.offsetParent !== null) recarregar(); }, 60000);
}
function aoMostrar() { if (S.dados && Date.now() - S.dados.lidoEm > 30000) recarregar(); }
function dataSnapshot() { return S.dados ? S.dados.snap : null; }

var api = {
  iniciar: iniciar, aoMostrar: aoMostrar, dataSnapshot: dataSnapshot, carregarDados: carregarDados, recarregar: recarregar,
  tabelaInexistente: tabelaInexistente, MSG_TABELAS: MSG_TABELAS, _lerTudo: lerTudo,
  temAtividade: temAtividade, diasDisponiveis: diasDisponiveis, diaPadrao: diaPadrao, calcularDia: calcularDia,
  montarBlocos: montarBlocos, acumuladoDosDias: acumuladoDosDias, cardTimeHtml: cardTimeHtml, blocoHtml: blocoHtml, acumuladoHtml: acumuladoHtml,
  presencaMap: presencaMap, esc: esc, fmt: fmt, ddmm: ddmm, somaDias: somaDias
};
global.Competicao = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

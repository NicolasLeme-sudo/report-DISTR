/* =========================================================================
   INGEST-COMPETICAO.JS — Admin da competição Black da DISTR
   Cards "Times da competição" e "Pontos da competição" (Admin > Abastecimento).
   Só admin grava (RLS). Parser de planilha, casamento de nomes e montagem da
   extração são puros e ficam no fim (api) para o teste em node.
   ========================================================================= */
(function (global) {
'use strict';

var R = function () { return global.RegrasBlack; };
var C = function () { return global.Competicao; };

/* ---------- nomes ---------- */
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
var CONECTIVOS = ['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'];
function tokens(s) { return norm(s).split(' ').filter(Boolean); }
function sigTokens(s) { return tokens(s).filter(function (t) { return t.length > 2 && CONECTIVOS.indexOf(t) === -1; }); }
function turnoBanco(turno) { return turno === '2º Turno' ? 'T02' : 'T01'; }

// colabs = [{ login, nome, turno }] (dim_colaboradores_turno). Devolve { tipo: exato|aproximado|ambiguo|nao, login, nomeBase, candidatos }.
function casarNome(nome, colabs, turno) {
  var n = norm(nome), pref = turno ? turnoBanco(turno) : null;
  function escolher(lista) {
    if (lista.length === 1) return lista[0];
    var doTurno = pref ? lista.filter(function (c) { return c.turno === pref; }) : [];
    return doTurno.length === 1 ? doTurno[0] : null;
  }
  var exatos = (colabs || []).filter(function (c) { return norm(c.nome) === n; });
  if (exatos.length) {
    var e = escolher(exatos);
    return e ? { tipo: 'exato', login: e.login, nomeBase: e.nome } : { tipo: 'ambiguo', candidatos: exatos };
  }
  var tk = sigTokens(nome), pontuados = [];
  (colabs || []).forEach(function (c) {
    var ct = tokens(c.nome);
    if (!tk.length || ct[0] !== tk[0]) return;
    var score = tk.filter(function (t) { return ct.indexOf(t) !== -1; }).length;
    if (score >= 2 && score >= tk.length - 1) pontuados.push({ c: c, score: score });
  });
  if (!pontuados.length) return { tipo: 'nao' };
  var topo = pontuados.reduce(function (a, x) { return x.score > a ? x.score : a; }, 0);
  var melhores = pontuados.filter(function (x) { return x.score === topo; }).map(function (x) { return x.c; });
  var a = escolher(melhores);
  return a ? { tipo: 'aproximado', login: a.login, nomeBase: a.nome } : { tipo: 'ambiguo', candidatos: melhores };
}

/* ---------- planilha ---------- */
function turnoDaAba(nome) {
  var s = norm(nome);
  if (/^T ?0?1$|^1 ?(O|TURNO)/.test(s) || /^1 TURNO/.test(s)) return '1º Turno';
  if (/^T ?0?2$|^2 ?(O|TURNO)/.test(s) || /^2 TURNO/.test(s)) return '2º Turno';
  return null;
}
function turnoDoTexto(v, time) {
  var s = norm(v);
  if (/(^| )1( |$)|T 0?1|1 O/.test(s) || /^T01$/.test(s)) return '1º Turno';
  if (/(^| )2( |$)|T 0?2|2 O/.test(s) || /^T02$/.test(s)) return '2º Turno';
  return time <= 3 ? '1º Turno' : '2º Turno';
}
// Formato "Black": uma aba por turno (T01, T2), colunas "Equipe 01/02/03" só com nomes; "NOVATO" = vaga sem nome;
// a coluna Apoio e a linha "3k" (meta) ficam de fora. abas = [{ nome, linhas: [[célula, ...], ...] }].
function parseEscalacaoBlack(abas) {
  var out = [];
  (abas || []).forEach(function (aba) {
    var turno = turnoDaAba(aba.nome), L = aba.linhas || [];
    if (!turno) return;
    var cab = -1, cols = {};
    for (var i = 0; i < L.length && cab < 0; i++) {
      (L[i] || []).forEach(function (c, j) { var m = /^\s*equipe\s*0?(\d)\s*$/i.exec(String(c == null ? '' : c)); if (m) cols[j] = +m[1]; });
      if (Object.keys(cols).length) cab = i;
    }
    if (cab < 0) return;
    Object.keys(cols).forEach(function (j) {
      for (var r = cab + 1; r < L.length; r++) {
        var v = String((L[r] || [])[j] == null ? '' : (L[r] || [])[j]).trim();
        if (!v || /^\d+\s*k$/i.test(v)) break;
        var novato = /^novato/i.test(v);
        out.push({ turno: turno, equipe: cols[j], time: (turno === '2º Turno' ? 3 : 0) + cols[j], nome: novato ? null : v, novato: novato });
      }
    });
  });
  return out;
}
// A cor se repete nos dois turnos (Vermelho no time 1 e no 4...): a aba leva o turno ("Vermelho T01"); sem turno, só vale se a cor for única.
function timeDaAba(nome) {
  var s = norm(nome), mt = /\s*\bT0?([12])\b\s*$/.exec(s), turno = mt ? (mt[1] === '1' ? '1º Turno' : '2º Turno') : null;
  if (mt) s = s.slice(0, mt.index).trim();
  var achou = [];
  Object.keys(R().TIMES).forEach(function (n) { if (norm(R().TIMES[n].nome) === s && (!turno || R().TIMES[n].turno === turno)) achou.push(+n); });
  if (achou.length === 1) return achou[0];
  if (achou.length) return null;
  var m = /^(TIME|EQUIPE)? ?([1-6])$/.exec(s);
  return m ? +m[2] : null;
}
// Formato "por times": uma aba por cor (Laranja…Roxo) ou "Time 1…6"; colunas Nome, Usuário WMS, Turno, Observação, Líder, 27/11, 28/11, 29/11.
function parsePlanilhaPorTimes(abas) {
  var out = [], dias = R().DIAS;
  (abas || []).forEach(function (aba) {
    var time = timeDaAba(aba.nome), L = aba.linhas || [];
    if (!time) return;
    var cab = -1, col = {};
    for (var i = 0; i < L.length && cab < 0; i++) {
      var tmp = {};
      (L[i] || []).forEach(function (c, j) {
        var s = norm(c);
        if (s === 'NOME') tmp.nome = j; else if (/^USUARIO/.test(s)) tmp.usu = j; else if (s === 'TURNO') tmp.turno = j;
        else if (/^OBS/.test(s)) tmp.obs = j; else if (/^LIDER/.test(s)) tmp.lider = j;
        dias.forEach(function (d) { if (String(c).trim() === d[1]) tmp['d' + d[0]] = j; });
      });
      if (tmp.nome != null || tmp.usu != null) { col = tmp; cab = i; }
    }
    if (cab < 0) return;
    for (var r = cab + 1; r < L.length; r++) {
      var row = L[r] || [], get = function (k) { return col[k] == null ? '' : String(row[col[k]] == null ? '' : row[col[k]]).trim(); };
      var nome = get('nome'), usu = get('usu').toUpperCase();
      if (!nome && !usu) continue;
      var pres = {};
      dias.forEach(function (d) { var v = get('d' + d[0]).toUpperCase(); if (/^[PFA]$/.test(v)) pres[d[0]] = v; });
      out.push({ turno: turnoDoTexto(get('turno'), time), time: time, nome: nome || null, usuario_wms: usu || null, novato: /^NOVATO/.test(usu), observacao: get('obs') || null, lider: /^(S|SIM|X|1|TRUE)$/i.test(get('lider')), presenca: pres });
    }
  });
  return out;
}
function formatoDaPlanilha(abas) {
  return (abas || []).some(function (a) { return turnoDaAba(a.nome) && (a.linhas || []).some(function (l) { return (l || []).some(function (c) { return /^\s*equipe\s*0?\d\s*$/i.test(String(c == null ? '' : c)); }); }); }) ? 'black' : 'times';
}
// Abas para "Exportar times atuais" (formato por times; volta pelo parsePlanilhaPorTimes).
function abasExportacao(cadastro) {
  var dias = R().DIAS;
  return R().ATIVOS.map(function (n) {
    var linhas = [['Nome', 'Usuário WMS', 'Turno', 'Observação', 'Líder'].concat(dias.map(function (d) { return d[1]; }))];
    (cadastro || []).filter(function (r) { return r.time === n; }).forEach(function (r) {
      linhas.push([r.nome || '', r.usuario_wms, r.turno, r.observacao || '', r.lider ? 'S' : ''].concat(dias.map(function (d) { return r.presenca && r.presenca[d[0]] || ''; })));
    });
    return { nome: R().TIMES[n].nome + ' ' + (R().TIMES[n].turno === '1º Turno' ? 'T01' : 'T02'), linhas: linhas };
  });
}

/* ---------- escalação: vira linhas do banco ---------- */
// itens = linhas parseadas; res = { 'turno|time|idx': { login } } com o EX achado/digitado. Devolve payloads de competicao_times.
function montarLinhasBanco(itens, resolvidos, existentes) {
  var cont = {}, porUsu = {};
  (existentes || []).forEach(function (r) { porUsu[r.usuario_wms] = r; });
  return itens.map(function (it, i) {
    var k = (cont[it.time] = (cont[it.time] || 0) + 1), login = it.usuario_wms || (resolvidos && resolvidos[i]) || '';
    if (it.novato) login = 'NOVATO.' + it.time + '.' + k;
    else if (!login) login = 'SEMUSU.' + it.time + '.' + k;
    var antiga = porUsu[login];
    return {
      usuario_wms: login, nome: it.nome, turno: it.turno, time: it.time,
      observacao: it.observacao != null ? it.observacao : (it.novato ? 'novato, sem nome ainda' : (/^SEMUSU\./.test(login) ? 'sem usuário GCI: informar o EX' : (antiga ? antiga.observacao || null : null))),
      lider: !!it.lider,
      presenca: Object.keys(it.presenca || {}).length ? it.presenca : (antiga && antiga.presenca) || {}
    };
  });
}

/* ---------- extração (.xlsx) ---------- */
function montarExtracao(d, dias) {
  var Rg = R(), Cm = C();
  var times = [['Dia', 'Turno', 'Time', 'Peças', 'Meta', 'Produtividade', 'Meta batida', 'Assiduidade', 'Desafios', 'Vistoria', 'Destaque', 'Ajustes', 'Total do dia']];
  var colab = [['Dia', 'Turno', 'Time', 'Usuário', 'Nome', 'Peças', 'Presença']];
  var placares = [];
  dias.forEach(function (dia) {
    Object.keys(Rg.TURNOS).forEach(function (turno) {
      var x = Cm.calcularDia(d, dia, turno); placares.push(x.p);
      var pres = Cm.presencaMap(d.cadastro, dia);
      x.p.linhas.forEach(function (r) {
        times.push([dia, turno, 'Time ' + Rg.TIMES[r.n].nome, r.pecas, r.meta, r.produtividade, r.metaBatida, r.assiduidade, r.desafios, r.segQual, r.destaque, r.ajustes, r.total]);
        (x.c.times[r.n - 1].lista || []).forEach(function (m) { colab.push([dia, turno, 'Time ' + Rg.TIMES[r.n].nome, m.usuario, m.nome, m.pecas, pres[m.usuario] || '']); });
      });
    });
  });
  var acc = Rg.acumulado(placares), acum = [['Time', 'Turno', 'Dias', 'Trinca Perfeita', 'Pontos acumulados']];
  Object.keys(acc).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) { acum.push(['Time ' + Rg.TIMES[n].nome, Rg.turnoDoTime(n), acc[n].dias, acc[n].trinca, acc[n].total]); });
  var lanc = [['Dia', 'Turno', 'Time', 'Categoria', 'Item', 'Pontos', 'Motivo', 'Lançado por', 'Quando']];
  (d.lanc || []).slice().sort(function (a, b) { return String(a.criado_em).localeCompare(String(b.criado_em)); }).forEach(function (l) {
    lanc.push([String(l.dia).slice(0, 10), l.turno, 'Time ' + (Rg.TIMES[l.time] || {}).nome, l.categoria, l.item || '', l.pontos, l.motivo || '', l.registrado_email || '', l.criado_em]);
  });
  return [{ nome: 'Times', linhas: times }, { nome: 'Acumulado', linhas: acum }, { nome: 'Colaboradores', linhas: colab }, { nome: 'Lançamentos', linhas: lanc }];
}

/* ---------- interface ---------- */
var CSS = [
  '.cmpad-aviso{font-size:12.5px;padding:10px 12px;border-radius:10px;border:1px solid var(--amber);background:var(--amber-soft);margin-bottom:12px}',
  '.cmpad-grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:10px 0}@media(max-width:1500px){.cmpad-grade{grid-template-columns:1fr}}',
  '.cmpad-time{border:1px solid var(--border);border-top:4px solid var(--tc);border-radius:10px;padding:10px;background:var(--bg-input)}',
  '.cmpad-time h5{margin:0 0 8px;font-size:13px}.cmpad-time h5 small{color:var(--text-muted);font-weight:400}',
  '.cmpad-time table{width:100%;border-collapse:collapse;font-size:12px}.cmpad-time td{padding:2px 3px;vertical-align:middle}',
  '.cmpad-time input[type=text],.cmpad-time select,.cmpad-f input,.cmpad-f select,.cmpad-f textarea{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;font-size:12px;width:100%;box-sizing:border-box}',
  '.cmpad-time td.pr select{width:46px;padding:4px 2px}.cmpad-time .rm{background:none;border:0;color:var(--red);cursor:pointer;font-size:14px}',
  '.cmpad-time .nov input{font-style:italic}',
  '.cmpad-th{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
  '.cmpad-barra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}',
  '.cmpad-prev{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}.cmpad-prev th,.cmpad-prev td{border-bottom:1px solid var(--border);padding:5px 6px;text-align:left}',
  '.cmpad-prev .ok{color:var(--olive)}.cmpad-prev .ap{color:var(--amber)}.cmpad-prev .no{color:var(--red)}',
  '.cmpad-f{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin:10px 0;align-items:end}.cmpad-f label{display:block;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}',
  '.cmpad-chk{border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:8px 0;max-height:260px;overflow:auto;background:var(--bg-input)}',
  '.cmpad-chk label{display:flex;gap:8px;font-size:12.5px;padding:2px 0;align-items:center}.cmpad-chk b{margin-left:auto;color:var(--red)}.ptsQtdBox{margin-left:auto;font-size:11px;color:var(--text-label);white-space:nowrap}.ptsQtdBox+b{margin-left:12px;min-width:34px;text-align:right}.cmpad-times{display:flex;gap:14px;flex-wrap:wrap;padding:4px 0}.cmpad-tm{display:flex;gap:6px;align-items:center;font-size:12.5px}.ptsQtd{width:46px;padding:2px 4px;font-size:12px}',
  '.cmpad-hist{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}.cmpad-hist th,.cmpad-hist td{border-bottom:1px solid var(--border);padding:5px 6px;text-align:left}.cmpad-hist .neg{color:var(--red)}'
].join('\n');

var A = { sb: null, raiz: null, dados: null, linhas: [], colabs: null, prev: null, ligado: false, cat: 'vistoria' };
function esc(s) { return global.Competicao.esc(s); }
function $(id) { return A.raiz.querySelector('#' + id); }
function msg(id, texto, tipo) { var el = $(id); if (!el) return; el.className = tipo === 'ok' ? 'aviso ok' : tipo === 'erro' ? 'cmpad-aviso' : ''; el.style.display = texto ? '' : 'none'; el.textContent = texto || ''; }
function log(id, t) { var el = $(id); if (el) el.textContent = t; }

function esqueleto() {
  var T = R().TIMES;
  return '<div class="admin-grupo">Competição Black</div>' +
    '<div class="section-title" style="margin-top:24px">Times da competição</div>' +
    '<div class="card"><div id="cadMsg"></div><div class="cmpad-grade" id="cadGrade"></div>' +
    '<div class="cmpad-barra"><button class="btn-mini" id="cadSalvar">Salvar alterações</button>' +
    '<button class="btn-mini" id="cadExportar">⬇ Exportar times atuais</button></div>' +
    '<div class="dropzone" id="cadDrop" style="margin-top:14px"><span id="cadDropTexto">Clique para selecionar a <strong>planilha da escalação</strong> (.xlsx: abas T01/T2 com Equipe 01–03, ou uma aba por cor)</span><input type="file" id="cadArquivo" accept=".xlsx" style="display:none"></div>' +
    '<div id="cadPrev"></div><div class="aviso ok" id="cadOk" style="display:none;margin-top:10px"></div><div class="log" id="cadLog"></div></div>' +
    '<div class="section-title" style="margin-top:24px">Pontos da competição</div>' +
    '<div class="card"><div id="ptsMsg"></div>' +
    '<div class="cmpad-f"><div><label>Dia</label><select id="ptsDia"></select></div><div><label>Turno</label><select id="ptsTurno"><option>1º Turno</option><option>2º Turno</option></select></div>' +
    '<div><label>Lançar</label><div class="seg-toggle" id="ptsCat"><button type="button" class="seg-btn ativo" data-cat="vistoria">Vistoria</button><button type="button" class="seg-btn" data-cat="desafio">Desafio</button><button type="button" class="seg-btn" data-cat="gincana">Gincana</button><button type="button" class="seg-btn" data-cat="ajuste">Ajuste</button></div></div></div>' +
    '<div id="ptsForm"></div><div class="aviso ok" id="ptsOk" style="display:none;margin-top:10px"></div>' +
    '<div class="cmpad-barra"><button class="btn-mini" id="ptsExtrair">⬇ Extrair Descontos e Adições</button></div>' +
    '<div id="ptsHist"></div></div>';
}

/* --- times --- */
function payloadLinha(x) { return { usuario_wms: String(x.usuario_wms || '').trim().toUpperCase(), nome: x.nome || null, turno: x.time <= 3 ? '1º Turno' : '2º Turno', time: x.time, observacao: x.observacao || null, lider: !!x.lider, presenca: x.presenca || {} }; }
function pagLinhas(cad) { return cad.map(function (r) { var x = { id: r.id, usuario_wms: r.usuario_wms, nome: r.nome, time: r.time, observacao: r.observacao, lider: r.lider, presenca: Object.assign({}, r.presenca || {}) }; x._orig = JSON.stringify(payloadLinha(x)); return x; }); }
function desenharTimes() {
  var T = R().TIMES, dias = R().DIAS;
  $('cadGrade').innerHTML = R().ATIVOS.map(function (n) {
    var linhas = A.linhas.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x.time === n && !o.x._rm; });
    return '<div class="cmpad-time" style="--tc:' + esc(T[n].cor) + '" data-time="' + n + '"><h5>Time ' + esc(T[n].nome) + ' <small>· ' + T[n].turno + '</small></h5><table><tr class="cmpad-th"><td>Usuário (EX)</td><td>Nome</td>' +
      dias.map(function (d) { return '<td>' + d[1] + '</td>'; }).join('') + '<td></td></tr>' +
      linhas.map(function (o) {
        var vago = /^NOVATO\./.test(o.x.usuario_wms);
        return '<tr data-i="' + o.i + '" class="' + (vago ? 'nov' : '') + '"><td><input type="text" class="f-usu" value="' + esc(o.x.usuario_wms) + '"></td><td><input type="text" class="f-nome" value="' + esc(o.x.nome || '') + '" placeholder="' + (vago ? 'nome do novato' : '') + '"></td>' +
          dias.map(function (d) { var v = o.x.presenca[d[0]] || ''; return '<td class="pr"><select class="f-pr" data-dia="' + d[0] + '">' + ['', 'P', 'A', 'F'].map(function (p) { return '<option' + (p === v ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></td>'; }).join('') +
          '<td><button class="rm" title="Remover" type="button">✕</button></td></tr>';
      }).join('') + '</table><button class="btn-mini add" type="button" style="margin-top:6px">+ pessoa</button></div>';
  }).join('');
}
function ligarTimes() {
  var grade = $('cadGrade');
  grade.addEventListener('input', function (e) { var tr = e.target.closest('tr[data-i]'); if (!tr) return; var x = A.linhas[+tr.dataset.i]; if (e.target.classList.contains('f-usu')) x.usuario_wms = e.target.value; else if (e.target.classList.contains('f-nome')) x.nome = e.target.value; });
  grade.addEventListener('change', function (e) { var tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.classList.contains('f-pr')) return; var x = A.linhas[+tr.dataset.i], v = e.target.value; if (v) x.presenca[e.target.dataset.dia] = v; else delete x.presenca[e.target.dataset.dia]; });
  grade.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]');
    if (tr && e.target.classList.contains('rm')) { A.linhas[+tr.dataset.i]._rm = true; desenharTimes(); return; }
    if (e.target.classList.contains('add')) { var n = +e.target.closest('[data-time]').dataset.time; A.linhas.push({ usuario_wms: '', nome: '', time: n, observacao: null, lider: false, presenca: {}, _orig: null }); desenharTimes(); }
  });
  $('cadSalvar').addEventListener('click', salvarTimes);
  $('cadExportar').addEventListener('click', exportarTimes);
  var drop = $('cadDrop'), inp = $('cadArquivo');
  drop.addEventListener('click', function () { inp.click(); });
  inp.addEventListener('change', function () { if (inp.files[0]) lerPlanilha(inp.files[0]); inp.value = ''; });
}
async function salvarTimes() {
  msg('cadOk', '');
  var vis = A.linhas.filter(function (x) { return !x._rm; }), vistos = {};
  for (var i = 0; i < vis.length; i++) {
    var u = payloadLinha(vis[i]).usuario_wms;
    if (!u) { msg('cadMsg', 'Há pessoa sem usuário (EX). Preencha ou remova antes de salvar.', 'erro'); return; }
    if (vistos[u]) { msg('cadMsg', 'Usuário repetido: ' + u, 'erro'); return; }
    vistos[u] = 1;
  }
  var apagar = A.linhas.filter(function (x) { return x._rm && x.id; }).map(function (x) { return x.id; });
  var atualizar = vis.filter(function (x) { return x.id && JSON.stringify(payloadLinha(x)) !== x._orig; });
  var inserir = vis.filter(function (x) { return !x.id; });
  try {
    if (apagar.length) { var d = await A.sb.from('competicao_times').delete().in('id', apagar); if (d.error) throw d.error; }
    for (var k = 0; k < atualizar.length; k++) { var u2 = await A.sb.from('competicao_times').update(Object.assign(payloadLinha(atualizar[k]), { atualizado_em: new Date().toISOString() })).eq('id', atualizar[k].id); if (u2.error) throw u2.error; }
    if (inserir.length) { var ins = await A.sb.from('competicao_times').insert(inserir.map(payloadLinha)); if (ins.error) throw ins.error; }
    msg('cadMsg', ''); msg('cadOk', 'Times salvos: ' + inserir.length + ' novo(s), ' + atualizar.length + ' alterado(s), ' + apagar.length + ' removido(s).', 'ok');
    await recarregarTudo();
  } catch (e) { msg('cadMsg', erroAmigavel(e), 'erro'); }
}
function baixarXlsx(abas, arquivo) {
  var wb = global.XLSX.utils.book_new();
  abas.forEach(function (a) { global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.aoa_to_sheet(a.linhas), String(a.nome).slice(0, 31)); });
  global.XLSX.writeFile(wb, arquivo);
}
function exportarTimes() { baixarXlsx(abasExportacao(A.dados.cadastro), 'Times_Competicao_DISTR.xlsx'); }

async function lerPlanilha(arquivo) {
  msg('cadOk', ''); $('cadPrev').innerHTML = '';
  try {
    var wb = global.XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    var abas = wb.SheetNames.map(function (nome) { return { nome: nome, linhas: global.XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: '', raw: false }) }; });
    var formato = formatoDaPlanilha(abas), itens = formato === 'black' ? parseEscalacaoBlack(abas) : parsePlanilhaPorTimes(abas);
    if (!itens.length) { msg('cadMsg', 'Não encontrei ninguém na planilha. Use abas T01/T2 com colunas "Equipe 01/02/03" ou uma aba por cor do time.', 'erro'); return; }
    if (!A.colabs) A.colabs = await global.Competicao._lerTudo(A.sb, 'dim_colaboradores_turno', 'login, nome, turno', function (q) { return q.order('login'); });
    itens.forEach(function (it) { if (it.novato) { it.achado = { tipo: 'novato' }; } else if (it.usuario_wms) { it.achado = { tipo: 'exato', login: it.usuario_wms }; } else it.achado = casarNome(it.nome, A.colabs, it.turno); });
    A.prev = { itens: itens, formato: formato };
    desenharPrevia();
  } catch (e) { msg('cadMsg', 'Erro ao ler a planilha: ' + (e && e.message || e), 'erro'); }
}
function desenharPrevia() {
  var itens = A.prev.itens, T = R().TIMES, rot = { exato: ['ok', 'ok'], aproximado: ['ap', 'conferir'], ambiguo: ['no', 'mais de um'], nao: ['no', 'não encontrado'], novato: ['ok', 'vaga sem nome'] };
  var turnos = {}; itens.forEach(function (it) { turnos[it.turno] = 1; });
  var saem = A.dados.cadastro.filter(function (r) { return turnos[r.turno]; }).length;
  $('cadPrev').innerHTML = '<table class="cmpad-prev"><tr><th>Time</th><th>Nome na planilha</th><th>Usuário (EX)</th><th>Situação</th></tr>' + itens.map(function (it, i) {
    var a = it.achado, r = rot[a.tipo];
    var campo = a.login ? esc(a.login) + (a.tipo === 'aproximado' ? ' <small>(' + esc(a.nomeBase) + ')</small>' : '')
      : a.tipo === 'novato' ? '—' : '<input type="text" class="cmpad-usu" data-i="' + i + '" placeholder="EX000000" style="width:110px">' + (a.candidatos ? ' <small>' + a.candidatos.map(function (c) { return esc(c.login); }).join(' / ') + '</small>' : '');
    return '<tr><td>' + esc(T[it.time].nome) + '</td><td>' + esc(it.nome || 'NOVATO') + '</td><td>' + campo + '</td><td class="' + r[0] + '">' + r[1] + '</td></tr>';
  }).join('') + '</table>' +
    '<div class="cmpad-barra"><button class="btn-mini" id="cadAplicar">Aplicar escalação</button><span style="font-size:12px;color:var(--text-muted)">Atualiza quem está na planilha e remove quem sai do(s) turno(s) enviado(s) (' + saem + ' pessoa(s) hoje). Sem usuário informado, a pessoa entra como SEMUSU até você preencher o EX.</span></div>';
  $('cadPrev').querySelectorAll('.cmpad-usu').forEach(function (inp) { inp.addEventListener('input', function () { itens[+inp.dataset.i].digitado = inp.value.trim().toUpperCase(); }); });
  $('cadAplicar').addEventListener('click', aplicarEscalacao);
}
async function aplicarEscalacao() {
  var itens = A.prev.itens, res = {};
  itens.forEach(function (it, i) { if (it.achado.login) res[i] = it.achado.login; else if (it.digitado) res[i] = it.digitado; });
  var linhas = montarLinhasBanco(itens, res, A.dados.cadastro), vistos = {};
  var dup = linhas.filter(function (l) { if (vistos[l.usuario_wms]) return true; vistos[l.usuario_wms] = 1; return false; });
  if (dup.length) { msg('cadMsg', 'Usuário repetido na planilha: ' + dup[0].usuario_wms, 'erro'); return; }
  var turnos = {}; itens.forEach(function (it) { turnos[it.turno] = 1; });
  try {
    var up = await A.sb.from('competicao_times').upsert(linhas.map(function (l) { return Object.assign({}, l, { atualizado_em: new Date().toISOString() }); }), { onConflict: 'usuario_wms' });
    if (up.error) throw up.error;
    var manter = {}; linhas.forEach(function (l) { manter[l.usuario_wms] = 1; });
    var sobras = A.dados.cadastro.filter(function (r) { return turnos[r.turno] && !manter[r.usuario_wms]; }).map(function (r) { return r.id; });
    if (sobras.length) { var d = await A.sb.from('competicao_times').delete().in('id', sobras); if (d.error) throw d.error; }
    var semUsu = linhas.filter(function (l) { return /^SEMUSU\./.test(l.usuario_wms); }).length;
    $('cadPrev').innerHTML = ''; A.prev = null; msg('cadMsg', '');
    msg('cadOk', 'Escalação aplicada: ' + linhas.length + ' pessoa(s), ' + sobras.length + ' removida(s)' + (semUsu ? ', ' + semUsu + ' sem usuário (preencher o EX nos times acima)' : '') + '.', 'ok');
    await recarregarTudo();
  } catch (e) { msg('cadMsg', erroAmigavel(e), 'erro'); }
}

/* --- pontos --- */
function timesDoTurno(turno) { return R().GRUPOS.filter(function (G) { return G.turno === turno; })[0].times; }
function opcoesTime(turno) { return timesDoTurno(turno).map(function (n) { return '<option value="' + n + '">Time ' + esc(R().TIMES[n].nome) + '</option>'; }).join(''); }
function formPontos() {
  var dia = $('ptsDia').value, turno = $('ptsTurno').value, cat = A.cat, Rg = R(), h = '';
  var selTime = '<div style="grid-column:1/-1"><label>Times (marque um ou mais)</label><div class="cmpad-times">' + timesDoTurno(turno).map(function (n, k) { return '<label class="cmpad-tm"><input type="checkbox" class="ptsTm" data-n="' + n + '"' + (k === 0 ? ' checked' : '') + '> Time ' + esc(Rg.TIMES[n].nome) + '</label>'; }).join('') + '</div></div>';
  if (cat === 'vistoria') {
    var ordem = ['leve', 'media', 'grave', 'gravissima'];
    h = '<div class="cmpad-f">' + selTime + '</div><div class="cmpad-chk"><label><input type="checkbox" id="ptsLimpa"> Sem apontamentos (vistoria limpa)<b style="color:var(--olive)">+' + Rg.P.vistoriaLimpa + '</b></label>' +
      Rg.CHECKLIST.map(function (c, i) { return '<label><input type="checkbox" class="ptsItem" data-i="' + i + '"> ' + esc(c.item) + ' <small>(' + Rg.GRAVIDADES[c.grav].rot + ')</small><span class="ptsQtdBox">vezes <input type="number" class="ptsQtd" data-i="' + i + '" min="1" max="99" value="1"></span><b>' + c.pts + '</b></label>'; }).join('') + '</div>';
  } else if (cat === 'desafio') {
    var lista = (Rg.DESAFIOS[dia] || []).concat(['Outro']);
    h = '<div class="cmpad-f">' + selTime + '<div><label>Desafio</label><select id="ptsItem">' + lista.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></div><div><label>Se outro, qual</label><input type="text" id="ptsOutro"></div><div><label>Pontos</label><input type="number" id="ptsValor" value="' + Rg.PONTOS_DESAFIO + '"></div></div>';
  } else if (cat === 'gincana') {
    var gl = Rg.GINCANAS.concat(['Outra gincana']);   // as 8 gincanas da programação (qualquer dia) + Outra

    h = '<div class="cmpad-f"><div><label>Gincana</label><select id="ptsItem">' + gl.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></div><div><label>Se outra, qual</label><input type="text" id="ptsOutro"></div><div><label>Pontos para cada time marcado</label><input type="number" id="ptsValor" value="' + Rg.PONTOS_DESAFIO + '"></div></div>' +
      '<div class="cmpad-chk"><label style="font-weight:700">Quem ganha (desmarque os times que não pontuaram):</label>' + timesDoTurno(turno).map(function (n) { return '<label><input type="checkbox" class="ptsGin" data-n="' + n + '" checked> Time ' + esc(Rg.TIMES[n].nome) + '</label>'; }).join('') + '</div>';
  } else {
    h = '<div class="cmpad-f">' + selTime + '<div><label>Pontos (negativo = desconto)</label><input type="number" id="ptsValor" value="0"></div><div style="grid-column:span 2"><label>Motivo</label><input type="text" id="ptsMotivo"></div></div>';
  }
  $('ptsForm').innerHTML = h + '<button class="btn-mini" id="ptsLancar">Lançar</button>';
  $('ptsLancar').addEventListener('click', lancarPontos);
  // Mexer na quantidade já marca a infração.
  Array.prototype.forEach.call(A.raiz.querySelectorAll('.ptsQtd'), function (q) {
    q.addEventListener('input', function () { var c = q.closest('label').querySelector('.ptsItem'); if (c && (parseInt(q.value, 10) || 0) > 0) c.checked = true; });
  });
}
function montarLancamentos(cat, dia, turno, f) {   // f = valores do formulário; devolve linhas de competicao_pontos
  var Rg = R(), base = { dia: dia, turno: turno };
  var tms = f.sel && f.sel.length ? f.sel : (f.time ? [f.time] : []);   // times marcados (vistoria, desafio e ajuste)
  if (cat === 'vistoria') {
    if (f.limpa) return tms.map(function (n) { return Object.assign({}, base, { time: n, categoria: 'vistoria', item: 'Sem apontamentos', pontos: Rg.P.vistoriaLimpa, motivo: null }); });
    return [].concat.apply([], tms.map(function (n) { return (f.itens || []).map(function (i) { var c = Rg.CHECKLIST[i], q = Math.max(1, Math.min(99, parseInt((f.qtds || {})[i], 10) || 1)); return Object.assign({}, base, { time: n, categoria: 'vistoria', item: q > 1 ? c.item + ' (' + q + '×)' : c.item, pontos: c.pts * q, motivo: Rg.GRAVIDADES[c.grav].rot }); }); }));
  }
  var nome = /^Outr[oa]( gincana)?$/.test(f.item) ? (f.outro || '').trim() : f.item;
  if (cat === 'desafio') return nome && f.valor ? tms.map(function (n) { return Object.assign({}, base, { time: n, categoria: 'desafio', item: nome, pontos: f.valor, motivo: null }); }) : [];
  if (cat === 'gincana') return nome && f.valor ? (f.times || timesDoTurno(turno)).map(function (n) { return Object.assign({}, base, { time: n, categoria: 'desafio', item: 'Gincana: ' + nome, pontos: f.valor, motivo: null }); }) : [];
  return f.valor && (f.motivo || '').trim() ? tms.map(function (n) { return Object.assign({}, base, { time: n, categoria: 'ajuste', item: null, pontos: f.valor, motivo: f.motivo.trim() }); }) : [];
}
async function inserirPontos(linhas) {
  var s = await A.sb.auth.getSession(), email = s.data && s.data.session && s.data.session.user.email || null;
  var r = await A.sb.from('competicao_pontos').insert(linhas.map(function (l) { return Object.assign({}, l, { registrado_email: email }); }));
  if (r.error) throw r.error;
}
async function lancarPontos() {
  var dia = $('ptsDia').value, turno = $('ptsTurno').value, g = function (id) { var e = $(id); return e ? e.value : ''; };
  var f = { sel: Array.prototype.map.call(A.raiz.querySelectorAll('.ptsTm:checked'), function (x) { return +x.dataset.n; }), item: g('ptsItem'), outro: g('ptsOutro'), valor: parseInt(g('ptsValor'), 10) || 0, motivo: g('ptsMotivo'),
    times: Array.prototype.map.call(A.raiz.querySelectorAll('.ptsGin:checked'), function (x) { return +x.dataset.n; }),
    qtds: (function () { var o = {}; Array.prototype.forEach.call(A.raiz.querySelectorAll('.ptsQtd'), function (x) { o[x.dataset.i] = x.value; }); return o; })(),
    limpa: !!($('ptsLimpa') && $('ptsLimpa').checked), itens: Array.prototype.map.call(A.raiz.querySelectorAll('.ptsItem:checked'), function (x) { return +x.dataset.i; }) };
  var linhas = montarLancamentos(A.cat, dia, turno, f);
  if (!linhas.length) { msg('ptsMsg', 'Nada para lançar: marque um item, informe pontos' + (A.cat === 'ajuste' ? ' e o motivo.' : '.'), 'erro'); return; }
  try {
    await inserirPontos(linhas);
    msg('ptsMsg', ''); msg('ptsOk', linhas.length + ' lançamento(s) gravado(s).', 'ok');
    await recarregarTudo();
  } catch (e) { msg('ptsMsg', erroAmigavel(e), 'erro'); }
}
function histPontos() {
  var dia = $('ptsDia').value, turno = $('ptsTurno').value, T = R().TIMES;
  var doDia = (A.dados.lanc || []).filter(function (l) { return String(l.dia).slice(0, 10) === dia && l.turno === turno; });
  var estornados = {}; doDia.forEach(function (l) { var m = /^Estorno de (\S+)/.exec(l.motivo || ''); if (m) estornados[m[1]] = 1; });
  $('ptsHist').innerHTML = doDia.length ? '<table class="cmpad-hist"><tr><th>Time</th><th>Categoria</th><th>Item</th><th>Pontos</th><th>Motivo</th><th></th></tr>' + doDia.map(function (l) {
    var estorno = /^Estorno de /.test(l.motivo || '');
    return '<tr><td>Time ' + esc((T[l.time] || {}).nome) + '</td><td>' + esc(l.categoria) + '</td><td>' + esc(l.item || '') + '</td><td class="' + (l.pontos < 0 ? 'neg' : '') + '">' + l.pontos + '</td><td>' + esc(l.motivo || '') + '</td><td>' +
      (estorno || estornados[l.id] ? '<small>' + (estorno ? 'estorno' : 'estornado') + '</small>' : '<button class="btn-mini est" data-id="' + esc(l.id) + '" type="button">Estornar</button>') + '</td></tr>';
  }).join('') + '</table>' : '<p style="font-size:12px;color:var(--text-muted);margin-top:10px">Nenhum lançamento neste dia e turno.</p>';
  $('ptsHist').querySelectorAll('.est').forEach(function (b) { b.addEventListener('click', function () { estornar(b.dataset.id); }); });
}
function linhaEstorno(l) {   // estorno = lançamento inverso (nunca edita nem apaga)
  return { dia: String(l.dia).slice(0, 10), turno: l.turno, time: l.time, categoria: l.categoria, item: 'Estorno: ' + (l.item || l.categoria), pontos: -l.pontos, motivo: 'Estorno de ' + l.id };
}
async function estornar(id) {
  var l = (A.dados.lanc || []).filter(function (x) { return x.id === id; })[0];
  if (!l) return;
  try { await inserirPontos([linhaEstorno(l)]); msg('ptsOk', 'Lançamento estornado.', 'ok'); await recarregarTudo(); } catch (e) { msg('ptsMsg', erroAmigavel(e), 'erro'); }
}
function extrair() {
  var d = A.dados, Cm = C(), pretos = R().DIAS.map(function (x) { return x[0]; }).filter(function (x) { return Cm.temAtividade(d, x); });
  var dias = pretos.length ? pretos : [$('ptsDia').value];   // antes da Black: prévia do dia escolhido
  baixarXlsx(montarExtracao(d, dias), 'Competicao_Black_DISTR_Descontos_e_Adicoes.xlsx');
}
function preencherDiasPontos() {
  var sel = $('ptsDia'), atual = sel.value, dias = R().DIAS.map(function (x) { return x[0]; });
  if (A.dados && dias.indexOf(A.dados.hoje) === -1) dias.unshift(A.dados.hoje);
  sel.innerHTML = dias.map(function (x) { return '<option value="' + x + '">' + global.Competicao.ddmm(x) + '</option>'; }).join('');
  sel.value = atual && dias.indexOf(atual) !== -1 ? atual : (dias.indexOf(A.dados && A.dados.hoje) !== -1 ? A.dados.hoje : dias[0]);
}
function erroAmigavel(e) { return global.Competicao.tabelaInexistente(e) ? global.Competicao.MSG_TABELAS : 'Erro: ' + (e && e.message || e); }
async function recarregarTudo() {
  try {
    A.dados = await global.Competicao.carregarDados(A.sb);
    A.linhas = pagLinhas(A.dados.cadastro);
    msg('cadMsg', '');
    desenharTimes(); preencherDiasPontos(); histPontos();
  } catch (e) { msg('cadMsg', erroAmigavel(e), 'erro'); }
}
function ligar(sb) {
  if (A.ligado) return;
  A.raiz = document.getElementById('compAdminRoot'); A.sb = sb; if (!A.raiz) return;
  A.ligado = true;
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  A.raiz.innerHTML = esqueleto();
  ligarTimes();
  $('ptsDia').addEventListener('change', function () { formPontos(); histPontos(); });
  $('ptsTurno').addEventListener('change', function () { formPontos(); histPontos(); });
  $('ptsCat').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (!b) return; A.cat = b.dataset.cat; $('ptsCat').querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('ativo', x === b); }); formPontos(); });
  $('ptsExtrair').addEventListener('click', function () { if (A.dados) extrair(); });
  preencherDiasPontos(); formPontos();
  recarregarTudo();
}

var api = {
  ligar: ligar, norm: norm, casarNome: casarNome, turnoDaAba: turnoDaAba, timeDaAba: timeDaAba, parseEscalacaoBlack: parseEscalacaoBlack, parsePlanilhaPorTimes: parsePlanilhaPorTimes,
  formatoDaPlanilha: formatoDaPlanilha, abasExportacao: abasExportacao, montarLinhasBanco: montarLinhasBanco, montarExtracao: montarExtracao,
  montarLancamentos: montarLancamentos, linhaEstorno: linhaEstorno
};
global.CompeticaoAdmin = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

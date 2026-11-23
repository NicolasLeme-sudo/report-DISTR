/* =========================================================================
   REGRAS-BLACK.JS — Missão Black Friday 2026 da DISTR (27, 28 e 29/11)
   Único lugar com os valores da pontuação e com a conta da competição usada
   pelo telão (tv-black.html) e pela tela Competição do report. Mesma pontuação do
   E-commerce; a produção é a Alocação no Picking (ressuprimento_operador_diario).
   Mudou um valor aqui, muda em todos.
   ========================================================================= */
(function (global) {
'use strict';

var DIAS = [['2026-11-27', '27/11', 'Largada Black'], ['2026-11-28', '28/11', 'Superação'], ['2026-11-29', '29/11', 'Grande Final']];

// Horário de cada turno em minutos desde 00:00 (o T02 passa da meia-noite: 1456 = 00:16 do dia seguinte).
var TURNOS = {
  '1º Turno': { ini: 5 * 60, fim: 14 * 60 + 48, almoco: [11 * 60 + 30, 12 * 60 + 30], rot: 'T01 · 05h00–14h48' },
  '2º Turno': { ini: 14 * 60 + 48, fim: 24 * 60 + 16, almoco: [18 * 60 + 40, 19 * 60 + 40], rot: 'T02 · 14h48–00h16' }
};

var P = {
  porPeca: 1,             // cada peça alocada no picking
  metaBatida: 200,        // bateu 100% da meta do dia
  antecipadaHora: 100,    // por hora antes do fim do turno (precisa do minuto da meta: ainda não há produção por hora)
  assiduidadeMax: 500,    // × presentes ÷ escalados (atestado conta como falta)
  atraso: -20,            // por pessoa atrasada
  desafiosMax: 300,       // soma dos desafios no dia
  destaque: 50,           // ao time do operador que mais ressuprimiu no turno
  vistoriaLimpa: 100,     // vistoria do dia sem nenhum apontamento
  trincaPerfeita: 200     // 100% de presença nos 3 dias (vai para o acumulado)
};

var GRAVIDADES = { leve: { rot: 'Leve', pts: -20 }, media: { rot: 'Média', pts: -50 }, grave: { rot: 'Grave', pts: -100 }, gravissima: { rot: 'Gravíssima', pts: -200 } };
var CHECKLIST = [
  ['leve', 'Lixo, fita ou plástico no chão'],
  ['leve', 'Carrinho ou paleteira fora da vaga'],
  ['leve', 'Etiqueta ou Nota Fiscal no chão'],
  ['leve', 'Material de apoio fora do lugar'],
  ['media', 'Caixa aberta ou avariada no picking'],
  ['media', 'Endereço muito desorganizado'],
  ['media', 'Volume deixado no corredor'],
  ['grave', 'Rota de fuga ou extintor obstruído'],
  ['grave', 'Sem EPI obrigatório (calçado, colete)'],
  ['grave', 'Empilhamento acima do limite'],
  ['gravissima', 'Subir em estante ou prateleira'],
  ['gravissima', 'Correr ou manobrar carrinho de forma perigosa'],
  ['gravissima', 'Descumprir orientação de segurança']
].map(function (x) { return { grav: x[0], item: x[1], pts: GRAVIDADES[x[0]].pts }; });

var DESAFIOS = {
  '2026-11-27': ['Quiz relâmpago', 'Grito da equipe', 'Missão surpresa'],
  '2026-11-28': ['Golden Ticket', 'Desafio relâmpago', 'Espírito de equipe'],
  '2026-11-29': ['Quiz final', 'Desafio surpresa', 'Equipe mais engajada']
};
var PONTOS_DESAFIO = 100;
var GINCANAS_DIA = {
  '2026-11-28': ['Desafio do Balão', 'Torre Black', 'Biscoito na Cara', 'Performance TikTok'],
  '2026-11-29': ['Mímica Relâmpago', 'Desenho às Cegas', 'Roleta do Balão', 'Desfile de Fantasia']
};
var GINCANAS = GINCANAS_DIA['2026-11-28'].concat(GINCANAS_DIA['2026-11-29']);

// Os 6 times. Cor, nome e personagem (gif) ainda provisórios, menos o Laranja e o Branco, que já têm GIF próprio.
// espelha = o personagem aponta para a esquerda no arquivo e o CSS espelha; false = já aponta para a direita.
var TIMES = {
  1: { nome: 'Laranja',  cor: '#F28C28', gif: 'corrida/laranja.gif',  espelha: false, altura: 78, turno: '1º Turno' },
  2: { nome: 'Branco',   cor: '#F2F2F2', gif: 'corrida/branco.gif',   espelha: true,  altura: 78, turno: '1º Turno' },
  3: { nome: 'Azul',     cor: '#4C95F0', gif: 'corrida/azul.gif',     espelha: true,  altura: 58, turno: '1º Turno' },
  4: { nome: 'Vermelho', cor: '#EF5B5B', gif: 'corrida/vermelho.gif', espelha: true,  altura: 58, turno: '2º Turno' },
  5: { nome: 'Verde',    cor: '#45C665', gif: 'corrida/verde.gif',    espelha: true,  altura: 58, turno: '2º Turno' },
  6: { nome: 'Roxo',     cor: '#A773EA', gif: 'corrida/roxo.gif',     espelha: true,  altura: 58, turno: '2º Turno' }
};
var NUM_TIMES = [1, 2, 3, 4, 5, 6];
// Uma corrida por turno: posição, destaque e ranking só entre os 3 times do turno.
var GRUPOS = [
  { id: 't1', rot: '1º Turno', turno: '1º Turno', times: [1, 2, 3] },
  { id: 't2', rot: '2º Turno', turno: '2º Turno', times: [4, 5, 6] }
];
function grupoDoTime(n) { return n <= 3 ? 't1' : 't2'; }
function turnoDoTime(n) { return TIMES[n] ? TIMES[n].turno : '1º Turno'; }

// Meta do time por dia: 3.000 peças alocadas por equipe (9.000 por turno).
var META_TIME = 3000;
var META_TURNO = { '1º Turno': META_TIME * 3, '2º Turno': META_TIME * 3 };
function metaDoTime() { return META_TIME; }

function pts(valor) { return Math.round(valor); }
function isoLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Dia operacional: entre 00h e 01h ainda é o dia anterior (o T02 vai até 00h16).
function diaOperacional(agora) { var d = new Date(agora || new Date()); if (d.getHours() < 1) d.setDate(d.getDate() - 1); return isoLocal(d); }
function turnoAtual(agora) {
  agora = agora || new Date();
  var min = agora.getHours() * 60 + agora.getMinutes(), dia = new Date(agora);
  if (min >= TURNOS['1º Turno'].ini && min < TURNOS['1º Turno'].fim) return { turno: '1º Turno', dia: isoLocal(dia) };
  if (min < TURNOS['1º Turno'].ini) { dia.setDate(dia.getDate() - 1); return { turno: '2º Turno', dia: isoLocal(dia), madrugada: true }; }
  return { turno: '2º Turno', dia: isoLocal(dia) };
}
function chaveUsu(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/,/g, '.').trim().toUpperCase(); }
function minutosTrabalhados(de, ate, almoco) {
  var total = Math.max(0, ate - de);
  if (almoco) total -= Math.max(0, Math.min(ate, almoco[1]) - Math.max(de, almoco[0]));
  return Math.max(0, total);
}

/* ---------- Conta da competição ----------
   producao = linhas de ressuprimento_operador_diario: { dia, turno, login, nome, pecas }
   cadastro = linhas de competicao_times
   diaAlvo  = 'aaaa-mm-dd' (vazio = último dia com produção)
   O time soma tudo o que cada membro alocou no dia, em qualquer turno do banco. */
function calcularCompeticao(producao, cadastro, diaAlvo) {
  var linhas = (producao || []).map(function (r) { return { dia: String(r.dia).slice(0, 10), k: chaveUsu(r.login), pecas: +r.pecas || 0 }; });
  var diaRef = diaAlvo || linhas.reduce(function (a, r) { return r.dia > a ? r.dia : a; }, '');
  var porLogin = new Map();
  linhas.forEach(function (r) { if (r.dia === diaRef) porLogin.set(r.k, (porLogin.get(r.k) || 0) + r.pecas); });
  var times = NUM_TIMES.map(function (n) { return { n: n, grupo: grupoDoTime(n), turno: turnoDoTime(n), nome: TIMES[n].nome, cor: TIMES[n].cor, membros: [] }; });
  (cadastro || []).forEach(function (r) {
    var t = times[r.time - 1];
    if (!t || t.membros.some(function (m) { return m.usuario === r.usuario_wms; })) return;
    var vago = /^NOVATO\./i.test(r.usuario_wms);
    var pecas = vago ? 0 : (porLogin.get(chaveUsu(r.usuario_wms)) || 0);
    t.membros.push({ usuario: r.usuario_wms, nome: r.nome || (vago ? 'Novato' : r.usuario_wms), vago: vago, lider: !!r.lider, pecas: pecas, valor: pecas, chaves: { aloc: chaveUsu(r.usuario_wms) } });
  });
  times.forEach(function (t) {
    t.lista = t.membros.slice().sort(function (a, b) { return b.valor - a.valor; });
    t.total = t.lista.reduce(function (s, m) { return s + m.valor; }, 0);
    t.meta = metaDoTime(t.n);
    t.ativos = t.lista.filter(function (m) { return m.valor > 0; }).length;
  });
  GRUPOS.forEach(function (G) {
    times.filter(function (t) { return t.grupo === G.id; })
      .sort(function (a, b) { return (b.lista.length ? 1 : 0) - (a.lista.length ? 1 : 0) || b.total - a.total; })
      .forEach(function (t, i) { t.pos = t.lista.length ? i + 1 : null; });
  });
  return { times: times, dia: diaRef || null, temDados: linhas.length > 0 };
}

// Placar de UM dia de UM turno (só os 3 times do turno).
//   c = calcularCompeticao(...) · cadastro = linhas de competicao_times · lanc = linhas de competicao_pontos do dia/turno
function placarDoDia(o) {
  var c = o.c, dia = o.dia, turno = o.turno;
  var times = c.times.filter(function (t) { return t.turno === turno && (t.lista.length || (o.cadastro || []).some(function (r) { return r.time === t.n; })); });

  // destaque: o operador que mais ressuprimiu no turno leva +destaque para o time dele
  var top = null;
  times.forEach(function (t) { t.lista.forEach(function (m) { if (m.valor > 0 && (!top || m.valor > top.m.valor)) top = { t: t.n, m: m }; }); });

  var linhas = times.map(function (t) {
    var n = t.n, r = { n: n, cor: t.cor, nome: t.nome, grupo: t.grupo, pecas: t.total, meta: t.meta, detalhe: [] };
    r.produtividade = Math.round(t.total * P.porPeca);
    r.metaBatida = t.total >= t.meta && t.meta ? pts(P.metaBatida) : 0;
    r.antecipada = 0; r.horaMeta = null; r.minutoMeta = null;
    r.ouro = 0; r.ouroDetalhe = [];

    var pessoas = {};
    (o.cadastro || []).forEach(function (row) { if (row.time === n && row.presenca && row.presenca[dia]) pessoas[row.usuario_wms] = row.presenca[dia]; });
    var marcas = Object.keys(pessoas).map(function (k) { return pessoas[k]; });
    r.escalados = marcas.length;
    r.presentes = marcas.filter(function (v) { return v === 'P' || v === 'A'; }).length;
    r.atrasos = marcas.filter(function (v) { return v === 'A'; }).length;
    r.faltas = r.escalados - r.presentes;
    r.assiduidade = r.escalados ? Math.max(0, Math.round(P.assiduidadeMax * r.presentes / r.escalados) + r.atrasos * P.atraso) : 0;
    r.presenca100 = r.escalados > 0 && r.faltas === 0;

    var doTime = (o.lanc || []).filter(function (l) { return l.time === n; });
    var soma = function (cat) { return doTime.filter(function (l) { return l.categoria === cat; }).reduce(function (s, l) { return s + (l.pontos || 0); }, 0); };
    r.desafios = Math.min(P.desafiosMax, soma('desafio'));
    r.segQual = soma('vistoria');
    r.ajustes = soma('ajuste');
    r.lancamentos = doTime;

    r.destaques = top && top.t === n ? [{ funcao: 'Ressuprimento', nome: top.m.nome || top.m.usuario, pecas: top.m.valor }] : [];
    r.destaque = r.destaques.length * P.destaque;
    r.bonus = r.metaBatida + r.antecipada + r.ouro + r.destaque + r.ajustes;
    r.total = r.produtividade + r.assiduidade + r.desafios + r.segQual + r.bonus;
    return r;
  });
  return { dia: dia, turno: turno, linhas: linhas };
}

// Soma dos dias + Trinca Perfeita (100% de presença nos 3 dias).
function acumulado(placares) {
  var porTime = {};
  placares.forEach(function (p) {
    p.linhas.forEach(function (r) {
      var a = porTime[r.n] = porTime[r.n] || { n: r.n, total: 0, dias: 0, dias100: 0 };
      a.total += r.total; a.dias++; if (r.presenca100) a.dias100++;
    });
  });
  Object.keys(porTime).forEach(function (k) {
    var a = porTime[k];
    a.trinca = a.dias100 === DIAS.length ? pts(P.trincaPerfeita) : 0;
    a.total += a.trinca;
  });
  return porTime;
}

global.RegrasBlack = {
  DIAS: DIAS, TURNOS: TURNOS, P: P, GRAVIDADES: GRAVIDADES, CHECKLIST: CHECKLIST,
  DESAFIOS: DESAFIOS, GINCANAS: GINCANAS, GINCANAS_DIA: GINCANAS_DIA, PONTOS_DESAFIO: PONTOS_DESAFIO,
  TIMES: TIMES, NUM_TIMES: NUM_TIMES, GRUPOS: GRUPOS, grupoDoTime: grupoDoTime, turnoDoTime: turnoDoTime,
  META_TIME: META_TIME, META_TURNO: META_TURNO, metaDoTime: metaDoTime,
  pts: pts, isoLocal: isoLocal, diaOperacional: diaOperacional, turnoAtual: turnoAtual, chaveUsu: chaveUsu,
  minutosTrabalhados: minutosTrabalhados, calcularCompeticao: calcularCompeticao, placarDoDia: placarDoDia, acumulado: acumulado
};
})(typeof window !== 'undefined' ? window : globalThis);

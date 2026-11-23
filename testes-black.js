// node testes-black.js — conta da competição da DISTR (regras-black.js)
const assert = require('assert');
require('./regras-black.js');
const R = globalThis.RegrasBlack;

const cad = [
  { usuario_wms: 'EX900001', nome: 'AUGUSTO', turno: '1º Turno', time: 1, presenca: { '2026-11-27': 'P' } },
  { usuario_wms: 'EX900002', nome: 'ALAN', turno: '1º Turno', time: 1, presenca: { '2026-11-27': 'A' } },
  { usuario_wms: 'EX900003', nome: 'EMANUEL', turno: '1º Turno', time: 2, presenca: { '2026-11-27': 'F' } },
  { usuario_wms: 'EX900004', nome: 'JULIO', turno: '1º Turno', time: 3, presenca: {} },
  { usuario_wms: 'EX900005', nome: 'DARIO', turno: '2º Turno', time: 4, presenca: {} },
  { usuario_wms: 'NOVATO.6.1', nome: null, turno: '2º Turno', time: 6, presenca: {} }
];
const prod = [
  { dia: '2026-11-27', turno: 'T01', login: 'EX900001', nome: 'x', pecas: 2000 },
  { dia: '2026-11-27', turno: 'T01', login: 'ex900002', nome: 'x', pecas: 1200 },
  { dia: '2026-11-27', turno: 'T03', login: 'EX900001', nome: 'x', pecas: 100 },
  { dia: '2026-11-27', turno: 'T01', login: 'EX900003', nome: 'x', pecas: 900 },
  { dia: '2026-11-27', turno: 'T02', login: 'EX900005', nome: 'x', pecas: 2500 },
  { dia: '2026-11-26', turno: 'T01', login: 'EX900004', nome: 'x', pecas: 9999 }
];

const c = R.calcularCompeticao(prod, cad, '2026-11-27');
assert.strictEqual(c.dia, '2026-11-27');
assert.strictEqual(c.times[0].total, 3300, 'time 1 soma todos os turnos do banco e ignora outro dia');
assert.strictEqual(c.times[0].meta, 3000);
assert.strictEqual(c.times[2].total, 0, 'dia 26 não conta no dia 27');
assert.strictEqual(c.times[5].lista[0].vago, true, 'novato é vaga sem peças');
assert.strictEqual(c.times[0].pos, 1); assert.strictEqual(c.times[1].pos, 2); assert.strictEqual(c.times[2].pos, 3);
assert.strictEqual(R.calcularCompeticao(prod, cad).dia, '2026-11-27', 'sem dia alvo usa o último com produção');

const p = R.placarDoDia({ c, dia: '2026-11-27', turno: '1º Turno', cadastro: cad, lanc: [
  { time: 1, categoria: 'desafio', pontos: 100 }, { time: 1, categoria: 'desafio', pontos: 250 },
  { time: 2, categoria: 'vistoria', pontos: -50 }, { time: 2, categoria: 'ajuste', pontos: 30 }] });
assert.strictEqual(p.linhas.length, 3, 'só os 3 times do 1º turno');
const t1 = p.linhas.find(r => r.n === 1), t2 = p.linhas.find(r => r.n === 2);
assert.strictEqual(t1.produtividade, 3300);
assert.strictEqual(t1.metaBatida, 200);
assert.strictEqual(t1.assiduidade, Math.round(500 * 2 / 2) - 20, 'presentes 2 de 2, 1 atraso');
assert.strictEqual(t1.desafios, 300, 'desafios limitados a 300');
assert.strictEqual(t1.destaque, 50, 'top operador do turno é do time 1');
assert.strictEqual(t1.total, 3300 + 480 + 300 + 0 + 200 + 50);
assert.strictEqual(t2.metaBatida, 0);
assert.strictEqual(t2.assiduidade, 0, 'ninguém presente = 0 de 500');
assert.strictEqual(t2.segQual, -50); assert.strictEqual(t2.ajustes, 30);
assert.strictEqual(t2.total, 900 + 0 + 0 - 50 + 30);

const ac = R.acumulado([p]);
assert.strictEqual(ac[1].trinca, 0);
assert.strictEqual(R.grupoDoTime(3), 't1'); assert.strictEqual(R.grupoDoTime(4), 't2');
assert.strictEqual(R.turnoAtual(new Date(2026, 10, 27, 1, 0)).turno, '2º Turno');
assert.strictEqual(R.diaOperacional(new Date(2026, 10, 28, 0, 30)), '2026-11-27');
console.log('testes-black.js OK');

/* ============================================================================
   TESTES — ingest-movimentacoes.js  (rode com: node testes-ingest-movimentacoes.js)
   ============================================================================
   Cobre as três armadilhas confirmadas contra o arquivo real e as regras de
   turno. Sai com código 1 se qualquer caso falhar, pra poder entrar em CI.
   ============================================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = { window: {}, console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'ingest.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'ingest-ressuprimento.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'ingest-movimentacoes.js'), 'utf8'), ctx);

let falhas = 0;
function ok(cond, nome) {
  console.log((cond ? '  ok  ' : '  FALHOU  ') + nome);
  if (!cond) falhas++;
}
function eq(a, b, nome) {
  const bateu = JSON.stringify(a) === JSON.stringify(b);
  if (!bateu) console.log('        esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));
  ok(bateu, nome);
}

/* ------------------------------------------------------------------ */
console.log('\n=== classificarZona — nível manda, não a rua ===');
eq(ctx.classificarZona('02', '01'), 'PICKING', 'rua 02 nível 01 -> Picking (estanteria)');
eq(ctx.classificarZona('02', '07'), 'PICKING', 'rua 02 nível 07 -> Picking (último nível de estanteria)');
eq(ctx.classificarZona('02', '08'), 'PULMAO', 'rua 02 nível 08 -> Pulmão (primeiro porta-pallet)');
eq(ctx.classificarZona('02', '12'), 'PULMAO', 'rua 02 nível 12 -> Pulmão');
eq(ctx.classificarZona('15', '10'), 'PULMAO', 'rua 15 (inativa, migrada pra rua 1) nível alto -> Pulmão');
eq(ctx.classificarZona('102', '01'), 'PICKING', 'rua 102 (picking calçado Mizuno) -> Picking');
eq(ctx.classificarZona('500', '01'), 'TRANSITO', 'rua 500 (baixar ressuprimento) -> Trânsito');
eq(ctx.classificarZona('600', '01'), 'TRANSITO', 'rua 600 (subir ressuprimento) -> Trânsito');
eq(ctx.classificarZona('98', '02'), 'TRANSITO', 'rua 98 (transitório) -> Trânsito');
eq(ctx.classificarZona('27', '01'), 'TRANSITO', 'rua 27 (perca) -> Trânsito');

/* ------------------------------------------------------------------ */
console.log('\n=== turnoDe (fallback por horário) — só 3 turnos, T02 absorve o antigo bloco sobreposto ===');
eq(ctx.turnoDe(5 * 60), 'T01', '05:00 -> T01 (início)');
eq(ctx.turnoDe(14 * 60 + 47), 'T01', '14:47 -> T01 (última minuto)');
eq(ctx.turnoDe(14 * 60 + 48), 'T02', '14:48 -> T02 (início)');
eq(ctx.turnoDe(19 * 60 + 59), 'T02', '19:59 -> T02 (era T02 antes, continua)');
eq(ctx.turnoDe(20 * 60), 'T02', '20:00 -> T02 (era o início do bloco sobreposto, agora vira T02)');
eq(ctx.turnoDe(23 * 60 + 59), 'T02', '23:59 -> T02');
eq(ctx.turnoDe(0), 'T02', '00:00 -> T02 (a janela vira o dia, ainda T02)');
eq(ctx.turnoDe(15), 'T02', '00:15 -> T02 (último minuto do antigo bloco sobreposto)');
eq(ctx.turnoDe(16), 'T03', '00:16 -> T03 (início)');
eq(ctx.turnoDe(4 * 60 + 59), 'T03', '04:59 -> T03 (último minuto)');

/* ------------------------------------------------------------------ */
console.log('\n=== parsearKardex — só TL+/TL-, conta o que descarta ===');
const CAB = 'ARTIGO|DESCRICAO|COR|TAMANHO|DATA|TIPO_MOVTO|REF|QTDE_ANT|QTDE_MOVTO|RESERVA|ARMAZ|SUB_ARMAZ|ENDERECO|VOLUME|LOGIN|NOME|';
function linha(artigo, cor, tam, data, tipo, ref, qtd, endereco, volume, login, nome) {
  return [artigo, 'DESC', cor, tam, data, tipo, ref, '0,000', qtd, '*', 'EXTRE', 'AC190', endereco, volume, login, nome, ''].join('|');
}
const arquivoBase = [
  'VULSP|MOVIMENTOS DE ESTOQUE (ENDERECOS/VOLUMES)||de:03/08/2026|ate:31/08/2026|||em:Set.2 ,26||b15s250998',
  CAB,
  // par válido: Pulmão (nível 08) -> Picking (nível 01) às 10:00 = T01
  linha('A1', 'PTO', '40', '05/08/26 10:00', 'TL-', 'R1', '10,000', ' 02,08,001', 'V001', 'EX1', 'OPERADOR 1'),
  linha('A1', 'PTO', '40', '05/08/26 10:00', 'TL+', 'R1', '10,000', ' 02,01,001', 'V001', 'EX1', 'OPERADOR 1'),
  // outro tipo de movimento: tem que ser ignorado
  linha('A1', 'PTO', '40', '05/08/26 11:00', 'TRS', 'R9', '5,000', ' 02,01,001', 'V001', 'EX1', 'OPERADOR 1'),
].join('\r\n');

const parsedBase = ctx.parsearKardex(arquivoBase);
eq(parsedBase.pernas.length, 2, 'lê as 2 pernas TL+/TL- e ignora a linha TRS');
eq(parsedBase.ignoradas_outro_tipo, 1, 'conta a linha de outro tipo em vez de sumir com ela');
eq(parsedBase.periodo, { de: '03/08/2026', ate: '31/08/2026' }, 'lê o período do cabeçalho do relatório');

/* ------------------------------------------------------------------ */
console.log('\n=== casarMovimentos — as 3 armadilhas ===');
const arquivoArmadilhas = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  // 1) par legítimo Pulmão -> Picking
  linha('A1', 'PTO', '40', '05/08/26 10:00', 'TL-', 'R1', '10,000', ' 02,08,001', 'V001', 'EX1', 'OPERADOR 1'),
  linha('A1', 'PTO', '40', '05/08/26 10:00', 'TL+', 'R1', '10,000', ' 02,01,001', 'V001', 'EX1', 'OPERADOR 1'),
  // 2) fiscal: MESMO endereço nas duas pontas -> descartado
  linha('A2', 'PTO', '41', '05/08/26 12:00', 'TL-', 'R2', '99,000', ' 02,01,002', 'V002', 'EXFISCAL', 'FISCAL'),
  linha('A2', 'PTO', '41', '05/08/26 12:00', 'TL+', 'R2', '99,000', ' 02,01,002', 'V002', 'EXFATUR', 'FATURAMENTO'),
  // 3) sem volume -> descartado (ajuste fiscal / importação)
  linha('A3', 'PTO', '42', '05/08/26 13:00', 'TL-', 'R3', '50,000', ' 02,08,003', '                  ', 'EX1', 'OPERADOR 1'),
  linha('A3', 'PTO', '42', '05/08/26 13:00', 'TL+', 'R3', '50,000', ' 02,01,003', '                  ', 'EX1', 'OPERADOR 1'),
  // 4) perna solta (só TL-, o par caiu fora da janela do relatório) -> descartado e contado
  linha('A4', 'PTO', '43', '05/08/26 14:00', 'TL-', 'R4', '7,000', ' 02,08,004', 'V004', 'EX1', 'OPERADOR 1'),
].join('\r\n');

const casado = ctx.casarMovimentos(ctx.parsearKardex(arquivoArmadilhas).pernas);
eq(casado.movimentos.length, 1, 'só o par legítimo vira movimento');
eq(casado.descartados.fiscal_mesmo_endereco, 1, 'par de mesmo endereço é descartado como fiscal');
eq(casado.descartados.sem_volume, 1, 'par sem volume é descartado');
eq(casado.descartados.sem_par_exato, 1, 'perna solta é descartada e contada');
eq(casado.movimentos[0].origem.zona, 'PULMAO', 'origem do movimento é a ponta TL- (nível 08 = Pulmão)');
eq(casado.movimentos[0].destino.zona, 'PICKING', 'destino do movimento é a ponta TL+ (nível 01 = Picking)');
eq(casado.movimentos[0].turno, 'T01', 'movimento das 10:00 cai no T01');

/* ------------------------------------------------------------------ */
console.log('\n=== dois saltos NÃO contam a mesma peça duas vezes ===');
const arquivoDoisSaltos = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  // salto 1: Pulmão -> corredor 500 (baixa; ainda não chegou no picking)
  linha('B1', 'AZU', '38', '06/08/26 09:00', 'TL-', 'RA', '100,000', ' 05,09,010', 'V100', 'EX2', 'OPERADOR 2'),
  linha('B1', 'AZU', '38', '06/08/26 09:00', 'TL+', 'RA', '100,000', ' 500,01,001', 'V100', 'EX2', 'OPERADOR 2'),
  // salto 2: corredor 500 -> Picking (é AQUI que conta como ressuprido)
  linha('B1', 'AZU', '38', '06/08/26 09:30', 'TL-', 'RB', '100,000', ' 500,01,001', 'V100', 'EX2', 'OPERADOR 2'),
  linha('B1', 'AZU', '38', '06/08/26 09:30', 'TL+', 'RB', '100,000', ' 05,01,010', 'V100', 'EX2', 'OPERADOR 2'),
].join('\r\n');

const snapDoisSaltos = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoDoisSaltos), { arquivo: 't.txt' });
eq(snapDoisSaltos.total.pecas_ressupridas, 100, 'peça que passou pelo trânsito conta UMA vez (100, não 200)');
eq(snapDoisSaltos.total.movimentos_ressuprimento, 1, 'só o salto que chega no Picking conta como ressuprimento');
eq(snapDoisSaltos.total.pecas_em_transito, 100, 'o salto Pulmão -> trânsito aparece como fila em andamento');

/* ------------------------------------------------------------------ */
console.log('\n=== fila em andamento: rua 98 é staging de RECEBIMENTO, não fila de ressuprimento ===');
// Confirmado com a operação (05/09/2026): a 98 guarda material da doca até
// ser armazenado. No arquivo real ela sozinha respondia por 5.191 peças
// (12%) da "Fila em andamento", inflando um número que deveria ser só o que
// está esperando subir pro Picking. As outras ruas de trânsito continuam
// contando, inclusive sujeira/perca (26/27) -- decisão da operação.
const arquivoFila = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  // Pulmão -> 500 (corredor de ressuprimento): CONTA
  linha('F1', 'AZU', '38', '06/08/26 09:00', 'TL-', 'RA', '40,000', ' 05,09,010', 'V1', 'EX2', 'OP 2'),
  linha('F1', 'AZU', '38', '06/08/26 09:00', 'TL+', 'RA', '40,000', ' 500,01,001', 'V1', 'EX2', 'OP 2'),
  // Pulmão -> 98 (staging de recebimento): NÃO conta
  linha('F2', 'AZU', '39', '06/08/26 10:00', 'TL-', 'RB', '70,000', ' 05,09,011', 'V2', 'EX2', 'OP 2'),
  linha('F2', 'AZU', '39', '06/08/26 10:00', 'TL+', 'RB', '70,000', ' 98,01,001', 'V2', 'EX2', 'OP 2'),
  // Pulmão -> 27 (perca): CONTA (a operação pediu pra manter)
  linha('F3', 'AZU', '40', '06/08/26 11:00', 'TL-', 'RC', '5,000', ' 05,09,012', 'V3', 'EX2', 'OP 2'),
  linha('F3', 'AZU', '40', '06/08/26 11:00', 'TL+', 'RC', '5,000', ' 27,01,001', 'V3', 'EX2', 'OP 2'),
].join('\r\n');
const snapFila = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoFila), { arquivo: 't.txt' });
eq(snapFila.total.pecas_em_transito, 45, 'fila = 40 (rua 500) + 5 (rua 27), sem as 70 da rua 98');
eq(snapFila.total.movimentos_em_transito, 2, 'só 2 dos 3 movimentos entram na fila');

/* ------------------------------------------------------------------ */
console.log('\n=== o que NÃO é ressuprimento ===');
const arquivoNaoRessup = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  // Picking -> Picking (realocação interna): não conta, a peça já estava lá
  linha('C1', 'VER', '39', '07/08/26 16:00', 'TL-', 'RC', '5,000', ' 02,01,001', 'V200', 'EX3', 'OPERADOR 3'),
  linha('C1', 'VER', '39', '07/08/26 16:00', 'TL+', 'RC', '5,000', ' 02,02,002', 'V200', 'EX3', 'OPERADOR 3'),
  // Picking -> Pulmão (subida/devolução): não conta
  linha('C2', 'VER', '39', '07/08/26 17:00', 'TL-', 'RD', '8,000', ' 02,01,003', 'V201', 'EX3', 'OPERADOR 3'),
  linha('C2', 'VER', '39', '07/08/26 17:00', 'TL+', 'RD', '8,000', ' 02,09,003', 'V201', 'EX3', 'OPERADOR 3'),
  // Pulmão -> Pulmão (remanejamento): não conta
  linha('C3', 'VER', '39', '07/08/26 18:00', 'TL-', 'RE', '9,000', ' 03,08,001', 'V202', 'EX3', 'OPERADOR 3'),
  linha('C3', 'VER', '39', '07/08/26 18:00', 'TL+', 'RE', '9,000', ' 03,10,001', 'V202', 'EX3', 'OPERADOR 3'),
].join('\r\n');

const snapNaoRessup = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoNaoRessup), { arquivo: 't.txt' });
eq(snapNaoRessup.total.pecas_ressupridas, 0, 'Picking->Picking, Picking->Pulmão e Pulmão->Pulmão não são ressuprimento');
eq(snapNaoRessup.total.movimentos_ressuprimento, 0, 'nenhum movimento de ressuprimento contado');
eq(snapNaoRessup.rotas.length, 3, 'mas as 3 rotas continuam visíveis no mapa de movimentações');

/* ------------------------------------------------------------------ */
console.log('\n=== agregação por dia e turno ===');
const arquivoDias = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  linha('D1', 'PTO', '40', '10/08/26 08:00', 'TL-', 'R1', '10,000', ' 02,08,001', 'V1', 'EX1', 'OP 1'),
  linha('D1', 'PTO', '40', '10/08/26 08:00', 'TL+', 'R1', '10,000', ' 02,01,001', 'V1', 'EX1', 'OP 1'),
  linha('D2', 'PTO', '40', '10/08/26 22:00', 'TL-', 'R2', '20,000', ' 02,08,002', 'V2', 'EX2', 'OP 2'),
  linha('D2', 'PTO', '40', '10/08/26 22:00', 'TL+', 'R2', '20,000', ' 02,01,002', 'V2', 'EX2', 'OP 2'),
  linha('D3', 'PTO', '40', '11/08/26 03:00', 'TL-', 'R3', '30,000', ' 02,08,003', 'V3', 'EX1', 'OP 1'),
  linha('D3', 'PTO', '40', '11/08/26 03:00', 'TL+', 'R3', '30,000', ' 02,01,003', 'V3', 'EX1', 'OP 1'),
].join('\r\n');

const snapDias = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoDias), { arquivo: 't.txt' });
eq(snapDias.por_dia.length, 2, 'agrupa em 2 dias');
eq(snapDias.por_dia[0].dia, '2026-08-10', 'dias vêm em ordem cronológica');
eq(snapDias.por_dia[0].pecas, 30, 'dia 10 soma 10 + 20 peças');
eq(snapDias.por_dia[0].operadores, 2, 'dia 10 teve 2 operadores distintos');
eq(snapDias.por_dia[0].turnos.T01.pecas, 10, '08:00 do dia 10 cai no T01');
eq(snapDias.por_dia[0].turnos.T02.pecas, 20, '22:00 do dia 10 cai no T02 (fallback, sem colaborador cadastrado)');
eq(snapDias.por_dia[1].turnos.T03.pecas, 30, '03:00 do dia 11 cai no T03');
eq(snapDias.total.operadores_distintos, 2, 'total de operadores distintos no período');

/* ------------------------------------------------------------------ */
console.log('\n=== turno real do colaborador (dim_colaboradores_turno) vence o chute por horário ===');
// EX1 (login de D1/D3) está cadastrado como T03 de verdade -- mesmo os
// movimentos das 08:00 (que o horário chutaria T01) e das 03:00 (que já
// bateria T03 por acaso) devem virar T03 pelo CADASTRO, não pelo relógio.
// EX2 (login de D2) não está na base -- continua no fallback por horário.
const mapaColabTeste = new Map([['EX1', 'T03']]);
const snapComColaborador = ctx.construirSnapshotMovimentacoes(
  ctx.parsearKardex(arquivoDias), { arquivo: 't.txt' }, new Map(), new Map(), [], mapaColabTeste
);
eq(snapComColaborador.por_dia[0].turnos.T01, undefined, 'EX1 cadastrado como T03 -- o T01 do horário some do dia 10');
eq(snapComColaborador.por_dia[0].turnos.T03.pecas, 10, 'movimento das 08:00 de EX1 vira T03 pelo cadastro, não T01 pelo relógio');
eq(snapComColaborador.por_dia[0].turnos.T02.pecas, 20, 'EX2 (não cadastrado) continua no fallback por horário -- T02');
eq(snapComColaborador.resolucao_turno, { por_cadastro: 2, por_horario: 1 }, '2 movimentos de EX1 resolvidos pelo cadastro, 1 de EX2 pelo horário');

const semColaborador = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoDias), { arquivo: 't.txt' });
eq(semColaborador.resolucao_turno, { por_cadastro: 0, por_horario: 3 }, 'sem mapa de colaborador, os 3 movimentos caem no fallback por horário');

/* ------------------------------------------------------------------ */
console.log('\n=== cabeçalho com coluna renomeada falha nomeando a coluna ===');
let mensagem = '';
try {
  ctx.parsearKardex([
    'VULSP|MOVIMENTOS|de:01/01/2026|ate:02/01/2026',
    'ARTIGO|DESCRICAO|COR|TAMANHO|DATA|TIPO_MOVTO|REF|QTDE_ANT|QUANTIDADE|RESERVA|ARMAZ|SUB_ARMAZ|ENDERECO|VOLUME|LOGIN|NOME|',
  ].join('\r\n'));
} catch (e) { mensagem = e.message; }
ok(/qtde_movto/i.test(mensagem), 'erro diz QUAL coluna faltou, em vez de somar zero em silêncio');

/* ------------------------------------------------------------------ */
console.log('\n=== diaISO — dia seguinte/anterior sem escorregar por fuso ===');
eq(ctx.diaISO(1, '2026-08-31'), '2026-09-01', 'dia seguinte cruza o mês');
eq(ctx.diaISO(-1, '2026-09-01'), '2026-08-31', 'dia anterior cruza o mês pra trás');
eq(ctx.diaISO(1, '2025-12-31'), '2026-01-01', 'dia seguinte cruza o ano');
eq(ctx.diaISO(0, '2026-08-15'), '2026-08-15', 'delta 0 devolve o mesmo dia');

/* ------------------------------------------------------------------ */
console.log('\n=== quebra por segmento — resolvida pelo dicionário artigo→família ===');
const mapaFamiliasSeg = new Map([
  ['060', { marca: 'OLYMPIKUS', categoria: 'VESTUÁRIO OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
  ['043', { marca: 'OLYMPIKUS', categoria: 'TÊNIS OLYMPIKUS', segmento: 'TÊNIS OLYMPIKUS' }],
]);
const arquivoSeg = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  linha('V1', 'PT', '40', '10/08/26 08:00', 'TL-', 'R1', '10,000', ' 02,08,001', 'V1', 'EX1', 'OP 1'),
  linha('V1', 'PT', '40', '10/08/26 08:00', 'TL+', 'R1', '10,000', ' 02,01,001', 'V1', 'EX1', 'OP 1'),
  linha('T1', 'PT', '40', '10/08/26 09:00', 'TL-', 'R2', '5,000', ' 02,08,002', 'V2', 'EX1', 'OP 1'),
  linha('T1', 'PT', '40', '10/08/26 09:00', 'TL+', 'R2', '5,000', ' 02,01,002', 'V2', 'EX1', 'OP 1'),
  // Z1 nunca apareceu num upload de Picking/Pulmão -- sem entrada no dicionário.
  linha('Z1', 'PT', '40', '10/08/26 10:00', 'TL-', 'R3', '3,000', ' 02,08,003', 'V3', 'EX1', 'OP 1'),
  linha('Z1', 'PT', '40', '10/08/26 10:00', 'TL+', 'R3', '3,000', ' 02,01,003', 'V3', 'EX1', 'OP 1'),
].join('\r\n');
const mapaArtigoFamiliaSeg = new Map([['V1', '060'], ['T1', '043']]);
const snapSeg = ctx.construirSnapshotMovimentacoes(ctx.parsearKardex(arquivoSeg), { arquivo: 't.txt' }, mapaArtigoFamiliaSeg, mapaFamiliasSeg, []);
const porSegMap = {};
snapSeg.por_segmento.forEach(function (s) { porSegMap[s.segmento] = s.pecas; });
eq(porSegMap.VESTUÁRIO, 10, 'V1 (família 060) vira segmento VESTUÁRIO');
eq(porSegMap.CALÇADO, 5, 'T1 (família 043, tênis) vira segmento CALÇADO');
eq(snapSeg.sem_familia.pecas, 3, 'Z1 (sem entrada no dicionário) fica sinalizado em sem_familia, não some');
eq(snapSeg.sem_familia.artigos_distintos, 1, 'conta 1 artigo distinto sem família');

/* ------------------------------------------------------------------ */
console.log('\n=== historico_diario — uma linha por dia+segmento+turno, sem somar entre turnos/segmentos ===');
const histMap = {};
snapSeg.historico_diario.forEach(function (h) { histMap[h.dia + '|' + h.segmento + '|' + h.turno] = h; });
eq(histMap['2026-08-10|VESTUÁRIO|T01'].pecas, 10, 'V1 (T01, 08:00) vira uma linha própria de VESTUÁRIO no dia 10');
eq(histMap['2026-08-10|CALÇADO|T01'].pecas, 5, 'T1 (T01, 09:00) vira uma linha própria de CALÇADO no dia 10 — não soma com VESTUÁRIO');
eq(histMap['2026-08-10|SEM FAMÍLIA|T01'].pecas, 3, 'Z1 sem família também entra no histórico, sinalizado');
eq(snapSeg.historico_diario.length, 3, 'uma linha por combinação distinta de dia+segmento+turno, nada a mais');

/* ------------------------------------------------------------------ */
console.log('\n=== cruzamento com planejamento — D0, D-1 e sem planejamento ===');
const arquivoPlano = [
  'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
  // família 060 ressuprida no dia 10 -- planejada pro dia 10 = D0
  linha('P1', 'PT', '40', '10/08/26 08:00', 'TL-', 'RA', '10,000', ' 02,08,001', 'VA', 'EX1', 'OP 1'),
  linha('P1', 'PT', '40', '10/08/26 08:00', 'TL+', 'RA', '10,000', ' 02,01,001', 'VA', 'EX1', 'OP 1'),
  // família 043 ressuprida no dia 10 -- planejada pro dia 11 = D-1 (adiantado)
  linha('P2', 'PT', '41', '10/08/26 09:00', 'TL-', 'RB', '20,000', ' 02,08,002', 'VB', 'EX1', 'OP 1'),
  linha('P2', 'PT', '41', '10/08/26 09:00', 'TL+', 'RB', '20,000', ' 02,01,002', 'VB', 'EX1', 'OP 1'),
  // família 068 ressuprida no dia 10 -- SEM nenhuma PFA planejada = sem planejamento
  linha('P3', 'PT', '42', '10/08/26 10:00', 'TL-', 'RC', '7,000', ' 02,08,003', 'VC', 'EX1', 'OP 1'),
  linha('P3', 'PT', '42', '10/08/26 10:00', 'TL+', 'RC', '7,000', ' 02,01,003', 'VC', 'EX1', 'OP 1'),
].join('\r\n');
const mapaArtigoFamiliaPlano = new Map([['P1', '060'], ['P2', '043'], ['P3', '068']]);
const mapaFamiliasPlano = new Map([
  ['060', { marca: 'OLYMPIKUS', categoria: 'VESTUÁRIO OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
  ['043', { marca: 'OLYMPIKUS', categoria: 'TÊNIS OLYMPIKUS', segmento: 'TÊNIS OLYMPIKUS' }],
  ['068', { marca: 'OLYMPIKUS', categoria: 'MEIAS OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }],
  // 043-B: uma família planejada pro período mas NUNCA ressuprida
]);
const planejamentoTeste = [
  { pfa: 'PFA1', familia_codigo: '060', turno: 'T01', data: '2026-08-10' },
  { pfa: 'PFA2', familia_codigo: '043', turno: 'T02', data: '2026-08-11' },
  { pfa: 'PFA4', familia_codigo: '999', turno: 'T01', data: '2026-08-10' }, // nunca ressuprida
];
const snapPlano = ctx.construirSnapshotMovimentacoes(
  ctx.parsearKardex(arquivoPlano), { arquivo: 't.txt' }, mapaArtigoFamiliaPlano, mapaFamiliasPlano, planejamentoTeste
);
const porPfa = {};
snapPlano.planejamento.forEach(function (p) { porPfa[p.pfa] = p; });
eq(porPfa.PFA1.status, 'D0', 'PFA1 (família 060) ressuprida no próprio dia planejado = D0');
eq(porPfa.PFA1.pecas, 10, 'D0 registra as peças do dia certo');
eq(porPfa.PFA2.status, 'D-1', 'PFA2 (família 043, planejada pro dia 11) ressuprida no dia 10 = D-1 (adiantado)');
eq(porPfa.PFA2.pecas, 20, 'D-1 registra as peças do dia anterior');
eq(porPfa.PFA4.status, 'planejado_nao_ressuprido', 'PFA4 (família 999) nunca apareceu no Kardex — planejada e não ressuprida');
eq(porPfa.PFA4.dias_pendente, 21, 'PFA4 planejada pro dia 10, Kardex cobre até 31 -> 21 dias pendente (FIFO)');
const semPlanoMap = {};
snapPlano.ressuprimento_sem_planejamento.forEach(function (r) { semPlanoMap[r.familia_codigo] = r.pecas; });
eq(semPlanoMap['068'], 7, 'família 068 ressuprida sem nenhuma PFA planejada pra ela = sem planejamento');
ok(semPlanoMap['060'] === undefined, 'família 060 (tem PFA1 pro mesmo dia) NÃO aparece em sem_planejamento');
ok(semPlanoMap['043'] === undefined, 'família 043 (tem PFA2 pro dia seguinte, cobre o D-1) NÃO aparece em sem_planejamento');

const semPlano068 = snapPlano.ressuprimento_sem_planejamento.find(function (r) { return r.familia_codigo === '068'; });
eq(semPlano068.por_turno.T01, 7, 'sem planejamento vem quebrado por turno (068 ressuprida às 10:00 = T01)');
eq(Object.keys(semPlano068.por_turno).length, 1, 'só o turno que realmente ressupriu aparece na quebra');

/* ------------------------------------------------------------------ */
console.log('\n=== status "aguardando" — PFA planejada pra depois do fim do Kardex ===');
const planejamentoFuturo = [
  { pfa: 'PFA9', familia_codigo: '060', turno: 'T01', data: '2026-09-15' }, // bem depois do fim do arquivo (31/08)
];
const snapFuturo = ctx.construirSnapshotMovimentacoes(
  ctx.parsearKardex(arquivoPlano), { arquivo: 't.txt' }, mapaArtigoFamiliaPlano, mapaFamiliasPlano, planejamentoFuturo
);
eq(snapFuturo.planejamento[0].status, 'aguardando', 'PFA planejada pra data futura ao Kardex vira "aguardando", não "não ressuprida"');
eq(snapFuturo.planejamento[0].dias_pendente, null, 'aguardando não tem contagem de FIFO — ainda não é atraso');

/* ------------------------------------------------------------------ */
console.log('\n=== processarMovimentacoes — dim_artigo_familia NÃO tem coluna "codigo" ===');
/* Bug real achado em produção (03/09/2026): lerTudoPaginado ordena por
   'codigo' por padrão (é a PK de dim_armazens/dim_familias), mas a PK de
   dim_artigo_familia é artigo_codigo. Sem passar ordenarPor='artigo_codigo'
   explicitamente, a consulta quebra no Postgres real com "column codigo does
   not exist" — e o catch (colocado pra tabela nova sumir sem quebrar quem
   não rodou a migração) engolia esse erro em silêncio, fazendo o dicionário
   parecer sempre vazio mesmo depois de populado. Este fake reproduz o
   comportamento exato do Postgres: erro se a ordenação pedida não é uma
   coluna que existe na tabela. */
(async function () {
  function supabaseFake() {
    const tabelas = {
      dim_artigo_familia: { colunas: ['artigo_codigo', 'familia_codigo'], linhas: [{ artigo_codigo: 'K1', familia_codigo: '060' }] },
      dim_familias: { colunas: ['codigo', 'marca', 'categoria', 'segmento'], linhas: [{ codigo: '060', marca: 'OLYMPIKUS', categoria: 'VESTUÁRIO OLYMPIKUS', segmento: 'TÊXTIL/ACESSÓRIOS OLYMPIKUS' }] },
    };
    return {
      from: function (nome) {
        if (nome === 'ressuprimento_planejamento') {
          return { select: function () { return this; }, then: function (res) { return Promise.resolve({ data: [], error: null }).then(res); } };
        }
        if (nome === 'dashboard_snapshots') {
          return { insert: async function () { return { error: null }; } };
        }
        const t = tabelas[nome];
        const q = {
          select: function () { return q; },
          order: function (col) { q._ordenarPor = col; return q; },
          range: async function (de) {
            // Coluna de ordenação pedida precisa existir na tabela — é o que
            // o Postgres real faz (rejeita ORDER BY numa coluna inexistente).
            if (t.colunas.indexOf(q._ordenarPor) === -1) return { data: null, error: { message: 'column "' + q._ordenarPor + '" does not exist' } };
            return { data: de === 0 ? t.linhas : [], error: null };
          },
        };
        return q;
      },
    };
  }

  const arquivoKardexArtigo = [
    'VULSP|MOVIMENTOS|de:03/08/2026|ate:31/08/2026', CAB,
    linha('K1', 'PT', '40', '10/08/26 08:00', 'TL-', 'RK', '10,000', ' 02,08,001', 'VK', 'EX1', 'OP 1'),
    linha('K1', 'PT', '40', '10/08/26 08:00', 'TL+', 'RK', '10,000', ' 02,01,001', 'VK', 'EX1', 'OP 1'),
  ].join('\r\n');
  const avisos = [];
  const fakeFile = { name: 'kardex.txt', text: async function () { return arquivoKardexArtigo; } };
  const payload = await ctx.processarMovimentacoes(supabaseFake(), fakeFile, function (m) { avisos.push(m); });

  const porSeg = {}; (payload.por_segmento || []).forEach(function (s) { porSeg[s.segmento] = s.pecas; });
  eq(porSeg.VESTUÁRIO, 10, 'dicionário lido com sucesso (ordenarPor correto) — K1 resolve pra segmento VESTUÁRIO');
  eq(payload.sem_familia.pecas, 0, 'nada cai em "sem família" quando o dicionário é lido com sucesso');
  ok(!avisos.some(function (a) { return /Aviso: não deu pra ler o dicionário/.test(a); }),
     'não emite aviso de falha de leitura quando a consulta funciona');

  /* ---------------------------------------------------------------- */
  console.log('\n=== upsertHistoricoDiario — grava em lotes, upsert por dia+segmento+turno ===');
  const chamadas = [];
  const clienteOk = {
    from: function (nome) {
      return {
        upsert: async function (linhas, opts) {
          chamadas.push({ tabela: nome, linhas: linhas, opts: opts });
          return { error: null };
        },
      };
    },
  };
  const linhasGrandes = [];
  for (let i = 0; i < 1200; i++) {
    linhasGrandes.push({ dia: '2026-08-1' + (i % 9), segmento: 'VESTUÁRIO', turno: 'T01', pecas: 1, movimentos: 1 });
  }
  const avisosHist = [];
  await ctx.upsertHistoricoDiario(clienteOk, linhasGrandes, function (m) { avisosHist.push(m); });
  eq(chamadas.length, 3, '1200 linhas em lotes de 500 viram 3 chamadas de upsert (500+500+200)');
  ok(chamadas.every(function (c) { return c.tabela === 'ressuprimento_historico_diario' && c.opts.onConflict === 'dia,segmento,turno'; }),
     'toda chamada mira a tabela certa com o onConflict de dia+segmento+turno');
  ok(avisosHist.some(function (a) { return /1\.200 linha/.test(a); }), 'avisa quantas linhas foram gravadas');

  console.log('\n=== upsertHistoricoDiario — tabela ainda não existe (migração não rodada) ===');
  const clienteSemTabela = { from: function () { return { select: function () { return this; }, order: function () { return this; }, range: async function () { return {}; } }; } };
  const avisosSemTabela = [];
  await ctx.upsertHistoricoDiario(clienteSemTabela, [{ dia: '2026-08-10', segmento: 'VESTUÁRIO', turno: 'T01', pecas: 1, movimentos: 1 }], function (m) { avisosSemTabela.push(m); });
  ok(avisosSemTabela.some(function (a) { return /Aviso: não deu pra gravar o histórico diário/.test(a); }),
     'tabela ausente vira aviso claro, não derruba o processamento');

  console.log('\n=== upsertHistoricoDiario — nada pra gravar não chama o banco ===');
  const chamadasVazio = [];
  await ctx.upsertHistoricoDiario({ from: function (n) { chamadasVazio.push(n); return { upsert: async function () { return { error: null }; } }; } }, [], function () {});
  eq(chamadasVazio.length, 0, 'historico_diario vazio não gera nenhuma chamada ao Supabase');

  console.log('\n=== upsertHistoricoFamiliaDiario — mesmo padrão, onConflict por dia+família+turno ===');
  const chamadasFam = [];
  const clienteFamOk = {
    from: function (nome) {
      return { upsert: async function (linhas, opts) { chamadasFam.push({ tabela: nome, linhas: linhas, opts: opts }); return { error: null }; } };
    },
  };
  const avisosFam = [];
  await ctx.upsertHistoricoFamiliaDiario(clienteFamOk, [{ dia: '2026-08-10', familia_codigo: '068', turno: 'T01', pecas: 7, movimentos: 1 }], function (m) { avisosFam.push(m); });
  eq(chamadasFam.length, 1, 'uma chamada de upsert pra 1 linha');
  eq(chamadasFam[0].tabela, 'ressuprimento_familia_diario', 'mira a tabela ressuprimento_familia_diario');
  eq(chamadasFam[0].opts.onConflict, 'dia,familia_codigo,turno', 'onConflict é dia+família+turno');
  ok(avisosFam.some(function (a) { return /1 linha/.test(a); }), 'avisa quantas linhas foram gravadas');
})().then(function () {
  console.log('\n' + (falhas === 0 ? 'TODOS OS TESTES PASSARAM' : falhas + ' TESTE(S) FALHARAM'));
  process.exit(falhas === 0 ? 0 : 1);
});

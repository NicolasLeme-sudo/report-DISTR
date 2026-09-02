/* ============================================================================
   ingest-colaboradores.js — dim_colaboradores_turno
   ============================================================================
   Turno REAL de cada colaborador, pra parar de CHUTAR o turno pelo horário
   do movimento quando dá pra saber de verdade quem bateu o ponto.

   Fonte: a base de Ativos (Excel semanal da gestão, aba "Ativos"). Traz o
   CÓDIGO do colaborador (ex: 15000923) e o horário dele (coluna "Horario":
   "1º Turno" / "2º Turno" / "3º Turno" / "ADM" / "CARGO DE CONFIANCA").

   O LOGIN que aparece no Kardex é esse MESMO número, só que com "EX" no
   lugar do "15" — 15000923 vira EX000923 (decisão da operação, 04/09/2026).

   ADM e CARGO DE CONFIANCA não são turno operacional — uma movimentação
   desses logins (ou de um login que ainda não está nessa base) cai no
   FALLBACK por horário do movimento (turnoDe, em ingest-movimentacoes.js),
   exatamente como se o colaborador não estivesse cadastrado. Nunca inventa
   um T01/T02/T03 pra quem não tem um turno operacional de verdade.
   ============================================================================ */

/* "15000923" (ou 15000923 número, ou com espaços) -> "EX000923".
   null quando o código não bate com o formato esperado (não começa com 15
   depois de completar 8 dígitos) — nunca inventa um login errado. */
function codigoAtivoParaLogin(codigo) {
  const digitos = String(codigo == null ? '' : codigo).replace(/\D/g, '');
  if (!digitos) return null;
  const completo = digitos.padStart(8, '0');
  if (completo.length !== 8 || completo.slice(0, 2) !== '15') return null;
  return 'EX' + completo.slice(2);
}

/* "1º Turno" / "2o turno" / "3° TURNO" -> T01/T02/T03. Qualquer outra coisa
   (ADM, CARGO DE CONFIANCA, em branco, texto de horário livre tipo "14:48
   AS 18:40...") devolve null -- vira sinal de "sem turno operacional
   cadastrado", não um turno errado. */
const REGEX_TURNO_OPERACIONAL = [
  { re: /\b1\D{0,2}turno\b/i, turno: 'T01' },
  { re: /\b2\D{0,2}turno\b/i, turno: 'T02' },
  { re: /\b3\D{0,2}turno\b/i, turno: 'T03' },
];
function turnoDoHorario(horarioBruto) {
  const texto = String(horarioBruto || '').trim();
  for (let i = 0; i < REGEX_TURNO_OPERACIONAL.length; i++) {
    if (REGEX_TURNO_OPERACIONAL[i].re.test(texto)) return REGEX_TURNO_OPERACIONAL[i].turno;
  }
  return null;
}

/* registros: [{codigo, nome, horario}] já extraídos da planilha (coluna A,
   B, H da aba "Ativos") — a leitura do .xlsx em si (SheetJS) fica no
   index.html, esta função só sabe transformar linhas já tabuladas. Devolve
   as linhas prontas pra upsert em dim_colaboradores_turno, avisando o que
   não deu pra aproveitar (nunca em silêncio). */
function construirLinhasColaboradores(registros, onAviso) {
  const avisar = onAviso || function () {};
  const linhas = [];
  let semCodigoValido = 0;
  (registros || []).forEach(function (r) {
    const login = codigoAtivoParaLogin(r.codigo);
    if (!login) { semCodigoValido++; return; }
    linhas.push({
      login: login,
      nome: String(r.nome || '').trim(),
      turno: turnoDoHorario(r.horario),
      turno_bruto: String(r.horario == null ? '' : r.horario).trim(),
      atualizado_em: new Date().toISOString(),
    });
  });
  if (semCodigoValido > 0) {
    avisar(semCodigoValido.toLocaleString('pt-BR') + ' linha(s) com código de ativo fora do formato ' +
      'esperado (15xxxxxx) — ignoradas.');
  }
  return linhas;
}

const LOTE_COLABORADORES = 500;
async function upsertColaboradoresTurno(supabaseClient, linhas, onAviso) {
  const avisar = onAviso || function () {};
  if (!linhas || linhas.length === 0) return;
  const lotes = [];
  for (let i = 0; i < linhas.length; i += LOTE_COLABORADORES) lotes.push(linhas.slice(i, i + LOTE_COLABORADORES));
  for (let i = 0; i < lotes.length; i++) {
    const { error } = await supabaseClient.from('dim_colaboradores_turno')
      .upsert(lotes[i], { onConflict: 'login' });
    if (error) throw error;
  }
}

/* Orquestração — chamada pelo index.html (tela Admin > Abastecimento). */
async function processarColaboradores(supabaseClient, registros, onProgresso) {
  const avisar = onProgresso || function () {};
  avisar('Lendo a base de Ativos…');
  const linhas = construirLinhasColaboradores(registros, avisar);
  if (linhas.length === 0) {
    avisar('Nenhuma linha aproveitável — confira se a planilha tem as colunas Código e Horario.');
    return { total: 0, por_turno: { T01: 0, T02: 0, T03: 0, sem_turno: 0 } };
  }
  const porTurno = { T01: 0, T02: 0, T03: 0, sem_turno: 0 };
  linhas.forEach(function (l) { porTurno[l.turno || 'sem_turno']++; });

  avisar('Gravando ' + linhas.length.toLocaleString('pt-BR') + ' colaborador(es)…');
  await upsertColaboradoresTurno(supabaseClient, linhas, avisar);

  avisar('Concluído: ' + porTurno.T01.toLocaleString('pt-BR') + ' no T01, ' +
    porTurno.T02.toLocaleString('pt-BR') + ' no T02, ' + porTurno.T03.toLocaleString('pt-BR') + ' no T03, ' +
    porTurno.sem_turno.toLocaleString('pt-BR') + ' sem turno operacional (ADM/confiança/outro — ' +
    'movimentação desses logins usa o horário do movimento pra presumir o turno).');
  return { total: linhas.length, por_turno: porTurno };
}

window.codigoAtivoParaLogin = codigoAtivoParaLogin;
window.turnoDoHorario = turnoDoHorario;
window.construirLinhasColaboradores = construirLinhasColaboradores;
window.upsertColaboradoresTurno = upsertColaboradoresTurno;
window.processarColaboradores = processarColaboradores;

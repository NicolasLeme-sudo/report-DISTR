/* ============================================================================
   RESSUPRIMENTO — regras compartilhadas entre o report (index.html) e o telão (tv.html)
   ============================================================================
   Interruptor Alocação no Picking / Retirada do Pulmão / Geral (soma) e a
   agregação do histórico por dia, turno e segmento. Vieram do index.html
   (05/11/2026) para o telão DISTR somar igual ao report.
   ============================================================================ */
(function (raiz) {
function normalizarTurnoLegado(turno) {
  return turno === 'T02_T03' ? 'T02' : turno;
}

function diasDoHistorico(linhas) {
  const porDia = new Map();
  linhas.forEach(function (h) {
    const turno = normalizarTurnoLegado(h.turno);
    if (!porDia.has(h.dia)) porDia.set(h.dia, { dia: h.dia, pecas: 0, movimentos: 0, turnos: {} });
    const d = porDia.get(h.dia);
    d.pecas += h.pecas; d.movimentos += h.movimentos;
    if (!d.turnos[turno]) d.turnos[turno] = { pecas: 0, movimentos: 0 };
    d.turnos[turno].pecas += h.pecas; d.turnos[turno].movimentos += h.movimentos;
  });
  return Array.from(porDia.values()).sort(function (a, b) { return a.dia < b.dia ? -1 : 1; });
}

function porTurnoDoHistorico(linhas) {
  const mapa = new Map();
  linhas.forEach(function (h) {
    const turno = normalizarTurnoLegado(h.turno);
    if (!mapa.has(turno)) mapa.set(turno, { turno: turno, pecas: 0, movimentos: 0 });
    const t = mapa.get(turno); t.pecas += h.pecas; t.movimentos += h.movimentos;
  });
  return Array.from(mapa.values()).sort(function (a, b) { return b.pecas - a.pecas; });
}

function porSegmentoDoHistorico(linhas) {
  const mapa = new Map();
  linhas.forEach(function (h) {
    if (!mapa.has(h.segmento)) mapa.set(h.segmento, { segmento: h.segmento, pecas: 0, movimentos: 0 });
    const s = mapa.get(h.segmento); s.pecas += h.pecas; s.movimentos += h.movimentos;
  });
  return Array.from(mapa.values()).sort(function (a, b) { return b.pecas - a.pecas; });
}

function combinarEtapaRessup(etapaRessup, histAlocacaoBruto, histRetiradaBruto, opsAlocacaoBruto, opsRetiradaBruto) {
  let historicoRessuprimento, historicoOperadorRessuprimento;
  if (etapaRessup === 'retirada') {
    historicoRessuprimento = histRetiradaBruto.map(function (h) { return { dia: h.dia, segmento: h.segmento, turno: h.turno, pecas: h.pecas, movimentos: h.movimentos }; });
    historicoOperadorRessuprimento = opsRetiradaBruto;
  } else if (etapaRessup === 'geral') {
    const porChave = new Map();
    const somar = function (h, sinal, pecas, movs) {
      const k = h.dia + '|' + h.segmento + '|' + h.turno;
      if (!porChave.has(k)) porChave.set(k, { dia: h.dia, segmento: h.segmento, turno: h.turno, pecas: 0, movimentos: 0 });
      const x = porChave.get(k); x.pecas += sinal * (Number(pecas) || 0); x.movimentos += sinal * (Number(movs) || 0);
    };
    histAlocacaoBruto.forEach(function (h) { somar(h, 1, h.pecas, h.movimentos); });
    histRetiradaBruto.forEach(function (h) { somar(h, 1, h.pecas, h.movimentos); });
    historicoRessuprimento = Array.from(porChave.values()).filter(function (x) { return x.pecas > 0 || x.movimentos > 0; });
    const vistos = new Set();
    historicoOperadorRessuprimento = opsAlocacaoBruto.concat(opsRetiradaBruto).filter(function (o) {
      const k = o.dia + '|' + o.turno + '|' + o.login; if (vistos.has(k)) return false; vistos.add(k); return true;
    });
  } else {
    historicoRessuprimento = histAlocacaoBruto;
    historicoOperadorRessuprimento = opsAlocacaoBruto;
  }
  return { historico: historicoRessuprimento, operadores: historicoOperadorRessuprimento };
}

/* Top operadores de um dia, em peças (telão DISTR, 05/11/2026). Alocação lê ressuprimento_operador_diario,
   retirada lê ressuprimento_retirada_operador; geral soma as duas por login. Linhas sem a coluna pecas
   (antes de migracao_operador_pecas.sql) contam zero. `turno` (opcional): só esse turno (T02_T03 antigo vale como T02). */
function topOperadoresDia(etapa, opsAlocacao, opsRetirada, dia, n, turno) {
  const fontes = etapa === 'retirada' ? [opsRetirada] : etapa === 'geral' ? [opsAlocacao, opsRetirada] : [opsAlocacao];
  const porLogin = new Map();
  fontes.forEach(function (lista) {
    (lista || []).forEach(function (o) {
      if (o.dia !== dia) return;
      if (turno && normalizarTurnoLegado(o.turno) !== turno) return;
      if (!porLogin.has(o.login)) porLogin.set(o.login, { login: o.login, nome: o.nome || '', pecas: 0, movimentos: 0 });
      const x = porLogin.get(o.login);
      x.pecas += Number(o.pecas) || 0; x.movimentos += Number(o.movimentos) || 0;
      if (!x.nome && o.nome) x.nome = o.nome;
    });
  });
  return Array.from(porLogin.values()).filter(function (x) { return x.pecas > 0; })
    .sort(function (a, b) { return b.pecas - a.pecas; }).slice(0, n || 5);
}

raiz.RessupCalc = {
  normalizarTurnoLegado: normalizarTurnoLegado, diasDoHistorico: diasDoHistorico, porTurnoDoHistorico: porTurnoDoHistorico,
  porSegmentoDoHistorico: porSegmentoDoHistorico, combinarEtapaRessup: combinarEtapaRessup, topOperadoresDia: topOperadoresDia,
};
if (typeof module !== 'undefined' && module.exports) module.exports = raiz.RessupCalc;
})(typeof window !== 'undefined' ? window : globalThis);

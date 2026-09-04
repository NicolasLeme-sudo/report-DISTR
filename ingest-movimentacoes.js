/* ============================================================================
   REPORT DISTRIBUIDORA — ingest-movimentacoes.js
   ============================================================================
   RESPONSABILIDADE ÚNICA: ler o Kardex de endereços/volumes (EX000796 —
   "MOVIMENTOS DE ESTOQUE") e devolver o snapshot de RESSUPRIMENTO POR DIA E
   TURNO. Mesma regra do ingest.js (README seção 1): nenhum document.*, nenhum
   innerHTML — se é sobre COMO aparece, é do index.html; se é sobre COMO o
   número é calculado, é daqui.

   ----------------------------------------------------------------------------
   O RELATÓRIO
   ----------------------------------------------------------------------------
   Uma linha por PERNA de movimento, delimitado por "|":
     ARTIGO|DESCRICAO|COR|TAMANHO|DATA|TIPO_MOVTO|REF|QTDE_ANT|QTDE_MOVTO|
     RESERVA|ARMAZ|SUB_ARMAZ|ENDERECO|VOLUME|LOGIN|NOME
   ENDERECO = "rua,nivel,box". DATA = "DD/MM/AA HH:MM".

   ----------------------------------------------------------------------------
   AS TRÊS ARMADILHAS — todas confirmadas contra o arquivo real de 03–31/08/2026
   ----------------------------------------------------------------------------
   1. ZONA NÃO SE DEDUZ DA RUA, SE DEDUZ DO NÍVEL.
      As ruas 01–15 aparecem TANTO no relatório de Picking quanto no de Pulmão.
      O que separa é o nível: 1–7 é estanteria de Picking, 8–12 é porta-pallet
      de Pulmão. Conferido endereço a endereço nos dois arquivos do dia
      02/09/2026: 17.481 endereços de Picking, 5.170 de Pulmão, ZERO em comum.
      Classificar por rua (como o gabarito antigo fazia) mistura as duas zonas.

   2. O RESSUPRIMENTO ACONTECE EM DOIS SALTOS.
      As ruas 500 ("Baixar Ressuprimento") e 600 ("Subir Ressuprimento") são
      corredor de passagem: o operador baixa Pulmão -> 500 e depois leva
      500 -> Picking. Somar todos os pares conta a mesma peça duas vezes —
      7.421 volumes entraram E saíram do trânsito no período medido.
      Por isso o que conta como "ressuprido" é o movimento que CHEGA no
      Picking, nunca o que sai do Pulmão: cada peça é contada uma vez só, e
      não depende de a primeira perna estar dentro da janela do arquivo.

   3. TL+ / TL- NO MESMO ENDEREÇO É FISCAL, NÃO É RESSUPRIMENTO.
      75.525 dos 120.564 pares do arquivo real têm o mesmo endereço nas duas
      pontas, com login de faturamento no TL+ e do fiscal no TL- (confirmado
      pela operação em 02/09/2026): é entrada/importação de material, não
      movimentação física. Some-se a isso as linhas sem VOLUME (ajuste fiscal),
      e sobram os pares que representam peça andando pelo armazém.
   ============================================================================ */

/* Ruas que não são nem Picking nem Pulmão: corredor de passagem e endereços de
   sinalização (sujeira/perca/trânsito). Gabarito da operação — rua fora desta
   lista é classificada pelo nível. */
const RUAS_TRANSITO = { 21: 1, 24: 1, 26: 1, 27: 1, 98: 1, 100: 1, 500: 1, 600: 1 };

/* Nível a partir do qual o endereço é porta-pallet (Pulmão). Abaixo disso é
   estanteria de Picking. Medido nos dois relatórios de posição, não chutado. */
const NIVEL_MINIMO_PULMAO = 8;

function classificarZona(rua, nivel) {
  const r = Number(rua) || 0;
  if (RUAS_TRANSITO[r]) return 'TRANSITO';
  return (Number(nivel) || 0) >= NIVEL_MINIMO_PULMAO ? 'PULMAO' : 'PICKING';
}

/* Ruas de trânsito que NÃO são fila de ressuprimento, mesmo recebendo material
   que saiu do Pulmão. A 98 é staging de RECEBIMENTO (material fica ali da
   doca até ser armazenado) — confirmado com a operação em 05/09/2026. Contá-la
   inflava a "Fila em andamento" com 5.191 peças (12% do total) que não estão
   esperando subir pro Picking. As demais ruas de trânsito continuam contando,
   inclusive sujeira/perca (26/27) — decisão da operação na mesma conversa. */
const RUAS_FORA_DA_FILA = { 98: 1 };

/* ============================================================================
   TURNOS — gabarito da operação
   ============================================================================
   T01      05:00–14:47
   T02      14:48–00:15   <- absorve o antigo bloco "sobreposto" (20:00–00:15)
   T03      00:16–04:59

   Até 04/09/2026 o bloco 20:00–00:15 era um balde à parte ("T02/T03") porque
   o Kardex não diz a qual turno o operador pertence. Isso mudou: agora dá
   pra saber o turno REAL de cada login pela base de Ativos
   (dim_colaboradores_turno, ver ingest-colaboradores.js) — esta janela por
   HORÁRIO vira só o FALLBACK pra quando o login não está cadastrado (ou é
   ADM/confiança, que não tem turno operacional). Decisão da operação:
   quando é chute, o bloco 20:00–00:15 chuta T02.
   ============================================================================ */
const TURNOS = [
  { id: 'T01', rotulo: 'T01', janela: '05:00–14:47' },
  { id: 'T02', rotulo: 'T02', janela: '14:48–00:15' },
  { id: 'T03', rotulo: 'T03', janela: '00:16–04:59' },
];

function turnoDe(minutosDoDia) {
  const m = Number(minutosDoDia) || 0;
  if (m >= 300 && m < 888) return 'T01';
  if (m >= 888 || m < 16) return 'T02';
  return 'T03';
}

/* "20/08/26 13:40" -> { dia: '2026-08-20', minutos: 820 }
   Devolve null quando não casa — a linha é descartada e contada, nunca
   silenciosamente somada com data errada. */
function parsearDataHora(texto) {
  const m = String(texto || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]), ano = 2000 + Number(m[3]);
  const hh = Number(m[4]), mm = Number(m[5]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23 || mm > 59) return null;
  const iso = ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  // Movimento entre 00:00 e 00:15 pertence ao T02 que começou no dia anterior
  // (fallback por horário), mas fica no dia de CALENDÁRIO mesmo: são 150
  // linhas em 340.503 no arquivo real (0,04%), não compensa inventar "dia
  // operacional" por isso.
  return { dia: iso, minutos: hh * 60 + mm };
}

/* Cabeçalho lido pelo NOME da coluna, não por posição — mesma decisão do
   parser de Balanço: se o sistema reordenar ou incluir coluna, continua
   achando cada campo. */
const ALIAS_COLUNAS_KARDEX = {
  artigo:    ['artigo'],
  descricao: ['descricao', 'descrição'],
  cor:       ['cor'],
  tamanho:   ['tamanho'],
  data:      ['data'],
  tipo:      ['tipo_movto', 'tipo movto', 'tipo'],
  ref:       ['ref'],
  qtd:       ['qtde_movto', 'qtde movto', 'qtd_movto'],
  endereco:  ['endereco', 'endereço'],
  volume:    ['volume'],
  login:     ['login'],
  nome:      ['nome'],
};

const COLUNAS_KARDEX_OBRIGATORIAS = ['artigo', 'cor', 'tamanho', 'data', 'tipo', 'ref', 'qtd', 'endereco', 'volume'];

function mapearColunasKardex(linhaCabecalho) {
  const nomes = linhaCabecalho.split('|').map(function (s) {
    return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  });
  const idx = {};
  Object.keys(ALIAS_COLUNAS_KARDEX).forEach(function (campo) {
    const aliases = ALIAS_COLUNAS_KARDEX[campo];
    for (let i = 0; i < nomes.length; i++) {
      if (aliases.indexOf(nomes[i]) !== -1) { idx[campo] = i; return; }
    }
  });
  const faltando = COLUNAS_KARDEX_OBRIGATORIAS.filter(function (c) { return idx[c] === undefined; });
  if (faltando.length) {
    throw new Error(
      'Coluna' + (faltando.length > 1 ? 's' : '') + ' não encontrada' + (faltando.length > 1 ? 's' : '') +
      ' no cabeçalho do Kardex: ' + faltando.map(function (c) { return '"' + ALIAS_COLUNAS_KARDEX[c][0] + '"'; }).join(', ') +
      '. O cabeçalho lido foi: ' + nomes.filter(Boolean).join(' | ') +
      '. Se o sistema renomeou alguma coluna, o alias precisa ser adicionado em ' +
      'ALIAS_COLUNAS_KARDEX (ingest-movimentacoes.js).'
    );
  }
  return idx;
}

/* ============================================================================
   PARSE — devolve as PERNAS brutas (uma por linha TL+/TL-), sem casar par ainda
   ============================================================================ */
function parsearKardex(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const pernas = [];
  let idx = null;
  const periodo = { de: null, ate: null };
  let ignoradasOutroTipo = 0;
  let ignoradasDataInvalida = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    if (!idx) {
      // Cabeçalho do relatório: "...|de:03/08/2026|ate:31/08/2026|..."
      const mDe = linha.match(/de:\s*(\d{2}\/\d{2}\/\d{4})/i);
      const mAte = linha.match(/ate:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (mDe) periodo.de = mDe[1];
      if (mAte) periodo.ate = mAte[1];
      if (/(^|\|)\s*artigo\s*\|/i.test(linha)) idx = mapearColunasKardex(linha);
      continue;
    }

    const p = linha.split('|');
    if (p.length < 10) continue;

    const tipo = (p[idx.tipo] || '').trim().toUpperCase();
    if (tipo !== 'TL+' && tipo !== 'TL-') { ignoradasOutroTipo++; continue; }

    const dh = parsearDataHora(p[idx.data]);
    if (!dh) { ignoradasDataInvalida++; continue; }

    const endereco = (p[idx.endereco] || '').trim();
    const partes = endereco.split(',');

    pernas.push({
      artigo: (p[idx.artigo] || '').trim(),
      descricao: idx.descricao !== undefined ? (p[idx.descricao] || '').trim() : '',
      cor: (p[idx.cor] || '').trim(),
      tamanho: (p[idx.tamanho] || '').trim(),
      dia: dh.dia,
      minutos: dh.minutos,
      data_bruta: (p[idx.data] || '').trim(),
      tipo: tipo,
      ref: (p[idx.ref] || '').trim(),
      qtd: window.numeroBR(p[idx.qtd]),
      endereco: endereco,
      rua: (partes[0] || '').trim(),
      nivel: (partes[1] || '').trim(),
      box: (partes[2] || '').trim(),
      volume: (p[idx.volume] || '').trim(),
      login: idx.login !== undefined ? (p[idx.login] || '').trim() : '',
      nome: idx.nome !== undefined ? (p[idx.nome] || '').trim() : '',
    });
  }

  if (!idx) {
    throw new Error(
      'Cabeçalho de colunas não encontrado no Kardex. A linha de cabeçalho é ' +
      'localizada por uma coluna chamada "ARTIGO" — se o sistema renomeou essa ' +
      'coluna, o alias precisa ser ajustado em ingest-movimentacoes.js.'
    );
  }

  return {
    pernas: pernas,
    periodo: periodo,
    ignoradas_outro_tipo: ignoradasOutroTipo,
    ignoradas_data_invalida: ignoradasDataInvalida,
  };
}

/* ============================================================================
   CASAMENTO DAS PERNAS EM MOVIMENTOS
   ============================================================================
   Chave do par: Artigo + Cor + Tamanho + Data/hora + REF (confirmada pela
   operação em 02/09/2026). A REF sozinha NÃO serve: ela se repete em milhares
   de linhas não relacionadas (é número de pedido/lote, não do movimento).

   Grupo que não tem exatamente 1 TL+ e 1 TL- fica de fora e é CONTADO — pode
   ser movimento cuja outra perna caiu fora da janela do relatório. Sumir com
   ele em silêncio esconderia volume real.
   ============================================================================ */
const SEP = '|#|';

function casarMovimentos(pernas) {
  const grupos = new Map();
  pernas.forEach(function (p) {
    const chave = [p.artigo, p.cor, p.tamanho, p.data_bruta, p.ref].join(SEP);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  });

  const movimentos = [];
  let semParExato = 0, fiscalMesmoEndereco = 0, semVolume = 0;

  grupos.forEach(function (g) {
    if (g.length !== 2) { semParExato += g.length; return; }
    const saida = g[0].tipo === 'TL-' ? g[0] : g[1];
    const entrada = g[0].tipo === 'TL-' ? g[1] : g[0];
    if (saida.tipo !== 'TL-' || entrada.tipo !== 'TL+') { semParExato += 2; return; }

    // Armadilha 3: mesmo endereço nas duas pontas = fiscal/importação.
    if (saida.endereco === entrada.endereco) { fiscalMesmoEndereco++; return; }
    // Sem volume = ajuste fiscal / importação de material (regra da operação).
    if (!saida.volume || !entrada.volume) { semVolume++; return; }

    movimentos.push({
      artigo: entrada.artigo,
      descricao: entrada.descricao,
      cor: entrada.cor,
      tamanho: entrada.tamanho,
      dia: entrada.dia,
      minutos: entrada.minutos,
      turno: turnoDe(entrada.minutos),
      qtd: entrada.qtd,
      volume: entrada.volume,
      login: entrada.login,
      nome: entrada.nome,
      origem: { endereco: saida.endereco, rua: saida.rua, zona: classificarZona(saida.rua, saida.nivel) },
      destino: { endereco: entrada.endereco, rua: entrada.rua, zona: classificarZona(entrada.rua, entrada.nivel) },
    });
  });

  return {
    movimentos: movimentos,
    descartados: {
      sem_par_exato: semParExato,
      fiscal_mesmo_endereco: fiscalMesmoEndereco,
      sem_volume: semVolume,
    },
  };
}

/* ============================================================================
   AGREGAÇÃO
   ============================================================================
   RESSUPRIDO = movimento cujo DESTINO é o Picking, vindo de fora do Picking
   (direto do Pulmão ou pelo corredor de trânsito). Definição fechada com a
   operação em 02/09/2026 — ver armadilha 2 no topo do arquivo. Realocação
   Picking -> Picking não conta: a peça já estava na estanteria.

   EM TRÂNSITO = saiu do Pulmão e parou no corredor de ressuprimento (500/600,
   21/100 legados, e as ruas de sinalização). É a fila de ressuprimento em
   andamento: já foi baixado, ainda não chegou na estanteria. A rua 98 fica
   FORA (ver RUAS_FORA_DA_FILA): lá é staging de recebimento, não fila.
   ============================================================================ */
function ehRessuprimento(mov) {
  return mov.destino.zona === 'PICKING' && mov.origem.zona !== 'PICKING';
}
function ehBaixaPendente(mov) {
  if (mov.origem.zona !== 'PULMAO' || mov.destino.zona !== 'TRANSITO') return false;
  return !RUAS_FORA_DA_FILA[Number(mov.destino.rua) || 0];
}

/* Dia seguinte/anterior a partir de "AAAA-MM-DD", em UTC — nunca escorrega de
   dia por fuso, mesmo padrão de parsearDataHora acima. */
function diaISO(delta, isoBase) {
  const p = String(isoBase).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta, 12));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/* "DD/MM/AAAA" (como vem no cabeçalho do Kardex, campo "ate:") -> "AAAA-MM-DD". */
function dataBrParaIso(dataBr) {
  const m = String(dataBr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return m[3] + '-' + m[2] + '-' + m[1];
}

/* Quantos dias de "de" até "ate" (ambos AAAA-MM-DD) — usado só pra exibir há
   quanto tempo uma PFA está pendente (FIFO), nunca em soma de negócio. */
function diferencaDias(deIso, ateIso) {
  const p1 = String(deIso).split('-').map(Number), p2 = String(ateIso).split('-').map(Number);
  const d1 = Date.UTC(p1[0], p1[1] - 1, p1[2]), d2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
  return Math.round((d2 - d1) / 86400000);
}

/* Resolve segmento_macro de uma família sem depender de ingest-ressuprimento.js
   ter sido carregado (não é garantido na ordem de testes) — se a função global
   não existir, o segmento fica null em vez de quebrar o Kardex inteiro. */
function segmentoMacroSeDisponivel(fam) {
  if (!fam || typeof window.segmentoMacro !== 'function') return null;
  return window.segmentoMacro(fam.segmento, fam.categoria);
}

/* ============================================================================
   CRUZAMENTO COM O PLANEJAMENTO — D0 / D-1 / sem planejamento
   ============================================================================
   Cada linha de `planejamento` é {pfa, familia_codigo, turno, data}, lançada
   manualmente pela assistente (tela Admin > Planejamento) — é permanente,
   nunca é sobrescrita por upload de Kardex. `pecasPorFamiliaDia` é um
   Map("familia|dia" -> peças) — pode vir de UM Kardex (uso em
   construirSnapshotMovimentacoes) ou do HISTÓRICO acumulado de vários
   uploads (ressuprimento_familia_diario, uso em index.html na hora de
   renderizar a tela) — a conta é idêntica nos dois casos:

     D0                    -> ressuprido na PRÓPRIA data planejada.
     D-1                   -> ressuprido no dia ANTERIOR (turno da noite
                              adiantando o que o turno seguinte vai separar).
     aguardando            -> data planejada é DEPOIS do último dia que temos
                              movimento pra essa fonte (ainda não deu tempo).
     planejado_nao_ressuprido -> nem D0, nem D-1, nem aguardando: pendente.

   `ultimoDia` é o corte que decide "aguardando" vs "pendente" — o último dia
   coberto pelo Kardex quando a fonte é um snapshot único, ou o dia mais
   recente presente no histórico acumulado quando a fonte é o histórico.
   ============================================================================ */
function classificarPlanejamento(planejamento, pecasPorFamiliaDia, ultimoDia, mapaFamilias) {
  mapaFamilias = mapaFamilias || new Map();
  return planejamento.map(function (p) {
    const pecasD0 = pecasPorFamiliaDia.get(p.familia_codigo + '|' + p.data) || 0;
    const pecasD1 = pecasPorFamiliaDia.get(p.familia_codigo + '|' + diaISO(-1, p.data)) || 0;
    let status, pecas, diasPendente = null;
    if (pecasD0 > 0) { status = 'D0'; pecas = pecasD0; }
    else if (pecasD1 > 0) { status = 'D-1'; pecas = pecasD1; }
    else if (ultimoDia && p.data > ultimoDia) { status = 'aguardando'; pecas = 0; }
    else {
      status = 'planejado_nao_ressuprido'; pecas = 0;
      // FIFO: há quantos dias essa PFA está pendente, contado até o último
      // dia que já temos movimento (não "hoje" — a fonte pode ser de ontem).
      if (ultimoDia) diasPendente = Math.max(0, diferencaDias(p.data, ultimoDia));
    }
    const famPlano = mapaFamilias.get(p.familia_codigo);
    return {
      pfa: p.pfa, familia_codigo: p.familia_codigo, familia_nome: famPlano ? famPlano.categoria : p.familia_codigo,
      turno: p.turno, data: p.data, status: status, pecas: pecas, dias_pendente: diasPendente,
    };
  });
}

/* Inverso de classificarPlanejamento: família ressuprida sem nenhuma PFA
   planejada pra ela, na própria data ou no dia seguinte — o "ressupriu à
   toa" que a operação pediu pra enxergar. Mesmo motivo de ser função
   separada: chamada tanto com `pecasPorFamiliaDia` de um Kardex só quanto
   do histórico acumulado.

   `porFamiliaDiaTurno` (opcional, Map "familia|dia|turno" -> {pecas,...}) só
   serve pra anexar a quebra por turno em CADA linha (`por_turno: {T01: x,
   T02: y, T03: z}`) — pedido do usuário, 05/09/2026: "o que os turnos
   ressupriram que não foi D0 nem D-1". Não muda QUAIS famílias/dias entram
   na lista — essa decisão continua turno-agnóstica, feita só com
   `pecasPorFamiliaDia`. */
function calcularSemPlanejamento(pecasPorFamiliaDia, planejamento, mapaFamilias, porFamiliaDiaTurno) {
  mapaFamilias = mapaFamilias || new Map();
  const familiasPlanejadasPorDia = new Map(); // dia -> Set(familia_codigo)
  planejamento.forEach(function (p) {
    if (!familiasPlanejadasPorDia.has(p.data)) familiasPlanejadasPorDia.set(p.data, new Set());
    familiasPlanejadasPorDia.get(p.data).add(p.familia_codigo);
  });
  const resultado = [];
  pecasPorFamiliaDia.forEach(function (pecas, chave) {
    const partes = chave.split('|');
    const familiaCod = partes[0], dia = partes[1];
    const planejadoHoje = familiasPlanejadasPorDia.has(dia) && familiasPlanejadasPorDia.get(dia).has(familiaCod);
    const diaSeguinte = diaISO(1, dia);
    const planejadoAmanha = familiasPlanejadasPorDia.has(diaSeguinte) && familiasPlanejadasPorDia.get(diaSeguinte).has(familiaCod);
    if (!planejadoHoje && !planejadoAmanha) {
      const fam = mapaFamilias.get(familiaCod);
      const porTurno = {};
      if (porFamiliaDiaTurno) {
        TURNOS.forEach(function (t) {
          const fdt = porFamiliaDiaTurno.get(chave + '|' + t.id);
          if (fdt && fdt.pecas) porTurno[t.id] = fdt.pecas;
        });
      }
      resultado.push({ familia_codigo: familiaCod, familia_nome: fam ? fam.categoria : familiaCod, dia: dia, pecas: pecas, por_turno: porTurno });
    }
  });
  resultado.sort(function (a, b) { return b.pecas - a.pecas; });
  return resultado;
}

function construirSnapshotMovimentacoes(parsed, meta, mapaArtigoFamilia, mapaFamilias, planejamento, mapaColaboradorTurno) {
  mapaArtigoFamilia = mapaArtigoFamilia || new Map();
  mapaFamilias = mapaFamilias || new Map();
  planejamento = planejamento || [];
  mapaColaboradorTurno = mapaColaboradorTurno || new Map();

  const casado = casarMovimentos(parsed.pernas);
  const movs = casado.movimentos;

  const porDia = new Map();       // dia -> agregado do dia
  const porTurno = new Map();     // turno -> { pecas, movimentos }
  const porSegmento = new Map();  // segmento_macro -> { pecas, movimentos }
  const rotas = new Map();        // "ZONA -> ZONA" -> { pecas, movimentos }
  const operadores = new Map();   // login -> { nome, pecas, movimentos }
  const pecasPorFamiliaDia = new Map(); // "familia|dia" -> peças ressupridas (turno-agnóstico, usado no D0/D-1)
  // dia+família+turno -> { pecas, movimentos } — igual à ideia de
  // porDiaSegmentoTurno, mas por família: vira ressuprimento_familia_diario
  // (histórico) e alimenta a quebra por turno do "sem planejamento" (o que
  // cada turno ressupriu que não era nem D0 nem D-1 de nenhuma PFA — pedido
  // do usuário, 05/09/2026). A classificação D0/D-1 continua turno-agnóstica
  // (pecasPorFamiliaDia acima) — decisão já tomada antes, não muda aqui.
  const porFamiliaDiaTurno = new Map();
  // dia+segmento+turno -> { pecas, movimentos } — é essa quebra que vira
  // ressuprimento_historico_diario (upsert por dia/segmento/turno), pra
  // manter um histórico contínuo entre uploads de Kardex, já que cada
  // arquivo cobre só um período e some quando o próximo é processado.
  const porDiaSegmentoTurno = new Map();

  let pecasRessupridas = 0, movimentosRessuprimento = 0;
  let pecasEmTransito = 0, movimentosEmTransito = 0;
  let semFamiliaPecas = 0, semFamiliaMovimentos = 0;
  const artigosSemFamilia = new Set();
  // Quantos movimentos tiveram o turno resolvido pelo cadastro real do
  // colaborador (dim_colaboradores_turno) vs. chutado pelo horário do
  // movimento (login não cadastrado, ou ADM/confiança, que não tem turno
  // operacional) — visível na tela, nunca escondido.
  let porCadastro = 0, porHorario = 0;

  movs.forEach(function (m) {
    // Turno REAL do colaborador quando existir cadastro pra esse login;
    // senão mantém o turno já chutado pelo horário do movimento (turnoDe,
    // calculado em casarMovimentos). Nunca sobrescreve com um turno vazio —
    // ADM/CARGO DE CONFIANCA e login desconhecido não têm entrada aqui.
    const turnoCadastrado = mapaColaboradorTurno.get(m.login);
    if (turnoCadastrado) { m.turno = turnoCadastrado; porCadastro++; } else { porHorario++; }

    const rota = m.origem.zona + ' -> ' + m.destino.zona;
    if (!rotas.has(rota)) rotas.set(rota, { rota: rota, pecas: 0, movimentos: 0 });
    const r = rotas.get(rota);
    r.pecas += m.qtd; r.movimentos += 1;

    if (ehBaixaPendente(m)) { pecasEmTransito += m.qtd; movimentosEmTransito += 1; }
    if (!ehRessuprimento(m)) return;

    pecasRessupridas += m.qtd;
    movimentosRessuprimento += 1;

    // Família/segmento — resolvidos pelo dicionário artigo→família (populado
    // a cada upload de Picking/Pulmão; ver upsertArtigoFamilia). Artigo sem
    // entrada ainda no dicionário (nunca apareceu num upload de Picking/
    // Pulmão) fica sinalizado, nunca some do total em silêncio.
    const familiaCod = mapaArtigoFamilia.get(m.artigo);
    const fam = familiaCod ? mapaFamilias.get(familiaCod) : null;
    const segMacro = segmentoMacroSeDisponivel(fam);
    if (!familiaCod) {
      semFamiliaPecas += m.qtd; semFamiliaMovimentos += 1; artigosSemFamilia.add(m.artigo);
    } else {
      const chaveFD = familiaCod + '|' + m.dia;
      pecasPorFamiliaDia.set(chaveFD, (pecasPorFamiliaDia.get(chaveFD) || 0) + m.qtd);
      const chaveFDT = chaveFD + '|' + m.turno;
      if (!porFamiliaDiaTurno.has(chaveFDT)) {
        porFamiliaDiaTurno.set(chaveFDT, { dia: m.dia, familia_codigo: familiaCod, turno: m.turno, pecas: 0, movimentos: 0 });
      }
      const fdt = porFamiliaDiaTurno.get(chaveFDT);
      fdt.pecas += m.qtd; fdt.movimentos += 1;
    }
    const rotSeg = segMacro || 'SEM FAMÍLIA';
    if (!porSegmento.has(rotSeg)) porSegmento.set(rotSeg, { segmento: rotSeg, pecas: 0, movimentos: 0 });
    const sInfo = porSegmento.get(rotSeg);
    sInfo.pecas += m.qtd; sInfo.movimentos += 1;

    const chaveDST = m.dia + '|' + rotSeg + '|' + m.turno;
    if (!porDiaSegmentoTurno.has(chaveDST)) {
      porDiaSegmentoTurno.set(chaveDST, { dia: m.dia, segmento: rotSeg, turno: m.turno, pecas: 0, movimentos: 0 });
    }
    const dst = porDiaSegmentoTurno.get(chaveDST);
    dst.pecas += m.qtd; dst.movimentos += 1;

    if (!porDia.has(m.dia)) {
      porDia.set(m.dia, { dia: m.dia, pecas: 0, movimentos: 0, turnos: {}, operadores: new Set() });
    }
    const d = porDia.get(m.dia);
    d.pecas += m.qtd; d.movimentos += 1;
    d.operadores.add(m.login);
    if (!d.turnos[m.turno]) d.turnos[m.turno] = { pecas: 0, movimentos: 0 };
    d.turnos[m.turno].pecas += m.qtd;
    d.turnos[m.turno].movimentos += 1;

    if (!porTurno.has(m.turno)) porTurno.set(m.turno, { turno: m.turno, pecas: 0, movimentos: 0 });
    const t = porTurno.get(m.turno);
    t.pecas += m.qtd; t.movimentos += 1;

    if (!operadores.has(m.login)) operadores.set(m.login, { login: m.login, nome: m.nome, pecas: 0, movimentos: 0 });
    const o = operadores.get(m.login);
    o.pecas += m.qtd; o.movimentos += 1;
  });

  const dias = Array.from(porDia.values())
    .map(function (d) {
      return { dia: d.dia, pecas: d.pecas, movimentos: d.movimentos, turnos: d.turnos, operadores: d.operadores.size };
    })
    .sort(function (a, b) { return a.dia < b.dia ? -1 : 1; });

  /* ============================================================================
     CRUZAMENTO COM O PLANEJAMENTO — D0 / D-1 / sem planejamento
     ============================================================================
     Extraído pra função (05/09/2026) pra poder ser chamado tanto daqui — com
     `pecasPorFamiliaDia` limitado ao período de UM Kardex — quanto do
     index.html na hora de renderizar a tela, cruzando `ressuprimento_
     planejamento` (permanente) com o HISTÓRICO acumulado de vários uploads
     (ressuprimento_familia_diario), pra o card parar de esquecer dias que
     não estão no último arquivo processado. Mesma conta, só muda de onde
     vem `pecasPorFamiliaDia` — ver classificarPlanejamento/
     calcularSemPlanejamento logo abaixo (fora desta função, exportadas).
     ============================================================================ */
  const ultimoDiaKardex = dataBrParaIso(parsed.periodo.ate);
  const planejamentoClassificado = classificarPlanejamento(planejamento, pecasPorFamiliaDia, ultimoDiaKardex, mapaFamilias);
  const ressuprimentoSemPlanejamento = calcularSemPlanejamento(pecasPorFamiliaDia, planejamento, mapaFamilias, porFamiliaDiaTurno);

  return {
    versao: 1,
    gerado_em: new Date().toISOString(),
    arquivo: meta.arquivo,
    periodo: parsed.periodo,
    total: {
      pecas_ressupridas: pecasRessupridas,
      movimentos_ressuprimento: movimentosRessuprimento,
      pecas_em_transito: pecasEmTransito,
      movimentos_em_transito: movimentosEmTransito,
      dias_com_movimento: dias.length,
      operadores_distintos: operadores.size,
    },
    por_dia: dias,
    por_turno: Array.from(porTurno.values()).sort(function (a, b) { return b.pecas - a.pecas; }),
    por_segmento: Array.from(porSegmento.values()).sort(function (a, b) { return b.pecas - a.pecas; }),
    rotas: Array.from(rotas.values()).sort(function (a, b) { return b.pecas - a.pecas; }),
    operadores: Array.from(operadores.values()).sort(function (a, b) { return b.pecas - a.pecas; }),
    planejamento: planejamentoClassificado,
    ressuprimento_sem_planejamento: ressuprimentoSemPlanejamento,
    // Vira linhas de ressuprimento_historico_diario (uma por dia+segmento+
    // turno) pra alimentar o histórico contínuo de "Ressuprimento por dia"
    // na tela — ver processarMovimentacoes.
    historico_diario: Array.from(porDiaSegmentoTurno.values()),
    // Vira linhas de ressuprimento_familia_diario (uma por dia+família+turno)
    // — histórico acumulado que alimenta a RECLASSIFICAÇÃO de D0/D-1/
    // pendente/sem-planejamento (agregando os turnos) e a quebra por turno
    // do "sem planejamento" na tela, em vez de depender só deste snapshot
    // (05/09/2026).
    historico_diario_familia: Array.from(porFamiliaDiaTurno.values()),
    // Quantos movimentos tiveram o turno resolvido pelo cadastro real
    // (dim_colaboradores_turno) vs. chutado pelo horário — nunca escondido.
    resolucao_turno: { por_cadastro: porCadastro, por_horario: porHorario },
    // Artigo que nunca apareceu num upload de Picking/Pulmão não tem entrada
    // no dicionário artigo→família ainda — fica de fora da quebra por
    // segmento e do cruzamento de planejamento, mas visível aqui, nunca
    // somado em silêncio nem escondido.
    sem_familia: {
      pecas: semFamiliaPecas, movimentos: semFamiliaMovimentos,
      artigos_distintos: artigosSemFamilia.size,
    },
    // Nada é descartado em silêncio: a tela mostra estes números pra que a
    // operação consiga bater o total do relatório com o que aparece aqui.
    descartados: casado.descartados,
    ignoradas_outro_tipo: parsed.ignoradas_outro_tipo,
    ignoradas_data_invalida: parsed.ignoradas_data_invalida,
  };
}

/* ============================================================================
   ORQUESTRAÇÃO — chamado pelo index.html (tela de Abastecimento)
   ============================================================================ */
async function processarMovimentacoes(supabaseClient, file, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo o Kardex…');
  const texto = await file.text();

  avisar('Interpretando as movimentações…');
  const parsed = parsearKardex(texto);
  avisar(parsed.pernas.length.toLocaleString('pt-BR') + ' linhas TL+/TL- lidas.');

  avisar('Carregando dicionário artigo→família, famílias, planejamento e turno dos colaboradores…');
  const [linhasArtigoFamilia, linhasFam, linhasPlanejamento, linhasColaboradores] = await Promise.all([
    // ordenarPor='artigo_codigo': o default de lerTudoPaginado ('codigo') é a
    // PK de dim_armazens/dim_familias, não a de dim_artigo_familia — sem isso
    // a consulta quebrava com "coluna codigo não existe" e o catch abaixo
    // engolia o erro em silêncio, fazendo o dicionário parecer sempre vazio
    // mesmo depois de populado (bug real, achado 03/09/2026 com dado real).
    window.lerTudoPaginado(supabaseClient, 'dim_artigo_familia', 'artigo_codigo, familia_codigo', null, 'artigo_codigo')
      .catch(function (e) {
        avisar('Aviso: não deu pra ler o dicionário artigo→família (' + (e && e.message) + ') — rodou migracao_planejamento.sql?');
        return [];
      }),
    window.lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, marca, categoria, segmento'),
    supabaseClient.from('ressuprimento_planejamento').select('pfa, familia_codigo, turno, data')
      .then(function (r) { return r.data || []; })
      .catch(function (e) {
        avisar('Aviso: não deu pra ler o planejamento (' + (e && e.message) + ') — rodou migracao_planejamento.sql?');
        return [];
      }),
    window.lerTudoPaginado(supabaseClient, 'dim_colaboradores_turno', 'login, turno', null, 'login')
      .catch(function (e) {
        avisar('Aviso: não deu pra ler o turno dos colaboradores (' + (e && e.message) + ') — rodou ' +
          'migracao_colaboradores_turno.sql? Sem ela, o turno de todo mundo é chutado pelo horário.');
        return [];
      }),
  ]);
  const mapaArtigoFamilia = new Map(linhasArtigoFamilia.map(function (a) { return [a.artigo_codigo, a.familia_codigo]; }));
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));
  // Só entra no mapa quem tem turno OPERACIONAL cadastrado (T01/T02/T03) —
  // ADM/CARGO DE CONFIANCA gravam turno null em dim_colaboradores_turno e
  // ficam de fora daqui de propósito, caindo no fallback por horário.
  const mapaColaboradorTurno = new Map(
    linhasColaboradores.filter(function (c) { return c.turno; }).map(function (c) { return [c.login, c.turno]; })
  );
  if (mapaArtigoFamilia.size === 0) {
    avisar('Aviso: dicionário artigo→família está vazio — processe Picking/Pulmão pelo menos uma vez ' +
      'pra habilitar a quebra por segmento e o cruzamento com o planejamento.');
  }
  if (mapaColaboradorTurno.size === 0) {
    avisar('Aviso: base de turno dos colaboradores está vazia — todo o turno deste Kardex será ' +
      'presumido pelo horário do movimento. Envie a base de Ativos em Admin › Abastecimento.');
  }

  avisar('Casando pares e classificando zonas…');
  const payload = construirSnapshotMovimentacoes(
    parsed, { arquivo: file.name }, mapaArtigoFamilia, mapaFamilias, linhasPlanejamento, mapaColaboradorTurno
  );
  avisar(
    payload.total.movimentos_ressuprimento.toLocaleString('pt-BR') + ' movimentos de ressuprimento · ' +
    payload.total.pecas_ressupridas.toLocaleString('pt-BR') + ' peças em ' +
    payload.total.dias_com_movimento + ' dias · turno real de ' +
    payload.resolucao_turno.por_cadastro.toLocaleString('pt-BR') + ' movimento(s), ' +
    payload.resolucao_turno.por_horario.toLocaleString('pt-BR') + ' presumido(s) pelo horário.'
  );

  avisar('Publicando o snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'ressuprimento_mov',
    payload: payload,
    gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  await upsertHistoricoDiario(supabaseClient, payload.historico_diario, avisar);
  await upsertHistoricoFamiliaDiario(supabaseClient, payload.historico_diario_familia, avisar);

  avisar('Concluído.');
  return payload;
}

/* ============================================================================
   HISTÓRICO DIÁRIO — grava dia+segmento+turno em ressuprimento_historico_diario
   pra que a tela consiga montar um intervalo de datas (ex: últimos 7 dias)
   cruzando VÁRIOS uploads de Kardex, não só o último processado. Upsert por
   (dia, segmento, turno): reprocessar um Kardex cujo período já foi gravado
   antes sobrescreve os dias daquele período — o arquivo mais recente sempre
   vence, sem duplicar nem exigir limpeza manual.
   ============================================================================ */
const LOTE_HISTORICO_DIARIO = 500;
async function upsertHistoricoDiario(supabaseClient, linhas, onAviso) {
  const avisar = onAviso || function () {};
  if (!linhas || linhas.length === 0) return;
  const lotes = [];
  for (let i = 0; i < linhas.length; i += LOTE_HISTORICO_DIARIO) {
    lotes.push(linhas.slice(i, i + LOTE_HISTORICO_DIARIO));
  }
  try {
    for (const lote of lotes) {
      const { error } = await supabaseClient.from('ressuprimento_historico_diario')
        .upsert(lote, { onConflict: 'dia,segmento,turno' });
      if (error) throw error;
    }
    avisar(linhas.length.toLocaleString('pt-BR') + ' linha(s) gravadas no histórico diário.');
  } catch (e) {
    avisar('Aviso: não deu pra gravar o histórico diário (' + (e && e.message) + ') — rodou migracao_historico_ressuprimento.sql? ' +
      'O restante do processamento seguiu normal, só o intervalo de datas na tela é que não vai enxergar este Kardex.');
  }
}

/* ============================================================================
   HISTÓRICO DIÁRIO POR FAMÍLIA — grava dia+família+turno em
   ressuprimento_familia_diario, mesmo padrão de upsertHistoricoDiario acima
   (onConflict por dia, arquivo mais recente vence só nos dias que cobre).
   É esse histórico que permite ao index.html reclassificar D0/D-1/pendente/
   sem-planejamento (agregando os turnos) no carregamento da tela, cruzando
   com o planejamento PERMANENTE, em vez de depender só do último Kardex
   processado — e também mostrar o que cada TURNO ressupriu sem nenhuma PFA
   cobrindo (05/09/2026, dois pedidos do usuário: não perder dias antigos
   quando o próximo Kardex cobrir só uma janela mais curta, e enxergar o
   "sem planejamento" quebrado por turno).
   ============================================================================ */
async function upsertHistoricoFamiliaDiario(supabaseClient, linhas, onAviso) {
  const avisar = onAviso || function () {};
  if (!linhas || linhas.length === 0) return;
  const lotes = [];
  for (let i = 0; i < linhas.length; i += LOTE_HISTORICO_DIARIO) {
    lotes.push(linhas.slice(i, i + LOTE_HISTORICO_DIARIO));
  }
  try {
    for (const lote of lotes) {
      const { error } = await supabaseClient.from('ressuprimento_familia_diario')
        .upsert(lote, { onConflict: 'dia,familia_codigo,turno' });
      if (error) throw error;
    }
    avisar(linhas.length.toLocaleString('pt-BR') + ' linha(s) gravadas no histórico por família.');
  } catch (e) {
    avisar('Aviso: não deu pra gravar o histórico por família (' + (e && e.message) + ') — rodou migracao_planejamento_historico.sql? ' +
      'O restante do processamento seguiu normal, só o card de Planejamento vai continuar preso ao último Kardex.');
  }
}

window.processarMovimentacoes = processarMovimentacoes;
window.upsertHistoricoDiario = upsertHistoricoDiario;
window.upsertHistoricoFamiliaDiario = upsertHistoricoFamiliaDiario;
window.parsearKardex = parsearKardex;
window.casarMovimentos = casarMovimentos;
window.construirSnapshotMovimentacoes = construirSnapshotMovimentacoes;
window.classificarZona = classificarZona;
window.turnoDe = turnoDe;
window.TURNOS = TURNOS;
window.diaISO = diaISO;
window.classificarPlanejamento = classificarPlanejamento;
window.calcularSemPlanejamento = calcularSemPlanejamento;

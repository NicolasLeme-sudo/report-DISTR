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
// 100 (23/09/2026): recebimento armazenado no chão, não é corredor de ressuprimento.
const RUAS_FORA_DA_FILA = { 98: 1, 100: 1 };

/* Rua 20 = CROSSDOCKING do recebimento, sem estoque físico (usuário,
   24/09/2026). Pelo nível ela caía como "Picking", e o que entrava nela
   contava como ressuprido — movimento com qualquer ponta na rua 20 é
   descartado (contado em descartados.rua_crossdocking). */
const RUAS_CROSSDOCKING = { 20: 1 };

/* ============================================================================
   TURNOS — gabarito da operação
   ============================================================================
   Horário oficial (operação, 24/09/2026):
   T01      05:00–14:48
   T02      14:48–00:16
   T03      20:20–04:48   (sobrepõe o fim do T02)

   Janela usada SÓ como fallback por horário, quando o login não está na
   base de Ativos (~11% dos movimentos): T01 05:00–14:47, T02 14:48–00:15,
   T03 00:16–04:59. Como T02 e T03 se sobrepõem entre 20:20 e 00:16, o
   horário sozinho não separa os dois — nessa faixa o chute é T02.

   Até 04/09/2026 o bloco 20:00–00:15 era um balde à parte ("T02/T03") porque
   o Kardex não diz a qual turno o operador pertence. Isso mudou: agora dá
   pra saber o turno REAL de cada login pela base de Ativos
   (dim_colaboradores_turno, ver ingest-colaboradores.js) — esta janela por
   HORÁRIO vira só o FALLBACK pra quando o login não está cadastrado (ou é
   ADM/confiança, que não tem turno operacional). Decisão da operação:
   quando é chute, o bloco 20:00–00:15 chuta T02.
   ============================================================================ */
const TURNOS = [
  { id: 'T01', rotulo: 'T01', janela: '05:00–14:48' },
  { id: 'T02', rotulo: 'T02', janela: '14:48–00:16' },
  { id: 'T03', rotulo: 'T03', janela: '20:20–04:48' },
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
/* Leitor linha a linha (25/09/2026): o mesmo parse de antes, mas alimentado
   uma linha por vez — permite ler o Kardex em pedaços (ver lerLinhasEmStream)
   sem montar o arquivo inteiro numa string só. Kardex de um ANO inteiro passa
   de 800 MB, acima do limite de string do navegador (~512 MB).
   opcoes.meses (Set de 'AAAA-MM'): só guarda as pernas desses meses — as de
   outros meses nem são contadas, pra cada linha contar uma vez só entre as
   passadas. opcoes.censo: não guarda pernas, só conta linhas TL+/TL- por mês. */
/* Pedaço de string no V8 (split/trim) guarda referência pro texto de onde
   saiu — num Kardex lido em partes, isso prendia o arquivo inteiro na memória
   (pico de 2,4 GB num teste de 490 MB). ' ' + s + slice força uma cópia
   própria; textos repetidos (descrição, nome, login) ficam uma vez só. */
function soltarTexto(s) {
  return s.length >= 13 ? (' ' + s).slice(1) : s;
}
function criarInternador() {
  const m = new Map();
  return function (s) {
    let v = m.get(s);
    if (v === undefined) { v = soltarTexto(s); m.set(v, v); }
    return v;
  };
}

/* Recebimento (26/09/2026): o volume chega na rua 98 por RFE/RFI/DCI, não por
   TL+ — sem isso, 5.525 volumes da 98 apareciam "sem registro no Kardex".
   Essas linhas entram só como ENTRADA do volume no endereço (data, login);
   nunca no casamento de pares nem na conta de ressuprimento. */
const TIPOS_RECEBIMENTO = { RFE: 1, RFI: 1, DCI: 1 };
function ehEntradaNoEndereco(p) {
  return p.tipo === 'TL+' || !!TIPOS_RECEBIMENTO[p.tipo];
}

function criarLeitorKardex(opcoes) {
  opcoes = opcoes || {};
  const internar = criarInternador();
  const pernas = [];
  const periodo = { de: null, ate: null };
  const meses = {};
  let idx = null;
  let ignoradasOutroTipo = 0;
  // Contagem por TIPO_MOVTO (24/09/2026): só TL+/TL- entram no cálculo, mas
  // os outros tipos (recebimento, ajuste etc.) ficam contados — inclusive
  // quantos caem na rua 98 e com login — pra saber como o recebimento chega
  // lá e se dá pra usar a data/usuário dele.
  const tiposMovimento = {};
  let ignoradasDataInvalida = 0;

  function linha(texto) {
    if (!texto.trim()) return;

    if (!idx) {
      // Cabeçalho do relatório: "...|de:03/08/2026|ate:31/08/2026|..."
      const mDe = texto.match(/de:\s*(\d{2}\/\d{2}\/\d{4})/i);
      const mAte = texto.match(/ate:\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (mDe) periodo.de = mDe[1];
      if (mAte) periodo.ate = mAte[1];
      if (/(^|\|)\s*artigo\s*\|/i.test(texto)) idx = mapearColunasKardex(texto);
      return;
    }

    const p = texto.split('|');
    if (p.length < 10) return;

    const tipo = (p[idx.tipo] || '').trim().toUpperCase();
    let dh;
    if (opcoes.meses) {
      dh = parsearDataHora(p[idx.data]);
      if (!dh || !opcoes.meses.has(dh.dia.slice(0, 7))) return;
    }
    if (opcoes.censo) {
      if (tipo !== 'TL+' && tipo !== 'TL-') return;
      dh = parsearDataHora(p[idx.data]);
      if (!dh) { ignoradasDataInvalida++; return; }
      const mes = dh.dia.slice(0, 7);
      meses[mes] = (meses[mes] || 0) + 1;
      return;
    }

    const endTipo = (p[idx.endereco] || '').trim().split(',');
    const tm = tiposMovimento[tipo || '(vazio)'] || (tiposMovimento[tipo || '(vazio)'] = { linhas: 0, na_rua_98: 0, com_volume: 0, com_login: 0 });
    tm.linhas++;
    if (Number(endTipo[0]) === 98) tm.na_rua_98++;
    if ((p[idx.volume] || '').trim()) tm.com_volume++;
    if (idx.login !== undefined && (p[idx.login] || '').trim()) tm.com_login++;
    const recebimento = TIPOS_RECEBIMENTO[tipo] && (p[idx.volume] || '').trim();
    if (tipo !== 'TL+' && tipo !== 'TL-' && !recebimento) { ignoradasOutroTipo++; return; }
    if (recebimento) ignoradasOutroTipo++; // não é movimento de ressuprimento; só marca a entrada do volume

    dh = dh || parsearDataHora(p[idx.data]);
    if (!dh) { ignoradasDataInvalida++; return; }

    const endereco = (p[idx.endereco] || '').trim();
    const partes = endereco.split(',');

    pernas.push({
      artigo: internar((p[idx.artigo] || '').trim()),
      descricao: idx.descricao !== undefined ? internar((p[idx.descricao] || '').trim()) : '',
      cor: internar((p[idx.cor] || '').trim()),
      tamanho: internar((p[idx.tamanho] || '').trim()),
      dia: dh.dia,
      minutos: dh.minutos,
      data_bruta: internar((p[idx.data] || '').trim()),
      tipo: tipo,
      ref: soltarTexto((p[idx.ref] || '').trim()),
      qtd: window.numeroBR(p[idx.qtd]),
      endereco: internar(endereco),
      rua: internar((partes[0] || '').trim()),
      nivel: internar((partes[1] || '').trim()),
      box: internar((partes[2] || '').trim()),
      volume: soltarTexto((p[idx.volume] || '').trim()),
      login: idx.login !== undefined ? internar((p[idx.login] || '').trim()) : '',
      nome: idx.nome !== undefined ? internar((p[idx.nome] || '').trim()) : '',
    });
  }

  function fim() {
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
      meses: meses,
      ignoradas_outro_tipo: ignoradasOutroTipo,
      tipos_movimento: tiposMovimento,
      ignoradas_data_invalida: ignoradasDataInvalida,
    };
  }

  return { linha: linha, fim: fim };
}

function parsearKardex(textoArquivo) {
  const leitor = criarLeitorKardex();
  textoArquivo.split(/\r?\n/).forEach(leitor.linha);
  return leitor.fim();
}

/* Lê o arquivo em pedaços (file.stream) e entrega linha por linha, sem nunca
   montar o texto inteiro — mesma decodificação UTF-8 do file.text(). */
async function lerLinhasEmStream(file, aoLer, aoProgresso) {
  const reader = file.stream().getReader();
  const dec = new TextDecoder('utf-8');
  let resto = '';
  let lidos = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    lidos += r.value.length;
    const partes = (resto + dec.decode(r.value, { stream: true })).split(/\r?\n/);
    resto = partes.pop();
    for (let i = 0; i < partes.length; i++) aoLer(partes[i]);
    if (aoProgresso) aoProgresso(lidos / (file.size || 1));
  }
  resto += dec.decode();
  if (resto) aoLer(resto);
}

/* Ruas de sinalização/passagem cujo material aparece no card "B.O. em
   endereço transitório" do Ressuprimento (mesmo gabarito de
   CLASSIF_RUA_PULMAO em ingest-ressuprimento.js, mais a 99). O Pulmão só
   traz DT. CRI. (criação do volume — a 1ª alocação no CD, às vezes anos
   atrás), então a data de ENTRADA no endereço vem daqui: o último TL+ do
   volume. Pedido do usuário, 23/09/2026: item na rua 500 aparecia como de
   2023 (DT. CRI.) quando tinha sido movido pra lá em 15/09/2026. */
const RUAS_ENTRADA_RASTREADA = { 10: 1, 21: 1, 24: 1, 26: 1, 27: 1, 98: 1, 99: 1, 100: 1, 500: 1, 600: 1 };

/* volume -> [rua, nivel, box, diaISO, minutos, login, nome] do TL+ MAIS
   RECENTE desse volume no Kardex — só guardado quando esse último destino é
   uma rua rastreada (se o volume saiu dela depois, o último TL+ aponta pra
   outro lugar e ele não entra). Array em vez de objeto pra caber no payload. */
function construirEntradasPorVolume(pernas) {
  const ultimo = new Map();
  pernas.forEach(function (p) {
    if (!ehEntradaNoEndereco(p) || !p.volume) return;
    const atual = ultimo.get(p.volume);
    if (!atual || p.dia > atual.dia || (p.dia === atual.dia && p.minutos > atual.minutos)) ultimo.set(p.volume, p);
  });
  const saida = {};
  ultimo.forEach(function (p, volume) {
    if (!RUAS_ENTRADA_RASTREADA[Number(p.rua) || 0]) return;
    saida[volume] = [String(Number(p.rua)), String(Number(p.nivel)), String(Number(p.box)), p.dia, p.minutos, p.login, p.nome];
  });
  return saida;
}

/* Junta o mapa acumulado com o Kardex novo, por volume, valendo SEMPRE o
   TL+ mais recente — não a ordem de upload. Antes "o novo mandava": subir
   um Kardex antigo depois de um recente (carga histórica mês a mês, pedido
   do usuário em 24/09/2026) sobrescreveria datas novas com velhas, ou
   apagaria volumes que ainda estão parados. Agora:
   - volume sem TL+ no arquivo novo: continua como estava;
   - TL+ do arquivo novo mais recente que o acumulado: vale o novo — se o
     destino é rua rastreada, grava; se não é (saiu pro Pulmão/Picking),
     remove;
   - TL+ do arquivo novo mais antigo que o acumulado: ignora. */
function mesclarEntradasPorVolume(anterior, pernas, novo) {
  const resultado = Object.assign({}, anterior || {});
  const ultimoNovo = new Map();
  pernas.forEach(function (p) {
    if (!ehEntradaNoEndereco(p) || !p.volume) return;
    const a = ultimoNovo.get(p.volume);
    if (!a || p.dia > a.dia || (p.dia === a.dia && p.minutos > a.minutos)) ultimoNovo.set(p.volume, p);
  });
  ultimoNovo.forEach(function (p, volume) {
    const ant = resultado[volume];
    const antMaisRecente = ant && (ant[3] > p.dia || (ant[3] === p.dia && Number(ant[4]) > p.minutos));
    if (antMaisRecente) return;
    if (novo && novo[volume]) resultado[volume] = novo[volume];
    else delete resultado[volume];
  });
  return resultado;
}

/* Fila em andamento acumulada entre uploads (26/09/2026): cada Kardex só
   enxerga as baixas Pulmão -> corredor do PRÓPRIO período, então com upload
   diário a fila mostraria só o que desceu naquele dia. Item da fila anterior
   continua enquanto o volume não tiver TL+ mais novo no arquivo novo (se
   teve, saiu do corredor); item que aparece nas duas vale o novo. */
function mesclarFilaItens(anterior, pernas, nova) {
  const ultimo = new Map();
  pernas.forEach(function (p) {
    if (!ehEntradaNoEndereco(p) || !p.volume) return;
    const a = ultimo.get(p.volume);
    if (!a || p.dia > a.dia || (p.dia === a.dia && p.minutos > a.minutos)) ultimo.set(p.volume, p);
  });
  const naNova = new Set((nova || []).map(function (i) { return i.volume; }));
  const mantidos = (anterior || []).filter(function (i) {
    if (naNova.has(i.volume)) return false;
    const u = ultimo.get(i.volume);
    if (!u) return true;
    const hm = String(i.hora || '00:00').split(':');
    const min = Number(hm[0]) * 60 + Number(hm[1]);
    return u.dia < i.dia || (u.dia === i.dia && u.minutos <= min);
  });
  return mantidos.concat(nova || []);
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
    if (p.tipo !== 'TL+' && p.tipo !== 'TL-') return; // recebimento não forma par
    const chave = [p.artigo, p.cor, p.tamanho, p.data_bruta, p.ref].join(SEP);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  });

  const movimentos = [];
  let semParExato = 0, fiscalMesmoEndereco = 0, semVolume = 0, ruaCrossdocking = 0;

  grupos.forEach(function (g) {
    if (g.length !== 2) { semParExato += g.length; return; }
    const saida = g[0].tipo === 'TL-' ? g[0] : g[1];
    const entrada = g[0].tipo === 'TL-' ? g[1] : g[0];
    if (saida.tipo !== 'TL-' || entrada.tipo !== 'TL+') { semParExato += 2; return; }

    // Armadilha 3: mesmo endereço nas duas pontas = fiscal/importação.
    if (saida.endereco === entrada.endereco) { fiscalMesmoEndereco++; return; }
    // Sem volume = ajuste fiscal / importação de material (regra da operação).
    if (!saida.volume || !entrada.volume) { semVolume++; return; }
    if (RUAS_CROSSDOCKING[Number(saida.rua) || 0] || RUAS_CROSSDOCKING[Number(entrada.rua) || 0]) { ruaCrossdocking++; return; }

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
      rua_crossdocking: ruaCrossdocking,
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
// dim_familias.codigo vem sempre com 3 dígitos, mas família colada à mão em
// Admin › Planejamento de Ressuprimento podia ser gravada sem o zero à
// esquerda ("82" em vez de "082") — a busca no mapa falhava e a tela caía no
// fallback "código — código" (achado pelo usuário, 17/09/2026: famílias
// 60/61/82/83 sem nome). O padding na gravação (index.html) resolve daqui pra
// frente; isto aqui só faz o mesmo casamento pras linhas já salvas erradas.
function familiaPadded(codigo) {
  return /^\d+$/.test(codigo) ? codigo.padStart(3, '0') : codigo;
}
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
    const famPlano = mapaFamilias.get(familiaPadded(p.familia_codigo));
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
      const fam = mapaFamilias.get(familiaPadded(familiaCod));
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

/* Fila em andamento DE VERDADE: baixa Pulmão -> corredor cujo volume NÃO
   mexeu mais depois (o último TL+ do volume no Kardex é essa mesma baixa).
   `pecas_em_transito` soma TODAS as baixas do período — no Kardex real de
   agosto/2026 eram 251.639 pç contra 10.818 ainda paradas no corredor —,
   então o KPI "ainda no corredor" passa a ler daqui (23/09/2026). Lista
   por item pra tela filtrar por período e exportar. */
function construirFilaItens(movs, pernas) {
  const ultimo = new Map();
  pernas.forEach(function (p) {
    if (!ehEntradaNoEndereco(p) || !p.volume) return;
    const a = ultimo.get(p.volume);
    if (!a || p.dia > a.dia || (p.dia === a.dia && p.minutos > a.minutos)) ultimo.set(p.volume, p);
  });
  return movs.filter(ehBaixaPendente).filter(function (m) {
    const u = ultimo.get(m.volume);
    return u && u.dia === m.dia && u.minutos === m.minutos && u.endereco === m.destino.endereco;
  }).map(function (m) {
    return {
      dia: m.dia, hora: String(Math.floor(m.minutos / 60)).padStart(2, '0') + ':' + String(m.minutos % 60).padStart(2, '0'),
      turno: m.turno, artigo: m.artigo, descricao: m.descricao, cor: m.cor, tamanho: m.tamanho, qtd: m.qtd,
      volume: m.volume, login: m.login, nome: m.nome, origem: m.origem.endereco, destino: m.destino.endereco,
    };
  });
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
  // dia+turno+login -> {nome} — vira ressuprimento_operador_diario
  // (histórico), pra "Operadores" no card "Ressuprimento por dia" parar de
  // mostrar "—" sempre que o histórico contínuo está ativo (05/09/2026,
  // achado pelo usuário: hoje só o snapshot de um Kardex isolado guarda
  // operadores, o histórico agregado nunca guardou quem mexeu).
  const porDiaTurnoOperador = new Map();

  let pecasRessupridas = 0, movimentosRessuprimento = 0;
  let pecasEmTransito = 0, movimentosEmTransito = 0;
  let semFamiliaPecas = 0, semFamiliaMovimentos = 0;
  const artigosSemFamilia = new Set();
  // Quantos movimentos tiveram o turno resolvido pelo cadastro real do
  // colaborador (dim_colaboradores_turno) vs. chutado pelo horário do
  // movimento (login não cadastrado, ou ADM/confiança, que não tem turno
  // operacional) — visível na tela, nunca escondido.
  let porCadastro = 0, porHorario = 0;
  // QUEM ficou sem turno real — não só quantos. Sem essa lista, "385
  // movimentos por horário" não vira ação: a operação precisa do login pra
  // cadastrar a pessoa na base de Ativos (ou confirmar que é ADM mesmo).
  const semCadastro = new Map();

  movs.forEach(function (m) {
    // Turno REAL do colaborador quando existir cadastro pra esse login;
    // senão mantém o turno já chutado pelo horário do movimento (turnoDe,
    // calculado em casarMovimentos). Nunca sobrescreve com um turno vazio —
    // ADM/CARGO DE CONFIANCA e login desconhecido não têm entrada aqui.
    const turnoCadastrado = mapaColaboradorTurno.get(m.login);
    if (turnoCadastrado) {
      m.turno = turnoCadastrado; porCadastro++;
    } else {
      porHorario++;
      if (!semCadastro.has(m.login)) {
        semCadastro.set(m.login, { login: m.login, nome: m.nome || '', movimentos: 0, pecas: 0, turnos_chutados: {} });
      }
      const sc = semCadastro.get(m.login);
      sc.movimentos += 1;
      sc.pecas += m.qtd;
      // Em quais turnos o CHUTE por horário jogou os movimentos dessa
      // pessoa. Um login espalhado entre dois turnos é exatamente o caso
      // que o horário resolve mal (ex.: vira do T02 pro T03 à meia-noite).
      sc.turnos_chutados[m.turno] = (sc.turnos_chutados[m.turno] || 0) + 1;
    }

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

    const chaveDTO = m.dia + '|' + m.turno + '|' + m.login;
    if (!porDiaTurnoOperador.has(chaveDTO)) {
      porDiaTurnoOperador.set(chaveDTO, { dia: m.dia, turno: m.turno, login: m.login, nome: m.nome });
    }
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
    // Vira linhas de ressuprimento_operador_diario (uma por dia+turno+login)
    // — histórico acumulado de QUEM trabalhou, pra "Operadores" no card
    // "Ressuprimento por dia" não ficar preso ao último Kardex (05/09/2026).
    historico_diario_operador: Array.from(porDiaTurnoOperador.values()),
    // Quantos movimentos tiveram o turno resolvido pelo cadastro real
    // (dim_colaboradores_turno) vs. chutado pelo horário — nunca escondido.
    resolucao_turno: {
      por_cadastro: porCadastro, por_horario: porHorario,
      // Lista dos logins que movimentaram sem turno cadastrado, do maior
      // volume pro menor — é a fila de trabalho pra fechar a base de Ativos.
      sem_cadastro: Array.from(semCadastro.values())
        .map(function (sc) {
          const turnos = Object.keys(sc.turnos_chutados).sort();
          return {
            login: sc.login, nome: sc.nome, movimentos: sc.movimentos, pecas: sc.pecas,
            turnos_chutados: turnos.join('/'),
            // Movimento espalhado por mais de um turno = o chute por horário
            // não é confiável nem "em média" pra essa pessoa.
            dividido_entre_turnos: turnos.length > 1,
          };
        })
        .sort(function (a, b) { return b.pecas - a.pecas; }),
    },
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
    entradas_volume: construirEntradasPorVolume(parsed.pernas),
    fila_itens: construirFilaItens(movs, parsed.pernas),
    ignoradas_outro_tipo: parsed.ignoradas_outro_tipo,
    tipos_movimento: parsed.tipos_movimento || {},
    ignoradas_data_invalida: parsed.ignoradas_data_invalida,
  };
}

/* ============================================================================
   ORQUESTRAÇÃO — chamado pelo index.html (tela de Abastecimento)
   ============================================================================ */
/* Acima disto o Kardex é lido em partes, mês a mês (ver processarKardexGrande).
   Um mês de Kardex tem ~70 MB; o arquivo de um ano, 660–860 MB. */
const LIMITE_LEITURA_INTEIRA = 150 * 1024 * 1024;
// Teto de linhas TL+/TL- em memória por passada no modo em partes.
const MAX_PERNAS_POR_LOTE = 600000;

async function carregarDimensoesKardex(supabaseClient, avisar) {
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
  return { mapaArtigoFamilia: mapaArtigoFamilia, mapaFamilias: mapaFamilias,
    planejamento: linhasPlanejamento, mapaColaboradorTurno: mapaColaboradorTurno };
}

async function processarMovimentacoes(supabaseClient, file, onProgresso) {
  const avisar = onProgresso || function () {};
  if (file.size > LIMITE_LEITURA_INTEIRA && typeof file.stream === 'function') {
    return processarKardexGrande(supabaseClient, file, avisar);
  }

  avisar('Lendo o Kardex…');
  const texto = await file.text();

  avisar('Interpretando as movimentações…');
  const parsed = parsearKardex(texto);
  avisar(parsed.pernas.length.toLocaleString('pt-BR') + ' linhas TL+/TL- lidas.');

  const dims = await carregarDimensoesKardex(supabaseClient, avisar);
  const mapaArtigoFamilia = dims.mapaArtigoFamilia, mapaFamilias = dims.mapaFamilias;
  const linhasPlanejamento = dims.planejamento, mapaColaboradorTurno = dims.mapaColaboradorTurno;

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

  let payloadAnterior = null;
  // Acumula entradas por volume com o snapshot anterior (ver
  // mesclarEntradasPorVolume) — falha de leitura só perde o acúmulo, nunca
  // derruba o processamento.
  try {
    const anterior = await supabaseClient.from('dashboard_snapshots')
      .select('payload').eq('pagina', 'ressuprimento_mov')
      .order('gerado_em', { ascending: false }).limit(1);
    payloadAnterior = anterior && anterior.data && anterior.data[0] ? anterior.data[0].payload : null;
    const mapaAnterior = payloadAnterior ? payloadAnterior.entradas_volume : null;
    payload.entradas_volume = mesclarEntradasPorVolume(mapaAnterior, parsed.pernas, payload.entradas_volume);
  } catch (e) {
    avisar('Aviso: não deu pra acumular as entradas por volume do Kardex anterior (' + (e && e.message) + ').');
  }
  avisar(Object.keys(payload.entradas_volume).length.toLocaleString('pt-BR') +
    ' volume(s) com data de entrada em endereço transitório/sinalização.');

  // Kardex ANTIGO (carga de histórico, ex.: um ano passado subido depois do
  // mês atual) não troca a tela: grava o histórico diário e só soma as
  // entradas por volume no snapshot atual (25/09/2026).
  let snapshotPublicar = payload;
  const ateArquivo = dataBrParaIso(parsed.periodo.ate);
  const ateAnterior = payloadAnterior && payloadAnterior.periodo ? dataBrParaIso(payloadAnterior.periodo.ate) : null;
  if (payloadAnterior && !(ateArquivo && ateAnterior && ateArquivo < ateAnterior)) {
    payload.fila_itens = mesclarFilaItens(payloadAnterior.fila_itens, parsed.pernas, payload.fila_itens);
  }
  if (ateArquivo && ateAnterior && ateArquivo < ateAnterior) {
    snapshotPublicar = Object.assign({}, payloadAnterior, { entradas_volume: payload.entradas_volume, gerado_em: new Date().toISOString() });
    avisar('Carga de histórico (arquivo até ' + ateArquivo + ', anterior ao último Kardex publicado) — a tela continua com o Kardex atual; só o histórico diário e as entradas por volume foram atualizados.');
  }

  avisar('Publicando o snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'ressuprimento_mov',
    payload: snapshotPublicar,
    gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  await upsertHistoricoDiario(supabaseClient, payload.historico_diario, avisar);
  await upsertHistoricoFamiliaDiario(supabaseClient, payload.historico_diario_familia, avisar);
  await upsertHistoricoOperadorDiario(supabaseClient, payload.historico_diario_operador, avisar);

  avisar('Concluído.');
  return payload;
}

/* ============================================================================
   KARDEX GRANDE (um ano inteiro) — lido em partes, mês a mês (25/09/2026)
   ============================================================================
   1ª passada (censo): conta as linhas TL+/TL- por mês, sem guardar nada.
   Depois, os meses são agrupados em lotes de até MAX_PERNAS_POR_LOTE linhas e
   cada lote é uma nova passada pelo arquivo: casa os pares (o par TL-/TL+ tem
   a mesma data/hora, então nunca atravessa mês), grava o histórico diário
   (dia × segmento × turno, família e operador — upsert, reprocessar não
   duplica) e acumula as entradas por volume. Só um lote fica na memória.

   Snapshot da tela: se o arquivo vai até a data do último Kardex publicado ou
   depois, o snapshot novo sai do lote mais recente; se é carga de ano antigo,
   o snapshot atual é mantido e só ganha as entradas por volume acumuladas —
   subir 2023 depois de 2026 não troca a tela pelo ano velho.
   ============================================================================ */
async function processarKardexGrande(supabaseClient, file, avisar, opcoes) {
  const maxPernas = (opcoes && opcoes.maxPernas) || MAX_PERNAS_POR_LOTE;
  const mb = function (n) { return Math.round(n / 1024 / 1024).toLocaleString('pt-BR'); };
  avisar('Kardex grande (' + mb(file.size) + ' MB) — leitura em partes, mês a mês.');

  let ultimoPct = -1;
  const progresso = function (rotulo) {
    return function (f) {
      const pct = Math.floor(f * 100);
      if (pct >= ultimoPct + 10) { ultimoPct = pct; avisar(rotulo + ' ' + pct + '%'); }
    };
  };

  ultimoPct = -1;
  const censo = criarLeitorKardex({ censo: true });
  await lerLinhasEmStream(file, censo.linha, progresso('Contando linhas por mês…'));
  const infoCenso = censo.fim();
  const mesesOrdem = Object.keys(infoCenso.meses).sort();
  if (!mesesOrdem.length) throw new Error('Nenhuma linha TL+/TL- com data válida no Kardex.');
  avisar(mesesOrdem.length + ' mês(es) no arquivo (' + mesesOrdem[0] + ' a ' + mesesOrdem[mesesOrdem.length - 1] + '), ' +
    mesesOrdem.reduce(function (t, m) { return t + infoCenso.meses[m]; }, 0).toLocaleString('pt-BR') + ' linhas TL+/TL-.');

  const lotes = [];
  let atual = [], soma = 0;
  mesesOrdem.forEach(function (m) {
    const n = infoCenso.meses[m];
    if (atual.length && soma + n > maxPernas) { lotes.push(atual); atual = []; soma = 0; }
    atual.push(m); soma += n;
  });
  if (atual.length) lotes.push(atual);

  const dims = await carregarDimensoesKardex(supabaseClient, avisar);

  let anterior = null;
  try {
    const r = await supabaseClient.from('dashboard_snapshots')
      .select('payload').eq('pagina', 'ressuprimento_mov')
      .order('gerado_em', { ascending: false }).limit(1);
    anterior = r && r.data && r.data[0] ? r.data[0].payload : null;
  } catch (e) {
    avisar('Aviso: não deu pra ler o snapshot anterior (' + (e && e.message) + ').');
  }

  let entradas = anterior ? (anterior.entradas_volume || {}) : {};
  const ateArquivo = dataBrParaIso(infoCenso.periodo.ate) || (mesesOrdem[mesesOrdem.length - 1] + '-31');
  const ateAnterior = anterior && anterior.periodo ? dataBrParaIso(anterior.periodo.ate) : null;
  const arquivoEhAtual = !anterior || !ateAnterior || ateArquivo >= ateAnterior;
  let fila = arquivoEhAtual && anterior ? (anterior.fila_itens || []) : [];
  let ultimoPayload = null;
  const descartados = { sem_par_exato: 0, fiscal_mesmo_endereco: 0, sem_volume: 0, rua_crossdocking: 0 };
  let pecasTotal = 0, movsTotal = 0, ignoradasOutroTipo = 0;

  for (let i = 0; i < lotes.length; i++) {
    const lote = lotes[i];
    const rot = 'Parte ' + (i + 1) + '/' + lotes.length + ' (' + lote[0] + (lote.length > 1 ? ' a ' + lote[lote.length - 1] : '') + ')';
    ultimoPct = -1;
    const leitor = criarLeitorKardex({ meses: new Set(lote) });
    await lerLinhasEmStream(file, leitor.linha, progresso(rot + ': lendo…'));
    const parsed = leitor.fim();
    // O período do lote (não o do cabeçalho do arquivo) é o que vale pro
    // cruzamento com planejamento dentro do lote.
    const ultimoDiaLote = parsed.pernas.reduce(function (mx, p) { return p.dia > mx ? p.dia : mx; }, '');
    const primeiroDiaLote = parsed.pernas.reduce(function (mn, p) { return !mn || p.dia < mn ? p.dia : mn; }, '');
    const iso2br = function (iso) { return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : null; };
    parsed.periodo = { de: iso2br(primeiroDiaLote), ate: iso2br(ultimoDiaLote) };

    const payload = construirSnapshotMovimentacoes(parsed, { arquivo: file.name }, dims.mapaArtigoFamilia,
      dims.mapaFamilias, dims.planejamento, dims.mapaColaboradorTurno);
    avisar(rot + ': ' + payload.total.movimentos_ressuprimento.toLocaleString('pt-BR') + ' movimentos de ressuprimento · ' +
      payload.total.pecas_ressupridas.toLocaleString('pt-BR') + ' peças em ' + payload.total.dias_com_movimento + ' dias.');

    await upsertHistoricoDiario(supabaseClient, payload.historico_diario, avisar);
    await upsertHistoricoFamiliaDiario(supabaseClient, payload.historico_diario_familia, avisar);
    await upsertHistoricoOperadorDiario(supabaseClient, payload.historico_diario_operador, avisar);

    entradas = mesclarEntradasPorVolume(entradas, parsed.pernas, payload.entradas_volume);
    if (arquivoEhAtual) fila = mesclarFilaItens(fila, parsed.pernas, payload.fila_itens);
    Object.keys(descartados).forEach(function (k) { descartados[k] += payload.descartados[k] || 0; });
    pecasTotal += payload.total.pecas_ressupridas;
    movsTotal += payload.total.movimentos_ressuprimento;
    ignoradasOutroTipo += payload.ignoradas_outro_tipo || 0;
    delete payload.historico_diario; delete payload.historico_diario_familia; delete payload.historico_diario_operador;
    ultimoPayload = payload;
  }

  const resumoCarga = { arquivo: file.name, meses: mesesOrdem, pecas_ressupridas: pecasTotal,
    movimentos_ressuprimento: movsTotal, descartados: descartados, ignoradas_outro_tipo: ignoradasOutroTipo };
  let snapshot;
  if (arquivoEhAtual) {
    snapshot = Object.assign(ultimoPayload, { entradas_volume: entradas, fila_itens: fila, carga_em_partes: resumoCarga });
    avisar('Arquivo é o mais recente — a tela passa a mostrar o último lote (' + lotes[lotes.length - 1].join(', ') + ') com o histórico completo.');
  } else {
    snapshot = Object.assign({}, anterior, { entradas_volume: entradas, gerado_em: new Date().toISOString(), carga_em_partes: resumoCarga });
    avisar('Carga de histórico (arquivo até ' + ateArquivo + ', anterior ao último Kardex publicado) — a tela continua com o Kardex atual; só o histórico diário e as entradas por volume foram atualizados.');
  }

  avisar('Publicando o snapshot…');
  const { error } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'ressuprimento_mov', payload: snapshot, gerado_em: new Date().toISOString(),
  });
  if (error) throw error;

  avisar('Total do arquivo: ' + movsTotal.toLocaleString('pt-BR') + ' movimentos de ressuprimento · ' +
    pecasTotal.toLocaleString('pt-BR') + ' peças em ' + mesesOrdem.length + ' mês(es).');
  avisar('Concluído.');
  return snapshot;
}

/* ============================================================================
   HISTÓRICO DIÁRIO — grava dia+segmento+turno em ressuprimento_historico_diario
   pra que a tela consiga montar um intervalo de datas (ex: últimos 10 dias)
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

/* ============================================================================
   HISTÓRICO DIÁRIO DE OPERADORES — grava dia+turno+login em
   ressuprimento_operador_diario, mesmo padrão de upsert das outras tabelas
   de histórico (onConflict pela chave; arquivo mais recente sobrescreve só
   os dias que cobre). É esse histórico que permite a coluna "Operadores" do
   card "Ressuprimento por dia" mostrar um número de verdade quando a fonte
   é o histórico acumulado, em vez de "—" (05/09/2026).
   ============================================================================ */
async function upsertHistoricoOperadorDiario(supabaseClient, linhas, onAviso) {
  const avisar = onAviso || function () {};
  if (!linhas || linhas.length === 0) return;
  const lotes = [];
  for (let i = 0; i < linhas.length; i += LOTE_HISTORICO_DIARIO) {
    lotes.push(linhas.slice(i, i + LOTE_HISTORICO_DIARIO));
  }
  try {
    for (const lote of lotes) {
      const { error } = await supabaseClient.from('ressuprimento_operador_diario')
        .upsert(lote, { onConflict: 'dia,turno,login' });
      if (error) throw error;
    }
    avisar(linhas.length.toLocaleString('pt-BR') + ' linha(s) gravadas no histórico de operadores.');
  } catch (e) {
    avisar('Aviso: não deu pra gravar o histórico de operadores (' + (e && e.message) + ') — rodou migracao_operador_historico.sql? ' +
      'O restante do processamento seguiu normal, só a coluna Operadores vai continuar mostrando "—" no histórico.');
  }
}

window.processarMovimentacoes = processarMovimentacoes;
window.upsertHistoricoDiario = upsertHistoricoDiario;
window.processarKardexGrande = processarKardexGrande;
window.criarLeitorKardex = criarLeitorKardex;
window.mesclarFilaItens = mesclarFilaItens;
window.lerLinhasEmStream = lerLinhasEmStream;
window.upsertHistoricoFamiliaDiario = upsertHistoricoFamiliaDiario;
window.upsertHistoricoOperadorDiario = upsertHistoricoOperadorDiario;
window.parsearKardex = parsearKardex;
window.casarMovimentos = casarMovimentos;
window.construirSnapshotMovimentacoes = construirSnapshotMovimentacoes;
window.classificarZona = classificarZona;
window.turnoDe = turnoDe;
window.TURNOS = TURNOS;
window.diaISO = diaISO;
window.classificarPlanejamento = classificarPlanejamento;
window.calcularSemPlanejamento = calcularSemPlanejamento;
window.familiaPadded = familiaPadded;
window.construirEntradasPorVolume = construirEntradasPorVolume;
window.mesclarEntradasPorVolume = mesclarEntradasPorVolume;
window.construirFilaItens = construirFilaItens;

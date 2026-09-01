/* ============================================================================
   REPORT DISTRIBUIDORA — ingest.js
   ============================================================================
   RESPONSABILIDADE ÚNICA: ler o arquivo-fonte, cruzar/agregar os dados e
   GRAVAR o resultado já pronto no Supabase.

   Este arquivo NUNCA desenha nada na tela. Não há document.querySelector,
   não há innerHTML, não há manipulação de DOM aqui. A comunicação com a
   interface acontece por callback (onProgresso), passado pelo index.html.
   Regra herdada do Report E-commerce (README seção 1) e tratada como
   inegociável: se um ajuste é sobre COMO algo aparece, ele pertence ao
   index.html; se é sobre COMO o número é calculado, ele pertence aqui.
   ============================================================================ */

/* ============================================================================
   DOIS LAYOUTS DE EXTRAÇÃO
   ============================================================================
   O mesmo dado sai do sistema em dois formatos, e o ingest aceita os dois —
   o layout é detectado pelo conteúdo do arquivo, não pelo nome dele:

     'pipe' → EX000796, delimitado por "|". É o formato PREFERIDO:
              traz St e "Em Linha" como colunas separadas, e artigo, descrição,
              cor e tamanho cada um em sua própria coluna.

     'fixo' → EX000914, largura fixa paginada. Mantido porque foi o primeiro
              formato recebido e ainda é o único que imprime o "** TOTAL GERAL"
              do sistema, útil para conferência.

   As duas funções de parse devolvem EXATAMENTE a mesma estrutura de registro,
   então tudo que vem depois (dedup, agregação, snapshot) não sabe nem precisa
   saber de qual layout o dado veio.
   ============================================================================ */

function detectarLayout(texto) {
  const inicio = texto.slice(0, 4000);
  if (/St\s*\|\s*Em Linha\s*\|/i.test(inicio)) return 'pipe';
  if (/POSICAO DO STOCK/i.test(inicio)) return 'fixo';
  // Sem cabeçalho reconhecível: decide pela presença de pipes nas primeiras linhas.
  return inicio.indexOf('|') !== -1 ? 'pipe' : 'fixo';
}

/* ----------------------------------------------------------------------------
   PARSE DO LAYOUT 'fixo' — "POSICAO DO STOCK - LOCAIS STOCKAGEM" (EX000914)
   ----------------------------------------------------------------------------
   O arquivo é um relatório de terminal em LARGURA FIXA, paginado, com um
   cabeçalho repetido a cada página. Não é CSV, não é TSV: separar por espaço
   quebra, porque a descrição do artigo tem espaços dentro dela.

   As colunas foram medidas na própria linha de régua do relatório
   (a linha de underscores logo abaixo do cabeçalho das colunas):

     0-1     St            VS | VN | IN | IS
     4-94    Artigo        campo composto, ver COLUNAS_ARTIGO abaixo
     97-100  Um            PAR | UN
     103-114 Armazem       "EXTRE/AC190"  (estabelecimento / armazém)
     117-130 Local         (vem vazio nesta extração)
     133-148 Stock Mínimo
     151-167 Qtd. Stock
     170-181 Preço Médio
     184-200 Valor Stock

   Dentro do campo "Artigo" (largura 90) há quatro subcampos de largura fixa:
     0-13    código do artigo   ("43224430", "OBMA261923", "BFR0402N")
     13-20   cor                ("ARENIT", "PRETO", "BCO/BD")
     20-26   tamanho            ("38", "39/44", "GG", "U")
     26-fim  descrição

   A família NÃO está na linha do produto: ela vem em uma linha "Familia ...:"
   no cabeçalho de cada página e vale para todas as linhas seguintes até a
   próxima. Por isso o parser mantém `familiaAtual` como estado enquanto varre.
   ---------------------------------------------------------------------------- */

const COLUNAS_LINHA = {
  st:        [0, 2],
  artigo:    [4, 94],
  um:        [97, 100],
  armazem:   [103, 114],
  local:     [117, 130],
  stockMin:  [133, 148],
  qtd:       [151, 167],
  precoMed:  [170, 181],
  valor:     [184, 200],
};

const COLUNAS_ARTIGO = {
  codigo:    [0, 13],
  cor:       [13, 20],
  tamanho:   [20, 26],
  descricao: [26, 90],
};

/* No layout antigo os dois status vinham colados num código só:
     1ª letra = V (válido) | I (inválido)
     2ª letra = S (em linha) | N (fora de linha)
   Este mapa é o que permite os dois layouts convergirem para o mesmo
   registro — o dashboard nunca vê "VS", vê valido=true / em_linha=true. */
const STATUS_VALIDOS = ['VS', 'VN', 'IN', 'IS'];

/* Número do relatório: "1.502,490" → 1502.49
   Campo vazio vira 0 (e não NaN, que contaminaria toda a soma a jusante).

   A versão antiga apagava TODO ponto e trocava a vírgula por ponto, o que
   assume formato brasileiro sem verificar. Isso lia "1502.49" (decimal com
   ponto) como 150249 — cem vezes maior, e SEM erro: o número errado entrava
   no dashboard com cara de certo. O layout delimitado por "|" já mistura
   convenções (a data dele vem em ISO, 2026-08-25), então "é sempre pt-BR"
   não é garantia que se possa assumir de graça.

   A regra usada aqui é a invariante do formato brasileiro: separador de
   milhar é SEMPRE seguido de exatamente 3 dígitos. "1.502" é mil e
   quinhentos e dois; "1.50" não existe em pt-BR — ali o ponto só pode ser
   decimal. Isso resolve o caso ambíguo sem mexer em nada que já lia certo. */
function numeroBR(texto) {
  let s = String(texto == null ? '' : texto).trim();
  if (!s) return 0;

  let negativo = false;
  if (/^-/.test(s)) { negativo = true; s = s.slice(1).trim(); }
  // Alguns relatórios marcam negativo com o sinal DEPOIS do número ("1.234,50-").
  if (/-$/.test(s)) { negativo = true; s = s.slice(0, -1).trim(); }

  const temVirgula = s.indexOf(',') !== -1;
  const ultimoPonto = s.lastIndexOf('.');
  let normalizado;

  if (temVirgula) {
    // Quem vier depois — ponto ou vírgula — é o separador DECIMAL; o outro é
    // milhar. Cobre pt-BR ("1.502,49") e en-US ("1,502.49") sem adivinhação.
    normalizado = ultimoPonto > s.lastIndexOf(',')
      ? s.replace(/,/g, '')                          // en-US
      : s.replace(/\./g, '').replace(',', '.');      // pt-BR
  } else if (ultimoPonto !== -1) {
    const casas = s.length - ultimoPonto - 1;
    // 3 casas após o ÚLTIMO ponto = milhar ("25.371" = 25371, "1.502.490").
    // Qualquer outra quantidade = decimal ("1502.49", "1502.4905").
    normalizado = casas === 3 ? s.replace(/\./g, '') : s.replace(/\./g, function (_, i) {
      return i === ultimoPonto ? '.' : '';
    });
  } else {
    normalizado = s;
  }

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return 0;
  return negativo ? -n : n;
}

function fatia(linha, faixa) {
  return linha.substring(faixa[0], faixa[1]).trim();
}

/* Mês abreviado em português do cabeçalho ("Ago.25,26" = 25/ago/2026). */
const MESES_ABREV = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

function parsearDataCabecalho(texto) {
  const m = String(texto).match(/([A-Za-z]{3})\.(\d{1,2}),(\d{2,4})/);
  if (!m) return null;
  const mes = MESES_ABREV[m[1].toLowerCase()];
  if (mes === undefined) return null;
  const dia = Number(m[2]);
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  // Data-calendário pura (sem hora): montada em UTC para não escorregar de dia
  // quando o navegador do operador estiver em outro fuso.
  return new Date(Date.UTC(ano, mes, dia));
}

/**
 * Varre o TXT inteiro e devolve as linhas de produto + os metadados do
 * relatório. Não toca no banco e não depende de nada externo — é uma função
 * pura, o que a torna fácil de testar isoladamente quando um número divergir.
 */
function parsearRelatorioEstoque(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const registros = [];
  const familiasVistas = new Map();

  let familiaAtual = null;
  let dataExtracao = null;
  let estabelecimento = null;
  let totalGeralQtd = null;
  let totalGeralValor = null;
  let totaisFamiliaSistema = new Map();

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    // --- cabeçalho: família corrente ---
    const mFam = linha.match(/^Familia\s*\.*:\s*(\S+)\s+(.*)$/);
    if (mFam) {
      familiaAtual = { codigo: mFam[1].trim(), nome: mFam[2].trim() };
      familiasVistas.set(familiaAtual.codigo, familiaAtual.nome);
      continue;
    }

    // --- cabeçalho: data da extração e estabelecimento (repetem a cada página) ---
    if (!dataExtracao) {
      const d = parsearDataCabecalho(linha);
      if (d) dataExtracao = d;
    }
    if (!estabelecimento) {
      const mEst = linha.match(/Estabel\s*\.*:\s*(\S+)/);
      if (mEst) estabelecimento = mEst[1].trim();
    }

    // --- linhas de total impressas pelo próprio sistema ---
    // São usadas só para CONFERÊNCIA (o parser soma por conta própria).
    // Se batem, temos prova de que a leitura de largura fixa está correta.
    if (linha.indexOf('**') !== -1) {
      const mGeral = linha.match(/\*\* TOTAL GERAL[\s.]*:\s*([\d.,]+)\s+([\d.,]+)/);
      if (mGeral) {
        totalGeralQtd = numeroBR(mGeral[1]);
        totalGeralValor = numeroBR(mGeral[2]);
      }
      const mFamTot = linha.match(/\*\* TOTAL FAMILIA\s+(\S+)[\s.]*:\s*([\d.,]+)\s+([\d.,]+)/);
      if (mFamTot) {
        totaisFamiliaSistema.set(mFamTot[1], {
          qtd: numeroBR(mFamTot[2]),
          valor: numeroBR(mFamTot[3]),
        });
      }
      continue;
    }

    // --- linha de produto ---
    const st = fatia(linha, COLUNAS_LINHA.st);
    if (STATUS_VALIDOS.indexOf(st) === -1) continue;
    if (!familiaAtual) continue; // defensivo: produto antes de qualquer família

    const campoArtigo = linha.substring(COLUNAS_LINHA.artigo[0], COLUNAS_LINHA.artigo[1]);
    const armazemBruto = fatia(linha, COLUNAS_LINHA.armazem); // "EXTRE/AC190"
    const partesArm = armazemBruto.split('/');
    const estab = (partesArm[0] || '').trim();
    // Há linhas no arquivo real em que o armazém vem em branco ("EXTRE/").
    // Elas NÃO são descartadas: viram SEM_ARMAZEM e aparecem no dashboard como
    // um bloco próprio. Estoque escondido é pior do que estoque estranho.
    const armazem = (partesArm[1] || '').trim() || 'SEM_ARMAZEM';

    registros.push({
      valido:          st.charAt(0) === 'V',
      em_linha:        st.charAt(1) === 'S',
      familia_codigo:  familiaAtual.codigo,
      familia_nome:    familiaAtual.nome,
      estabelecimento: estab,
      armazem:         armazem,
      artigo_codigo:   fatia(campoArtigo, COLUNAS_ARTIGO.codigo),
      cor:             fatia(campoArtigo, COLUNAS_ARTIGO.cor),
      tamanho:         fatia(campoArtigo, COLUNAS_ARTIGO.tamanho),
      descricao:       fatia(campoArtigo, COLUNAS_ARTIGO.descricao),
      unidade:         fatia(linha, COLUNAS_LINHA.um),
      qtd:             numeroBR(fatia(linha, COLUNAS_LINHA.qtd)),
      preco_medio:     numeroBR(fatia(linha, COLUNAS_LINHA.precoMed)),
      valor:           numeroBR(fatia(linha, COLUNAS_LINHA.valor)),
    });
  }

  return {
    registros: registros,
    familias: familiasVistas,
    data_extracao: dataExtracao,
    estabelecimento: estabelecimento,
    total_geral_sistema: { qtd: totalGeralQtd, valor: totalGeralValor },
    totais_familia_sistema: totaisFamiliaSistema,
  };
}

/* ----------------------------------------------------------------------------
   PARSE DO LAYOUT 'pipe' — EX000796
   ----------------------------------------------------------------------------
   Muito mais simples que o de largura fixa: uma linha de cabeçalho nomeia as
   colunas e o resto é delimitado por "|".

     St | Em Linha | Fam | Artigo | Descricao | Cor | Tamanho | Um |
     Armazem | Local | Stock_Minimo | Qtd_Stock | Preco_Medio | Valor_Stock |

   Três diferenças de conteúdo em relação ao layout antigo:

   1. Os status vêm SEPARADOS (St = V/I, Em Linha = S/N) em vez de colados.
   2. O armazém vem como "EXTRE-AC190" (hífen) e não "EXTRE/AC190" (barra).
   3. O arquivo inclui linhas de SKU com Qtd_Stock ZERO — cadastro de produto
      sem estoque. São 8.480 delas no arquivo de 25/08. Elas NÃO entram no
      total (estoque zero não é estoque), mas são contadas e reportadas: saber
      quantos SKUs estão zerados é informação de operação, não lixo.

   O cabeçalho é lido pelo NOME das colunas, não por posição fixa: se o sistema
   passar a exportar uma coluna a mais ou em outra ordem, o parser continua
   achando cada campo.
   ---------------------------------------------------------------------------- */

const ALIAS_COLUNAS_PIPE = {
  st: ['st', 'status'],
  em_linha: ['em linha', 'emlinha', 'em_linha'],
  fam: ['fam', 'familia'],
  artigo: ['artigo'],
  descricao: ['descricao', 'descrição'],
  cor: ['cor'],
  tamanho: ['tamanho'],
  um: ['um'],
  armazem: ['armazem', 'armazém'],
  local: ['local'],
  qtd: ['qtd_stock', 'qtd stock', 'qtd'],
  preco: ['preco_medio', 'preco medio', 'preço_medio', 'preco'],
  valor: ['valor_stock', 'valor stock', 'valor'],
};

function normalizarCabecalho(s) {
  return String(s).trim().toLowerCase()
    .replace(/^vulsp-/, '')     // o relatório prefixa "VULSP-Stock_Minimo"
    .replace(/\s+/g, ' ');
}

/* Colunas sem as quais o resultado fica ERRADO em silêncio, e não só pobre.
   Se 'qtd' não é achada, toda linha lê quantidade 0, cai no descarte de "SKU
   zerado" e o arquivo inteiro some — com a mensagem enganosa de que o admin
   mandou o arquivo errado. Se 'valor' não é achada, pior: as quantidades
   entram certas e o estoque aparece valendo R$ 0,00, sem erro nenhum.
   'cor' e 'tamanho' entram na lista porque fazem parte da chave de dedup:
   sem elas, tamanhos diferentes do mesmo artigo viram uma linha só.
   Fora daqui ficam descricao/um/local — se sumirem, o relatório fica menos
   descritivo, mas nenhum número muda. */
const COLUNAS_PIPE_OBRIGATORIAS = ['st', 'em_linha', 'fam', 'artigo', 'cor', 'tamanho', 'armazem', 'qtd', 'preco', 'valor'];

function mapearColunasPipe(linhaCabecalho) {
  const nomes = linhaCabecalho.split('|').map(normalizarCabecalho);
  const idx = {};
  Object.keys(ALIAS_COLUNAS_PIPE).forEach(function (campo) {
    const aliases = ALIAS_COLUNAS_PIPE[campo];
    for (let i = 0; i < nomes.length; i++) {
      if (aliases.indexOf(nomes[i]) !== -1) { idx[campo] = i; return; }
    }
  });

  const faltando = COLUNAS_PIPE_OBRIGATORIAS.filter(function (c) { return idx[c] === undefined; });
  if (faltando.length) {
    // Falha nomeando a coluna e mostrando o que foi lido: quem recebe este erro
    // é o admin no meio do upload, e ele precisa saber que o arquivo está certo
    // e o que mudou foi um nome de coluna — não que mandou o arquivo errado.
    throw new Error(
      'Coluna' + (faltando.length > 1 ? 's' : '') + ' não encontrada' +
      (faltando.length > 1 ? 's' : '') + ' no cabeçalho: ' +
      faltando.map(function (c) { return '"' + ALIAS_COLUNAS_PIPE[c][0] + '"'; }).join(', ') +
      '. O cabeçalho lido foi: ' + nomes.filter(Boolean).join(' | ') +
      '. Se o sistema renomeou alguma coluna, o alias precisa ser adicionado em ' +
      'ALIAS_COLUNAS_PIPE (ingest.js).'
    );
  }
  return idx;
}

function parsearRelatorioPipe(textoArquivo) {
  const linhas = textoArquivo.split(/\r?\n/);
  const registros = [];
  const familiasVistas = new Map();
  let idx = null;
  let dataExtracao = null;
  let zeradas = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;

    // Cabeçalho do relatório: "POSICAO STOCK ...  2026-08-25 17:00:33.303 ..."
    if (!dataExtracao) {
      const mData = linha.match(/(\d{4})-(\d{2})-(\d{2})[ T]\d{2}:\d{2}/);
      if (mData) {
        dataExtracao = new Date(Date.UTC(+mData[1], +mData[2] - 1, +mData[3]));
      }
    }

    if (!idx) {
      if (/(^|\|)\s*st\s*\|/i.test(linha)) idx = mapearColunasPipe(linha);
      continue;
    }

    const p = linha.split('|');
    if (p.length < 10) continue;

    const st = (p[idx.st] || '').trim().toUpperCase();
    const el = (p[idx.em_linha] || '').trim().toUpperCase();
    if (st !== 'V' && st !== 'I') continue;   // linha de rodapé/lixo

    const qtd = numeroBR(p[idx.qtd]);
    if (qtd === 0) { zeradas++; continue; }   // SKU cadastrado, sem estoque

    // "EXTRE-AC190" → estabelecimento EXTRE, armazém AC190.
    // "EXTRE" sozinho (sem armazém) vira SEM_ARMAZEM, igual ao layout antigo:
    // essas linhas existem no dado real e não podem sumir do relatório.
    const armBruto = (p[idx.armazem] || '').trim();
    const corte = armBruto.indexOf('-');
    const estab = corte === -1 ? armBruto : armBruto.slice(0, corte);
    const armazem = (corte === -1 ? '' : armBruto.slice(corte + 1)).trim() || 'SEM_ARMAZEM';

    // O relatório escreve a família sem zero à esquerda em alguns casos ("43").
    // O gabarito usa 3 dígitos. Normalizar aqui evita "43" e "043" virarem
    // duas famílias diferentes no agrupamento.
    const fam = String((p[idx.fam] || '').trim()).padStart(3, '0');
    familiasVistas.set(fam, (p[idx.descricao] || '').trim());

    registros.push({
      valido:          st === 'V',
      em_linha:        el === 'S',
      familia_codigo:  fam,
      familia_nome:    '',            // o nome vem do gabarito (dim_familias)
      estabelecimento: estab,
      armazem:         armazem,
      artigo_codigo:   (p[idx.artigo] || '').trim(),
      cor:             (p[idx.cor] || '').trim(),
      tamanho:         (p[idx.tamanho] || '').trim(),
      descricao:       (p[idx.descricao] || '').trim(),
      unidade:         (p[idx.um] || '').trim(),
      qtd:             qtd,
      preco_medio:     numeroBR(p[idx.preco]),
      valor:           numeroBR(p[idx.valor]),
    });
  }

  if (!idx) {
    // A linha de cabeçalho é achada procurando uma coluna chamada "St" — ela é
    // a âncora, não só mais uma coluna. Por isso renomear "St" cai AQUI e não
    // na validação de colunas obrigatórias: sem a âncora, nem chegamos a
    // mapear. Dizer qual é a âncora poupa o admin de procurar às cegas.
    throw new Error(
      'Cabeçalho de colunas não encontrado no arquivo delimitado por "|". ' +
      'A linha de cabeçalho é localizada por uma coluna chamada "St" — se o ' +
      'sistema renomeou essa coluna, o alias precisa ser adicionado em ' +
      'ALIAS_COLUNAS_PIPE e na detecção de cabeçalho (ingest.js).'
    );
  }

  return {
    registros: registros,
    familias: familiasVistas,
    data_extracao: dataExtracao,
    estabelecimento: registros.length ? registros[0].estabelecimento : null,
    // Este layout não imprime totais do sistema — sem conferência externa.
    total_geral_sistema: { qtd: null, valor: null },
    totais_familia_sistema: new Map(),
    linhas_zeradas: zeradas,
    layout: 'pipe',
  };
}

function parsearRelatorio(textoArquivo) {
  const layout = detectarLayout(textoArquivo);
  if (layout === 'pipe') return parsearRelatorioPipe(textoArquivo);
  const r = parsearRelatorioEstoque(textoArquivo);
  r.layout = 'fixo';
  r.linhas_zeradas = 0;   // o layout antigo já sai do sistema com "Stock Zero: N"
  return r;
}

/* ----------------------------------------------------------------------------
   DEDUPLICAÇÃO ANTES DO INSERT (README 3.2)
   ----------------------------------------------------------------------------
   No arquivo real de 25.371 linhas a chave natural
   (status × família × armazém × artigo × cor × tamanho) é única — foi
   conferido. Mas o relatório é paginado e o layout pode mudar; se uma extração
   futura repetir a chave, o insert em lote estouraria 409 de conflito.

   Diferença importante em relação ao caso do e-commerce: lá o correto era
   MANTER o registro "mais avançado" por prioridade de status. Aqui as linhas
   repetidas seriam duas posições do MESMO SKU no MESMO armazém, então o
   correto é SOMAR as quantidades e os valores — descartar uma delas perderia
   estoque real. O preço médio é recalculado como média ponderada pela
   quantidade, não simplesmente sobrescrito.
   ---------------------------------------------------------------------------- */
function deduplicarPosicoes(registros) {
  const porChave = new Map();
  let colisoes = 0;

  registros.forEach(function (r) {
    const chave = [
      // estabelecimento entra na chave: sem ele, o mesmo SKU no mesmo código
      // de armazém vindo de dois estabelecimentos virava UMA linha, e o
      // Object.assign abaixo guarda o estabelecimento do PRIMEIRO — o estoque
      // do segundo era gravado como se fosse do primeiro. O total geral
      // continuava certo, só a atribuição ficava errada, que é o tipo de
      // divergência que ninguém acha. Hoje a extração é de um estabelecimento
      // só e isto não muda nada; é a trava pra quando exportarem os dois
      // juntos no mesmo arquivo.
      r.valido, r.em_linha, r.familia_codigo, r.estabelecimento, r.armazem,
      r.artigo_codigo, r.cor, r.tamanho,
    ].join('\u0001');

    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, Object.assign({}, r));
      return;
    }
    colisoes++;
    const qtdTotal = existente.qtd + r.qtd;
    existente.preco_medio = qtdTotal > 0
      ? (existente.preco_medio * existente.qtd + r.preco_medio * r.qtd) / qtdTotal
      : existente.preco_medio;
    existente.qtd = qtdTotal;
    existente.valor += r.valor;
  });

  return { registros: Array.from(porChave.values()), colisoes: colisoes };
}

/* ----------------------------------------------------------------------------
   PAGINAÇÃO SEGURA (README 3.1)
   ----------------------------------------------------------------------------
   O PostgREST tem um teto próprio de linhas por resposta (tipicamente 1000),
   INDEPENDENTE do tamanho pedido em .range(). Comparar "voltou menos do que
   pedi" com "acabou" foi a causa raiz do bug em que um card mostrava 100% de
   um único segmento no report do e-commerce. Aqui a regra é: só para quando a
   página vier VAZIA, e o offset avança pelo tamanho REAL retornado.
   ---------------------------------------------------------------------------- */
async function lerTudoPaginado(supabaseClient, tabela, colunas, aplicarFiltros, ordenarPor) {
  const LOTE = 5000;
  let offset = 0;
  const tudo = [];
  while (true) {
    // A ordenação não é enfeite: sem ORDER BY estável o Postgres não promete a
    // MESMA ordem entre duas consultas, e paginar por offset em cima de ordem
    // indefinida pode repetir uma linha numa página e pular outra na seguinte.
    // Hoje dim_armazens/dim_familias cabem numa página só e o problema não
    // aparece; quando crescerem, apareceria como gabarito faltando pra uma
    // família — o tipo de bug que ninguém liga ao paginador. Default 'codigo'
    // porque é a PK das duas dimensões que hoje passam por aqui.
    let q = supabaseClient.from(tabela).select(colunas)
      .order(ordenarPor || 'codigo', { ascending: true })
      .range(offset, offset + LOTE - 1);
    if (aplicarFiltros) q = aplicarFiltros(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;   // só "voltou zero" significa "acabou"
    tudo.push.apply(tudo, data);
    offset += data.length;                   // avança pelo que voltou de verdade
  }
  return tudo;
}

/* ----------------------------------------------------------------------------
   UPLOAD DO ARQUIVO ORIGINAL COMPRIMIDO (README 3.4)
   ----------------------------------------------------------------------------
   O TXT bruto tem ~10 MB. Comprimido em gzip cai para uma fração disso, o que
   evita o erro 400 de "tamanho excede o limite" do Storage. O fallback para o
   upload cru cobre navegador sem CompressionStream.
   ---------------------------------------------------------------------------- */
async function uploadArquivoOriginal(supabaseClient, caminho, file) {
  try {
    const cs = new CompressionStream('gzip');
    const comprimido = await new Response(file.stream().pipeThrough(cs)).blob();
    const { error } = await supabaseClient.storage
      .from('backups')
      .upload(caminho + '.gz', comprimido, { contentType: 'application/gzip', upsert: true });
    if (error) throw error;
    return caminho + '.gz';
  } catch (e) {
    try {
      const { error } = await supabaseClient.storage
        .from('backups').upload(caminho, file, { upsert: true });
      if (error) throw error;
      return caminho;
    } catch (e2) {
      // Backup é auditoria, não é o dado. Falhar aqui não pode derrubar a
      // ingestão inteira — o snapshot ainda vale. Registra e segue.
      console.warn('Backup do arquivo original falhou:', e2);
      return null;
    }
  }
}

/* ----------------------------------------------------------------------------
   AGREGAÇÃO — MONTAGEM DO SNAPSHOT
   ----------------------------------------------------------------------------
   Aqui é onde o índice do dashboard nasce PRONTO. A hierarquia definida com a
   operação é: 1º Armazém → 2º Marca → 3º Família.

   Toda linha da árvore carrega qtd, valor e o % de participação EM RELAÇÃO AO
   PAI (não ao total geral): dentro de um armazém, os percentuais das marcas
   somam 100%; dentro de uma marca, os das famílias somam 100%. Foi a leitura
   que o modelo do dash financeiro sugere e a que responde à pergunta que a
   gestão faz de verdade ("quanto desse armazém é Mizuno?").
   ---------------------------------------------------------------------------- */
const ROTULO_STATUS = {
  VS: 'Válido · em linha',
  VN: 'Válido · fora de linha',
  IS: 'Inválido · em linha',
  IN: 'Inválido · fora de linha',
};

function pct(parte, total) {
  return total > 0 ? (parte / total) * 100 : 0;
}

/* Chave dos quatro baldes de status: V/I + S/N.
   Cada nó da árvore guarda o total quebrado nessas quatro combinações, para
   que os filtros do dashboard sejam uma SOMA de baldes já calculados, e não um
   recálculo de regra de negócio no navegador — o index.html continua só
   somando o que já veio pronto (README seção 1.2). */
function chaveStatus(r) {
  return (r.valido ? 'V' : 'I') + (r.em_linha ? 'S' : 'N');
}

function novoNo(codigo, nome) {
  return { codigo: codigo, nome: nome, qtd: 0, valor: 0, skus: 0, st: {}, filhos: new Map() };
}

function acumular(no, r) {
  no.qtd += r.qtd;
  no.valor += r.valor;
  no.skus += 1;
  const k = chaveStatus(r);
  const b = no.st[k] || (no.st[k] = { qtd: 0, valor: 0, skus: 0 });
  b.qtd += r.qtd;
  b.valor += r.valor;
  b.skus += 1;
}

function construirSnapshotEstoque(registros, mapaFamilias, mapaArmazens, meta) {
  // --- árvore Armazém → Marca → Família ---
  const raiz = new Map();
  const porStatus = new Map();
  const porMarca = new Map();
  const familiasNaoMapeadas = new Set();

  registros.forEach(function (r) {
    const infoFam = mapaFamilias.get(r.familia_codigo);
    const marca = infoFam ? infoFam.marca : 'NAO MAPEADA';
    if (!infoFam) familiasNaoMapeadas.add(r.familia_codigo);
    // O nome da família vem do GABARITO, não do arquivo: o layout delimitado
    // não traz o nome da família, e o de largura fixa traz um nome de sistema
    // ("VESTUARIO OLYMP.TERCEIROS") diferente do que a operação usa
    // ("VESTUÁRIO OLY"). O gabarito é a fonte de verdade para exibição.
    const nomeFam = (infoFam && infoFam.categoria) || r.familia_nome || r.familia_codigo;
    const segmento = (infoFam && infoFam.segmento) || '—';

    if (!raiz.has(r.armazem)) raiz.set(r.armazem, novoNo(r.armazem, r.armazem));
    const nArm = raiz.get(r.armazem);
    acumular(nArm, r);

    if (!nArm.filhos.has(marca)) nArm.filhos.set(marca, novoNo(marca, marca));
    const nMarca = nArm.filhos.get(marca);
    acumular(nMarca, r);

    if (!nMarca.filhos.has(r.familia_codigo)) {
      const nf = novoNo(r.familia_codigo, nomeFam);
      nf.segmento = segmento;
      nMarca.filhos.set(r.familia_codigo, nf);
    }
    acumular(nMarca.filhos.get(r.familia_codigo), r);

    const ks = chaveStatus(r);
    if (!porStatus.has(ks)) porStatus.set(ks, novoNo(ks, ROTULO_STATUS[ks] || ks));
    acumular(porStatus.get(ks), r);

    if (!porMarca.has(marca)) porMarca.set(marca, novoNo(marca, marca));
    acumular(porMarca.get(marca), r);
  });

  const totalQtd = registros.reduce(function (s, r) { return s + r.qtd; }, 0);
  const totalValor = registros.reduce(function (s, r) { return s + r.valor; }, 0);

  // Ordem dos armazéns vem do gabarito (dim_armazens.ordem) — decisão de
  // negócio, não alfabética. Armazém desconhecido cai no fim, mas aparece.
  function ordemArmazem(cod) {
    const info = mapaArmazens.get(cod);
    return info ? info.ordem : 95;
  }

  const armazens = Array.from(raiz.values())
    .sort(function (a, b) { return ordemArmazem(a.codigo) - ordemArmazem(b.codigo); })
    .map(function (nArm) {
      const infoArm = mapaArmazens.get(nArm.codigo);
      return {
        codigo: nArm.codigo,
        nome: (infoArm && infoArm.descricao) || 'Armazém não cadastrado no gabarito',
        categoria: (infoArm && infoArm.categoria) || 'NAO_MAPEADO',
        qtd: nArm.qtd,
        valor: nArm.valor,
        skus: nArm.skus,
        st: nArm.st,
        pct_qtd: pct(nArm.qtd, totalQtd),
        pct_valor: pct(nArm.valor, totalValor),
        marcas: Array.from(nArm.filhos.values())
          .sort(function (a, b) { return b.valor - a.valor; })
          .map(function (nMarca) {
            return {
              codigo: nMarca.codigo,
              nome: nMarca.nome,
              qtd: nMarca.qtd,
              valor: nMarca.valor,
              skus: nMarca.skus,
              st: nMarca.st,
              pct_qtd: pct(nMarca.qtd, nArm.qtd),
              pct_valor: pct(nMarca.valor, nArm.valor),
              familias: Array.from(nMarca.filhos.values())
                .sort(function (a, b) { return b.valor - a.valor; })
                .map(function (nFam) {
                  return {
                    codigo: nFam.codigo,
                    nome: nFam.nome,
                    segmento: nFam.segmento,
                    qtd: nFam.qtd,
                    valor: nFam.valor,
                    skus: nFam.skus,
                    st: nFam.st,
                    pct_qtd: pct(nFam.qtd, nMarca.qtd),
                    pct_valor: pct(nFam.valor, nMarca.valor),
                  };
                }),
            };
          }),
      };
    });

  function listaSimples(mapa, total) {
    return Array.from(mapa.values())
      .sort(function (a, b) { return b.valor - a.valor; })
      .map(function (n) {
        return {
          codigo: n.codigo, nome: n.nome, qtd: n.qtd, valor: n.valor, skus: n.skus, st: n.st,
          pct_qtd: pct(n.qtd, total.qtd), pct_valor: pct(n.valor, total.valor),
        };
      });
  }

  // --- conferência contra o total impresso pelo próprio sistema ---
  // Uma diferença de centavos é esperada: o sistema soma os valores já
  // arredondados linha a linha. Uma diferença de QUANTIDADE, não — essa
  // significaria linha perdida no parse, e o dashboard mostra o alerta.
  const sis = meta.total_geral_sistema || {};
  const conferencia = {
    qtd_parseada: totalQtd,
    valor_parseado: totalValor,
    qtd_sistema: sis.qtd,
    valor_sistema: sis.valor,
    diff_qtd: sis.qtd != null ? totalQtd - sis.qtd : null,
    diff_valor: sis.valor != null ? totalValor - sis.valor : null,
    // ok = null significa "este layout não imprime total do sistema", e não
    // "conferiu". A tela precisa dizer isso, não fingir uma validação.
    ok: sis.qtd != null ? Math.abs(totalQtd - sis.qtd) < 0.001 : null,
  };

  return {
    versao: 2,
    gerado_em: new Date().toISOString(),          // UTC puro (README 3.3)
    arquivo: meta.arquivo_nome,
    layout: meta.layout,
    linhas_zeradas: meta.linhas_zeradas || 0,
    data_extracao: meta.data_extracao ? meta.data_extracao.toISOString().slice(0, 10) : null,
    estabelecimento: meta.estabelecimento,
    total: {
      qtd: totalQtd,
      valor: totalValor,
      skus: registros.length,
      artigos: new Set(registros.map(function (r) { return r.artigo_codigo; })).size,
      preco_medio: totalQtd > 0 ? totalValor / totalQtd : 0,
    },
    armazens: armazens,
    por_marca: listaSimples(porMarca, { qtd: totalQtd, valor: totalValor }),
    por_status: listaSimples(porStatus, { qtd: totalQtd, valor: totalValor }),
    familias_nao_mapeadas: Array.from(familiasNaoMapeadas),
    conferencia: conferencia,
  };
}

/* ----------------------------------------------------------------------------
   ORQUESTRAÇÃO
   ----------------------------------------------------------------------------
   Fluxo completo de uma atualização de estoque. O index.html chama só isto.
   `onProgresso` é o único canal de saída para a interface — nenhuma escrita
   direta no DOM acontece aqui.
   ---------------------------------------------------------------------------- */
const LOTE_INSERT = 500;

async function processarEstoque(supabaseClient, file, onProgresso) {
  const avisar = onProgresso || function () {};

  avisar('Lendo arquivo…');
  const texto = await file.text();

  const layout = detectarLayout(texto);
  avisar('Layout detectado: ' + (layout === 'pipe'
    ? 'delimitado por "|" (EX000796).'
    : 'largura fixa (EX000914).'));

  const parsed = parsearRelatorio(texto);
  if (parsed.registros.length === 0) {
    throw new Error(
      'Nenhuma linha de produto reconhecida. Confira se o arquivo é a extração de ' +
      'posição de stock, exportada direto do sistema e sem reformatação.'
    );
  }

  const dedup = deduplicarPosicoes(parsed.registros);
  avisar(
    parsed.registros.length.toLocaleString('pt-BR') + ' linhas com estoque' +
    (parsed.linhas_zeradas
      ? ' (' + parsed.linhas_zeradas.toLocaleString('pt-BR') + ' linhas de SKU zerado descartadas do total)'
      : '') +
    (dedup.colisoes ? ' · ' + dedup.colisoes + ' somadas por chave repetida' : '') + '.'
  );

  // --- dimensões (com paginação segura, mesmo sendo tabelas pequenas hoje) ---
  avisar('Carregando gabaritos de armazém e família…');
  const [linhasArm, linhasFam] = await Promise.all([
    lerTudoPaginado(supabaseClient, 'dim_armazens', 'codigo, descricao, categoria, ordem'),
    lerTudoPaginado(supabaseClient, 'dim_familias', 'codigo, nome, marca, categoria, segmento'),
  ]);
  const mapaArmazens = new Map(linhasArm.map(function (a) { return [a.codigo, a]; }));
  const mapaFamilias = new Map(linhasFam.map(function (f) { return [f.codigo, f]; }));

  // --- cabeçalho da extração ---
  const totQtd = dedup.registros.reduce(function (s, r) { return s + r.qtd; }, 0);
  const totValor = dedup.registros.reduce(function (s, r) { return s + r.valor; }, 0);

  avisar('Registrando a extração…');
  const { data: extracao, error: errExtracao } = await supabaseClient
    .from('estoque_extracoes')
    .insert({
      arquivo_nome: file.name,
      data_extracao: parsed.data_extracao ? parsed.data_extracao.toISOString().slice(0, 10) : null,
      estabelecimento: parsed.estabelecimento,
      gerado_em: new Date().toISOString(),        // UTC — conversão só na exibição
      layout: parsed.layout,
      linhas_lidas: dedup.registros.length,
      linhas_zeradas: parsed.linhas_zeradas || 0,
      qtd_total_parseada: totQtd,
      valor_total_parseado: totValor,
      qtd_total_sistema: parsed.total_geral_sistema.qtd,
      valor_total_sistema: parsed.total_geral_sistema.valor,
    })
    .select('id')
    .single();
  if (errExtracao) throw errExtracao;

  // --- fato, em lotes ---
  const paraInserir = dedup.registros.map(function (r) {
    const infoFam = mapaFamilias.get(r.familia_codigo);
    return {
      extracao_id: extracao.id,
      valido: r.valido,
      em_linha: r.em_linha,
      familia_codigo: r.familia_codigo,
      marca: infoFam ? infoFam.marca : 'NAO MAPEADA',
      armazem: r.armazem,
      estabelecimento: r.estabelecimento,
      artigo_codigo: r.artigo_codigo,
      cor: r.cor,
      tamanho: r.tamanho,
      descricao: r.descricao,
      unidade: r.unidade,
      qtd: r.qtd,
      preco_medio: r.preco_medio,
      valor: r.valor,
    };
  });

  for (let i = 0; i < paraInserir.length; i += LOTE_INSERT) {
    const lote = paraInserir.slice(i, i + LOTE_INSERT);
    const { error } = await supabaseClient.from('estoque_posicoes').insert(lote);
    if (error) throw error;
    avisar('Gravando posições… ' +
      Math.min(i + LOTE_INSERT, paraInserir.length).toLocaleString('pt-BR') +
      ' / ' + paraInserir.length.toLocaleString('pt-BR'));
  }

  // --- snapshot pronto para renderizar ---
  avisar('Consolidando o snapshot…');
  const payload = construirSnapshotEstoque(dedup.registros, mapaFamilias, mapaArmazens, {
    arquivo_nome: file.name,
    data_extracao: parsed.data_extracao,
    estabelecimento: parsed.estabelecimento,
    total_geral_sistema: parsed.total_geral_sistema,
    layout: parsed.layout,
    linhas_zeradas: parsed.linhas_zeradas || 0,
  });

  const { error: errSnap } = await supabaseClient.from('dashboard_snapshots').insert({
    pagina: 'estoque',
    payload: payload,
    gerado_em: new Date().toISOString(),
    extracao_id: extracao.id,
  });
  if (errSnap) throw errSnap;

  // --- backup do original (não bloqueia o resultado) ---
  avisar('Enviando backup do arquivo original…');
  const caminho = 'estoque/' + new Date().toISOString().slice(0, 10) + '/' + file.name;
  const storagePath = await uploadArquivoOriginal(supabaseClient, caminho, file);
  if (storagePath) {
    await supabaseClient.from('estoque_extracoes')
      .update({ storage_path: storagePath }).eq('id', extracao.id);
  }

  avisar('Concluído.');
  return payload;
}

/* Exposto no escopo global porque o index.html é single-file sem bundler —
   mesma abordagem do Report E-commerce. */
window.processarEstoque = processarEstoque;
window.parsearRelatorio = parsearRelatorio;
window.detectarLayout = detectarLayout;
window.parsearRelatorioEstoque = parsearRelatorioEstoque;
window.parsearRelatorioPipe = parsearRelatorioPipe;
window.construirSnapshotEstoque = construirSnapshotEstoque;
window.deduplicarPosicoes = deduplicarPosicoes;

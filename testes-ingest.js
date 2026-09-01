/* ============================================================================
   TESTES DO INGEST — rode com:  node testes-ingest.js
   ============================================================================
   Sem dependência, sem framework, sem build: o projeto inteiro é servido como
   arquivo estático e não tem node_modules, então o teste segue a mesma regra.
   Sai com código 1 se algo falhar, então serve em CI se um dia houver.

   POR QUE ISTO EXISTE: o ingest.js é o único lugar do sistema que erra em
   SILÊNCIO. Se o parser lê um número errado, nada estoura — o dashboard
   simplesmente mostra outro valor, com a mesma cara de certo. Os casos abaixo
   são as invariantes que, se quebrarem, ninguém percebe pela tela.

   Como o ingest.js é escrito pra rodar no navegador (termina com window.*),
   aqui ele é lido como texto, as linhas window.* são removidas e o resto é
   avaliado. Funções vazam do eval; const não vaza, por isso as constantes que
   os testes usam são reexportadas no fim do eval.
   ============================================================================ */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'ingest.js'), 'utf8')
  .split('\n').filter(function (l) { return !l.trim().startsWith('window.'); }).join('\n');
eval(src + ';globalThis.COLUNAS_LINHA = COLUNAS_LINHA;');

let falhas = 0;
let grupo = '';
function secao(nome) { grupo = nome; console.log('\n=== ' + nome + ' ==='); }
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : '  XX  ') + msg);
  if (!cond) falhas++;
}
function eq(obtido, esperado, msg) {
  const igual = typeof esperado === 'number' && typeof obtido === 'number'
    ? Math.abs(obtido - esperado) < 1e-9
    : obtido === esperado;
  ok(igual, msg + (igual ? '' : '  (esperado ' + esperado + ', obtido ' + obtido + ')'));
}

/* --------------------------------------------------------------------------
   1) numeroBR — conversão de texto para número
   --------------------------------------------------------------------------
   A regra é a invariante do pt-BR: separador de milhar é SEMPRE seguido de
   exatamente 3 dígitos. "1.502" é mil e quinhentos e dois; "1.50" não existe
   em pt-BR, ali o ponto só pode ser decimal. É isso que permite ler o formato
   americano sem estragar o brasileiro.
   -------------------------------------------------------------------------- */
secao('numeroBR');
[
  ['1.502,490', 1502.49,   'pt-BR milhar + decimal (formato do layout fixo)'],
  ['1502,49',   1502.49,   'pt-BR só decimal'],
  ['100,000',   100,       'quantidade com 3 casas decimais'],
  ['5.000,00',  5000,      'valor com milhar'],
  ['0,000',     0,         'zero'],
  ['',          0,         'vazio vira 0, não NaN'],
  [null,        0,         'null vira 0'],
  ['   ',       0,         'só espaço vira 0'],
  ['abc',       0,         'lixo vira 0 (NaN contaminaria a soma inteira)'],
  ['100',       100,       'inteiro puro'],
  ['25.371',    25371,     'ponto seguido de 3 dígitos = MILHAR'],
  ['1.502.490', 1502490,   'dois separadores de milhar'],
  ['1502.49',   1502.49,   'ponto com 2 casas = DECIMAL (antes lia 150249)'],
  ['1502.4905', 1502.4905, 'ponto com 4 casas = decimal'],
  ['1,502.49',  1502.49,   'formato en-US (antes lia 1.50249)'],
  ['-1.234,50', -1234.5,   'negativo com sinal na frente'],
  ['1.234,50-', -1234.5,   'negativo com sinal atrás'],
].forEach(function (c) {
  eq(numeroBR(c[0]), c[1], JSON.stringify(c[0]).padEnd(13) + c[2]);
});

/* --------------------------------------------------------------------------
   2) deduplicarPosicoes — o que conta como "mesma linha"
   -------------------------------------------------------------------------- */
secao('deduplicarPosicoes');
function reg(over) {
  return Object.assign({
    valido: true, em_linha: true, familia_codigo: '043', estabelecimento: 'EXTRE',
    armazem: 'AC190', artigo_codigo: '432', cor: 'PRETO', tamanho: '40',
    qtd: 100, valor: 5000, preco_medio: 50,
  }, over);
}

const doisEstab = deduplicarPosicoes([
  reg({ estabelecimento: 'EXTRE', qtd: 100, valor: 5000 }),
  reg({ estabelecimento: 'SPAUL', qtd: 70, valor: 3500 }),
]);
eq(doisEstab.registros.length, 2, 'estabelecimentos diferentes NÃO são fundidos');
eq(doisEstab.colisoes, 0, 'e não reportam colisão falsa');
eq(doisEstab.registros.reduce(function (s, r) { return s + r.qtd; }, 0), 170, 'total preservado');

const repetida = deduplicarPosicoes([
  reg({ qtd: 100, valor: 5000, preco_medio: 40 }),
  reg({ qtd: 100, valor: 6000, preco_medio: 60 }),
]);
eq(repetida.registros.length, 1, 'linha realmente repetida vira uma só');
eq(repetida.registros[0].qtd, 200, 'quantidades SOMAM (descartar perderia estoque real)');
eq(repetida.registros[0].valor, 11000, 'valores somam');
eq(repetida.registros[0].preco_medio, 50, 'preço médio é PONDERADO pela qtd, não sobrescrito');

['tamanho', 'cor', 'armazem', 'artigo_codigo'].forEach(function (campo) {
  const r = deduplicarPosicoes([reg({}), reg({ [campo]: 'OUTRO' })]);
  eq(r.registros.length, 2, campo + ' diferente = linhas diferentes');
});

/* --------------------------------------------------------------------------
   3) parser do layout delimitado por "|"
   -------------------------------------------------------------------------- */
secao('layout pipe');
const TOPO = 'POSICAO STOCK 2026-08-25 17:00:33.303';
const CAB = 'St|Em Linha|Fam|Artigo|Descricao|Cor|Tamanho|Um|Armazem|Local|Stock_Minimo|Qtd_Stock|Preco_Medio|Valor_Stock';
function linhaPipe(arm, qtd, val) {
  return 'V|S|043|43224430|TENIS X|PRETO|40|PAR|' + arm + '||0|' + qtd + '|50,00|' + val;
}
function arquivoPipe(cab, linhas) {
  return [TOPO, cab].concat(linhas).join('\n');
}

const pipeOk = parsearRelatorioPipe(arquivoPipe(CAB, [linhaPipe('EXTRE-AC190', '100,000', '5.000,00')]));
eq(pipeOk.registros.length, 1, 'cabeçalho correto: lê a linha');
eq(pipeOk.registros[0].qtd, 100, 'quantidade lida');
eq(pipeOk.registros[0].armazem, 'AC190', '"EXTRE-AC190" -> armazém AC190');
eq(pipeOk.registros[0].estabelecimento, 'EXTRE', 'e estabelecimento EXTRE');

const semArm = parsearRelatorioPipe(arquivoPipe(CAB, [linhaPipe('EXTRE', '10,000', '100,00')]));
eq(semArm.registros[0].armazem, 'SEM_ARMAZEM', 'armazém em branco vira SEM_ARMAZEM (não some do relatório)');

const zerada = parsearRelatorioPipe(arquivoPipe(CAB, [
  linhaPipe('EXTRE-AC190', '0,000', '0,00'),
  linhaPipe('EXTRE-AC190', '5,000', '50,00'),
]));
eq(zerada.registros.length, 1, 'SKU com estoque zero não entra no total');
eq(zerada.linhas_zeradas, 1, 'mas é contado e reportado');

// Coluna renomeada tem que FALHAR NOMEANDO a coluna. Antes o parser seguia com
// a coluna undefined, lia qtd 0, descartava tudo como "SKU zerado" e o admin
// recebia "mande o arquivo certo" — quando o arquivo estava certo.
[['Qtd_Stock', 'Quantidade_Stock'], ['Valor_Stock', 'Vlr_Total'], ['Armazem', 'Deposito'],
 ['Cor', 'Cor_Produto'], ['Tamanho', 'Tam'], ['Fam', 'Familia_Cod']].forEach(function (t) {
  let erro = null;
  try {
    parsearRelatorioPipe(arquivoPipe(CAB.replace(t[0], t[1]), [linhaPipe('EXTRE-AC190', '100,000', '5.000,00')]));
  } catch (e) { erro = e; }
  ok(erro !== null, t[0] + ' renomeada -> falha (não passa batido)');
  ok(erro !== null && erro.message.toLowerCase().indexOf(t[0].toLowerCase()) !== -1,
     t[0] + ' renomeada -> a mensagem nomeia a coluna que faltou');
});

// "St" é caso à parte: é a ÂNCORA usada pra achar a linha de cabeçalho, não só
// mais uma coluna. Renomeá-la cai antes do mapeamento, então o erro é outro —
// mas tem que continuar sendo um erro que explica onde mexer.
let erroSt = null;
try {
  parsearRelatorioPipe(arquivoPipe(CAB.replace('St|', 'Situacao|'), [linhaPipe('EXTRE-AC190', '100,000', '5.000,00')]));
} catch (e) { erroSt = e; }
ok(erroSt !== null, 'St renomeada -> falha (é a âncora do cabeçalho)');
ok(erroSt !== null && /"St"/.test(erroSt.message),
   'St renomeada -> a mensagem explica que "St" é a âncora do cabeçalho');

/* --------------------------------------------------------------------------
   4) parser do layout de largura fixa
   -------------------------------------------------------------------------- */
secao('layout fixo');
function linhaFixa(campos) {
  const l = ' '.repeat(210).split('');
  Object.keys(campos).forEach(function (k) {
    const ini = COLUNAS_LINHA[k][0];
    const v = String(campos[k]);
    for (let i = 0; i < v.length; i++) l[ini + i] = v[i];
  });
  return l.join('').replace(/\s+$/, '');
}
function campoArtigo(cod, cor, tam, desc) {
  return cod.padEnd(13) + cor.padEnd(7) + tam.padEnd(6) + desc;
}

const arquivoFixo = [
  '   POSICAO DO STOCK - LOCAIS STOCKAGEM        Ago.25,26',
  '   Estabel....: EXTRE',
  'Familia ....: 043 VESTUARIO OLYMP.TERCEIROS',
  linhaFixa({ st: 'VS', artigo: campoArtigo('43224430', 'PRETO', '40', 'TENIS OLYMPIKUS'),
              um: 'PAR', armazem: 'EXTRE/AC190', qtd: '1.502,490', precoMed: '50,00', valor: '75.124,50' }),
  linhaFixa({ st: 'VN', artigo: campoArtigo('43224431', 'BRANCO', '41', 'TENIS 2'),
              um: 'PAR', armazem: 'EXTRE/AC190', qtd: '25.371', precoMed: '10,00', valor: '253.710,00' }),
  linhaFixa({ st: 'IN', artigo: campoArtigo('43224432', 'AZUL', '42', 'TENIS 3'),
              um: 'PAR', armazem: 'EXTRE/', qtd: '100,000', precoMed: '2,50', valor: '250,00' }),
  '   ** TOTAL GERAL .....:      26.973,490     329.084,50',
].join('\n');

eq(detectarLayout(arquivoFixo), 'fixo', 'layout detectado pelo conteúdo');
const fx = parsearRelatorio(arquivoFixo);
eq(fx.registros.length, 3, 'lê as 3 linhas de produto');
eq(fx.registros[0].qtd, 1502.49, 'qtd de largura fixa');
eq(fx.registros[0].valor, 75124.5, 'valor de largura fixa');
eq(fx.registros[0].artigo_codigo, '43224430', 'código do artigo fatiado na posição certa');
eq(fx.registros[0].cor, 'PRETO', 'cor fatiada');
eq(fx.registros[0].tamanho, '40', 'tamanho fatiado');
eq(fx.registros[0].armazem, 'AC190', '"EXTRE/AC190" -> AC190');
ok(fx.registros[0].valido === true && fx.registros[0].em_linha === true, 'VS -> válido + em linha');
ok(fx.registros[1].valido === true && fx.registros[1].em_linha === false, 'VN -> válido + fora de linha');
ok(fx.registros[2].valido === false && fx.registros[2].em_linha === false, 'IN -> inválido + fora de linha');
eq(fx.registros[2].armazem, 'SEM_ARMAZEM', 'armazém em branco vira SEM_ARMAZEM');
eq(fx.estabelecimento, 'EXTRE', 'estabelecimento do cabeçalho');
eq(fx.data_extracao.toISOString().slice(0, 10), '2026-08-25', 'data "Ago.25,26" -> 2026-08-25');

// A conferência é a prova de que a leitura de largura fixa está certa: a soma
// do parser tem que bater com o total que o próprio sistema imprimiu.
eq(fx.total_geral_sistema.qtd, 26973.49, 'TOTAL GERAL do sistema lido');
const somaFixo = fx.registros.reduce(function (s, r) { return s + r.qtd; }, 0);
ok(Math.abs(somaFixo - fx.total_geral_sistema.qtd) < 0.001,
   'soma do parser bate com o total do sistema (' + somaFixo.toFixed(2) + ')');

/* -------------------------------------------------------------------------- */
console.log('\n' + (falhas === 0
  ? 'TODOS OS TESTES PASSARAM'
  : falhas + ' TESTE(S) FALHARAM'));
process.exit(falhas === 0 ? 0 : 1);

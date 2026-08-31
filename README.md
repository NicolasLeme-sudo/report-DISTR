# Report Distribuidora — Balanço e Detalhamento de Estoque

Dashboard executivo de estoque da distribuidora, com a hierarquia
**Armazém › Marca › Família** em listagem que abre e fecha, no modelo do dash
financeiro usado como referência.

A base técnica e a identidade visual são herdadas do Report E-commerce
(CD Vulcabras — Extrema/MG), mas este é um projeto **independente**: repositório
próprio, banco Supabase próprio e deploy próprio. As demais páginas — romaneio,
faturamento, entrega por transportadora — entram depois nesta mesma base, sem
mudança de estrutura: cada uma vira uma nova linha em `dashboard_snapshots`.

---

## 1. Arquitetura

Três camadas, com separação rígida de responsabilidade:

```
   Extração TXT do sistema (Posição de Stock)
              │  upload manual, feito pelo operador no navegador
              ▼
        ┌───────────────┐
        │   ingest.js    │  Lê o arquivo, cruza com os gabaritos, calcula
        │  (processa e   │  os indicadores e grava tudo já pronto.
        │   só escreve)  │  NUNCA desenha nada na tela.
        └───────┬────────┘
                │ grava
                ▼
        ┌───────────────┐
        │   Supabase     │  Postgres (dados + snapshot) +
        │                │  Storage (backup gzip do TXT original)
        └───────┬────────┘
                │ lê o snapshot já pronto
                ▼
        ┌───────────────┐
        │  index.html    │  Desenha cards, gráficos e a árvore.
        │ (renderiza e   │  NUNCA recalcula regra de negócio.
        │   só lê)       │
        └───────────────┘
                ▼
             Vercel
```

**Essa separação não é opcional.** Número errado na tela se investiga no
`ingest.js` (como foi calculado); aparência se ajusta no `index.html` (como é
exibido). Foi o que economizou tempo de debug no projeto do e-commerce e é o
que mantém a tela rápida com base grande.

| Arquivo | O que é |
|---|---|
| `index.html` | O dashboard. Single-file, sem build step. |
| `ingest.js` | Parse, agregação e gravação (página Estoque). |
| `distr-fluxo.js` | Renderizador + editor da página **Fluxo de Processos** (ver seção 10). |
| `esquema.sql` | Todo o banco: tabelas, gabaritos, RLS. Já aplicado. |
| `seed_distr_fluxo.sql` | Semente da primeira versão do Fluxo de Processos (ver seção 10). |
| `vercel.json` | Diz ao Vercel que é estático puro, sem build. |
| `favicon.png` | Ícone da aba e marca no menu. |

---

## 2. Infraestrutura já provisionada

### Supabase

| | |
|---|---|
| Projeto | `report-distribuidora` |
| Organização | Vulca |
| Região | `sa-east-1` (São Paulo) |
| URL | `https://qaehjplsasumuhszjcnu.supabase.co` |
| Custo | R$ 0/mês |

O schema e os gabaritos **já estão aplicados** (7 armazéns, 37 famílias com
marca e segmento). A `publishable key` já está preenchida no `index.html` —
ela é pública por design: quem protege o dado é a RLS no Postgres, não o fato
de a chave estar escondida no front.

### O que ainda falta fazer no Supabase (5 min)

1. **Storage → New bucket** → nome `backups`, **Public: OFF**.
   É onde fica a cópia comprimida de cada TXT enviado, para auditoria.
2. **Authentication → Users → Add user** → seu e-mail e senha.
3. Copie o UUID do usuário e rode no **SQL Editor**:
   ```sql
   insert into perfis_acesso (user_id, role, nome)
   values ('COLE-O-UUID-AQUI', 'admin', 'Seu Nome');
   ```
   Sem esse passo o login recusa: a tela exige perfil cadastrado.

### GitHub

Crie um repositório novo (ex. `report-distribuidora`) e suba estes arquivos na
**raiz** dele. Nada além do que está aqui é necessário.

### Vercel

1. **Add New → Project** → importe o repositório.
2. **Framework Preset: Other**. Build Command e Output Directory em branco —
   o `vercel.json` já cuida disso.
3. **Deploy**. Em ~30 segundos o link fica pronto.
4. Todo push na branch de produção redeploya sozinho.

> O `index.html` também funciona aberto direto do disco (duplo clique): ele
> fala com o Supabase pela internet, não depende do servidor de hospedagem.
> Serve de plano B se o deploy travar na véspera de uma apresentação.

---

## 3. Carregar o estoque

1. Abra o link, faça login.
2. Menu **Admin → Atualizar dados**.
3. Selecione o TXT da extração de posição de stock, **exatamente como sai do
   sistema**.
4. Acompanhe o log. Ao terminar, o dashboard recarrega sozinho.

### Os dois layouts de extração

O ingest aceita os dois formatos e detecta qual é **pelo conteúdo do arquivo**,
não pelo nome:

| Layout | Extração | Observação |
|---|---|---|
| Delimitado por `\|` | **EX000796** | **Preferido.** Traz `St` e `Em Linha` como colunas separadas, e artigo/descrição/cor/tamanho cada um na sua coluna. |
| Largura fixa | EX000914 | Mantido por compatibilidade. É o único que imprime o `** TOTAL GERAL` do sistema, útil para conferência. |

> **Não abra o arquivo no Excel e salve por cima.** No layout de largura fixa
> as colunas são lidas por posição de caractere, e qualquer reformatação
> quebra a leitura.

---

## 4. O que a tela mostra

### 4.1. Faixa de conferência

Quando a extração é a de **largura fixa**, o ingest compara o que leu com o
`** TOTAL GERAL` impresso pelo próprio sistema:

- **Verde** — a quantidade confere exatamente. Na carga de 25/08/2026:
  **2.946.194 unidades**, batendo linha a linha. A diferença de **R$ 0,88** no
  valor é arredondamento do próprio relatório e fica declarada na tela.
- **Vermelho** — não bateu. Significa linha perdida na leitura: **não
  apresente o número**, investigue o parse.

Quando a extração é a **delimitada**, o arquivo não imprime totais. A tela diz
exatamente isso — "não há conferência externa" — em vez de fingir uma
validação que não houve.

### 4.2. KPIs

Valor total, quantidade, **disponível para venda** (armazéns `DISPONIVEL` —
hoje só o AC190), **bloqueado / em análise**, SKUs com estoque e custo médio
unitário.

A leitura imediata: dos R$ 127,2 mi de estoque, **R$ 120,5 mi (94,7%)
disponíveis** e **R$ 6,7 mi (5,3%) travados** em análise, qualidade ou
devolução.

### 4.3. Filtros de status

O relatório traz **dois status independentes**, que respondem a perguntas
diferentes — e por isso são dois filtros separados, não um só:

| Filtro | Valores | O que significa |
|---|---|---|
| **Válido** | Sim (`V`) / Não (`I`) | O artigo é válido? |
| **Em linha** | Sim (`S`) / Não (`N`) | O artigo está em linha? |

Clicar no filtro já ativo desliga — para ninguém ficar preso num recorte sem
perceber no meio de uma apresentação. O filtro atinge tudo ao mesmo tempo:
KPIs, gráficos e a árvore inteira, e o recorte ativo fica escrito no rodapé
da tabela.

Isso funciona porque cada nó da árvore já vem do ingest com o total quebrado
nas quatro combinações. O navegador só **soma baldes já calculados** — não
reprocessa regra de negócio.

> No layout antigo os dois status vinham colados num código só (`VS`/`VN`/
> `IS`/`IN`). O ingest desmembra na leitura, então os dois layouts produzem
> exatamente o mesmo dado.

### 4.4. Gráficos

- **Composição do valor por armazém** — barra empilhada. A cor não é
  decoração: verde = disponível, âmbar = em análise, vermelho = bloqueado.
- **Valor de estoque por marca** — barras horizontais na cor institucional de
  cada marca (Mizuno dourado, Olympikus azul, Under Armour vermelho).

### 4.5. A árvore

Fechada, mostra os 7 armazéns e o **TOTAL GERAL**. Cada `+` abre um nível:

```
AC190  [DISPONÍVEL]  Armazém Físico segregado em PULMÃO e PICKING
  └ MIZUNO
      ├ 102  TÊNIS MIZUNO       | TÊNIS MIZUNO
      ├ 103  VESTUÁRIO MIZUNO   | TÊXTIL/ACESSÓRIOS MIZUNO
      └ ...
```

Colunas: **Qtd · % do nível · SKUs · R$ · % do nível**.

O **%** é sempre em relação ao **nível pai**, não ao total geral — dentro de um
armazém as marcas somam 100%; dentro de uma marca, as famílias somam 100%.
É o que responde à pergunta que a gestão faz de verdade: *"quanto desse
armazém é Mizuno?"*

Os nomes de família e o segmento ao lado vêm do **gabarito da operação**
(`dim_familias`), não do relatório — o sistema escreve "VESTUARIO
OLYMP.TERCEIROS" onde a operação lê "VESTUÁRIO OLY".

A coluna **KPI** traz a bandeira nos armazéns cujo estoque **não está
disponível para venda**, mesma função da bandeira do dash financeiro de
referência.

Botões **Expandir tudo / Recolher tudo** e **CSV** (exporta a árvore inteira,
não só o que está aberto, respeitando os filtros ativos).

---

## 5. Números da carga de 25/08/2026 (EX000796, 17:00)

| | |
|---|---|
| Linhas com estoque | 24.973 |
| Linhas de SKU zerado | 8.480 — **fora do total** |
| Artigos distintos | 3.009 |
| Quantidade | 2.931.823 un |
| Valor | R$ 127.199.303,46 |
| Famílias | 21 com estoque, todas mapeadas |

**Por armazém:**

| Armazém | Qtd | Valor | % valor |
|---|---:|---:|---:|
| AC190 (disponível) | 2.834.432 | R$ 120.514.650,87 | 94,7% |
| ARMRP (bloqueado) | 77.662 | R$ 4.997.283,39 | 3,9% |
| ARAMO (análise) | 13.957 | R$ 1.369.869,23 | 1,1% |
| DEVFT (bloqueado) | 3.848 | R$ 269.372,02 | 0,2% |
| ARMFT (análise) | 1.737 | R$ 41.268,88 | 0,0% |
| ARMC1 (análise) | 42 | R$ 2.349,60 | 0,0% |
| SEM_ARMAZEM | 145 | R$ 4.509,47 | 0,0% |

**Por marca:** Mizuno R$ 68,9 mi (54,1%) · Under Armour R$ 32,3 mi (25,4%) ·
Olympikus R$ 26,1 mi (20,5%).

**Por status:**

| Válido | Em linha | Qtd | Valor |
|---|---|---:|---:|
| Sim | Sim | 2.240.615 | R$ 81.667.203,02 |
| Sim | Não | 690.053 | R$ 45.494.599,30 |
| Não | Não | 805 | R$ 30.027,08 |
| Não | Sim | 350 | R$ 7.474,05 |

### Três coisas que vale saber antes de apresentar

1. **As duas extrações do mesmo dia não batem entre si.** A EX000914 (15:19)
   dá 2.946.194 un / R$ 130,6 mi; a EX000796 (17:00) dá 2.931.823 un /
   R$ 127,2 mi. Comparando linha a linha, 24.891 das 25.371 posições são
   idênticas — a diferença é movimentação real do armazém entre os dois
   horários, mais alguns preços médios recalculados. **Use uma extração só** e
   diga qual e de que horário; misturar as duas produz números que não fecham.
2. **8.480 linhas do arquivo delimitado têm quantidade zero** — SKU cadastrado
   sem estoque. Elas ficam **fora do total** (estoque zero não é estoque), mas
   são contadas e aparecem no rodapé e no KPI de SKUs. O layout antigo já saía
   do sistema filtrado (`Stock Zero: N`), por isso ele não tem essas linhas.
3. **`ARMC1` (materiais de consumo, 42 un) está somado no total geral.** Se
   materiais de consumo não devem contar como estoque de produto, o certo é
   filtrar no `ingest.js` — não esconder na tela — e isso muda o total
   apresentado.

---

## 6. Como o dado é lido

### Layout delimitado (EX000796) — preferido

```
St | Em Linha | Fam | Artigo | Descricao | Cor | Tamanho | Um |
Armazem | Local | Stock_Minimo | Qtd_Stock | Preco_Medio | Valor_Stock |
```

O cabeçalho é lido **pelo nome das colunas**, não por posição: se o sistema
passar a exportar uma coluna a mais ou em outra ordem, o parser continua
achando cada campo. O armazém vem como `EXTRE-AC190`; linhas sem armazém
(`EXTRE` sozinho) viram `SEM_ARMAZEM` e **aparecem no relatório** — estoque
escondido é pior do que estoque estranho.

### Layout de largura fixa (EX000914)

Relatório de terminal paginado, com cabeçalho repetido a cada página. Não é
CSV: separar por espaço quebra, porque a descrição do artigo tem espaços. As
posições vieram da própria linha de régua do relatório e estão em
`COLUNAS_LINHA` / `COLUNAS_ARTIGO`, no topo do `ingest.js` — **se o layout
mudar, é só ali que se mexe**.

Dois detalhes que não são óbvios nesse layout:

- **A família não está na linha do produto.** Vem numa linha `Familia ...:` no
  cabeçalho de cada página e vale para as linhas seguintes. O parser a carrega
  como estado enquanto varre.
- **A marca não existe como campo em nenhum dos dois layouts.** Em vez de
  deixar o código adivinhar por substring — frágil, porque `UA` casa dentro de
  outras palavras — a relação família → marca é **dado**, em `dim_familias`.
  Família nova que apareça e não esteja cadastrada cai em `NÃO MAPEADA` e o
  dashboard avisa, em vez de somar silenciosamente no lugar errado.

---

## 7. Padrões de engenharia herdados

Implementados desde o primeiro commit, para não repetir bugs já resolvidos no
report do e-commerce:

- **Paginação segura** — para só quando a página volta **vazia**, e o offset
  avança pelo tamanho real retornado. Nunca assumir que "voltou menos que pedi"
  significa "acabou": foi a causa do card que mostrava 100% de um único
  segmento, escondendo os outros quatro.
- **Deduplicação antes do insert** — com uma diferença em relação ao
  e-commerce: lá o certo era manter o registro de status mais avançado; aqui
  duas linhas iguais seriam duas posições do mesmo SKU no mesmo armazém, então
  o certo é **somar** e recalcular o preço médio ponderado. Descartar perderia
  estoque real. No arquivo atual não há colisão — a trava é preventiva.
- **Data sempre em UTC na gravação**, conversão para Brasília só na exibição,
  via `Intl.DateTimeFormat` com timezone fixo. Nunca somar ou subtrair horas na
  mão: quebra em horário de verão.
- **Gzip no upload** do arquivo original, com fallback para o upload cru.
- **Linha de total marcada por classe**, nunca por `:last-child`. Estilizar "a
  última linha" por posição fez a 10ª linha de um Top 10 parecer total geral.
- **RLS desde o início** — no e-commerce isso ficou pendente; aqui entrou junto
  com o schema.

---

## 8. Identidade visual

Segue a skill `vulcabras-visual-identity`: Segoe UI, cards neutros sem sombra
pesada, kicker em caixa alta com linha fina dourada, tema escuro como padrão e
claro como alternativo (o botão **Tema** troca e a escolha fica salva).

Cor tem significado, nunca é decoração: verde = disponível/positivo, âmbar =
atenção, vermelho = bloqueado/negativo, e as cores de marca só identificam
marca.

---

## 9. Pendências

**Antes de liberar para mais gente:**

1. **Testar a RLS pela API, não só pela tela.** Faça um `select` em
   `estoque_posicoes` usando só a publishable key, sem login. Tem que voltar
   vazio. Se voltar dado, a RLS não está valendo — pare e corrija.
2. Confirmar a hierarquia real de perfis. Hoje o schema herda
   `admin` / `gestor` / `operador` do CD, que pode não ser a hierarquia certa
   aqui.

**Perguntas de negócio em aberto:**

- `ARMC1` (materiais de consumo) deve entrar no total de estoque?
- Por que 10 linhas saem sem armazém preenchido?
- Qual a marca das famílias 16–19 (BOTAS), 30 (SEMI ACABADO) e 53 (OPANKA)?
  Estão cadastradas com a própria categoria como marca. Nenhuma tem estoque
  hoje, então não afetam número nenhum — mas vão afetar quando aparecerem.
- Qual a frequência de atualização — diária, semanal, sob demanda?
- Existe conceito de estoque parado há N dias (equivalente ao FIFO do CD)?
  Se sim, com que régua de corte?

**Evoluções naturais desta base:**

- 4º nível na árvore (artigo → cor/tamanho). O dado já está gravado em
  `estoque_posicoes`; é só carregar sob demanda ao abrir a família.
- Comparativo entre extrações (Atual × Anterior × Δ%), no formato exato do dash
  financeiro. `estoque_extracoes` já guarda o histórico.
- Agrupamento alternativo por **Segmento** ou **Categoria** — já estão em
  `dim_familias` e no snapshot, falta só o seletor de hierarquia na tela.
- Novas páginas (romaneio, faturamento, transportadora) como novas linhas em
  `dashboard_snapshots`, sem mudança de schema.

---

## 10. Fluxo de Processos — DISTR

Fluxograma do processo operacional do CD (Recebimento → Armazenagem →
Expedição, mais o fluxo à parte de Reversa), no menu **Processos → Fluxo de
Processos - DISTR**, visível a todos os perfis — é material de treinamento,
não só de gestão. Quem tem perfil **admin** também edita, ao vivo, no
navegador.

### Arquitetura

Segue a mesma separação do restante do app — só que aqui não existe
`ingest.js` porque não há arquivo externo pra processar: o próprio Admin *é*
quem gera o dado, editando na tela.

```
   distr-fluxo.js         Lê e desenha o fluxograma (retângulo=etapa,
   (renderiza e,           losango=decisão, pílula=início/fim). Para admin,
    p/ admin, edita)       também liga o editor por cima: clicar numa seta
        │                  insere etapa/quebra/B.O.; clicar numa etapa ou
        │ lê/grava          losango abre o painel de edição.
        ▼
   dashboard_snapshots     pagina='distr_fluxo' — mesma tabela e mesmo
   (Postgres)               padrão "uma versão = uma linha nova" do resto
                            do app (seção 1). "Salvar" nunca dá UPDATE, então
                            toda versão anterior continua no banco — é o
                            histórico/undo de graça.
```

**RLS: nenhuma policy nova foi criada.** A leitura (`ler_snapshots`) já libera
qualquer `pagina` pra todo autenticado, e a escrita (`gravar_snapshots`) já é
só-admin — exatamente a regra que essa página precisa. O botão "Editar fluxo"
na tela é conveniência de interface; a proteção de verdade é essa RLS.

### Modelo de dados (dentro do `payload` jsonb)

```jsonc
{
  "versao_schema": 1,
  "setores": ["Comercial", "Coleta", ...],       // autocomplete do campo Responsável
  "lanes": [
    { "id": "principal", "titulo": "...", "sub": "...",
      "fases": [
        { "id": "receb", "titulo": "Recebimento",
          "blocos": [ ["step","1"], ["step","2"],
            ["guard","A quantidade bateu na conferência?", ["4.1","4.2"],
              {"exc":"Não","ok":"Sim","rejoin":true}], ... ] },
        ...
      ] },
    { "id": "reversa", "titulo": "Reversa", "fases": [ ... ] }
  ],
  "nos": { "receb:1": { "nome":"...", "resumo":"...", "original":"...",
                        "resp":"...", "orig":"—", "dest":"AC190", ... } }
}
```

`blocos` é a topologia de cada fase — `step`/`gate` (retângulo), `guard`
(losango com um ramo lateral de desvio) ou `fork` (losango com duas colunas,
ambas legítimas). `nos` guarda o detalhe de cada etapa, indexado por
`"fase:número"`. Ícones (o conjunto de 37 SVGs de linha) vivem só no
JavaScript, não no payload — é gabarito fixo, não dado editável.

### Editando (admin)

Botão **✏️ Editar fluxo** liga o modo edição (começa desligado, mesmo pra
admin — ninguém edita sem querer só por ter a permissão):

- **Clique numa seta** entre dois blocos → menu com as opções cabíveis ali:
  numa cadeia de desvio de um losango (guard), "Nova etapa padrão / Nova
  quebra / Novo B.O."; no tronco ou num ramo de bifurcação (fork), só "Nova
  etapa padrão" — bifurcação são dois caminhos igualmente corretos, não um
  desvio.
- **Clique numa etapa** → painel com todos os campos (nome, resumo, texto
  original, responsável(is) — aceita composto "A/B/C" — armazém
  origem/destino, tipo, ícone, observações). Inclui excluir.
- **Clique num losango** → edita a pergunta e o comportamento (qual resposta
  leva ao desvio, se a cadeia volta ao tronco). Itens da cadeia se editam
  pelas próprias etapas/setas dela, não por aqui.
- **Setores**: cadastro simples que alimenta o autocomplete do Responsável —
  o campo continua aceitando texto livre mesmo sem estar cadastrado.
- **+ Nova fase**: anexa uma fase nova ao final de uma lane já existente.
- **Salvar alterações**: grava tudo como uma linha nova em
  `dashboard_snapshots`. Enquanto não salva, nada é permanente — **Descartar**
  volta pra última versão publicada.

**Numeração** (`1`, `6.1`, `6.1.2`, `5A`...) é recalculada sozinha a cada
inserção/exclusão, com raio de ação **limitado ao que a edição realmente
afeta** — nunca renumera nada fora dali. O número sugerido sempre aparece
num campo editável, então dá pra ajustar à mão quando o padrão automático não
for exatamente o que se quer.

**Fora do escopo desta versão** (registrado, não esquecido): criar uma lane
inteiramente nova (só fase nova dentro de lane existente); reordenar
fases/etapas do tronco (inserir sim, reordenar não); criar um losango do zero
a partir de uma seta (editar um já existente, sim); uma tela de "versões
anteriores" (cada save já vira linha nova no banco, recuperável por SQL).

### Publicar a primeira versão

A tabela nasce vazia — sem uma primeira linha, a tela mostra "Nenhuma versão
do fluxo publicada ainda". Rode `seed_distr_fluxo.sql` inteiro no **SQL
Editor** do Supabase (mesmo projeto de `esquema.sql`) uma vez: ele insere a
versão validada com a operação (66 etapas, 4 fases + Reversa) como a primeira
linha de `dashboard_snapshots` para `pagina='distr_fluxo'`. Depois disso, é
editor na tela — não precisa rodar esse arquivo de novo (e se rodar, só cria
mais uma versão igual, não quebra nada).

---
name: apresentacao-html
description: Padrão de apresentação em HTML da Logística Vulcabras (Distribuidora / E-commerce). Use SEMPRE que o usuário pedir uma apresentação, deck ou slides em arquivo HTML, ou "no formato de apresentação" para mostrar à diretoria, ao Fabio ou ao time. Gera um arquivo .html único (abre sem internet) com botões para passar slide, tela cheia, capa com a logo Vulcabras e o V minimalista no rodapé dos demais slides.
---

# Apresentação HTML: padrão Vulcabras

O usuário aprovou este modelo em 29/10/2026 ("deixe isso um padrão daqui pra frente"). Toda apresentação em
HTML parte de `modelo.html`, nesta pasta. Não invente outro visual: mude só o conteúdo dos slides.

## Como montar

1. Copie `modelo.html` para o scratchpad e troque o conteúdo dos `<section class="slide">` dentro de
   `<div id="stage">`. Os slides de exemplo são a apresentação de overcapacity do Pulmão: aproveite a estrutura
   de cada um e apague o que não usar.
2. Deixe os marcadores como estão: `{{LOGO}}` (logo completa, só na capa), `{{V}}` (V minimalista, no rodapé
   de todos os slides menos a capa), `{{FAVICON}}` e `{{TITULO}}`.
3. Embuta as imagens e gere o arquivo final:
   `python3 .claude/skills/apresentacao-html/embutir.py rascunho.html Nome_Final.html "Título da aba"`
4. Confira 2 ou 3 slides com o Playwright (viewport 1280×720, abrir com `#n` para ir ao slide n) e entregue
   o arquivo com SendUserFile (`display: "attach"`). Se for uma versão grande, mostre antes uma prévia,
   porque o usuário quer aprovar antes da versão final.

## O que o modelo já faz (não remover)

- Palco fixo de 1920×1080 que escala para caber em qualquer tela, com transição suave entre slides.
- Navegação: botões ‹ › e ⛶ (tela cheia) no canto superior direito, que ficam apagados até mexer o mouse.
  Também setas, espaço, PageUp/PageDown, tecla F e arrastar no celular. A barra amarela no topo mostra o
  progresso e o endereço guarda o slide (`#3`).
- Paleta: fundo azul-marinho em degradê, amarelo `#F6BD00` para destaque, vermelho `#E03A4E` para alerta,
  verde `#4CC38A` para "ok", texto `#F4F7FB`, secundário `#93A5B8`. Fonte Segoe UI.

## Blocos prontos (classes)

| Bloco | Uso |
|---|---|
| `.slide.capa` | Capa: logo completa no alto, eyebrow, `h1`, filete amarelo, subtítulo, rodapé e número grande apagado ao fundo (`.big`) |
| `.eyebrow` | Rótulo da seção, em amarelo com traço antes |
| `h2` com `<em>` | Título do slide; `<em>` pinta o trecho em amarelo |
| `.cards` + `.card` (`.gold`, `.red`, `.green`) | 3 ou 4 números grandes com faixa colorida à esquerda (`.k` rótulo, `.v` valor, `.d` detalhe) |
| `svg.chart` com `rect.bar` (`.ok`, `.over`, `.hoje`, `.ent`) | Barras que crescem ao abrir o slide; `line.cap` + `text.capt` para a linha de referência; `style="--d:Xms"` escalona a animação |
| `.legend` | Legenda com quadradinhos de cor |
| `.two` | Duas colunas (1,1 : 1) |
| `table` + `td.hl` | Tabela com destaque amarelo |
| `.stack` + `.pill` (`.r`) | Lista de números rótulo/valor; `.r` deixa o valor vermelho |
| `.grid2` + `.lev` | Cartões numerados de ações ou alavancas |
| `.prem` | Grade de premissas com borda amarela à esquerda |
| `.foot` | Rodapé: fonte à esquerda e `<img class="vm" src="{{V}}">` à direita. Vai em todo slide, menos na capa |

## Regras de conteúdo

- Português, frases curtas. Um tema por slide, com o título dizendo a conclusão.
- Números no formato brasileiro (5.769; 1,31 mi; 97%).
- Todo slide de dados tem a fonte no rodapé.
- Gráficos em SVG desenhados em escala, com valor em cima das barras e a linha de referência rotulada.
- Cabem 6 a 8 slides; terminar com premissas ("De onde vem cada número") quando houver projeção.

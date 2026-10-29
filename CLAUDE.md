# CLAUDE.md — Report Distribuidora (DISTR) · Vulcabras

Regras gerais de trabalho: `C:\Repositórios\CLAUDE.md`. Resumo: plano + modelo antes de editar, PT-BR, economia de créditos, aprovado vai direto para `main`.

## Leia por trechos
`README.md` (~490 linhas): 1 Arquitetura · 2 Infraestrutura · 3 Carregar o estoque · 4 O que a tela mostra · 5 Números da carga de 25/08 · 6 Como o dado é lido · 7 Padrões herdados do E-commerce · 8 Identidade visual · 9 Pendências · 10 Fluxo de Processos.

## Essencial
- Projeto independente, base herdada do Report E-commerce. Supabase `qaehjplsasumuhszjcnu`. Deploy Vercel a partir de `main`.
- Hierarquia de estoque Armazém › Marca › Família (`estoque_posicoes`, `estoque_extracoes`, `dim_familias`).
- Ingests separados: `ingest.js`, `ingest-movimentacoes.js`, `ingest-pfas.js`, `ingest-ressuprimento.js`, `ingest-colaboradores.js`, `ingest-emails-ajustes.js`, `embarque.js`. Fluxo de processos `distr-fluxo.js`; planta 3D `planta3d-distr.js`.
- **Testes automáticos** `testes-*.js`: rode com `node testes-<nome>.js` depois de mexer no ingest correspondente.
- Migrações em `migracao_*.sql`, esquema em `esquema.sql`.
- Forecast: meses com forecast e os dois seguintes aparecem no filtro Período; o gráfico vai até o último mês liberado; mês sem forecast mostra aviso.
- Topbar padrão: perfil + Tela cheia + Tema Claro/Escuro + Sair.

## Relacionados (sem repositório)
- Apresentação **Estoque Armazéns DISTR** (`Mapa-de-Armazens-do-CD.pptx`, 6 slides: mapa, tratativas de regularização, cronograma).
- Tabela de volumetria DISTR para o Outlook; ideias para o telão DISTR (embarcado + ressuprido) ficaram para depois do E-commerce.

## Pendências
Ver README seção 9: testar RLS pela API, hierarquia de perfis, perguntas de negócio (ARMC1, linhas sem armazém, marcas das famílias 16–19/30/53, frequência, estoque parado).

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
- **Dia de produção do Kardex** (`diaDeProducao` em ingest-movimentacoes.js, 05/11/2026): T02 depois da meia-noite conta no dia anterior; T03 inteiro no dia em que termina (a noite, a partir das 12h, vai para o dia seguinte); T01 = calendário. Turno da noite só em parte no arquivo não grava (`fora_do_periodo`); o T03 do 1º dia do arquivo também não. Antes dos upserts, `limparHistoricoDoPeriodo` apaga os dias que o arquivo grava inteiros. Mandar o Kardex começando pelo menos 1 dia antes.
- **Telão DISTR** `tv.html` (`/tv`, README seção 11): cópia da estrutura do telão do E-commerce, mesmo banco, conta da TV com perfil operador (`telao_usuario.sql`). Telas: Start Inicial (Material pendente sem 00 e 06, PFA mais antiga, FIFO, funil 7 etapas, NF × segmento em pé, faixa por segmento) e Ressuprimento (7 dias com registro, interruptor Alocação/Retirada/Soma, T01–T03, rosca por segmento, Top 5). Regras compartilhadas com o report em `start-inicial-calc.js` e `ressuprimento-calc.js` (teste `testes-telao.js`). Peças por operador: `migracao_operador_pecas.sql`. Fase 2: Embarque × Forecast.

## Relacionados (sem repositório)
- Apresentação **Estoque Armazéns DISTR** (`Mapa-de-Armazens-do-CD.pptx`, 6 slides: mapa, tratativas de regularização, cronograma).
- Tabela de volumetria DISTR para o Outlook.

## Pendências
Ver README seção 9: testar RLS pela API, hierarquia de perfis, perguntas de negócio (ARMC1, linhas sem armazém, marcas das famílias 16–19/30/53, frequência, estoque parado).

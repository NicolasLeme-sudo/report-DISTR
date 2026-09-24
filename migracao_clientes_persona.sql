-- ============================================================================
-- MIGRAÇÃO — Clientes que personalizam (etapa 04 - Material em Personalização)
-- Aplicada em 24/09/2026. PFA em Leitura expedição de cliente desta lista
-- aparece como '04 - Material em Personalização' no Start Inicial (a
-- reclassificação é feita na tela, index.html → aplicarEtapaPersona).
-- nome = razão social OU palavra-chave (casa quando o nome do cliente CONTÉM
-- o texto); personalizavel=false com o nome exato força não-persona.
-- Admin › Abastecimento substitui a lista inteira.
-- ============================================================================

create table if not exists dim_clientes_persona (
  nome           text primary key,
  personalizavel boolean not null default true,
  atualizado_em  timestamptz not null default now()
);

alter table dim_clientes_persona enable row level security;

drop policy if exists ler_dim_clientes_persona on dim_clientes_persona;
create policy ler_dim_clientes_persona on dim_clientes_persona
  for select to authenticated using (meu_papel() is not null);

drop policy if exists gravar_dim_clientes_persona on dim_clientes_persona;
create policy gravar_dim_clientes_persona on dim_clientes_persona
  for all to authenticated using (meu_papel() = 'admin') with check (meu_papel() = 'admin');

-- Carga inicial: planilha "Base de Clientes que personalizam DISTR" + 8 nomes
-- sem razão social passados pelo usuário (FLAMBOYAN, CALCENTER, LÍDER, POLICE,
-- ZAPEC, CALZADOS ROGER, ABYS, OSCAR E ABYS).
insert into dim_clientes_persona (nome, personalizavel) values
  ('ABYS MODAS LTDA', true),
  ('ADELINA MODAS LTDA', true),
  ('ALF COMERCIO DE CALCADOS LTDA', true),
  ('ALM COMERCIAL DE CALCADOS LTDA', true),
  ('AMAZON SERVICOS DE VAREJO DO BRASIL LTDA.', false),
  ('BADAN ARTIGOS ESPORTIVOS LTDA', true),
  ('BIG BELEM CALCADOS LTDA', true),
  ('BISOL CALCADOS E ARTIGOS ESPORTIVOS LTDA - EPP', true),
  ('CAL CENTER COM DE CALC LTDA', true),
  ('CAL-CENTER COMERCIO DE CALCADOS LTDA', true),
  ('CALZADOS ROGER S.A.', true),
  ('CASA BAYARD ARTIGOS PARA ESPORTES LTDA', false),
  ('CASA SORAYA LTDA.', true),
  ('CHRIS INDUSTRIA E COMERCIO DE CONFECCOES LTDA', true),
  ('DEP COMERCIO DE CALCADOS LTDA', true),
  ('DF WORK COMERCIO DE CALCADOS LTDA', true),
  ('DJP COMERCIAL DE CALCADOS LTDA', true),
  ('DREBES & CIA LTDA', true),
  ('DS LOG COMERCIO DE CALCADOS LTDA', true),
  ('DS.COM.BR COMERCIO DE CALCADOS LTDA', true),
  ('DSR COML DE CALCADOS LTDA', true),
  ('EBAZAR.COM.BR. LTDA', false),
  ('ECLIPSE COM.DE CALCADOS LTDA', true),
  ('ECLIPSE COMERCIO DE CALCADOS LTDA', true),
  ('ELDA COMERCIAL CALCADOS LTDA', true),
  ('ELI COMERCIO DE CALCADOS LTDA', true),
  ('ESTRATEGIA CALCADOS LTDA', true),
  ('EUZIMAR A. NOBRE', true),
  ('FCO COMERCIAL DE CALCADOS LTDA', true),
  ('FF.COM ESPORTES LTDA', true),
  ('FLYTE COM CALC LTDA', true),
  ('FORMOSA SUPERMERCADOS E MAGAZINE LTDA', false),
  ('FRANK SILVESTRIN DE SOUZA', true),
  ('GERALDO ALEXANDRE JANUARIO FALDAO EPP', true),
  ('ISA COMERCIAL DE CALCADOS LTDA', true),
  ('JQG COMERCIAL DE CALCADOS LTDA', true),
  ('JSP COMERCIAL DE CALCADOS LTDA', true),
  ('JULI COMERCIO DE CALCADOS LTDA', true),
  ('KAREN COMERCIAL DE CALCADOS LTDA', true),
  ('KENIAK COM DE CALC LTDA', true),
  ('KYRALY COM CALC LTDA', true),
  ('LFM COMERCIAL DE CALCADOS LTDA', true),
  ('LIDER COMERCIO E INDUSTRIA LTDA', true),
  ('LINDA COMERCIAL DE CALCADOS LTDA', true),
  ('LNJC COMERCIO DA MODA LTDA', true),
  ('LOJA VINTE E NOVE LTDA', true),
  ('LOJAS AVENIDA S.A', true),
  ('LUIS FELIPE CAGLIARI DE SOUZA', true),
  ('LUIZA CALCADOS LTDA', true),
  ('M MODAS LTDA', true),
  ('MARJA COMERCIO DE CALCADOS LTDA', true),
  ('MARJOV COMERCIO DE ROUPAS E CALCADOS LTDA', true),
  ('MM PAPELARIA PROMISSAO LTDA', true),
  ('MN COMERCIO DE CALCADOS LTDA - ME', true),
  ('MRM COMERCIAL DE CALCADOS LTDA', true),
  ('NACIONAL BREVES COMERCIO DE CALCADOS LTDA', false),
  ('NACIONAL CASTANHAL COMERCIO DE CALCADOS LTDA', false),
  ('NACIONAL MOJU COMERCIO DE CALCADOS LTDA', false),
  ('NACIONAL MOJU II COMERCIO DE CALCADOS', false),
  ('ONE CALCADOS LTDA', true),
  ('OSANA ANA DE LIRA GARRIDO ME', true),
  ('PINHEIRO TECIDOS LTDA', true),
  ('PITTOL CALCADOS LTDA', true),
  ('PIUMA CALCADOS LTDA', true),
  ('PK COMERCIAL DE CALCADOS LTDA', true),
  ('QUEIROZ COMERCIAL DE CALCADOS LTDA', true),
  ('R MILET COMERCIO DE CALCADOS LTDA', true),
  ('RED COMERCIAL DE CALCADOS LTDA', true),
  ('REGIONAL ALENQUER COMERCIO DE CALCADOS LTDA', true),
  ('REGIONAL ITAITUBA COMERCIO DE CALCADOS LTDA', true),
  ('REGIONAL JURITI COMERCIO DE CALCADOS LTDA', true),
  ('REGIONAL ORIXIMINA COMERCIO DE CALCADOS LTDA', true),
  ('REGIONAL VIGIA COMERCIO DE CALCADOS LTDA', true),
  ('REGIS COMERCIO DE CALCADOS LTDA', true),
  ('S.SALLUM LTDA', true),
  ('SBF COMERCIO DE PRODUTOS ESPORTIVOS S.A.', false),
  ('SNICKER COM CALC LTDA', true),
  ('SNICKER COMERCIO DE CALCADOS LTDA', true),
  ('T.A.N. MOUTINHO COMERCIO', true),
  ('TK COMERCIAL DE CALCADOS LTDA', true),
  ('TOBELLI COMERCIO DE CALCADOS LTDA', true),
  ('TOP COMERCIO DE CALCADOS LTDA', true),
  ('TWO FRIENDS COMERCIO DE CALCADOS E CONFECCOES LTDA', true),
  ('UBS COMERCIAL DE CALCADOS LTDA', true),
  ('ULTRA 1 ONLINE LTDA', true),
  ('VECTRA COMERCIO DE CALCADOS LTDA', true),
  ('VIANA COMERCIO DE CALCADOS LTDA', true),
  ('FLAMBOYAN', true),
  ('CALCENTER', true),
  ('LÍDER', true),
  ('POLICE', true),
  ('ZAPEC', true),
  ('CALZADOS ROGER', true),
  ('ABYS', true),
  ('OSCAR E ABYS', true)
on conflict (nome) do update set personalizavel = excluded.personalizavel, atualizado_em = now();

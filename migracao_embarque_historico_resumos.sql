-- 30/10/2026 — já aplicada no Supabase (migração "embarque_historico_operacao_resumos").
-- embarque_historico_operacao abria os ~48 MB de snapshots de PFAs a cada carga (12 s) e passava do limite de 8 s
-- do report: a tela ficava sem o expedido do GCI e sem o backlog. Agora lê dois resumos leves, mantidos por gatilho:
--   pfas_snapshot_resumo   (1 linha por snapshot: dia e backlog)
--   pfas_primeira_aparicao (1 linha por PFA: data de importação e pares da 1ª vez que apareceu)
-- Resultado idêntico ao da função antiga; ~0,6 s.
create table if not exists public.pfas_snapshot_resumo (gerado_em timestamptz primary key, dia date not null, backlog int);
create table if not exists public.pfas_primeira_aparicao (pfa text primary key, data_importacao date, pares int, gerado_em timestamptz not null);
create index if not exists pfas_primeira_aparicao_di on public.pfas_primeira_aparicao (data_importacao);
alter table public.pfas_snapshot_resumo enable row level security;
alter table public.pfas_primeira_aparicao enable row level security;
drop policy if exists ler_pfas_snapshot_resumo on public.pfas_snapshot_resumo;
create policy ler_pfas_snapshot_resumo on public.pfas_snapshot_resumo for select to authenticated using (meu_papel() is not null);
drop policy if exists ler_pfas_primeira_aparicao on public.pfas_primeira_aparicao;
create policy ler_pfas_primeira_aparicao on public.pfas_primeira_aparicao for select to authenticated using (meu_papel() is not null);

create or replace function public.pfas_resumir_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pagina <> 'pfas' then return new; end if;
  insert into pfas_snapshot_resumo (gerado_em, dia, backlog)
  values (new.gerado_em, (new.gerado_em at time zone 'America/Sao_Paulo')::date, (new.payload->'stats'->'pendentes'->>'pares')::int)
  on conflict (gerado_em) do update set backlog = excluded.backlog;
  insert into pfas_primeira_aparicao (pfa, data_importacao, pares, gerado_em)
  select distinct on (x->>'pfa') x->>'pfa', nullif(x->>'data_importacao', '')::date, (x->>'pares')::int, new.gerado_em
  from jsonb_array_elements(new.payload->'pendentes') x
  where x->>'pfa' is not null
  on conflict (pfa) do update set data_importacao = excluded.data_importacao, pares = excluded.pares, gerado_em = excluded.gerado_em
    where pfas_primeira_aparicao.gerado_em > excluded.gerado_em;
  return new;
end $$;
drop trigger if exists trg_pfas_resumir_snapshot on public.dashboard_snapshots;
create trigger trg_pfas_resumir_snapshot after insert or update of payload on public.dashboard_snapshots
  for each row execute function public.pfas_resumir_snapshot();

insert into public.pfas_snapshot_resumo (gerado_em, dia, backlog)
select gerado_em, (gerado_em at time zone 'America/Sao_Paulo')::date, (payload->'stats'->'pendentes'->>'pares')::int
from public.dashboard_snapshots where pagina = 'pfas'
on conflict (gerado_em) do nothing;
insert into public.pfas_primeira_aparicao (pfa, data_importacao, pares, gerado_em)
select distinct on (x->>'pfa') x->>'pfa', nullif(x->>'data_importacao', '')::date, (x->>'pares')::int, s.gerado_em
from public.dashboard_snapshots s, jsonb_array_elements(s.payload->'pendentes') x
where s.pagina = 'pfas' and x->>'pfa' is not null
order by x->>'pfa', s.gerado_em
on conflict (pfa) do nothing;

create or replace function public.embarque_historico_operacao(p_de date)
 returns jsonb language sql stable set search_path to 'public' as $function$
  with snaps as (
    select distinct on (dia) dia, gerado_em, backlog from pfas_snapshot_resumo where dia >= p_de order by dia, gerado_em),
  exp as (
    select data_embarque as dia, sum(qtd_total)::int as expedido, count(distinct nota)::int as notas
    from pfas_embarcadas where data_embarque >= p_de and coalesce(operacao, '') <> 'CROSSDOC' group by 1),
  ent as (select data_importacao as dia, sum(pares)::int as entrada from pfas_primeira_aparicao where data_importacao >= p_de group by 1),
  dias as (select dia from snaps union select dia from exp union select dia from ent)
  select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'backlog', s.backlog, 'backlog_em', s.gerado_em,
    'expedido', e.expedido, 'notas', e.notas, 'entrada', n.entrada) order by d.dia), '[]'::jsonb)
  from dias d left join snaps s using (dia) left join exp e using (dia) left join ent n using (dia);
$function$;

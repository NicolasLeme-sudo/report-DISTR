-- Conta própria do telão DISTR (tv.html), só leitura.
-- 1) Supabase > Authentication > Users > Add user: telao.distr@vulcabras.com com uma senha (marque "Auto Confirm User").
-- 2) Rode isto no SQL Editor para dar o perfil "operador" (lê tudo, não grava nada):
insert into perfis_acesso (user_id, role, nome)
select id, 'operador', 'Telão DISTR' from auth.users where email = 'telao.distr@vulcabras.com'
on conflict (user_id) do update set role = 'operador';
-- 3) Na TV: abra https://<site do report>/tv, entre uma vez com esse usuário (a TV guarda a sessão) e clique em Tela cheia.

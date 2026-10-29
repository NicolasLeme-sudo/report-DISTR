"""Embute logos/favicon do padrão Vulcabras numa apresentação HTML montada a partir do modelo.html.
Uso: python3 embutir.py entrada.html saida.html "Título da aba"
Troca {{LOGO}}, {{V}}, {{FAVICON}} e {{TITULO}}; o arquivo final abre sozinho, sem internet."""
import base64, sys, pathlib
aqui = pathlib.Path(__file__).parent / 'assets'
uri = lambda n: 'data:image/png;base64,' + base64.b64encode((aqui / n).read_bytes()).decode()
ent, sai = sys.argv[1], sys.argv[2]
titulo = sys.argv[3] if len(sys.argv) > 3 else 'Apresentação'
s = pathlib.Path(ent).read_text(encoding='utf-8')
s = (s.replace('{{LOGO}}', uri('logo-vulcabras.png')).replace('{{V}}', uri('v-vulcabras.png'))
      .replace('{{FAVICON}}', uri('favicon.png')).replace('{{TITULO}}', titulo))
pathlib.Path(sai).write_text(s, encoding='utf-8')
print('ok', sai, len(s), 'bytes')

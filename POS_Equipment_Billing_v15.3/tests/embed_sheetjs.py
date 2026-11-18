"""Keep the homepage Excel runtime byte-for-byte aligned with the worker copy."""
from pathlib import Path

site = Path(__file__).resolve().parents[1] / 'site'
script = (site / 'vendor/xlsx.full.min.js').read_text(encoding='utf-8')
assert '</script' not in script.lower(), 'SheetJS cannot safely be placed in an inline script'
page = site / 'index.html'
html = page.read_text(encoding='utf-8')
start = html.index('<script id="embeddedSheetJS">') + len('<script id="embeddedSheetJS">')
end = html.index('</script>', start)
page.write_text(html[:start] + '\n' + script + html[end:], encoding='utf-8')

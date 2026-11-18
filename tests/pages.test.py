"""Check that the published site works as a static project under a repository path."""
import shutil
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1] / 'site'
assert (root / '.nojekyll').is_file()
assert not any(p.suffix.lower() in {'.xls', '.xlsx', '.pdf', '.zip', '.env'} for p in root.rglob('*') if p.is_file())
with tempfile.TemporaryDirectory() as directory:
    project = Path(directory) / 'pos-billing'
    shutil.copytree(root, project)
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=directory)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}/pos-billing/'
            assets = ['index.html','case-workspace.css','app.js','case-data.js','case-ui.js','import-io.js',
                      'import-worker.js','quote-pdf.js','vendor/xlsx.full.min.js','vendor/pdf.min.js',
                      'vendor/pdf.worker.min.js','vendor/pdf-resources.js','vendor/quote/pdf-lib.min.js',
                      'vendor/quote/noto-tc.cff.js','manifest.webmanifest']
            for asset in assets:
                with urlopen(urljoin(base,asset), timeout=5) as response:
                    assert response.status == 200, asset
                    assert response.read() == (project / asset).read_bytes(), asset
        finally:
            server.shutdown()
            worker.join()
print(f'PASS: {len(assets)} files served intact under /pos-billing/')

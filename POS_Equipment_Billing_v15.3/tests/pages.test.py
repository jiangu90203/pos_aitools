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
    project = Path(directory) / 'pos_aitools'
    shutil.copytree(root, project)
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=directory)) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}/pos_aitools/'
            with urlopen(base.rstrip('/'), timeout=5) as redirect:
                assert redirect.url == base
                assert 'v15.3' in redirect.read().decode('utf-8')
            assets = sorted(f.relative_to(project).as_posix() for f in project.rglob('*') if f.is_file())
            for asset in assets:
                versioned = asset + '?v=15.3' if asset.endswith(('.js','.css','.webmanifest')) else asset
                with urlopen(urljoin(base,versioned), timeout=5) as response:
                    assert response.status == 200, asset
                    assert response.read() == (project / asset).read_bytes(), asset
                    if asset.endswith('.js'):
                        assert 'javascript' in response.headers.get('Content-Type',''), asset
                    if asset.endswith('.css'):
                        assert response.headers.get('Content-Type') == 'text/css', asset
        finally:
            server.shutdown()
            worker.join()
print(f'PASS: {len(assets)} files served intact under /pos_aitools/')

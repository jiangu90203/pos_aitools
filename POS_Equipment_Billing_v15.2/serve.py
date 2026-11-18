"""Serve the packaged app on localhost using the Python standard library."""
import sys
import threading
import webbrowser
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    site = root / "site" if (root / "site" / "index.html").is_file() else root
    with ThreadingHTTPServer(("127.0.0.1", 8765), partial(Handler, directory=str(site))) as server:
        url = "http://127.0.0.1:8765/"
        print(f"Open {url} (Ctrl+C to stop).", flush=True)
        if "--open" in sys.argv:
            timer = threading.Timer(0.15, webbrowser.open, args=(url,))
            timer.daemon = True
            timer.start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass

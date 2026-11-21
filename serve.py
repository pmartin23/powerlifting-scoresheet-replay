"""Serve Powerlifting Scoresheet Replay locally and relay public LiftingCast archive reads."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen


class ReplayHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        match = re.fullmatch(r'/archive-api/meets/(m[a-z0-9]+)', path)
        if path == '/archive-api/meets':
            upstream = 'https://archive.liftingcast.com/archived_meets.json'
        elif match:
            upstream = (f'https://couchdb.archive.liftingcast.com/{match[1]}_readonly/'
                        '_all_docs?include_docs=true')
        elif path.startswith('/archive-api/'):
            self.send_error(404)
            return
        else:
            super().do_GET()
            return

        try:
            with urlopen(upstream, timeout=15) as response:
                body = response.read()
        except HTTPError as error:
            retry_after = error.headers.get('Retry-After')
            error.close()
            if error.code == 429 or (error.code == 503 and retry_after):
                self.send_response(error.code)
                if retry_after:
                    self.send_header('Retry-After', retry_after)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', '0')
                self.end_headers()
            else:
                self.send_error(error.code if error.code == 404 else 502)
            return
        except (URLError, OSError):
            self.send_error(502)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default=8000, type=int)
    port = parser.parse_args().port
    with ThreadingHTTPServer(('127.0.0.1', port), ReplayHandler) as server:
        print(f'Open http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()

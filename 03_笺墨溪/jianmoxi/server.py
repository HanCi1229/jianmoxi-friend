"""Local preview with public sources and a private DeepSeek adapter."""
import argparse
import json
import subprocess
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
import ai_service

ROOT = Path(__file__).resolve().parent
CACHE = {}
CACHE_LOCK = threading.Lock()
HITOKOTO_LOCK = threading.Lock()
LAST_HITOKOTO = 0


def upstream_url(path, query):
    """Never accept a URL or host from a browser request."""
    if path == '/api/hitokoto':
        category = query.get('category', [''])[0]
        if category not in ('d', 'i', 'h'):
            raise ValueError('Unknown category')
        return 'https://v1.hitokoto.cn/?' + urlencode(dict(c=category, min_length=12, max_length=65, encode='json'))
    if path == '/api/lyrics':
        title = query.get('track_name', [''])[0].strip()
        if not title or len(title) > 80 or any(ord(c) < 32 for c in title):
            raise ValueError('Invalid track name')
        return 'https://lrclib.net/api/search?' + urlencode(dict(track_name=title))
    raise ValueError('Unknown endpoint')


def fetch_public(url):
    # curl works with the host network setup; no shell interpolation is used.
    retry = ['--retry', '1', '--retry-delay', '1', '--retry-max-time', '12'] if url.startswith('https://lrclib.net/') else []
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                             '--proto', '=https', '--proto-redir', '=https', '--max-time', '8',
                             '--user-agent', 'XingzouLocalPrototype/0.1', *retry, url],
                            capture_output=True, timeout=20, check=True)
    if len(result.stdout) > 2_000_000:
        raise ValueError('Response too large')
    return json.loads(result.stdout)


def public_content(path, query):
    global LAST_HITOKOTO
    url = upstream_url(path, query)
    ttl = 2 if path == '/api/hitokoto' else 600
    with CACHE_LOCK:
        entry = CACHE.get(url)
        if entry and time.monotonic() - entry[0] < ttl:
            return entry[1]
    if path == '/api/hitokoto':
        with HITOKOTO_LOCK:
            time.sleep(max(0, .65 - (time.monotonic() - LAST_HITOKOTO)))
            LAST_HITOKOTO = time.monotonic()
            data = fetch_public(url)
    else:
        data = fetch_public(url)
    with CACHE_LOCK:
        if len(CACHE) > 100:
            CACHE.clear()
        CACHE[url] = (time.monotonic(), data)
    return data


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == '/api/ai/status':
            return self.send_json(200, ai_service.status())
        if not parsed.path.startswith('/api/'):
            return super().do_GET()
        query = parse_qs(parsed.query)
        try:
            upstream_url(parsed.path, query)
        except ValueError:
            return self.send_json(400, {'error': 'invalid_request'})
        try:
            return self.send_json(200, public_content(parsed.path, query))
        except (OSError, ValueError, subprocess.SubprocessError):
            return self.send_json(502, {'error': 'source_unavailable'})

    def do_POST(self):
        path = urlsplit(self.path).path
        task = {'/api/ai/inspiration': 'inspiration', '/api/ai/advice': 'advice',
                '/api/ai/continue': 'continue'}.get(path)
        if not task:
            return self.send_json(404, {'error': '接口不存在'})
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        host = self.headers.get('Host', '')
        if host not in hosts or self.headers.get('Origin') != 'http://' + host:
            return self.send_json(403, {'error': '仅允许本地页面请求'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_json(415, {'error': '请求格式不正确'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 64000:
                return self.send_json(413, {'error': '内容过长，请缩短到 12000 字以内'})
            self.connection.settimeout(10)
            data = json.loads(self.rfile.read(length))
            return self.send_json(200, ai_service.complete(task, data))
        except (ValueError, TypeError):
            return self.send_json(400, {'error': '请提供有效内容，正文最多 12000 字'})
        except ai_service.AIError as error:
            return self.send_json(error.status, {'error': str(error)})
        except (OSError, TimeoutError):
            return self.send_json(408, {'error': '请求超时'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT / 'dist')))
    print(f'行走预览：http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()

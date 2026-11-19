"""Outbound-only connection from the existing workspace to the private Site."""
import json
import logging
import os
import signal
import threading
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .server import ToolError, dispatch

SITE = os.environ['JIANMOXI_SITE_URL'].rstrip('/')
SITE_AUTH = os.environ['JIANMOXI_SITES_AUTH']
TOKEN = os.environ['JIANMOXI_BRIDGE_TOKEN']
if not SITE.startswith('https://') or not SITE.endswith('.chatgpt.site'):
    raise RuntimeError('Configure the exact private Site origin')
stop = threading.Event()
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = build_opener(NoRedirect())


def post(route, data):
    request = Request(SITE + route, json.dumps(data, ensure_ascii=False).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN,
        'OAI-Sites-Authorization': 'Bearer ' + SITE_AUTH,
    })
    with opener.open(request, timeout=18) as response:
        return json.load(response)


def main():
    failures = 0
    while not stop.is_set():
        try:
            job = post('/bridge/poll', {}).get('job')
            failures = 0
            if not job:
                stop.wait(1.5)
                continue
            try:
                result = {'result': dispatch(job['name'], job['arguments'])}
            except ToolError as error:
                result = {'error': str(error)}
            except Exception:
                result = {'error': '工作区暂时无法处理这次请求，请稍后重试。'}
            post('/bridge/result', {'id': job['id'], 'lease': job['lease'], 'response': result})
        except (OSError, ValueError, KeyError, TypeError) as error:
            failures += 1
            if failures in (1, 5) or failures % 60 == 0:
                code = error.code if isinstance(error, HTTPError) else type(error).__name__
                logging.warning('Private Site connection pending (%s)', code)
            stop.wait(min(15, failures * 2))


if __name__ == '__main__':
    main()

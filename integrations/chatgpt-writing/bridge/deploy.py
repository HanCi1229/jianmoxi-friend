"""Deploy verified GitHub bridge source. Read secret/config JSON from stdin."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


data = json.load(sys.stdin)
token = data['token']
if not re.fullmatch(r'[A-Za-z0-9_-]{64}', token):
    raise RuntimeError('A new 48-byte bridge secret is required')
stage = Path('/run/jianmoxi-plugin-stage')
dest = Path('/opt/jianmoxi-writing-tools')
prefix = 'integrations/chatgpt-writing/'
files = ['tools.json', 'bridge/server.py', 'bridge/requirements.txt', 'bridge/jianmoxi-writing-tools.service']
for name in files:
    content = (stage / name).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    if data['hashes'].get(prefix + name) != digest:
        raise RuntimeError('GitHub source mismatch for ' + name)
secret_path = Path('/etc/jianmoxi-writing-tools.env')
service_path = Path('/etc/systemd/system/jianmoxi-writing-tools.service')
nginx_path = Path('/etc/nginx/conf.d/xingzou-https.conf')
nginx_before = nginx_path.read_text()
needle = '    client_max_body_size 8m;'
route = '''
    location = /writing-tools/v1 {
        client_max_body_size 1m;
        proxy_pass http://127.0.0.1:4190/v1;
        proxy_set_header Host $host;
        proxy_connect_timeout 5s;
        proxy_read_timeout 35s;
        proxy_buffering off;
    }
'''
if '/writing-tools/v1' not in nginx_before and nginx_before.count(needle) != 1:
    raise RuntimeError('Review Nginx configuration before adding the route')
nginx_next = nginx_before if '/writing-tools/v1' in nginx_before else nginx_before.replace(needle, needle + '\n' + route)
environment = ('JIANMOXI_BRIDGE_TOKEN=' + token + '\nJIANMOXI_ACCOUNT_ID=owner\n'
               'JIANMOXI_CONTROL_DB=/var/lib/xingzou/app.db\n'
               'JIANMOXI_PUBLIC_ORIGIN=https://49.234.43.25\n'
               'JIANMOXI_PERSONA_FILE=/opt/jianmoxi-friend/backend/friend-persona.md\n')
if secret_path.exists() and secret_path.read_text() != environment:
    raise RuntimeError('Existing plugin credential differs; review before replacing')
backup = Path(tempfile.mkdtemp(prefix='jianmoxi-plugin-before-', dir='/root'))
for path in (nginx_path, service_path, secret_path):
    if path.exists():
        shutil.copy2(path, backup / path.name)
        (backup / path.name).chmod(0o600)
dest.mkdir(exist_ok=True)
(dest / 'bridge').mkdir(exist_ok=True)
for name in files:
    shutil.copyfile(stage / name, dest / name)
    (dest / name).chmod(0o644)
try:
    secret_path.write_text(environment)
    secret_path.chmod(0o600)
    shutil.copyfile(dest / 'bridge/jianmoxi-writing-tools.service', service_path)
    service_path.chmod(0o644)
    nginx_path.write_text(nginx_next)
    subprocess.run(['nginx', '-t'], check=True, capture_output=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'jianmoxi-writing-tools'], check=True, capture_output=True)
    subprocess.run(['systemctl', 'restart', 'jianmoxi-writing-tools'], check=True)
    for attempt in range(20):
        try:
            with urlopen('http://127.0.0.1:4190/health', timeout=3) as response:
                assert json.load(response)['ok']
            break
        except OSError:
            time.sleep(.3)
    else:
        raise RuntimeError('Bridge healthcheck failed')
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    url = 'https://49.234.43.25/writing-tools/v1'
    body = json.dumps({'name': 'list_articles', 'arguments': {'limit': 1}}).encode()
    try:
        urlopen(Request(url, data=body, headers={'Content-Type': 'application/json'}), timeout=10)
        raise RuntimeError('Unauthenticated bridge request was accepted')
    except HTTPError as error:
        assert error.code == 401
    request = Request(url, data=body, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=15) as response:
        result = json.load(response)
    assert isinstance(result['result']['total'], int)
    print('Private bridge deployed. TLS, anonymous rejection and authenticated cloud-article access passed.')
except Exception:
    nginx_path.write_text(nginx_before)
    for path in (service_path, secret_path):
        previous = backup / path.name
        if previous.exists():
            shutil.copy2(previous, path)
        else:
            path.unlink(missing_ok=True)
    subprocess.run(['systemctl', 'stop', 'jianmoxi-writing-tools'], check=False, capture_output=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=False)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
    raise

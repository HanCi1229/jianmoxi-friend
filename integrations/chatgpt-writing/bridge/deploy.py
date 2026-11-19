"""Deploy verified GitHub bridge source. Secret JSON arrives only on stdin."""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

data = json.load(sys.stdin)
token = data['token']
if not re.fullmatch(r'[A-Za-z0-9_-]{64}', token):
    raise RuntimeError('A 48-byte bridge credential is required')
stage = Path('/run/jianmoxi-plugin-stage')
dest = Path('/opt/jianmoxi-writing-tools')
files = ['tools.json', 'bridge/server.py', 'bridge/requirements.txt', 'bridge/jianmoxi-writing-tools.service']
for name in files:
    content = (stage / name).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
    if data['hashes'].get('integrations/chatgpt-writing/' + name) != digest:
        raise RuntimeError('GitHub source mismatch for ' + name)
environment_path = Path('/etc/jianmoxi-writing-tools.env')
service_path = Path('/etc/systemd/system/jianmoxi-writing-tools.service')
environment = ('JIANMOXI_BRIDGE_TOKEN=' + token + '\nJIANMOXI_ACCOUNT_ID=owner\n'
               'JIANMOXI_CONTROL_DB=/var/lib/xingzou/app.db\n'
               'JIANMOXI_PUBLIC_ORIGIN=https://49.234.43.25\n'
               'JIANMOXI_PERSONA_FILE=/opt/jianmoxi-friend/backend/friend-persona.md\n')
if environment_path.exists() and ('JIANMOXI_BRIDGE_TOKEN=' + token + '\n') not in environment_path.read_text():
    raise RuntimeError('Existing plugin credential differs; review before replacing')
backup = Path(tempfile.mkdtemp(prefix='jianmoxi-plugin-before-', dir='/root'))
for path in (service_path, environment_path):
    if path.exists():
        shutil.copy2(path, backup / path.name)
        (backup / path.name).chmod(0o600)
previous = {}
dest.mkdir(exist_ok=True)
(dest / 'bridge').mkdir(exist_ok=True)
try:
    for name in files:
        target = dest / name
        previous[name] = target.read_bytes() if target.exists() else None
        shutil.copyfile(stage / name, target)
        target.chmod(0o644)
    environment_path.write_text(environment)
    environment_path.chmod(0o600)
    shutil.copyfile(dest / 'bridge/jianmoxi-writing-tools.service', service_path)
    service_path.chmod(0o644)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', 'jianmoxi-writing-tools'], check=True, capture_output=True)
    subprocess.run(['systemctl', 'restart', 'jianmoxi-writing-tools'], check=True)
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    payload = json.dumps({'name': 'list_articles', 'arguments': {'limit': 1}}).encode()
    for attempt in range(20):
        try:
            with urlopen(Request('http://127.0.0.1:4190/v1', data=payload, headers=headers), timeout=10) as response:
                assert 'result' in json.load(response)
            break
        except (OSError, AssertionError):
            time.sleep(.3)
    else:
        raise RuntimeError('Bridge did not pass its authenticated workspace read')
    print('Verified GitHub bridge deployed; authenticated workspace query passed.')
except Exception:
    subprocess.run(['systemctl', 'stop', 'jianmoxi-writing-tools'], check=False, capture_output=True)
    for path in (service_path, environment_path):
        previous_file = backup / path.name
        if previous_file.exists():
            shutil.copy2(previous_file, path)
        else:
            path.unlink(missing_ok=True)
    for name, contents in previous.items():
        target = dest / name
        if contents is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(contents)
    subprocess.run(['systemctl', 'daemon-reload'], check=False)
    if (backup / service_path.name).exists():
        subprocess.run(['systemctl', 'start', 'jianmoxi-writing-tools'], check=False, capture_output=True)
    raise

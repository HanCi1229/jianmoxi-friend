"""Live account-isolated checks. Run with the backend's Python environment as root."""
import hashlib
import importlib.util
import json
import os
import secrets
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4


root = Path(sys.argv[1]).resolve()
store = Path('/var/lib/xingzou')
control = store / 'app.db'
name = 'qamcp-' + secrets.token_hex(6)
password = secrets.token_urlsafe(24)
invite = secrets.token_urlsafe(32)
digest = hashlib.sha256(invite.encode()).hexdigest()
account_id = None
with sqlite3.connect(control, timeout=10) as db:
    db.execute("INSERT INTO account_invites VALUES (?,'member',?)", (digest, int(time.time()) + 600))
try:
    req = Request('http://127.0.0.1:8766/api/register',
                  data=json.dumps({'username': name, 'password': password, 'code': invite}).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=20) as response:
        assert json.load(response)['ok']
    with sqlite3.connect(control) as db:
        account_id = db.execute('SELECT id FROM accounts WHERE username=?', (name,)).fetchone()[0]
    os.environ['JIANMOXI_BRIDGE_TOKEN'] = 'q' * 64
    os.environ['JIANMOXI_ACCOUNT_ID'] = account_id
    spec = importlib.util.spec_from_file_location('bridge_under_test', root / 'bridge/server.py')
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    call = bridge.dispatch
    assert call('list_articles', {})['total'] == 0
    article_id = str(uuid4())
    args = {'article_id': article_id, 'title': 'MCP 接入验收', 'content': '窗前的雨停了。\n山路还亮着。'}
    created = call('create_article', args)
    repeated = call('create_article', args)
    assert created['revision'] == repeated['revision']
    assert call('list_articles', {})['total'] == 1
    article = call('read_article', {'article_id': article_id, 'limit': 5})
    assert not article['complete'] and article['next_offset'] == 5
    changed = call('edit_article', {'article_id': article_id, 'expected_revision': created['revision'],
                                   'edits': [{'old_text': '雨停了', 'new_text': '雨又落下'}]})
    assert changed['revision'] != created['revision']
    try:
        call('edit_article', {'article_id': article_id, 'expected_revision': created['revision'], 'title': 'stale'})
        raise AssertionError('Stale revision should have been rejected')
    except bridge.ToolError as error:
        assert error.status == 409
    assert '雨又落下' in call('read_article', {'article_id': article_id})['text']
    move = {'article_id': article_id, 'expected_revision': changed['revision']}
    call('trash_article', move)
    call('trash_article', move)
    assert call('list_articles', {})['total'] == 0
    assert call('list_articles', {'in_trash': True})['total'] == 1
    call('restore_article', move)
    call('restore_article', move)
    assert call('list_articles', {})['total'] == 1
    books = call('search_library', {'query': '', 'limit': 3})['books']
    assert books
    work_id = books[0]['id']
    page = call('read_library', {'work_id': work_id, 'limit': 200})
    assert page['text'] and page['source_url']
    quote = page['text'].strip()[:30]
    excerpt = call('save_excerpt', {'work_id': work_id, 'text': quote})
    again = call('save_excerpt', {'work_id': work_id, 'text': quote})
    assert excerpt['item']['id'] == again['item']['id']
    assert call('list_excerpts', {})['total'] == 1
    try:
        call('save_excerpt', {'work_id': work_id, 'text': '这句话在原文里肯定没有' + secrets.token_hex(6)})
        raise AssertionError('Invented quote was accepted')
    except bridge.ToolError as error:
        assert error.status == 400
    print('Passed isolated account CRUD, retries, stale edits, library text and source-checked excerpts.')
finally:
    with sqlite3.connect(control, timeout=10) as db:
        if account_id:
            db.execute('DELETE FROM account_sessions WHERE account_id=?', (account_id,))
            db.execute('DELETE FROM accounts WHERE id=? AND username=?', (account_id, name))
        db.execute('DELETE FROM account_invites WHERE digest=?', (digest,))
    if account_id:
        folder = store / 'accounts' / account_id
        if folder.exists():
            assert folder.parent.resolve() == (store / 'accounts').resolve() and folder.is_dir() and not folder.is_symlink()
            shutil.rmtree(folder)

"""Account registry and friend invitations for the cloud workspace."""
import hashlib
import re
import secrets
import time
from werkzeug.security import check_password_hash, generate_password_hash

OWNER_ID = 'owner'
TOKEN_LIFETIME = 7 * 86400
MAX_ACCOUNTS = 30
USERNAME = re.compile(r'[a-z0-9][a-z0-9_.-]{2,31}')
CODE = re.compile(r'[A-Za-z0-9_-]{32,64}')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
    token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_invites (
    digest TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK(purpose IN ('owner','member')), expires INTEGER NOT NULL
);
'''


def initialize(db):
    db.executescript(SCHEMA)
    with db:
        db.execute("DELETE FROM account_invites WHERE purpose='owner'")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def username(value):
    name = value.strip().lower() if isinstance(value, str) else ''
    return name if USERNAME.fullmatch(name) else ''


def issue_invite(db):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute('DELETE FROM account_invites WHERE expires<=?', (now,))
    db.execute("INSERT INTO account_invites VALUES (?,'member',?)",
               (digest(token), now + TOKEN_LIFETIME))
    return token


def configure_owner(db, name, password, legacy_hash=''):
    """Set up the owner through the server administrator, never public signup."""
    name = username(name)
    if not name:
        raise ValueError('账号请用 3–32 位字母、数字或 ._-')
    if not isinstance(password, str) or not password:
        raise ValueError('请填写密码')
    if legacy_hash and check_password_hash(legacy_hash, password):
        raise ValueError('请用一个与旧共享密码不同的密码')
    password_hash = generate_password_hash(password)
    initialize(db)
    with db:
        db.execute('BEGIN IMMEDIATE')
        owner = db.execute('SELECT password_hash FROM accounts WHERE id=?', (OWNER_ID,)).fetchone()
        if owner and owner[0]:
            raise ValueError('你的账号已建好，可以直接登录')
        existing = db.execute('SELECT 1 FROM accounts WHERE username=? AND id<>?', (name, OWNER_ID)).fetchone()
        if existing:
            raise ValueError('该账号已被使用')
        db.execute('''INSERT INTO accounts VALUES (?,?,?)
                      ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash''',
                   (OWNER_ID, name, password_hash))
        db.execute('DELETE FROM sessions')

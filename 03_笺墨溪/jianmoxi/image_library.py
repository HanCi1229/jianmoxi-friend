"""Persistent, source-attributed image catalog; files stay outside app releases."""
import hashlib
import json
import re
import sqlite3
from pathlib import Path

SCHEMA = '''CREATE TABLE IF NOT EXISTS image_assets (
 id TEXT PRIMARY KEY, body TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'ready');
 CREATE TABLE IF NOT EXISTS image_import_runs (
 id INTEGER PRIMARY KEY, finished_at TEXT NOT NULL, body TEXT NOT NULL);
'''


def initialize(connection):
    connection.executescript(SCHEMA)


def import_manifest(connection, folder):
    """Idempotent operator import. Validate every asset before touching the DB."""
    folder = Path(folder)
    records = json.loads((folder / 'manifest.json').read_text())
    checked = []
    for record in records:
        identifier = record.get('id', '')
        if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier):
            raise ValueError('Invalid image ID')
        if record.get('license') not in ('cc0', 'pdm', 'by', 'unsplash', 'pixabay', 'ghibli-stills'):
            raise ValueError('Unsupported license')
        if not all(str(record.get(k, '')).startswith('https://') for k in ('sourceUrl', 'licenseUrl', 'originalUrl')):
            raise ValueError('Missing provenance')
        if not record.get('creator') or not record.get('tags'):
            raise ValueError('Missing creator or tags')
        data = (folder / 'files' / (identifier + '.jpg')).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != record['sha256'] or len(data) < 1000:
            raise ValueError('Image integrity check failed')
        checked.append((identifier, json.dumps(record, ensure_ascii=False), digest))
    initialize(connection)
    with connection:
        for values in checked:
            connection.execute("INSERT INTO image_assets(id,body,sha256) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,status='ready' WHERE image_assets.sha256=excluded.sha256 AND image_assets.status='pending'", values)
    return len(checked)


def active_assets(connection, folder):
    # Never send a known-missing image to the client.
    return [json.loads(row[0]) for row in connection.execute("SELECT body FROM image_assets WHERE status='ready' ORDER BY id")
            if (Path(folder) / 'files' / (json.loads(row[0])['id'] + '.jpg')).is_file()]


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--folder', required=True)
    args = parser.parse_args()
    with sqlite3.connect(args.db) as db:
        print('Validated images:', import_manifest(db, args.folder))

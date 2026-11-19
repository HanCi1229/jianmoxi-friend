"""Read-only owner/library export. No passwords, sessions or API keys are exported."""
import argparse
import gzip
import hashlib
import json
import os
import re
import sqlite3
import struct
import time
import zlib
from pathlib import Path


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def export(database, directory, persona):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    snapshot = 'migration-' + str(int(time.time()))
    entries = []

    def register(name, kind, key, metadata=None):
        path = directory / name
        path.chmod(0o600)
        digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
        record = {'file': name, 'kind': kind, 'key': key, 'bytes': path.stat().st_size, 'sha256': digest}
        if metadata is not None:
            record['metadata'] = metadata
        entries.append(record)

    with sqlite3.connect('file:' + str(Path(database).resolve()) + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        state_row = db.execute('SELECT version,body FROM state WHERE id=1').fetchone()
        state = json.loads(state_row['body'])
        account = db.execute("SELECT username FROM accounts WHERE id='owner'").fetchone()
        excerpts = [dict(row) for row in db.execute('SELECT id,record,created_at,deleted_at FROM reading_excerpts')]
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        allowed = {'state', 'catalog', 'created_inspirations', 'reading_recommendation', 'image_assets'}
        allowed.update(name for name in tables if name.startswith(('assistant_', 'companion_')))
        archive = {name: [dict(row) for row in db.execute('SELECT * FROM ' + name)] for name in sorted(allowed & tables)}
        with gzip.open(directory / 'legacy-owner.json.gz', 'wb') as stream:
            stream.write(encoded({'snapshot': snapshot, 'tables': archive}))
        register('legacy-owner.json.gz', 'archive', snapshot + '/legacy-owner.json.gz')
        payload = {'snapshot': snapshot, 'version': state_row['version'], 'state': state,
                   'account': account['username'], 'persona': Path(persona).read_text(encoding='utf-8'),
                   'excerpts': excerpts}
        (directory / 'workspace.json').write_bytes(encoded(payload))
        register('workspace.json', 'workspace', snapshot + '/workspace.json')
        books = {row['id']: dict(row) for row in db.execute('SELECT id,chapter_count FROM library_books')}
        works = db.execute('SELECT id,title,author,genre,collection,characters,record,status FROM library_works ORDER BY id').fetchall()
        chapter_total = 0
        for work in works:
            identifier = work['id']
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
                raise ValueError('Invalid work identifier')
            original = json.loads(work['record'])
            pieces, index = [], []
            position = 0
            if identifier in books:
                chapters = [(row['chapter'], row['title'], bytes(row['body']), row['characters'])
                            for row in db.execute('SELECT chapter,title,body,characters FROM library_chapters WHERE work_id=? ORDER BY chapter', (identifier,))]
                if len(chapters) != books[identifier]['chapter_count']:
                    raise ValueError('Source chapter count mismatch')
            else:
                paragraphs = original.get('body', [])
                sections = original.get('sections', [])
                chapters = []
                for number in range(max(1, len(sections))):
                    start = sections[number]['start'] if sections else 0
                    end = sections[number + 1]['start'] if number + 1 < len(sections) else len(paragraphs)
                    body = paragraphs[start:end]
                    title = sections[number]['title'] if sections else work['title']
                    chapters.append((number, title, zlib.compress(encoded(body)), len('\n'.join(body))))
            for number, title, body, characters in chapters:
                index.append({'chapter': number, 'title': title, 'offset': position, 'length': len(body), 'characters': characters})
                pieces.append(body)
                position += len(body)
            header = encoded({'version': 1, 'chapters': index})
            name = 'work-' + identifier + '.jmx'
            with (directory / name).open('wb') as stream:
                stream.write(b'JMX1' + struct.pack('>I', len(header)) + header)
                for piece in pieces:
                    stream.write(piece)
            metadata = {key: original[key] for key in original if key not in ('body', 'chapter', 'chapterDirectory')}
            metadata.update(id=identifier, title=work['title'], author=work['author'], genre=work['genre'],
                            collection=work['collection'], characters=work['characters'], status=work['status'],
                            header_bytes=8 + len(header), chapter_count=len(index))
            register(name, 'work', snapshot + '/works/' + identifier + '.jmx', metadata)
            chapter_total += len(index)
        manifest = {'format': 1, 'snapshot': snapshot,
                    'counts': {'articles': len(state.get('articles', [])), 'trash': len(state.get('trash', [])),
                               'excerpts': sum(not row['deleted_at'] for row in excerpts),
                               'works': len(works), 'ready_works': sum(row['status'] == 'ready' for row in works),
                               'chapters': chapter_total}, 'files': entries}
        manifest['bytes'] = sum(entry['bytes'] for entry in entries)
        (directory / 'manifest.json').write_bytes(encoded(manifest))
        (directory / 'manifest.json').chmod(0o600)
        os.chown(directory, 0, os.stat(directory).st_gid)
        print(json.dumps({'snapshot': snapshot, 'counts': manifest['counts'], 'bytes': manifest['bytes'], 'files': len(entries)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default='/var/lib/xingzou/app.db')
    parser.add_argument('--directory', required=True)
    parser.add_argument('--persona', default='/opt/jianmoxi-friend/backend/friend-persona.md')
    options = parser.parse_args()
    export(options.database, options.directory, options.persona)

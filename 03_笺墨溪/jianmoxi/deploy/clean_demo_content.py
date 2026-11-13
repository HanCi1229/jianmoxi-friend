"""Remove only untouched, fingerprinted demo articles; back up before any database change."""
import copy
import json
import os
import sqlite3
import sys
from pathlib import Path

def clean_state(state, examples):
    result = copy.deepcopy(state)
    fingerprints = {(a['id'], a['title'], a['content']) for a in examples}
    removed = []
    for key in ('articles', 'trash'):
        kept = []
        for article in result[key]:
            if (article['id'], article['title'], article['content']) in fingerprints:
                removed.append(article['id'])
            else:
                kept.append(article)
        result[key] = kept
    if result.get('currentId') in removed:
        result['currentId'] = None
    result['favs'] = [i for i in result['favs'] if i not in {'r1','r2','r3','r4','r5','r6'}]
    return result, removed

def migrate(dbpath, examplespath, readingspath, backup):
    db = sqlite3.connect(dbpath, timeout=30)
    destination = Path(backup)
    if destination.exists():
        raise RuntimeError('Backup already exists; inspect before repeating migration')
    fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
    with sqlite3.connect(destination) as snapshot:
        db.backup(snapshot)
    examples=json.loads(Path(examplespath).read_text())
    books=json.loads(Path(readingspath).read_text())
    db.execute('BEGIN IMMEDIATE')
    version,body=db.execute('SELECT version,body FROM state WHERE id=1').fetchone()
    state=json.loads(body)
    clean,removed=clean_state(state,examples)
    existing=json.loads(db.execute("SELECT body FROM catalog WHERE kind='readings'").fetchone()[0])
    newids={r['id'] for r in books}
    retained=[r for r in existing if r.get('id') not in {'r1','r2','r3','r4','r5','r6'}|newids]
    if clean!=state:
        db.execute('UPDATE state SET version=?,body=? WHERE id=1',(version+1,json.dumps(clean,ensure_ascii=False)))
    db.execute("UPDATE catalog SET body=? WHERE kind='readings'",(json.dumps(retained+books,ensure_ascii=False),))
    db.commit()
    print(json.dumps({'removedUntouchedDemoIds':removed,'preservedArticleCount':len(clean['articles']),'readingCount':len(retained+books),'backup':str(destination)},ensure_ascii=False))

if __name__=='__main__':
    migrate(*sys.argv[1:])

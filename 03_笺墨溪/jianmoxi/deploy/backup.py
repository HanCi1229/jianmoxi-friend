"""Consistent SQLite backup, retaining the latest 14 daily files on the server."""
import datetime
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
os.umask(0o077)
folder = Path('/var/lib/xingzou/backups')
folder.mkdir(exist_ok=True)
day = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d') + '.db'


def snapshot(path, destination):
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = destination / (day + '.tmp')
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as source, closing(sqlite3.connect(temporary)) as backup:
        source.backup(backup)
    temporary.replace(destination / day)
    for old in sorted(destination.glob('????-??-??.db'))[:-14]:
        old.unlink()


snapshot(Path('/var/lib/xingzou/app.db'), folder)
for path in Path('/var/lib/xingzou/accounts').glob('*/app.db'):
    if re.fullmatch(r'[a-f0-9]{32}', path.parent.name):
        workspace = folder / 'accounts' / path.parent.name
        snapshot(path, workspace)
        knowledge = path.with_name('knowledge.db')
        if knowledge.is_file():
            snapshot(knowledge, workspace / 'knowledge')
# Photographs are immutable; retain a complete current snapshot beside DB backups.
import tarfile
images = Path('/var/lib/xingzou/images')
if images.exists():
    temporary = folder / 'images-current.tmp'
    with tarfile.open(temporary, 'w:gz') as archive:
        archive.add(images, arcname='images')
    temporary.replace(folder / 'images-current.tar.gz')

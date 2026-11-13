"""Extract short, traceable dialogue records from the official Cornell archive.
Usage: python3 scripts/import_movies.py /path/to/cornell_movie_dialogs_corpus.zip
"""
import hashlib
import json
import random
import re
import sys
import zipfile
from pathlib import Path

archive = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
prefix = 'cornell movie-dialogs corpus/'
with zipfile.ZipFile(archive) as corpus:
    def rows(name):
        return [line.split(' +++$+++ ') for line in corpus.read(prefix + name).decode('latin1').splitlines()]

    movies = {row[0]: row for row in rows('movie_titles_metadata.txt')}
    candidates = []
    for row in rows('movie_lines.txt'):
        if len(row) != 5:
            continue
        line_id, character_id, movie_id, character, quote = row
        if not 45 <= len(quote) <= 130 or not quote.endswith(('.', '!', '?')):
            continue
        if '<' in quote or '>' in quote or not re.search(r'\b(hope|dream|heart|home|love|remember|tomorrow|life)\b', quote, re.I):
            continue
        if re.search(r'\b(fuck\w*|shit\w*|bitch\w*|asshole\w*)\b', quote, re.I):
            continue
        movie = movies.get(movie_id)
        if not movie or not character.strip():
            continue
        candidates.append(dict(id=line_id, movieId=movie_id, characterId=character_id,
                               character=character, title=movie[1], year=movie[2], quote=quote))
    random.Random(20261102).shuffle(candidates)
    selected, counts = [], {}
    for record in candidates:
        key = record['movieId']
        if counts.get(key, 0) >= 2:
            continue
        selected.append(record)
        counts[key] = counts.get(key, 0) + 1
        if len(selected) == 120:
            break
    data = dict(provider='Cornell Movie-Dialogs Corpus',
                sourceUrl='https://www.cs.cornell.edu/~cristian/Cornell_Movie-Dialogs_Corpus.html',
                archiveUrl='https://www.cs.cornell.edu/~cristian/data/cornell_movie_dialogs_corpus.zip',
                archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                citation='Cristian Danescu-Niculescu-Mizil and Lillian Lee, ACL 2011.',
                selection='Short dialogue excerpts, automatically filtered; not verified against final film subtitles.',
                items=selected)
    output = root / 'dist/data'
    output.mkdir(exist_ok=True)
    (output / 'movies.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'cornell-README.txt').write_bytes(corpus.read(prefix + 'README.txt'))
    print(f'Imported {len(selected)} excerpts from {len(counts)} movies; source IDs retained.')

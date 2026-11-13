"""Daily bounded collection from the open-source Lorem Picsum public catalog.
Photos are Unsplash-licensed; Picsum's MIT code license is not an image license.
New unattended assets are pending review; published assets are never replaced.
"""
import argparse
import datetime
import hashlib
import io
import json
import re
import sqlite3
import subprocess
import time
from pathlib import Path
from PIL import Image, ImageOps
from image_library import initialize


def get(url, timeout=30):
    result=subprocess.run(['curl','--fail','--silent','--show-error','--location',
        '--proto','=https','--proto-redir','=https','--connect-timeout','8',
        '--max-time',str(timeout),'--max-filesize','10000000',url],capture_output=True,timeout=timeout+5)
    if result.returncode:
        raise RuntimeError('Source fetch failed')
    return result.stdout


def collect(folder, db_path=None, index_file=None, limit=12):
    folder=Path(folder);(folder/'files').mkdir(parents=True,exist_ok=True)
    manifest=folder/'manifest.json'
    existing=json.loads(manifest.read_text()) if manifest.exists() else []
    known={r['id'] for r in existing};hashes={r['sha256'] for r in existing}
    cursor_file=folder/'collector-cursor.json'
    cursor=json.loads(cursor_file.read_text()) if cursor_file.exists() else {'page':1}
    failures=[];accepted=[];errors=0
    if len(existing)>=600:
        print(json.dumps({'added':0,'total':len(existing),'status':'capacity reached'}));return
    try:
        rows=json.loads(Path(index_file).read_text()) if index_file else json.loads(get(
            'https://picsum.photos/v2/list?page='+str(cursor['page'])+'&limit=30'))
        if not isinstance(rows,list):raise ValueError('Invalid catalog')
        if not rows:cursor['page']=1
        for row in rows:
            if len(accepted)>=limit or errors>=8:break
            uid=str(row.get('id',''))
            if not re.fullmatch(r'[0-9]{1,8}',uid):continue
            identifier='ps-'+uid
            if identifier in known:continue
            source=row.get('url','')
            if not source.startswith('https://unsplash.com/photos/') or not row.get('author'):continue
            try:
                width=min(1200,int(row['width']));height=round(width*int(row['height'])/int(row['width']))
                if height>1600:width=round(width*1600/height);height=1600
                url=f'https://picsum.photos/id/{uid}/{width}/{height}'
                raw=get(url)
                with Image.open(io.BytesIO(raw)) as original:
                    if original.width<500 or original.height<400 or original.width*original.height>40000000:continue
                    photo=ImageOps.exif_transpose(original).convert('RGB')
                    out=io.BytesIO();photo.save(out,'JPEG',quality=84,optimize=True)
                    data=out.getvalue();digest=hashlib.sha256(data).hexdigest()
                    if digest in hashes:continue
                    record=dict(id=identifier,title='摄影作品 '+uid,creator=row['author'],sourceUrl=source,
                        originalUrl=row['download_url'],provider='Lorem Picsum / Unsplash',
                        license='unsplash',licenseUrl='https://unsplash.com/license',tags=[],alt='摄影配图',
                        width=photo.width,height=photo.height,sha256=digest,url='/media/library/'+identifier+'.jpg',
                        retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        edited='缩小尺寸、压缩；页面可能裁切展示')
                    target=folder/'files'/(identifier+'.jpg');temp=target.with_suffix('.tmp')
                    temp.write_bytes(data);temp.replace(target)
                    accepted.append(record);known.add(identifier);hashes.add(digest)
            except Exception:errors+=1
            time.sleep(0.5)
        if rows and (all('ps-'+str(r.get('id')) in known for r in rows) or (len(accepted)<limit and errors<8)):cursor['page']+=1
        cursor_file.write_text(json.dumps(cursor))
    except (RuntimeError,ValueError,subprocess.TimeoutExpired) as error:
        failures.append(type(error).__name__)
    existing.extend(accepted)
    temp=manifest.with_suffix('.tmp');temp.write_text(json.dumps(existing,ensure_ascii=False,indent=2));temp.replace(manifest)
    report=dict(added=len(accepted),total=len(existing),failed=errors,source='Lorem Picsum',errors=failures)
    if db_path:
        with sqlite3.connect(db_path,timeout=30) as db:
            initialize(db)
            for record in existing:
                db.execute("INSERT OR IGNORE INTO image_assets(id,body,sha256,status) VALUES (?,?,?,'pending')",
                    (record['id'],json.dumps(record,ensure_ascii=False),record['sha256']))
            db.execute('INSERT INTO image_import_runs(finished_at,body) VALUES (?,?)',
                (datetime.datetime.now(datetime.timezone.utc).isoformat(),json.dumps(report)))
            db.execute('DELETE FROM image_import_runs WHERE id < (SELECT MAX(id)-90 FROM image_import_runs)')
    print(json.dumps(report,ensure_ascii=False))
    if failures and not accepted:raise SystemExit(1)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--folder',required=True);parser.add_argument('--db')
    parser.add_argument('--index');parser.add_argument('--limit',type=int,default=12)
    args=parser.parse_args();collect(args.folder,args.db,args.index,max(1,min(args.limit,40)))

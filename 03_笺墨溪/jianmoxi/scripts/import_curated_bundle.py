"""Apply validated authored batches against a fresh read-only task snapshot."""
import argparse,json,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import library_knowledge as library
from scripts import import_curated_study,import_curated_synthesis

def apply(db,batches):
 receipts=[]
 for batch in batches:
  authored=batch['authored'];wid=authored['workId']
  with library.connect(db) as k:
   book=k.execute('SELECT * FROM study_books WHERE work_id=?',(wid,)).fetchone()
   assert book,'Unknown work'
   packet=dict(book=dict(book),jobs=[dict(r) for r in k.execute('SELECT * FROM study_jobs WHERE work_id=?',(wid,))],dependencies=[dict(r) for r in k.execute('SELECT d.* FROM study_dependencies d JOIN study_jobs j ON j.id=d.parent WHERE j.work_id=?',(wid,))])
  assert batch['kind'] in ('chapters','synthesis')
  importer=import_curated_study if batch['kind']=='chapters' else import_curated_synthesis
  receipts.append(dict(batchId=authored['batchId'],receipt=importer.apply(db,packet,authored)))
 return receipts

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('bundle');p.add_argument('--db',required=True);args=p.parse_args()
 db=sqlite3.connect('file:'+str(pathlib.Path(args.db).resolve())+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 print(json.dumps(apply(db,json.loads(pathlib.Path(args.bundle).read_text())),ensure_ascii=False))

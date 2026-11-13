#!/usr/bin/env python3
import argparse,json,sqlite3,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import library_knowledge
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--curate',type=int,default=0);p.add_argument('--analyse',type=int,default=0);args=p.parse_args()
with sqlite3.connect(args.db) as db:
 print(json.dumps(library_knowledge.build(db,lambda n:print('Indexed works',n,flush=True))),flush=True)
 for i in range(args.curate):
  try:print('Curated',i,len(library_knowledge.curate(db,int(time.time()//1800)*7+i)),flush=True)
  except Exception as e:print('Curation failed',type(e).__name__,flush=True)

 if args.analyse:
  try:print('Analysed works',library_knowledge.analyse_pending(db,args.analyse,lambda n:print('Analysed',n,flush=True)),flush=True)
  except Exception as e:print('Analysis deferred',type(e).__name__,flush=True)

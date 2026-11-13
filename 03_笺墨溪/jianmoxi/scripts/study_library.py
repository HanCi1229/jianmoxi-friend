#!/usr/bin/env python3
"""Single supervisor, two bounded model workers; restart-safe leases and periodic planning."""
import argparse,concurrent.futures,fcntl,json,sqlite3,sys,time,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import book_study as study
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--plan',action='store_true');p.add_argument('--follow',action='store_true');p.add_argument('--workers',type=int,default=2);p.add_argument('--steps',type=int,default=0);args=p.parse_args()
lock=open(str(Path(args.db).with_name('book-study.lock')),'a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
def connection():return sqlite3.connect(args.db,timeout=30)
with connection() as db:
 study.initialize(db)
 if args.plan:print(json.dumps(study.plan(db,lambda n:print('planned',n,flush=True))),flush=True)
last_plan=time.monotonic();done=0;errors=0

def one():
 with connection() as db:
  job=study.claim(db)
  if not job:return None
  try:
   written=study.process(db,job)
   return dict(id=job['id'],work=job['work_id'],kind=job['kind'],ok=written)
  except Exception as e:
   study.failure(db,job,e);return dict(id=job['id'],work=job['work_id'],kind=job['kind'],ok=False,error=type(e).__name__)
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(args.workers,2))) as pool:
 while True:
  slots=max(1,min(args.workers,2,args.steps-done if args.steps else 2))
  rows=list(pool.map(lambda _:one(),range(slots)));active=[r for r in rows if r]
  for r in active:print(json.dumps(r),flush=True);done+=1;errors=errors+1 if not r['ok'] else 0
  if errors>=8:
   print('Repeated errors; cooling down for five minutes.',flush=True);time.sleep(300);errors=0
  if args.steps and done>=args.steps:break
  if not active:
   with connection() as db:print(json.dumps(study.status(db),ensure_ascii=False),flush=True)
   if not args.follow:break
   time.sleep(30)
  if args.follow and time.monotonic()-last_plan>=3600:
   with connection() as db:study.plan(db)
   last_plan=time.monotonic()

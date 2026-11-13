"""Read-only handoff snapshot. Run on server with Python 3; emits no credentials."""
import sqlite3,json,subprocess,os,datetime
out={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
for name in ['xingzou','nginx','xingzou-book-study','xingzou-backup.timer','xingzou-images.timer','xingzou-library.timer','xingzou-cert-renew.timer']:
 out.setdefault('services',{})[name]={k:subprocess.run(['systemctl',k,name],capture_output=True,text=True).stdout.strip() for k in ['is-active','is-enabled']}
k=sqlite3.connect('file:/var/lib/xingzou/knowledge.db?mode=ro',uri=True);k.row_factory=sqlite3.Row
approved=json.loads(k.execute("SELECT value FROM study_state WHERE key='approved_work_ids'").fetchone()[0]);out['books']=[]
for w in approved:
 b=dict(k.execute('SELECT * FROM study_books WHERE work_id=?',(w,)).fetchone());b['metadata']=json.loads(b['metadata'])
 b['jobs']=[dict(r) for r in k.execute('SELECT kind,status,count(*) AS n FROM study_jobs WHERE work_id=? GROUP BY kind,status',(w,))]
 b['doneChapters']=[r[0] for r in k.execute("SELECT chapter FROM study_jobs WHERE work_id=? AND kind='chapter' AND status='done' ORDER BY chapter",(w,))]
 b['rootStatus']=k.execute('SELECT status FROM study_jobs WHERE id=?',(b['root_id'],)).fetchone()[0]
 b['quotes']=[dict(r) for r in k.execute('SELECT status,count(*) AS n FROM study_quotes WHERE work_id=? GROUP BY status',(w,))]
 out['books'].append(b)
out['receipts']=[{'key':r[0],'value':json.loads(r[1])} for r in k.execute("SELECT key,value FROM study_state WHERE key LIKE 'curated%'")]
a=sqlite3.connect('file:/var/lib/xingzou/app.db?mode=ro',uri=True)
out['tables']=[r[0] for r in a.execute("SELECT name FROM sqlite_master WHERE type='table'")]
out['dataDirectories']=[{'name':f,'isDir':os.path.isdir('/var/lib/xingzou/'+f),'bytes':os.stat('/var/lib/xingzou/'+f).st_size} for f in os.listdir('/var/lib/xingzou') if not f.startswith('.')]
out['configuredModel']=None
for line in open('/etc/xingzou/cloud.env'):
 if line.startswith('DEEPSEEK_MODEL='):out['configuredModel']=line.strip().split('=',1)[1]
out['unauthenticatedQuotesHTTP']=subprocess.run(['curl','-sS','--max-time','10','-o','/dev/null','-w','%{http_code}','-H','Host: 49.234.43.25','http://127.0.0.1:8765/api/quotes'],capture_output=True,text=True).stdout
out['tlsHTTP']=subprocess.run(['curl','-sS','--max-time','15','-o','/dev/null','-w','%{http_code}','https://49.234.43.25/'],capture_output=True,text=True).stdout
print(json.dumps(out,ensure_ascii=False,indent=2))

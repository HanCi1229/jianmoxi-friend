"""Import reviewed public-domain originals; omit anthology editors and adverts."""
import hashlib,json,re,unicodedata
from pathlib import Path
from urllib.parse import quote
ROOT=Path(__file__).resolve().parents[1];SOURCE=ROOT/'.deploy/book-sources'
def clean(raw):
 out=[]
 for line in raw.splitlines():
  s=line.strip(); normalized=unicodedata.normalize('NFKC',s).lower();compact=re.sub(r'[^a-z]','',normalized)
  if not s or re.match(r'^第\d+章 ',s):continue
  if 'xiaoshuo' in compact or compact.startswith('www') or '小说天堂' in s:continue
  if s=='中青年时代的郁达夫二':continue
  out.append(s)
 return out
records=[]
def record(title,author,genre,body,filename,order,sections=None):
 assert len(''.join(body))>50
 r=dict(id='lit-'+hashlib.sha256((author+':'+title).encode()).hexdigest()[:18],title=title,author=author,genre=genre,body=body,collection=author+'作品选',collectionOrder=order,intro=next((p for p in body if len(p)>25),' '.join(body))[:70]+'…',sourceUrl='https://github.com/hankinghu/literature-books/blob/master/'+quote(filename),sourceName='文学作品文本库',sourceEdition='原作转录；移除下载广告和编者附录，合并连载分段',retrievedAt='2026-11-03',sourceFileSHA256=hashlib.sha256((SOURCE/filename).read_bytes()).hexdigest(),access='internal',coverTags=['nature','street'] if genre=='散文' else ['forest'])
 if sections:r['sections']=sections
 records.append(r)
name='萧红经典全集.txt';s=(SOURCE/name).read_text(encoding='utf-8-sig');matches=list(re.finditer(r'^第(\d+)章 ([^\n]+)',s,re.M));groups={};chapter_starts={}
for i,m in enumerate(matches):
 n=int(m[1]);title=m[2].strip()
 if n>=40:continue
 title=re.sub(r'（[一二三四五六七]+）$','',title).replace('（代序）','')
 body=clean(s[m.end():matches[i+1].start()]);group=groups.setdefault(title,[])
 if title=='呼兰河传':chapter_starts.setdefault(title,[]).append(dict(title='第'+str(n-30)+'章',start=len(group)))
 group.extend(body)
for i,(title,body) in enumerate(groups.items()):
 genre='小说' if title in ['生死场','后花园','牛车上','呼兰河传','小城三月','旷野的呼喊'] else '诗歌' if title in ['春曲','沙粒','可纪念的枫叶（外二首）'] else '散文'
 sections=[]
 if title=='呼兰河传':
  sections=chapter_starts[title]+[dict(title=p,start=k) for k,p in enumerate(body) if p=='尾声']
 if title=='生死场':
  sections=[dict(title=p,start=k) for k,p in enumerate(body) if re.fullmatch(r'[一二三四五六七八九十○]+\s+.{2,25}',p)]
 record(title,'萧红',genre,body,name,i,sections)
name='郁达夫大全集.txt';s=(SOURCE/name).read_text(encoding='utf-8-sig');s=s[s.index('第56章'):s.index('第66章')]
titles=['归航','立秋之夜','苏州烟雨记','零余者','小春天气','南行杂记','一个人在途上','灯蛾埋葬之夜','志摩在回忆里','光慈的晚年','移家琐记','杭州的八月','故都的秋','江南的冬景','北平的四季','日本的文化生活']
positions=[re.search(r'^\s*'+re.escape(t)+r'\s*$',s,re.M) for t in titles];assert all(positions)
existing={(r['author'],r['title']) for r in json.loads((ROOT/'data/library-works.json').read_text())}
for i,(title,m) in enumerate(zip(titles,positions)):
 if ('郁达夫',title) in existing:continue
 body=clean(s[m.end():positions[i+1].start() if i+1<len(positions) else len(s)])
 record(title,'郁达夫','散文',body,name,i)
(ROOT/'data/library-modern.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
print('Added full-text works',len(records));print([(r['title'],len(''.join(r['body'])),len(r.get('sections',[]))) for r in records if r['genre']=='小说'])

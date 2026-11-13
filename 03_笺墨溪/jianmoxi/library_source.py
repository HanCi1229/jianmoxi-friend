"""Read source-backed public literature from Wikimedia's public parse API."""
import hashlib,json,re,subprocess,time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode,quote,unquote

class SourceRateLimited(Exception):pass

class Node:
 def __init__(self,tag='',attrs=None,parent=None):self.tag=tag;self.attrs=dict(attrs or []);self.parent=parent;self.children=[]
 def walk(self):
  yield self
  for child in self.children:
   if isinstance(child,Node):yield from child.walk()
 def text(self):
  if self.tag in ('style','script','sup'):return ''
  return ''.join(c.text() if isinstance(c,Node) else c for c in self.children)

class Tree(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.current=self.root
 def handle_starttag(self,tag,attrs):
  child=Node(tag,attrs,self.current);self.current.children.append(child)
  if tag=='br':child.children.append('\n')
  if tag not in ('br','hr','img','input','meta','link','wbr','source'):self.current=child
 def handle_endtag(self,tag):
  current=self.current
  while current.parent:
   if current.tag==tag:self.current=current.parent;return
   current=current.parent
 def handle_data(self,data):self.current.children.append(data)

BLOCKED=('headerContainer','licenseContainer','licensetpl','navbox','ws-noexport','noprint','mw-editsection','references','toc','acContainer','catlinks','printfooter','wst-pagebreak')
def blocked(node):
 while node:
  value=node.attrs.get('id','')+' '+node.attrs.get('class','')
  if node.tag in ('style','script','table','sup') or any(c in value for c in BLOCKED):return True
  node=node.parent
 return False

def parse_document(document):
 parser=Tree();parser.feed(document);return parser.root

def body_from(document):
 root=parse_document(document);body=[]
 for node in root.walk():
  if node.tag=='p' and not blocked(node):
   text=node.text().replace('\u200b','').replace('\ufeff','').strip()
   text=re.sub(r'[ \t\u3000]+',' ',text);text=re.sub(r'\n{3,}','\n\n',text)
   if text and not text.startswith('←') and not re.fullmatch(r'[0-9\s]+',text):body.append(text)
 return body

def get_page(title,cache):
 cache=Path(cache);cache.mkdir(parents=True,exist_ok=True);target=cache/(quote(title,safe='')+'.json')
 if target.exists():
  data=json.loads(target.read_text())
  if data.get('parse'):return data['parse']
 url='https://zh.wikisource.org/w/api.php?'+urlencode(dict(action='parse',page=title,prop='text|links|revid',format='json',variant='zh-hans',redirects=1,maxlag=5))
 for attempt in range(2):
  result=subprocess.run(['curl','-fsSL','--connect-timeout','8','--max-time','35','-A','XingzouLibrary/1.0 (reading catalog)',url],capture_output=True)
  if b'429' in result.stderr:raise SourceRateLimited('Wikisource rate limit; stop this run')
  if result.returncode==0:
   try:
    data=json.loads(result.stdout)
    if data.get('parse'):target.write_text(json.dumps(data,ensure_ascii=False));return data['parse']
    if data.get('error',{}).get('code')!='maxlag':return None
   except ValueError:pass
  time.sleep(1+attempt)
 return None

def extract_record(seed,page):
 html=page['text']['*'];root=parse_document(html)
 header=next((n for n in root.walk() if n.attrs.get('id')=='headerContainer'),None)
 if not header:return None
 authors=[n.text().strip() for n in header.walk() if n.tag=='a' and ('Author:' in unquote(n.attrs.get('href','')) or '作者:' in unquote(n.attrs.get('href','')))]
 if seed['author'] not in authors:return None
 body=body_from(html);length=sum(len(x) for x in body)
 is_poem=bool(re.search(r'class="[^"]*\bpoem\b',html))
 if length<(30 if is_poem else 150):return None
 # Catalog-only pages and incomplete subpage extracts must not become articles.
 if length<450 and sum(1 for a in page.get('links',[]) if a['ns']==0)>12:return None
 title=seed.get('displayTitle') or next((n.text().strip() for n in header.walk() if n.tag=='b' and n.text().strip()),page['title'])
 if len(title)>100:return None
 genre='诗歌' if is_poem else ('散文' if seed.get('genre')=='诗歌' else seed.get('genre','散文'))
 year_match=re.search(r'(?<!\d)(1[89]\d{2}|20\d{2})年',header.text())
 id_override={'匆匆':'wikisource-congcong','背影':'wikisource-beiying'}
 return dict(id=id_override.get(title,'ws-'+str(page['pageid'])),title=title,author=seed['author'],category=genre,genre=genre,
  collection=seed.get('collection',''),collectionOrder=seed.get('order',0),img='forest',
  intro=re.sub(r'\s+',' ',body[0])[:90]+'…',year=year_match.group(1) if year_match else '',body=body,
  sourceUrl='https://zh.wikisource.org/zh-hans/'+quote(page['title'],safe='/'),sourceName='维基文库',
  sourceEdition='维基文库简体转写；完整正文，保留段落',sourceRevision=page['revid'],sourcePageId=page['pageid'],
  retrievedAt=time.strftime('%Y-%m-%d'),characters=length,bodyHash=hashlib.sha256('\n'.join(body).encode()).hexdigest(),
  coverTags=seed.get('coverTags',[]),coverId=seed.get('coverId'),provenance='wikisource-transcription')

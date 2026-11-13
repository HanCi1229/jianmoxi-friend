# -*- coding: utf-8 -*-
"""Extract user supplied books without modifying originals. No network access."""
import hashlib,json,re,zipfile,posixpath,shutil,tempfile,contextlib,io,sys
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from concurrent.futures import ProcessPoolExecutor,as_completed
import fitz
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.deploy/book-import';PARSED=OUT/'parsed';PARSED.mkdir(exist_ok=True)
CHAPTER=re.compile(r'^(?:第[零〇一二三四五六七八九十百千万两\d]{1,12}[章回卷部节集篇]|(?:Chapter|CHAPTER)\s+[\dIVX]+|(?:序章|楔子|引子|尾声|后记|番外|终章)(?:\s|[：:、]|$))')
AD=re.compile(r'微信.{0,15}\d{5}|(?:www\.|https?://|QQ群|加群|公众号|下载更多|电子书免费赠送|更多精校|本书由.*整理|更多免费电子书)',re.I)
def clean(s):return re.sub(r'[\t\u3000\xa0 ]+',' ',s.replace('\x00','').replace('\ufeff','')).strip()
def decode(b):
 if b.startswith((b'\xff\xfe',b'\xfe\xff')):return b.decode('utf-16')
 try:return b.decode('utf-8-sig')
 except UnicodeDecodeError:
  try:return b.decode('gb18030')
  except UnicodeDecodeError:
   from charset_normalizer import from_bytes
   best=from_bytes(b[:200000]).best()
   if not best:raise ValueError('无法识别文字编码')
   return b.decode(best.encoding,errors='replace')
def paragraphs(text):
 out=[]
 for line in text.splitlines():
  line=clean(line)
  if line and not (AD.search(line) and len(line)<180):out.append(line)
 return out

def normalize_title(name):
 name=re.sub(r'^\d+[._\s]*','',Path(name).stem).strip();name=re.sub(r'^名家名译[：:]','',name)
 if '《' in name and '》' in name:return name.split('《',1)[1].split('》',1)[0].replace('[精品]','')
 name=re.split(r'\s+-\s+|-[（(\u4e00-\u9fff]',name,maxsplit=1)[0]
 name=re.sub(r'（(?:全[一二三四五六七八九十\d]+册|精校版全本|校对版全本|已完本|增订本|2022新版)）','',name)
 name=re.sub(r'\((?:已完本|假同名)\)| 完结\+番外|全文\+番外.*','',name)
 return name.strip()
ALIASES={'三体合集':'三体全集','盗墓.笔记.全集':'盗墓笔记','盗墓笔记八部+番外':'盗墓笔记','基度山伯爵':'基督山伯爵','光利西斯':'尤利西斯','生命中不能承受之轻':'不能承受的生命之轻','美妙的新世界':'美丽新世界','鲁滨逊飘流记':'鲁滨逊漂流记','简·爱':'简爱','汤姆索耶历险记':'汤姆·索亚历险记'}
AUTHORS={}
for author,titles in {
'曹雪芹':'红楼梦','余华':'活着|许三观卖血记','刘慈欣':'三体全集','路遥':'平凡的世界','金庸':'天龙八部|笑傲江湖|射雕英雄传|倚天屠龙记','史铁生':'我与地坛|病隙碎笔|记忆与印象','海子':'海子诗全集','当年明月':'明朝那些事儿','王国维':'人间词话',
'我吃西红柿':'星辰变|吞噬星空','天蚕土豆':'斗破苍穹|大主宰','辰东':'遮天|完美世界|圣墟|长生界','耳根':'仙逆|我欲封天|天逆|求魔|一念永恒|三寸人间','老鹰吃小鸡':'万族之劫','蝴蝶蓝':'全职高手','忘语':'凡人修仙传','烽火戏诸侯':'剑来|雪中悍刀行','卖报小郎君':'大奉打更人','唐家三少':'斗罗大陆|斗罗大陆2绝世唐门|斗罗大陆3龙王传说|斗罗大陆4终极斗罗|斗罗大陆5重生唐三|斗罗大陆外传唐门英雄传|斗罗大陆外传神界传说|神印王座','勺子':'炼气十万年','南派三叔':'盗墓笔记','佛前献花':'神秘复苏','萧鼎':'诛仙','爱潜水的乌贼':'诡秘之主','油爆香菇':'退下，让朕来','墨香铜臭':'魔道祖师','猫腻':'庆余年','老猪':'紫川','梦入神机':'佛本是道',
'米兰·昆德拉':'不朽|为了告别的聚会|玩笑|生活在别处|不能承受的生命之轻','川端康成':'古都|美丽与悲哀|雪国','泰戈尔':'吉檀伽俐|新月集|园丁集|采果集','维克多·雨果':'巴黎圣母院|悲惨世界','列夫·托尔斯泰':'安娜·卡列尼娜|战争与和平|复活','陀思妥耶夫斯基':'罪与罚|卡拉马佐夫兄弟','高尔基':'童年|在人间|我的大学|母亲','查尔斯·狄更斯':'双城记|雾都孤儿','巴尔扎克':'高老头|欧也妮·葛朗台','杰克·伦敦':'白牙|野性的呼唤|马丁·伊登','屠格涅夫':'父与子|猎人笔记','D.H.劳伦斯':'儿子与情人|恋爱中的女人','大仲马':'三个火枪手|基督山伯爵','马克·吐温':'哈克贝利·芬恩历险记|汤姆·索亚历险记','加西亚·马尔克斯':'百年孤独','F.斯科特·菲茨杰拉德':'了不起的盖茨比|夜色温柔','卡夫卡':'城堡','司汤达':'红与黑','福楼拜':'包法利夫人','小仲马':'茶花女','普希金':'上尉的女儿','简·奥斯丁':'傲慢与偏见','夏洛蒂·勃朗特':'简爱','艾米莉·勃朗特':'呼啸山庄','塞万提斯':'唐·吉诃德','拉伯雷':'巨人传','莫泊桑':'莫泊桑小说集','契诃夫':'变色龙','海明威':'老人与海','霍桑':'红字','哈代':'苔丝','夏目漱石':'我是猫','芥川龙之介':'罗生门','丹尼尔·笛福':'鲁滨逊漂流记','J.D.塞林格':'麦田里的守望者','歌德':'浮士德|少年维特的烦恼','莎士比亚':'莎士比亚选集','惠特曼':'草叶集','雪莱':'雪莱诗选','拜伦':'拜伦诗选','波德莱尔':'恶之花','弥尔顿':'失乐园','乔万尼·薄伽丘':'十日谈','伊索':'伊索寓言','汉斯·克里斯蒂安·安徒生':'安徒生童话选|安徒生童话故事集','尼古拉·奥斯特洛夫斯基':'钢铁是怎样炼成的','伏尼契':'牛虻','索尔仁尼琴':'癌症楼','鲍里斯·帕斯捷尔纳克':'日瓦戈医生','詹姆斯·乔伊斯':'尤利西斯','君特·格拉斯':'铁皮鼓','库尔特·冯内古特':'五号屠场','约瑟夫·海勒':'第二十二条军规','威廉·戈尔丁':'蝇王','奥尔德斯·赫胥黎':'美丽新世界','托马斯·曼':'布登勃洛克一家','布尔加科夫':'大师与玛格丽特','雅罗斯拉夫·哈谢克':'好兵帅克','果戈理':'死魂灵','卢梭':'爱弥儿','杰克·凯鲁亚克':'在路上','约翰·斯坦贝克':'愤怒的葡萄','西奥多·德莱塞':'嘉莉妹妹','辛克莱·刘易斯':'大街','让-保罗·萨特':'恶心','凯特·肖邦':'觉醒','欧仁·奥尼尔':'毛猿','普罗斯佩·梅里美':'高龙巴','拉法埃洛·乔万尼奥里':'斯巴达克思','民间文学':'一千零一夜',
}.items():
 for title in titles.split('|'):AUTHORS[title]=author

def epub(p):
 with zipfile.ZipFile(p) as z:
  names=z.namelist();lookup={n.lower():n for n in names};opfs=[n for n in names if n.lower().endswith('.opf')]
  if not opfs:raise ValueError('没有 EPUB 书籍目录')
  opf=opfs[0]
  try:
   c=ET.fromstring(z.read('META-INF/container.xml'));opf=lookup[c.find('.//{*}rootfile').attrib['full-path'].lower()]
  except (KeyError,ET.ParseError):pass
  raw=z.read(opf)
  if b'<' not in raw[:100]:raise ValueError('EPUB 内容已加密或损坏')
  soup=BeautifulSoup(decode(raw),'html.parser');title=soup.find(['dc:title','title']);author=soup.find(['dc:creator','creator']);meta={'title':title.get_text().strip() if title else '', 'author':author.get_text().strip() if author else ''}
  manifest={i.get('id'):i for i in soup.find_all('item')};order=[]
  for ref in soup.find_all('itemref'):
   item=manifest.get(ref.get('idref'))
   if item and ref.get('linear')!='no':
    path=posixpath.normpath(posixpath.join(posixpath.dirname(opf),unquote(item.get('href','').split('#')[0])))
    if path.lower() in lookup:order.append(lookup[path.lower()])
  if not order:raise ValueError('EPUB 阅读顺序无法识别')
  chapters=[];bad=0
  for name in order:
   html=decode(z.read(name));doc=BeautifulSoup(html,'html.parser')
   for n in doc(['script','style','nav']):n.decompose()
   body=doc.body or doc;lines=paragraphs(body.get_text('\n'))
   if sum(map(len,lines))<35:continue
   heading=body.find(re.compile('^h[1-4]$'));label=clean(heading.get_text(' ')) if heading else (lines[0] if len(lines[0])<65 else '正文')
   if label in ('目录','Contents','目 录') and len(lines)<1000:continue
   if label and any(x in label for x in ['版权信息','图书在版','Copyright']) and sum(map(len,lines))<3000:continue
   chapters.extend(split_parts(label,lines))
  return meta,chapters

def split_parts(title,lines):
 chunks=[];part=[];n=0
 for line in lines:
  if part and n+len(line)>14000:chunks.append(part);part=[];n=0
  # A malformed giant paragraph must not create an unbounded mobile response.
  if len(line)>14000:
   if part:chunks.append(part);part=[];n=0
   chunks.extend([[line[i:i+14000]] for i in range(0,len(line),14000)]);continue
  part.append(line);n+=len(line)
 if part:chunks.append(part)
 return [dict(title=(title[:100] or '正文')+(f' · {i+1}' if len(chunks)>1 else ''),body=v) for i,v in enumerate(chunks)]

def txt(p):
 lines=paragraphs(decode(p.read_bytes()));chapters=[];title='开篇';body=[];found=0
 for line in lines:
  if len(line)<100 and CHAPTER.match(line):
   if body:chapters.extend(split_parts(title,body))
   title=line;body=[];found+=1
  else:body.append(line)
 if body:chapters.extend(split_parts(title,body))
 if not found:chapters=split_parts('正文',lines)
 author='';head='\n'.join(lines[:35]);m=re.search(r'作者[：:\s]+([^\s\n《》]{2,20})',head)
 if m:author=m[1]
 return dict(author=author),chapters

def pdf(p):
 d=fitz.open(p)
 if d.needs_pass:raise ValueError('PDF 需要密码')
 chapters=[]
 for i,page in enumerate(d):
  # Preserve text for search and an accessible alternative. The default reader
  # shows the original page, because older PDFs have unreliable number maps.
  blocks=page.get_text('blocks',sort=True);lines=[]
  for block in blocks:
   if len(block)>6 and block[6]!=0:continue
   if block[1]<25 or block[3]>page.rect.height-22:continue
   value=re.sub(r'(?<=[\u4e00-\u9fff])\s*\n\s*(?=[\u4e00-\u9fff])','',block[4]).strip()
   if value and not re.fullmatch(r'[\s\d—－-]+',value):lines.extend(paragraphs(value))
  chapters.append(dict(title='第 '+str(i+1)+' 页',body=lines or ['本页为图片或无可提取文字。'],page=i))
 meta=dict(author=d.metadata.get('author',''),pages=len(d));d.close();return meta,chapters

def extract(source):
 p=Path(source['path']);target=PARSED/(source['sha256']+'.json')
 if target.exists():return json.loads(target.read_text())['summary']
 summary=dict(source=source['stored'],filename=source['relative'],status='ready',warnings=[])
 try:
  if '假同名' in p.name:raise ValueError('文件名明确标记为假同名，隔离处理')
  if p.suffix=='.epub':meta,chapters=epub(p)
  elif p.suffix=='.txt':meta,chapters=txt(p)
  elif p.suffix=='.pdf':meta,chapters=pdf(p)
  elif p.suffix=='.azw3':
   import mobi
   with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):folder,converted=mobi.extract(str(p))
   try:meta,chapters=epub(Path(converted))
   finally:shutil.rmtree(folder)
  else:raise ValueError('格式暂不支持')
  title=normalize_title(p.name);title=ALIASES.get(title,title)
  if p.parent.name=='神秘复苏-文本小说':title='神秘复苏'
  if '盗墓笔记-文本小说' in str(p):
   if '番外'==p.parent.name:title='盗墓笔记·'+p.stem
   elif title.startswith('盗墓笔记') and title not in ('盗墓笔记','盗墓笔记八部+番外') and p.parent.name=='盗墓笔记1—8全':summary['warnings'].append('分卷或衍生内容')
  author=AUTHORS.get(title) or meta.get('author','')
  if not author and '-' in p.stem:author=p.stem.rsplit('-',1)[1].strip()
  if not author or re.search(r'微信|calibre|Administrator|Microsoft|Adobe|电子书|www\.|http|未知',author,re.I) or len(author)>70:author='作者待核'
  author=re.sub(r'\s*[（(][A-Za-z].*','',author).strip()
  author=re.sub(r'^[（(\[].{1,6}[)）\]]','',author).strip()
  if '盗墓笔记' in title and '终极解谜' not in title:author='南派三叔'
  # Metadata in the supplied ebook describes a screenplay, not King's novella.
  if title=='肖申克的救赎' and '达拉邦特' in author:title+='（电影剧本）'
  if title=='双城记' and '亚米契斯' in author:summary['warnings'].append('元数据作者与书名不一致');author='作者待核'
  characters=sum(sum(map(len,c['body'])) for c in chapters)
  if characters<100:raise ValueError('未提取到足够正文')
  if sum(sum(line.count('\ufffd') for line in c['body']) for c in chapters)>max(10,characters*.001):raise ValueError('正文乱码过多')
  genre='小说'
  if any(w in title for w in ('诗','词','野草')):genre='诗歌'
  if any(w in title for w in ('散文','我与地坛','精神家园','思维的乐趣','病隙','记忆与印象','文化苦旅','瓦尔登湖','读书与做人','妙语录','青春','五年文集','走了很远')):genre='散文'
  if any(w in title for w in ('通史','艺术的故事','乡土中国','明朝那些','菊与刀','理想国','爱弥儿')):genre='人文社科'
  if any(w in title for w in ('鬼谷子','孙子略解','王阳明')):genre='古文'
  if '我的小说合集' in str(p) or p.suffix=='.txt':genre='网络小说'
  if '剧本' in title or title in ('莎士比亚选集','浮士德','毛猿'):genre='戏剧'
  summary.update(title=title,author=author,genre=genre,characters=characters,chapters=len(chapters),format=p.suffix[1:],metadata=meta,bodyHash=hashlib.sha256('\n'.join('\n'.join(c['body']) for c in chapters).encode()).hexdigest())
  target.write_text(json.dumps(dict(summary=summary,chapters=chapters),ensure_ascii=False))
 except Exception as e:
  summary.update(status='review',error=str(e));target.write_text(json.dumps(dict(summary=summary),ensure_ascii=False))
 return summary

if __name__=='__main__':
 sources=json.loads((OUT/'sources.json').read_text());results=[]
 with ProcessPoolExecutor(max_workers=4) as pool:
  for future in as_completed([pool.submit(extract,s) for s in sources]):
   r=future.result();results.append(r);print(len(results),r['filename'],r['status'],r.get('characters',0),r.get('error',''),flush=True)
 (OUT/'extraction.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print('DONE',len(results),flush=True)

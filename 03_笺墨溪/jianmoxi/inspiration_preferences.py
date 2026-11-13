"""Bounded controls for source-backed inspiration; AI can select IDs, never invent quotes."""
import datetime,re
LIST_FIELDS=('excludedAuthors','reducedAuthors','avoidKeywords')
FIELDS=LIST_FIELDS+('onlyAuthors','onlyOrigin','origin','maxPerAuthor','selectedIds','selectionDay','selectionMode')
FOREIGN=tuple('梭罗 爱默生 蒙田 川端康成 夏目漱石 太宰治 芥川龙之介 泰戈尔 纪伯伦 马尔克斯 博尔赫斯 加缪 卡夫卡 黑塞 里尔克 普鲁斯特 托尔斯泰 陀思妥耶夫斯基 契诃夫 屠格涅夫 雨果 巴尔扎克 福楼拜 海明威 伍尔夫 奥斯丁 狄更斯 安徒生 马克·吐温'.split())
def today():return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date().isoformat()
def matches(author,values):return any(v in author for v in values if v)
def validate(value):
 for key in LIST_FIELDS:
  rows=value.get(key,[])
  if not isinstance(rows,list) or len(rows)>12 or any(not isinstance(v,str) or not 1<=len(v.strip())<=80 for v in rows):raise ValueError('Invalid inspiration preference')
 if any(type(value.get(k,False)) is not bool for k in ('onlyAuthors','onlyOrigin')):raise ValueError('Invalid preference filter')
 if value.get('origin','any') not in ('any','chinese','foreign'):raise ValueError('Invalid origin')
 if type(value.get('maxPerAuthor',10)) is not int or not 1<=value.get('maxPerAuthor',10)<=10:raise ValueError('Invalid author limit')
 rows=value.get('selectedIds',[])
 if not isinstance(rows,list) or len(rows)>30 or any(not isinstance(v,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',v) for v in rows) or len(set(rows))!=len(rows):raise ValueError('Invalid selected inspiration IDs')
 day=value.get('selectionDay','')
 if not isinstance(day,str) or (day and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day)):raise ValueError('Invalid selection day')
 if value.get('selectionMode','ranked') not in ('ranked','created'):raise ValueError('Invalid selection mode')
 return value

def allows(row,prefs):
 s=row['source'];author=s['author'];words=' '.join([s['quote'],*row.get('themes',[]),row.get('interpretation','')])
 if matches(author,prefs.get('excludedAuthors',[])):return False
 if prefs.get('onlyAuthors') and not matches(author,prefs.get('authors',[])):return False
 origin=prefs.get('origin','any');foreign=matches(author,FOREIGN)
 if prefs.get('onlyOrigin') and origin=='foreign' and not foreign:return False
 if prefs.get('onlyOrigin') and origin=='chinese' and foreign:return False
 if any(w and w in words for w in prefs.get('avoidKeywords',[])):return False
 if prefs.get('genres') and row.get('genre') not in prefs['genres']:return False
 if prefs.get('types') and 'literature' not in prefs['types']:return False
 return True

def score(row,prefs):
 words=' '.join([row['source']['quote'],*row.get('themes',[]),row.get('interpretation','')])
 origin=prefs.get('origin','any');foreign=matches(row['source']['author'],FOREIGN)
 origin_score=10 if (origin=='foreign' and foreign) or (origin=='chinese' and not foreign) else 0
 return origin_score+(20 if matches(row['source']['author'],prefs.get('authors',[])) else 0)+sum(3 for w in prefs.get('keywords',[]) if w and w in words)

def status(rows,prefs):
 if not prefs:return '书库精选'
 if prefs.get('selectionMode')=='created' and prefs.get('selectionDay')==today():
  return '已制作并展示 '+str(len(rows))+' 张灵感卡片' if rows else '本批卡片的原文已变化或不可用，请重新制作'
 message='已按偏好整理 '+str(len(rows))+' 条灵感' if rows else '当前书库没有符合这些条件的灵感，已保留偏好'
 if rows and len(rows)<30:message+='；符合条件的摘句暂不足 30 条'
 missing=[a for a in prefs.get('authors',[]) if not any(a in r['source']['author'] for r in rows)]
 if missing:message+='；本次没有'+ '、'.join(missing)+'的可用摘句'
 return message

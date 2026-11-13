// Public-content adapter. It never sends drafts, favourites, or user identifiers.
// AI enriches source-backed candidates without changing their attribution.
function createLiveFeedProvider(demoProvider) {
  const cacheKey=(window.xingzouCloud?.storageKey('xingzou-v2-live-sources')||'xingzou-v2-live-sources');
  const isClassical=s=>s.classical===true||s.topic==='古诗文'||/古文|古诗|唐诗|宋词/.test(s.source?.note||'');
  const limitClassical=items=>{let n=0;return items.filter(s=>!isClassical(s)||++n<=2)};
  let cache={};
  try{cache=JSON.parse(localStorage.getItem(cacheKey)||'{}')||{}}catch{}
  let hitokotoQueue=Promise.resolve(),lastHitokotoAt=0,moviesPromise;
  const clean=value=>typeof value==='string'?value.trim():'';
  const stamp=()=>new Date().toISOString();
  const prompts={
    literature:['从这句话，想到一段生活','选一个让你停下来的词，写一段属于自己的经历。',['它让你想起了什么具体的场景？','把感受落在一个动作或物件上。']],
    lyrics:['把一句歌词，放回自己的生活','留意这一句唤起的情绪，试着写一个与它呼应的片刻。',['你会在什么地方听到这首歌？','如果不借用歌词，你会怎样表达相近的感受？']],
    movie:['让一句对白，带出一个人物','想一想这句话背后的愿望，写一段属于你的人物对话。',['说话的人真正想得到什么？','另一个人会怎样回答，或者保持沉默？']]
  };
  function item(id,topic,img,source,kind){const [short,desc,questions]=prompts[kind];return {id,topic,img,source,short,desc,questions,promptKind:'template'}}
  async function json(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),url.startsWith('/api/inspiration/library')?65000:22000);
    try{const response=await fetch(url,{signal:controller.signal,credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('HTTP '+response.status);return await response.json()}
    finally{clearTimeout(timer)}
  }
  function hitokoto(category){
    const request=hitokotoQueue.catch(()=>{}).then(async()=>{
      const wait=Math.max(0,650-(Date.now()-lastHitokotoAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      lastHitokotoAt=Date.now();
      const record=await json('/api/hitokoto?'+new URLSearchParams({category}));
      if(!clean(record.hitokoto)||!clean(record.from)||!clean(record.uuid))throw new Error('Incomplete quote');
      return item('hitokoto-'+record.uuid,category==='i'?'古诗文':category==='h'?'影视':'文学',category==='i'?'forest':'morning',{
        author:clean(record.from_who)||'署名未提供',work:clean(record.from),quote:clean(record.hitokoto),year:'',
        url:'https://hitokoto.cn/?uuid='+encodeURIComponent(record.uuid),note:'一言 · '+(category==='h'?'影视短句':'文学摘句'),
        provider:'一言',recordId:record.uuid,verified:false,retrievedAt:stamp(),
        verificationNote:'正文及署名来自一言，尚未逐条核对原作。'+(!clean(record.from_who)?'此条来源没有提供作者或角色署名。':'')
      },category==='h'?'movie':'literature');
    });hitokotoQueue=request;return request;
  }
  function lyricExcerpt(record,index){
    const text=clean(record.plainLyrics)||clean(record.syncedLyrics).replace(/\[[^\]]*\]/g,'');
    const lines=text.split(/\r?\n/).map(clean).filter(line=>line.length>=5&&line.length<=65&&!/^\[|^(作词|作曲|编曲|制作|词|曲|演唱|歌手|专辑|Lyrics|Composer|Producer|Written|Singer)\s*[:：]/i.test(line));
    const contentLines=lines.filter(line=>line!==clean(record.trackName)&&line!==clean(record.artistName)&&!/^.+\s[-–—]\s.+$/.test(line)&&!/(?:歌词制作|歌词编辑|lrc|https?:|www\.|QQ[:：])/i.test(line));
    const chinese=contentLines.filter(line=>/[\u3400-\u9fff]/.test(line));
    const candidates=chinese.length?chinese:contentLines;
    return candidates.length?candidates[index%candidates.length]:'';
  }
  async function lyrics(cursor){
    // Starter discovery queries, not a personalised or model-generated ranking.
    const queries=['晴天','旅行','夜曲','平凡之路','Yellow'];
    const records=await json('/api/lyrics?'+new URLSearchParams({track_name:queries[cursor%queries.length]}));
    if(!Array.isArray(records))throw new Error('Invalid lyrics response');
    const available=records.filter(record=>Number.isInteger(record.id)&&!record.instrumental&&clean(record.trackName)&&clean(record.artistName)&&lyricExcerpt(record,cursor));
    if(!available.length)throw new Error('No lyrics found');
    const record=available[cursor%available.length],quote=lyricExcerpt(record,cursor);
    return item('lrclib-'+record.id+'-'+Array.from(quote).reduce((hash,ch)=>(hash*31+ch.codePointAt(0))>>>0,0).toString(36),'歌词','sea',{
      author:'演唱：'+clean(record.artistName),work:clean(record.trackName),quote,year:'',
      url:'https://lrclib.net/api/get/'+record.id,note:'LRCLIB · 歌词节选',provider:'LRCLIB',recordId:String(record.id),
      credits:'词作者：接口未提供'+(clean(record.albumName)?'；专辑：'+clean(record.albumName):''),
      verified:false,retrievedAt:stamp(),verificationNote:'歌手不等于词作者。此处保留接口中的歌手信息，歌词尚未逐句核对。'
    },'lyrics');
  }
  async function movie(cursor){
    if(!moviesPromise)moviesPromise=json('/data/movies.json').catch(error=>{moviesPromise=null;throw error});
    const corpus=await moviesPromise;
    if(!Array.isArray(corpus.items)||!corpus.items.length)throw new Error('Empty movie corpus');
    const record=corpus.items[cursor%corpus.items.length];
    return item('cornell-'+record.id,'电影','forest',{
      author:'角色：'+record.character,work:record.title,quote:record.quote,year:record.year,
      url:corpus.sourceUrl,note:'Cornell · 英文电影对白',provider:'Cornell Movie-Dialogs Corpus',
      recordId:record.movieId+' / '+record.id,credits:'编剧：语料未提供；对白角色：'+record.character,
      verified:false,retrievedAt:stamp(),verificationNote:'摘自电影剧本语料，保留英文原句；未核对最终上映版字幕。角色名称不是编剧署名。'
    },'movie');
  }
  return {async load({kind,cursor,onUpdate}){
    if(kind==='reading')return demoProvider.load({kind,cursor});
    const batch=Number.isFinite(Number(cursor))?Number(cursor):0;
    // The server selects a stable set of 30 each Shanghai calendar day.
    // Reopening the app must not trigger a slow model call or rotate six cards.
    const response=await json('/api/inspiration/library');
    const items=(response.items||[]).filter(s=>s.source?.quote?.length<=70&&((['literary-prose-v1','requested-literary-v1'].includes(s.editorialPolicy)&&s.source.readingId&&s.source.verified)||(s.editorialPolicy==='original-literary-v1'&&s.contentKind==='original'&&!s.source.verified&&s.source.work==='AI \u539f\u521b')));
    const illustrated=window.xingzouImages?window.xingzouImages.assign(items):items;
    onUpdate?.({items:illustrated,status:response.status||'文学摘句'});
    return {items:illustrated,nextCursor:batch+1,status:response.status||'文学摘句'};
  }};
}

// Match public content against reviewed, locally hosted photographs.
// Every inspiration keeps a photo, including when matching or network loading fails.
window.xingzouImages=(()=>{
 const words={music:['音乐','歌声','旋律','唱片','music','song','melody'],forest:['森林','树林','树','林间','forest','woods','tree'],sea:['海','波浪','潮','ocean','sea','coast','beach'],rain:['雨','雨滴','rain'],books:['书','阅读','读书','book','library'],window:['窗','window'],street:['街','巷','城市','street','city','alley'],journey:['旅行','旅途','路','车站','火车','train','road','journey','path'],grass:['草','草叶','草地','grass'],flowers:['花','桃','flower','bloom'],mountain:['山','原野','mountain','hill'],sky:['天空','云','月','光','黄昏','日落','星','sky','sun','moon','cloud','light'],water:['河','湖','溪','池','水','river','lake','water'],stilllife:['咖啡','茶','书桌','笔记','coffee','desk','notebook','tea']};
 const stableHash=s=>Array.from(s).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
 let assets=[],recent=[];
 try{recent=JSON.parse(sessionStorage.getItem('xingzou-photo-recent')||'[]')}catch{}
 const safe=r=>r&&/^(ov|ps|cma|px|gh)-[a-z0-9-]+$/.test(r.id)&&r.url==='/media/library/'+r.id+'.jpg'&&Array.isArray(r.tags)&&/^https:\/\//.test(r.sourceUrl)&&/^https:\/\//.test(r.licenseUrl);
 const set=rows=>{assets=Array.isArray(rows)?rows.filter(safe):[]};
 function assign(items){
  const used=new Set();
  const result=items.map(item=>{
   const text=[item.source?.quote,item.source?.work,item.title,item.intro].filter(Boolean).join(' ').toLowerCase();
   const tags=Object.keys(words).filter(t=>words[t].some(w=>/^[a-z]+$/.test(w)?new RegExp('\\b'+w+'\\b','i').test(text):text.includes(w)));
   const hash=Array.from(item.id).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
   const scored=assets.filter(a=>!used.has(a.id)).map(a=>({a,score:a.tags.reduce((n,t)=>n+(tags.includes(t)?1:0),0)})).filter(x=>x.score>0);
   scored.sort((a,b)=>b.score-a.score||Number(recent.includes(a.a.id))-Number(recent.includes(b.a.id))||stableHash(item.id+'|'+a.a.id)-stableHash(item.id+'|'+b.a.id));
   const pool=assets.filter(a=>!used.has(a.id));const photo=assets.find(a=>a.id===item.coverId)||scored[0]?.a||pool[hash%pool.length]||assets[hash%assets.length]||fallback(item);
   if(photo){used.add(photo.id);recent.push(photo.id)}
   return {...item,photo};
  });
  recent=recent.slice(-12);try{sessionStorage.setItem('xingzou-photo-recent',JSON.stringify(recent))}catch{}
  return result;
 }
 function fallback(item){const name=['forest','sea','morning'][stableHash(item.id||'')%3];return {id:'bundled-'+name,url:'/assets/'+name+'.jpg',alt:'自然主题摄影',sourceUrl:'',licenseUrl:'',creator:'',license:''}}
 function photo(item){return safe(item.photo)&&assets.some(a=>a.id===item.photo.id)?item.photo:cover(item)||fallback(item)}
 document.addEventListener('error',event=>{const img=event.target;if(!(img instanceof HTMLImageElement)||img.dataset.library===undefined)return;const attempts=Number(img.dataset.retries||0);img.dataset.retries=String(attempts+1);if(attempts<2&&assets.length){img.src=assets[(stableHash(img.alt||'')+attempts)%assets.length].url}else if(attempts<3){img.src='/assets/forest.jpg'}},true);
 function cover(item){
  const explicit=assets.find(a=>a.id===item.coverId);if(explicit)return explicit;
  const title=(item.title||'').toLowerCase(),intro=(item.intro||'').toLowerCase(),body=(item.content||item.body?.join(' ')||'').slice(0,10000).toLowerCase();
  const scores={};Object.entries(words).forEach(([tag,terms])=>{scores[tag]=terms.reduce((sum,w)=>sum+(title.includes(w)?12:0)+(intro.includes(w)?4:0)+(body.includes(w)?2:0),0)+(item.coverTags?.includes(tag)&&tag!=='books'?1:0)});
  const hash=Array.from(item.id||item.title||'').reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);
  const ranked=assets.map(a=>({a,score:Math.max(...a.tags.map(t=>scores[t]||0))})).filter(r=>r.score>0);
  ranked.sort((a,b)=>b.score-a.score||a.a.id.localeCompare(b.a.id));
  const best=ranked.filter(r=>r.score===ranked[0]?.score);
  if(best.length)return best[hash%best.length].a;
  const pool=assets.filter(a=>a.tags.some(t=>['forest','water','mountain','flowers','sky','stilllife','books','street'].includes(t)));return pool.length?pool[hash%pool.length]:assets[hash%assets.length]||null;
 }
 return {set,assign,photo,cover};
})();

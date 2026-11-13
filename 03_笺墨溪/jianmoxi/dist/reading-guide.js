/* Reading companionship stays separate from the full library and long-term preferences. */
(()=>{
 const style=document.createElement('link');style.rel='stylesheet';style.href='/reading-guide.css?v=20261104-1';document.head.append(style);
 let selection=null,loadedDay='',loading=false,error='',name='小溪',epoch=0;
 const originalView=readingView,originalResults=libraryResults;
 function signals(){let mood='',positions={};try{const d=JSON.parse(localStorage.getItem((window.xingzouCloud?.storageKey('jianmoxi-today-v1')||'jianmoxi-today-v1'))||'{}');if(typeof d.day==='string'&&d.day.split('-').map(Number).join('-')===dayKey().split('-').map(Number).join('-'))mood=d.mood||'';positions=JSON.parse(localStorage.getItem((window.xingzouCloud?.storageKey('jianmoxi-reading-positions')||'jianmoxi-reading-positions'))||'{}')}catch{}return {mood:['平静','愉快','期待','想念','低落','疲惫'].includes(mood)?mood:'',recentIds:Object.entries(positions).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,8).map(([id])=>id)}}
 function quoteHTML(){const q=selection?.quote;return q?`<button type="button" class="reading-quote-link" data-reading-quote aria-label="讨论这句或打开原文"><blockquote>${esc(q.quote)}</blockquote><cite>${esc(q.author)} ·《${esc(q.title)}》</cite></button>`:''}
 function updateHeader(){const node=document.querySelector('#reading-muse-quote');if(node)node.innerHTML=quoteHTML();document.querySelectorAll('[data-reading-guide]').forEach(b=>{b.textContent=name+'荐读';b.setAttribute('aria-busy',String(loading))})}
 function accept(value,activate=false){if(!value)return;epoch++;selection=value;name=value.name||name;loadedDay=value.day||dayKey();loading=false;error='';if(activate){clearTimeout(librarySearchTimer);libraryState.request++;Object.assign(libraryState,{view:'recommendations',q:'',genre:'',author:'',collection:'',saved:false,loading:false,error:''});if(page==='reading')renderLibrary()}updateHeader()}
 async function load(force=false){if(loading)return false;if(selection?.day===dayKey()&&!force)return true;const run=++epoch;loading=true;error='';updateHeader();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
  try{const r=await fetch('/api/reading/recommendation',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...signals(),refresh:force}),signal:controller.signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'荐读暂时不可用');if(run!==epoch)return !!selection;accept(d.recommendation);if(!selection)throw new Error('暂时没能选好作品');return true}
  catch(e){if(run===epoch){error=e.name==='AbortError'?'荐读稍慢，稍后可以再试':e.message;loadedDay=dayKey()}return false}
  finally{clearTimeout(timer);if(run===epoch){loading=false;updateHeader()}}
 }
 readingView=function(){const box=document.createElement('div');box.innerHTML=originalView();box.querySelector('#reading-daily-quote')?.remove();const header=box.querySelector('.compact-heading'),tools=box.querySelector('.compact-library-filters .collection-tools');header.classList.add('reading-room-heading');const actions=document.createElement('div');actions.className='reading-room-actions';actions.innerHTML=`<button class="reading-guide-entry" type="button" data-reading-guide aria-busy="${loading}">${esc(name)}荐读</button>`;if(tools)while(tools.firstChild)actions.append(tools.firstChild);tools?.remove();header.append(actions);const quote=document.createElement('div');quote.id='reading-muse-quote';quote.className='reading-muse-quote';quote.innerHTML=quoteHTML();header.after(quote);if(loadedDay!==dayKey()&&!loading){loadedDay=dayKey();queueMicrotask(()=>load())}return `<section class="reading-room">${box.innerHTML}</section>`};
 libraryResults=function(){
  const s=libraryState;
  if(s.view==='recommendations'&&selection){const previous={view:s.view,result:s.result,q:s.q,genre:s.genre,collection:s.collection,saved:s.saved,error:s.error,author:s.author,loading:s.loading};let html;
   try{Object.assign(s,{view:'works',q:'',genre:'',collection:'',author:'',saved:false,error:'',loading:false,result:{items:selection.books,total:selection.books.length,page:1,pages:1}});html=originalResults()}finally{Object.assign(s,previous)}
   const box=document.createElement('div');box.innerHTML=html;box.querySelector('.library-section-title').innerHTML=`<h2>${esc(name)}为你选的</h2><div class="reading-selection-tools"><button type="button" class="text-btn" data-reading-guide-chat>聊聊偏好</button><button type="button" class="text-btn" data-reading-all>全部书库</button></div>`;return box.innerHTML;
  }
  const box=document.createElement('div');box.innerHTML=originalResults();if(s.view==='works'&&!s.q&&!s.genre&&!s.author&&!s.collection&&!s.saved){box.querySelector('.library-section-title h2')?.remove();box.querySelector('.library-section-title')?.classList.add('reading-count-only')}return box.innerHTML;
 };
 function chat(quote=false){const q=selection?.quote;const ctx={label:quote&&q?'阅读 · '+q.title:name+'荐读',page:'reading',...signals()};if(quote&&q)Object.assign(ctx,{readingId:q.workId,chapter:q.chapter,readingSelection:{workId:q.workId,chapter:q.chapter,text:q.quote}});return openAssistant(ctx)}
 document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-reading-guide')){e.preventDefault();if(!selection||selection.day!==dayKey()){if(loading)return toast('小溪正在选书，书库可以先看');if(!await load())return toast(error||'暂时没能完成荐读')}accept(selection,true)}
  if(b.hasAttribute('data-reading-all')){Object.assign(libraryState,{view:'works',q:'',genre:'',author:'',collection:'',saved:false,page:1});loadLibrary()}
  if(b.hasAttribute('data-reading-guide-chat'))chat(false);
  if(b.hasAttribute('data-reading-quote')){const q=selection?.quote;if(!q)return;modal(`<h2>读到这一句</h2><blockquote class="reading-quote-detail">${esc(q.quote)}</blockquote><p>${esc(q.author)} ·《${esc(q.title)}》${q.chapterTitle?' · '+esc(q.chapterTitle):''}</p><p>${esc(selection.reason)}</p><div class="actions"><button type="button" class="secondary" data-reading-quote-chat>和${esc(name)}聊聊</button><button type="button" class="primary" data-reading-quote-open>读原文</button></div>`)}
  if(b.hasAttribute('data-reading-quote-chat'))chat(true);
  if(b.hasAttribute('data-reading-quote-open'))openCitedPassage(selection.quote).catch(e=>toast(e.message));
 });
 document.addEventListener('companion-profile-updated',()=>{name=companionSettings?.profile?.name||name;updateHeader()});
 window.xingzouReadingGuide={accept,load};
 if(page==='reading')render();
})();

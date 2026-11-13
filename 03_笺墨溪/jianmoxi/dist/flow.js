/* One navigation pattern per surface: swipe cards, continuous library, explicit chapter jumps. */
(() => {
 const css=document.createElement('link');css.rel='stylesheet';css.href='/flow.css?v=20261104-1';document.head.append(css);
 let daily=null;const stamp=()=>dayKey(),quoteKey=(window.xingzouCloud?.storageKey('jianmoxi-reading-quote')||'jianmoxi-reading-quote');
 try{const d=JSON.parse(localStorage.getItem(quoteKey)||'null');if(d?.day===stamp()&&['quote','author','work'].every(k=>typeof d[k]==='string'&&d[k].trim())&&d.quote.length<=60)daily=d}catch{}
 function quoteHTML(){
  if(daily?.day!==stamp())daily=null;
  if(!daily){const pool=seeds.filter(s=>s.source?.quote&&s.source.quote.length<=60&&s.source.author&&s.source.work);const books=pool.filter(s=>s.readingId||s.source.readingId);const candidates=books.length?books:pool;if(candidates.length){const hash=[...stamp()].reduce((a,c)=>a+c.charCodeAt(0),0);const source=candidates[hash%candidates.length].source;daily={day:stamp(),quote:source.quote,author:source.author,work:source.work};try{localStorage.setItem(quoteKey,JSON.stringify(daily))}catch{}}}
  return daily?`<blockquote>${esc(daily.quote)}</blockquote><cite>${esc(daily.author)} ·《${esc(daily.work)}》</cite>`:'';
 }
 const oldReading=readingView,oldArticles=articlesView,oldRefresh=refreshFeed;
 readingView=function(){const box=document.createElement('div');box.innerHTML=oldReading();const heading=box.querySelector('.compact-heading'),search=heading.querySelector('.library-search');heading.after(search);search.classList.add('slim-search');const quote=document.createElement('div');quote.id='reading-daily-quote';quote.className='reading-daily-quote';quote.innerHTML=quoteHTML();heading.append(quote);return box.innerHTML};
 articlesView=function(){const box=document.createElement('div');box.innerHTML=oldArticles();const heading=box.querySelector('.compact-heading'),search=heading.querySelector('.article-search');heading.after(search);search.classList.add('slim-search');return box.innerHTML};
 refreshFeed=async function(kind){const result=await oldRefresh(kind);const slot=document.querySelector('#reading-daily-quote');if(slot)slot.innerHTML=quoteHTML();return result};
 // The initial feed may already be in flight when this module is loaded.
 let quoteAttempts=0;function updateQuote(){const slot=document.querySelector('#reading-daily-quote');if(slot&&!slot.textContent.trim())slot.innerHTML=quoteHTML();if(!daily&&quoteAttempts++<15)setTimeout(updateQuote,2000)}updateQuote();
 // Keep only the chapter-end navigation; scrolling a chapter is not changing chapters.
 const reader=renderWork,uploaded=renderUploadedBook;
 function tidyReader(){const controls=document.querySelectorAll('.reader .chapter-navigation');if(controls.length>1)controls[0].remove();const top=document.querySelector('.reader-toolbar [data-fav]');if(top)document.querySelector('.reader-actions [data-fav]')?.remove()}
 renderWork=function(){reader();tidyReader()};renderUploadedBook=function(r){uploaded(r);tidyReader()};
 // Accumulate library pages without replacing the search input or resetting scroll.
 let running=null,errorBase=null,errorMessage='';
 const oldResults=libraryResults;
 libraryResults=function(){const box=document.createElement('div');box.innerHTML=oldResults();box.querySelector('.library-pager')?.remove();const r=libraryState.result;if(!libraryState.error&&r&&libraryState.view==='works'&&r.page<r.pages){const more=document.createElement('div');more.className='library-continuation';more.dataset.libraryContinue='';more.setAttribute('role','status');more.innerHTML=errorBase===r?`<span>${esc(errorMessage)}</span><button type="button" class="text-btn" data-library-continue-retry>重试</button>`:'继续向下浏览';box.append(more)}return box.innerHTML};
 function identity(){const s=libraryState;return JSON.stringify([s.q,s.genre,s.author,s.collection,s.saved,s.view,s.request])}
 async function more(){
  const s=libraryState,base=s.result,token=identity();if(page!=='reading'||s.loading||s.error||!base||base.page>=base.pages||s.view!=='works'||errorBase===base||running?.token===token)return;
  const run={token};running=run;const node=document.querySelector('[data-library-continue]');if(node)node.textContent='正在加载…';
  const params=new URLSearchParams({q:s.q,genre:s.genre,author:s.author,collection:s.collection,page:base.page+1,limit:12});if(s.saved)params.set('favorites','1');
  try{const next=await libraryJSON('/api/library?'+params);if(page!=='reading'||identity()!==token||s.result!==base)return;const ids=new Set(base.items.map(x=>x.id));s.result={...next,items:[...base.items,...next.items.filter(x=>!ids.has(x.id))]};errorBase=null;errorMessage='';const region=document.querySelector('#library-results');if(region)region.innerHTML=libraryResults()}
  catch(e){if(identity()!==token||s.result!==base||page!=='reading')return;errorBase=base;errorMessage='暂时没能加载后续作品';const region=document.querySelector('#library-results');if(region)region.innerHTML=libraryResults()}
  finally{if(running===run)running=null}
 }
 let watched=null;
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))more()},{rootMargin:'0px 0px 160px 0px'}):null;
 function observe(){const node=document.querySelector('[data-library-continue]');if(node===watched)return;observer?.disconnect();watched=node;if(node)observer?.observe(node)}
 const changes=new MutationObserver(observe);changes.observe(document.querySelector('#main'),{childList:true,subtree:true});observe();
 if(!observer)window.addEventListener('scroll',()=>{const n=document.querySelector('[data-library-continue]');if(n&&n.getBoundingClientRect().top<innerHeight+160)more()},{passive:true});
 document.addEventListener('click',e=>{if(e.target.closest('[data-library-continue-retry]')){errorBase=null;more()}});
 document.addEventListener('keydown',e=>{const rail=e.target.closest('.notebook-focus .fragment-grid');if(!rail||e.target!==rail||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();rail.scrollBy({left:rail.clientWidth*(e.key==='ArrowRight'?1:-1),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})});
 if(page!=='editor'&&page!=='reader')render();
})();

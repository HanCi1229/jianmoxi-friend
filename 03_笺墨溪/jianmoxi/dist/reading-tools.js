/* Keep a copy of the selected passage before an action changes focus. */
const readerToolsCSS=document.createElement('link');readerToolsCSS.rel='stylesheet';readerToolsCSS.href='/reading-tools.css?v=20261103-popover';document.head.append(readerToolsCSS);
const passageBar=document.createElement('div');passageBar.className='passage-tools';passageBar.hidden=true;passageBar.setAttribute('role','toolbar');passageBar.setAttribute('aria-label','选中文字操作');
const passageIcons={interpret:'M4 5h6c2 0 2 2 2 2s0-2 2-2h6v14h-6c-2 0-2 2-2 2s0-2-2-2H4ZM12 7v14',excerpt:'M6 3h12v18l-6-4-6 4Z',copy:'M9 9h12v12H9ZM15 9V3H3v12h6',associate:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',discuss:'M4 4h16v12H9l-5 4Z'};
passageBar.innerHTML=[['interpret','AI 解读'],['excerpt','摘录'],['copy','复制'],['associate','AI 联想'],['discuss','讨论']].map(([k,v],i)=>`<button type="button" tabindex="${i?-1:0}" data-passage-action="${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${passageIcons[k]}"/></svg><span>${v}</span></button>`).join('');document.body.append(passageBar);
let selectedPassage=null,selectionTimer,passageRun=null,excerptItems=[],passageHideTimer,passageFrame,passageSelecting=false,passageDismissed='',passageVersion=0;
function hidePassageTools(){
 clearTimeout(selectionTimer);cancelAnimationFrame(passageFrame);passageVersion++;
 passageBar.classList.remove('is-visible');passageBar.setAttribute('aria-hidden','true');passageBar.inert=true;document.body.classList.remove('has-passage-selection');
 clearTimeout(passageHideTimer);passageHideTimer=setTimeout(()=>{passageBar.hidden=true},140);
}
// Pure geometry: prefer outside the selection; for a screen-long passage use its active end.
function passagePlacement(rects,focus,viewport,width,height){
 const gap=16,leftEdge=viewport.left+10,rightEdge=viewport.right-10,topEdge=viewport.top+10,bottomEdge=viewport.bottom-10;
 const visible=rects.filter(r=>r.width>0&&r.height>0&&r.bottom>topEdge&&r.top<bottomEdge&&r.right>leftEdge&&r.left<rightEdge);
 if(!visible.length||width>rightEdge-leftEdge||height>bottomEdge-topEdge)return null;
 const first=visible[0],last=visible[visible.length-1];
 let anchor=last,side='below',top=last.bottom+gap;
 if(top+height>bottomEdge){
  anchor=first;side='above';top=first.top-height-gap;
  if(top<topEdge){
   anchor=visible.reduce((best,r)=>Math.abs((r.top+r.bottom)/2-focus.y)<Math.abs((best.top+best.bottom)/2-focus.y)?r:best,first);
   side=anchor.bottom+gap+height<=bottomEdge?'below':'above';
   top=side==='above'?anchor.top-height-gap:anchor.bottom+gap;
  }
 }
 top=Math.max(topEdge,Math.min(top,bottomEdge-height));
 const anchorX=Math.max(anchor.left,Math.min(focus.x,anchor.right));
 const left=Math.max(leftEdge,Math.min(anchorX-width/2,rightEdge-width));
 return {left,top,side,arrow:Math.max(18,Math.min(anchorX-left,width-18))};
}
function passageViewport(){
 const v=window.visualViewport,box={left:v?.offsetLeft||0,top:v?.offsetTop||0,right:(v?.offsetLeft||0)+(v?.width||innerWidth),bottom:(v?.offsetTop||0)+(v?.height||innerHeight)};
 const nav=document.querySelector('.mobile-nav');if(nav&&getComputedStyle(nav).display!=='none'){const r=nav.getBoundingClientRect();if(r.top>box.top&&r.bottom>=box.bottom-2)box.bottom=Math.min(box.bottom,r.top)}
 return box;
}
function passageSelectionKey(s){return [s.workId,s.chapter,s.text].join('\u0000')}
function capturePassage(){
 if(passageSelecting||page!=='reader'||!openedWork||document.querySelector('#dialog').open||document.body.classList.contains('assistant-open'))return hidePassageTools();
 const selection=window.getSelection(),prose=document.querySelector('.library-reader .prose');
 if(!selection?.rangeCount||selection.isCollapsed||!prose?.contains(selection.anchorNode)||!prose.contains(selection.focusNode))return hidePassageTools();
 const text=selection.toString().trim();if(!text)return hidePassageTools();
 const passage={workId:openedWork.id,title:openedWork.title,author:openedWork.author,chapter:readerChapter,text};
 if(passageDismissed===passageSelectionKey(passage))return hidePassageTools();
 const range=selection.getRangeAt(0),rects=Array.from(range.getClientRects());
 const caret=document.createRange();caret.setStart(selection.focusNode,selection.focusOffset);caret.collapse(true);
 const caretRect=caret.getClientRects()[0],backward=selection.focusNode===range.startContainer&&selection.focusOffset===range.startOffset,end=backward?rects[0]:rects[rects.length-1];if(!end)return hidePassageTools();
 const focus={x:caretRect?.left??(backward?end.left:end.right),y:caretRect?((caretRect.top+caretRect.bottom)/2):(end.top+end.bottom)/2};
 const viewport=passageViewport();passageBar.style.maxWidth=Math.max(0,viewport.right-viewport.left-20)+'px';
 clearTimeout(passageHideTimer);passageBar.hidden=false;
 const position=passagePlacement(rects,focus,viewport,passageBar.offsetWidth,passageBar.offsetHeight);
 if(!position)return hidePassageTools();
 selectedPassage=passage;passageBar.style.left=position.left+'px';passageBar.style.top=position.top+'px';passageBar.style.setProperty('--passage-arrow',position.arrow+'px');passageBar.dataset.side=position.side;
 passageBar.removeAttribute('aria-hidden');passageBar.inert=false;document.body.classList.add('has-passage-selection');
 const version=++passageVersion;requestAnimationFrame(()=>{if(version===passageVersion)passageBar.classList.add('is-visible')});
}
function queuePassageCapture(delay=180){clearTimeout(selectionTimer);selectionTimer=setTimeout(capturePassage,delay)}
document.addEventListener('selectionchange',()=>{if(!passageBar.contains(document.activeElement)){hidePassageTools();queuePassageCapture()}});
document.addEventListener('pointerdown',e=>{
 if(passageBar.contains(e.target))return;
 passageSelecting=!!e.target.closest?.('.library-reader .prose');
 passageDismissed=passageSelecting?'':selectedPassage?passageSelectionKey(selectedPassage):'';
 hidePassageTools();
},true);
document.addEventListener('pointerup',e=>{passageSelecting=false;if(!passageBar.contains(e.target))queuePassageCapture(220)});
document.addEventListener('pointercancel',()=>{passageSelecting=false;queuePassageCapture(220)});
passageBar.addEventListener('pointerdown',e=>e.preventDefault());
passageBar.addEventListener('keydown',e=>{
 const buttons=Array.from(passageBar.querySelectorAll('button')),at=buttons.indexOf(document.activeElement);
 if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.tabIndex=i===next?0:-1);buttons[next].focus()}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!passageBar.hidden){passageDismissed=selectedPassage?passageSelectionKey(selectedPassage):'';hidePassageTools()}});
function repositionPassage(){cancelAnimationFrame(passageFrame);passageFrame=requestAnimationFrame(()=>{if(!passageSelecting)capturePassage()})}
window.addEventListener('scroll',repositionPassage,{passive:true});window.addEventListener('resize',repositionPassage,{passive:true});
readerToolsCSS.addEventListener('load',repositionPassage);
window.visualViewport?.addEventListener('resize',repositionPassage,{passive:true});window.visualViewport?.addEventListener('scroll',repositionPassage,{passive:true});
window.addEventListener('hashchange',()=>{passageDismissed='';passageSelecting=false;hidePassageTools()});
new MutationObserver(()=>{passageDismissed='';hidePassageTools()}).observe(document.querySelector('#main'),{childList:true});
async function passageAPI(url,body,method='POST',signal){const r=await fetch(url,{credentials:'same-origin',...(body!==undefined?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'暂时无法完成，请重试');return d}
function passageQuote(s){return `<blockquote class="passage-quote">${esc(s.text)}</blockquote><p class="passage-attribution">${esc(s.author)} ·《${esc(s.title)}》${s.chapterTitle?' · '+esc(s.chapterTitle):''}</p>`}
async function copyPassage(s){try{await navigator.clipboard.writeText(s.text);toast('已复制选中文字')}catch{const el=document.createElement('textarea');el.value=s.text;el.style.position='fixed';el.style.opacity='0';(document.querySelector('#dialog').open?document.querySelector('#dialog-body'):document.body).append(el);el.select();const copied=document.execCommand('copy');el.remove();toast(copied?'已复制选中文字':'复制失败，请使用系统复制菜单')}}
async function savePassage(s){try{await passageAPI('/api/excerpts',s);toast('已保存到我的摘录')}catch(e){toast(e.message)}}
async function discussPassage(s,articleId){if(assistantBusy)return toast('AI 正在回复，稍后再讨论这段文字');hidePassageTools();window.getSelection()?.removeAllRanges();await openAssistant({label:'讨论 · '+s.title,readingId:s.workId,readingSelection:{workId:s.workId,text:s.text,chapter:s.chapter},...(articleId?{articleId}:{})});await sendAssistant('一起讨论我选中的这段文字：它表达了怎样的情感，又有哪些值得细读的地方？')}
function passageDrafts(){return articles.filter(a=>a.content?.trim())}
function showPassageAI(s,mode){
 hidePassageTools();const drafts=passageDrafts(),preferred=drafts.find(a=>a.id===currentId)||drafts.find(a=>a.status==='draft')||drafts[0];
 modal(`<span class="eyebrow">${mode==='associate'?'让阅读，走进写作':'细读这一段'}</span><h2>${mode==='associate'?'AI 联想':'AI 解读'}</h2>${passageQuote(s)}${mode==='associate'?`<div class="passage-draft"><label for="passage-article">结合哪篇文稿</label>${drafts.length?`<select id="passage-article">${drafts.map(a=>`<option value="${esc(a.id)}" ${a.id===preferred?.id?'selected':''}>${esc(a.title||'未命名文章')}${a.id===currentId?' · 当前在写':''}</option>`).join('')}</select>`:'<p>先写下一点正文，AI 才能结合你的文字提出建议。</p><button class="secondary" data-action="new">开始写作</button>'}</div>`:''}<div id="passage-ai-result" aria-live="polite"></div><div class="passage-result-actions"><button class="secondary" data-passage-modal="excerpt">${icon('bookmark')}摘录</button><button class="secondary" data-passage-modal="discuss">${icon('chat')}继续讨论</button></div>`);
 const modalNode=document.querySelector('#dialog-body');modalNode.querySelectorAll('[data-passage-modal]').forEach(b=>b.onclick=()=>b.dataset.passageModal==='excerpt'?savePassage(s):discussPassage(s,document.querySelector('#passage-article')?.value));
 const select=modalNode.querySelector('#passage-article');select?.addEventListener('change',()=>runPassageAI(s,mode,select.value));
 if(mode==='interpret'||preferred)runPassageAI(s,mode,preferred?.id);
}
async function runPassageAI(s,mode,articleId){
 passageRun?.abort();const control=new AbortController();passageRun=control;const box=document.querySelector('#passage-ai-result');if(!box)return;
 box.innerHTML=`<div class="passage-loading" role="status">${mode==='associate'?'正在对照你的文稿，寻找可以接上的地方…':'正在细读这段文字…'}</div>`;const timer=setTimeout(()=>control.abort('timeout'),70000);
 try{
  if(mode==='associate'){saveEditor();await window.xingzouCloud.flush();if(!window.xingzouCloud.isSynced)throw new Error('文稿正在同步，请稍后重试')}
  const r=await passageAPI('/api/reading/assist',{...s,mode,articleId},'POST',control.signal);if(control.signal.aborted||passageRun!==control||!box.isConnected)return;
  box.innerHTML=`<section class="passage-insight"><h3>${esc(r.summary)}</h3><div>${esc(r.interpretation).replaceAll('\n','<br>')}</div>${r.connections?.length?`<div class="passage-connections"><h4>可以这样接入</h4>${r.connections.map(c=>`<article><blockquote>${esc(c.anchor)}</blockquote><p>${esc(c.suggestion)}</p></article>`).join('')}</div>`:''}<p class="passage-hint"><span>${mode==='associate'?'落笔提醒':'写作启发'}</span>${esc(r.writingHint)}</p></section>`;
 }catch(e){if(box.isConnected&&passageRun===control&&(!control.signal.aborted||control.signal.reason==='timeout')){box.innerHTML=`<p class="reader-ai-error">${esc(e.name==='AbortError'||control.signal.reason==='timeout'?'等待超时，请重试':e.message)}</p><button class="secondary" data-passage-retry>重试</button>`;box.querySelector('button').onclick=()=>runPassageAI(s,mode,articleId)}}finally{clearTimeout(timer);if(passageRun===control)passageRun=null}
}
document.querySelector('#dialog').addEventListener('close',()=>{passageRun?.abort();passageRun=null});
passageBar.addEventListener('click',e=>{const action=e.target.closest('button')?.dataset.passageAction,s=selectedPassage?{...selectedPassage}:null;if(!action||!s)return;if(s.text.length>3000&&action!=='copy')return toast('这段较长，请选取 3000 字以内的文字');passageDismissed=passageSelectionKey(s);hidePassageTools();if(action==='copy')return copyPassage(s);if(action==='excerpt')return savePassage(s);if(action==='discuss')return discussPassage(s);showPassageAI(s,action)});
function drawExcerpts(){const box=document.querySelector('#excerpt-list');if(!box)return;const q=document.querySelector('#excerpt-search')?.value.trim().toLowerCase()||'';const matches=excerptItems.filter(s=>(s.text+' '+s.title+' '+s.author).toLowerCase().includes(q));box.innerHTML=matches.length?matches.map(s=>`<article class="excerpt-note">${passageQuote(s)}<div class="excerpt-actions"><button data-excerpt="read" data-id="${s.id}">回到原文</button><button data-excerpt="interpret" data-id="${s.id}">AI 解读</button><button data-excerpt="associate" data-id="${s.id}">AI 联想</button><button data-excerpt="copy" data-id="${s.id}">复制</button><button data-excerpt="discuss" data-id="${s.id}">讨论</button><button data-excerpt="remove" data-id="${s.id}" aria-label="删除这条摘录">删除</button></div></article>`).join(''):`<div class="empty"><p>${q?'没有找到相关摘录':'阅读时选中喜欢的一段，点“摘录”就会留在这里。'}</p></div>`}
async function showExcerpts(){modal('<span class="eyebrow">阅读留下的片刻</span><h2>我的摘录</h2><input id="excerpt-search" class="search" type="search" placeholder="搜索摘录、作品或作者" aria-label="搜索摘录"><div id="excerpt-list" aria-live="polite">正在打开摘录…</div>');const box=document.querySelector('#excerpt-list');document.querySelector('#excerpt-search').addEventListener('input',drawExcerpts);try{const d=await passageAPI('/api/excerpts');if(!box.isConnected)return;excerptItems=d.items;drawExcerpts()}catch(e){if(box.isConnected)box.innerHTML=`<p>${esc(e.message)}</p><button class="secondary" data-open-excerpts>重试</button>`}}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-open-inspiration-chat')){e.stopImmediatePropagation();return openAssistant({label:'聊聊灵感',page:'inspiration'})}
 if(b.hasAttribute('data-open-excerpts')){e.stopImmediatePropagation();return showExcerpts()}
 if(!b.dataset.excerpt)return;e.stopImmediatePropagation();const s=excerptItems.find(s=>s.id===b.dataset.id);if(!s)return;
 try{switch(b.dataset.excerpt){case 'copy':return copyPassage(s);case 'interpret':case 'associate':return showPassageAI(s,b.dataset.excerpt);case 'discuss':return discussPassage(s);case 'remove':await passageAPI('/api/excerpts/'+s.id,{},'DELETE');excerptItems=excerptItems.filter(x=>x.id!==s.id);drawExcerpts();return toast('已删除摘录');case 'read':closeModal();await showReading(s.workId);if(openedWork?.id===s.workId){readerChapter=s.chapter;renderWork();}break}}catch(error){toast(error.message)}
},true);
const journalWithReadingNotes=journalView;journalView=function(){return journalWithReadingNotes().replace('<div class="account-setting-grid">','<div class="account-setting-grid"><button data-open-excerpts><span>'+icon('pen')+'我的摘录</span><small>阅读留下的文字 ↗</small></button>')};
if(page==='journal')render();

// Native Android suppresses its floating menu only after these controls are ready.
function readingTouchTarget(event){const target=event.target instanceof Element?event.target:null;const inText=!!target?.closest('.library-reader .prose');try{window.XingzouReader?.setReady(true);window.XingzouReader?.setTextTarget(inText)}catch{}}
document.addEventListener('pointerdown',readingTouchTarget,{capture:true,passive:true});
document.addEventListener('touchstart',readingTouchTarget,{capture:true,passive:true});
try{window.XingzouReader?.setReady(true)}catch{}

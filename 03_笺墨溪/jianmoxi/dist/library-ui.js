const bookReaderCSS=document.createElement('link');bookReaderCSS.rel='stylesheet';bookReaderCSS.href='/book-reader.css?v=20261103';document.head.append(bookReaderCSS);
// A searchable cloud library. Lists contain metadata; full text loads on demand.
const libraryState={q:'',genre:'',author:'',collection:'',page:1,saved:false,view:'works',result:null,loading:false,error:'',request:0};
let librarySearchTimer,openedWork=null,readerChapter=0,readerRequest=0;
async function libraryJSON(url){const control=new AbortController(),timer=setTimeout(()=>control.abort(),25000);try{const r=await fetch(url,{credentials:'same-origin',signal:control.signal});const d=await r.json();if(!r.ok)throw new Error(d.error||'书库暂时无法连接');return d}finally{clearTimeout(timer)}}
function libraryLength(work){return work.chunked?`${work.characters>=10000?(work.characters/10000).toFixed(1)+' 万':work.characters}字 · ${work.chapterCount} ${work.format==='pdf'?'页':'章'}`:Math.max(1,Math.ceil(work.characters/400))+' 分钟'}
function coverFor(item){return window.xingzouImages?.cover(item)}
function bookTextCover(item,cls){return `<span class="${cls} book-text-cover" aria-label="《${esc(item.title)}》暂无封面"><strong>${esc(item.title)}</strong><small>${esc(item.author||'')}</small></span>`}
function libraryCover(item,cls='library-cover'){
 const c=item.bookCover;if(c?.url==='/api/library/'+item.id+'/cover')return `<img class="${cls} book-cover-real" src="${esc(c.url)}" alt="《${esc(item.title)}》书籍封面" loading="lazy" data-book-cover data-book-title="${esc(item.title)}" data-book-author="${esc(item.author)}">`;
 if(item.sourceKind==='upload')return bookTextCover(item,cls);
 const p=coverFor(item);return p?`<img class="${cls}" data-library src="${esc(p.url)}" alt="${esc(p.alt)}" loading="lazy">`:`<span class="${cls} book-letter" aria-hidden="true">${esc((item.title||'文').slice(0,1))}</span>`
}
document.addEventListener('error',event=>{const img=event.target;if(!(img instanceof HTMLImageElement)||!img.hasAttribute('data-book-cover'))return;const cover=document.createElement('span');cover.className='library-cover book-text-cover';const title=document.createElement('strong'),author=document.createElement('small');title.textContent=img.dataset.bookTitle;author.textContent=img.dataset.bookAuthor;cover.append(title,author);img.replaceWith(cover)},true);

function renderLibrary(){
 // Updating results must not detach an input being used by a phone's IME.
 if(document.activeElement?.id==='library-search'&&document.querySelector('#library-results')){
  document.querySelector('#library-results').innerHTML=libraryResults();return;
 }
 render();
}
async function loadLibrary(){
 const run=++libraryState.request;libraryState.loading=true;libraryState.error='';
 const params=new URLSearchParams({q:libraryState.q,genre:libraryState.genre,author:libraryState.author,collection:libraryState.collection,page:libraryState.page,limit:12});
 if(libraryState.saved)params.set('favorites','1');
 if(page==='reading')renderLibrary();
 try{if(libraryState.saved){await window.xingzouCloud.flush();if(!window.xingzouCloud.isSynced)throw new Error('收藏正在同步，请稍后重试')}const result=await libraryJSON('/api/library?'+params);if(run!==libraryState.request)return;libraryState.result=result;libraryState.page=result.page}
 catch(error){if(run!==libraryState.request)return;libraryState.error=error.name==='AbortError'?'连接超时，请重试':error.message}
 finally{if(run===libraryState.request){libraryState.loading=false;if(page==='reading')renderLibrary()}}
}
function libraryResults(){
 const s=libraryState,r=s.result;
 if(s.error)return `<div class="empty"><h2>暂时没能打开书库</h2><p>${esc(s.error)}</p><button class="secondary" data-library-retry>重新连接</button></div>`;
 if(!r)return '<div class="empty"><h2>正在打开书库</h2><p>一页一页，慢慢读。</p></div>';
 if(s.view==='collections')return `<div class="library-collections">${r.collections.map((c,i)=>`<button class="library-collection" data-library-collection="${esc(c.title)}">${libraryCover({id:c.title,title:c.title,coverTags:i%2?['books']:['forest']})}<div><span class="eyebrow">作品集</span><h2>${esc(c.title)}</h2><p>${esc(c.author.split(',').length>3?c.author.split(',').slice(0,2).join('、')+'等 '+c.author.split(',').length+' 位作者':c.author.replaceAll(',','、'))}</p><small>已收录 ${c.count} 部 →</small></div></button>`).join('')}</div>`;
 const heading=s.collection?`《${esc(s.collection)}》`:s.saved?'我的收藏':s.q?'搜索结果':s.author?esc(s.author)+'的作品':s.genre||'全部作品';
 return `<div class="library-section-title"><h2>${heading}</h2><span>${r.total} 部${s.loading?' · 正在更新':''}</span>${s.collection?'<button class="text-btn" data-library-reset-collection>返回书库</button>':''}</div><div class="library-grid" aria-label="阅读作品">${r.items.map(work=>`<article class="library-card"><button class="library-work" data-read="${esc(work.id)}">${libraryCover(work)}<div class="library-copy"><span class="eyebrow">${esc(work.genre)}${work.collection&&work.collection!==work.genre?' · '+esc(work.collection):''}</span><h2>${esc(work.title)}</h2><p>${esc(work.intro)}</p><small>${esc(work.author)} · ${libraryLength(work)}</small></div></button><button class="icon-btn library-save ${favs.includes(work.id)?'is-saved':''}" data-fav="${esc(work.id)}" aria-label="${favs.includes(work.id)?'取消收藏':'收藏'}《${esc(work.title)}》">${icon('bookmark')}</button></article>`).join('')}</div>${!r.items.length?'<div class="empty"><h2>这里还没有找到作品</h2><p>试试其他作者、分类或关键词。</p></div>':''}<div class="collection-pager library-pager"><span></span><div><button class="icon-btn" data-library-page="${r.page-1}" aria-label="上一页作品" ${r.page<=1||s.loading?'disabled':''}>←</button><span>${r.page} / ${r.pages}</span><button class="icon-btn" data-library-page="${r.page+1}" aria-label="下一页作品" ${r.page>=r.pages||s.loading?'disabled':''}>→</button></div></div>`;
}
readingView=function(){
 const s=libraryState,r=s.result;if(!r&&!s.loading&&!s.error){s.loading=true;queueMicrotask(loadLibrary)}
 return `<div class="collection-heading library-heading"><div><span class="eyebrow">THE READING ROOM</span><h1>阅读<span class="heading-word">在书页间，走远一点</span></h1><p>${r?`${r.libraryTotal} 部作品 · ${r.authors.length} 位作者`:'正在连接云端书库'}</p></div><div class="collection-tools"><button class="text-btn" data-open-excerpts>${icon('pen')}我的摘录</button><button class="text-btn" data-library-favorites>${icon('bookmark')}${s.saved?'返回书库':'我的收藏'}</button></div></div><div class="library-search-row"><label class="library-search">${icon('search')}<input type="search" class="search" id="library-search" value="${esc(s.q)}" aria-label="搜索书库" placeholder="搜索作品、作者或正文"></label></div><div class="library-tabs" role="group" aria-label="阅读体裁"><button class="${!s.genre&&s.view==='works'?'active':''}" data-library-genre="">全部</button>${['网络小说','小说','散文','诗歌','古文','人文社科','戏剧'].filter(g=>(r?.genres||[]).some(x=>x.name===g)).map(g=>`<button class="${s.genre===g&&s.view==='works'?'active':''}" data-library-genre="${g}">${g}</button>`).join('')}<button class="${s.view==='collections'?'active':''}" data-library-collections>作品集</button></div><section id="library-results" aria-live="polite">${libraryResults()}</section>`;
};
// Uploaded books load one chapter at a time; existing short-form works retain their reader.
let bookLoadSequence=0;
async function loadBookChapter(r,index){
 const run=++bookLoadSequence;r.loadingChapter=index;r.chapterError='';renderUploadedBook(r);
 try{const c=await libraryJSON('/api/library/'+r.id+'/chapters/'+index);if(run!==bookLoadSequence||openedWork!==r||page!=='reader')return;r.bookCache[index]=c;r.chapterDirectory=c.directory;r.body=c.body;
  // Keep a bounded cache on phones, including the current chapter.
  const keys=Object.keys(r.bookCache);if(keys.length>5)for(const k of keys)if(Number(k)!==index&&Math.abs(Number(k)-index)>1)delete r.bookCache[k];
 }catch(e){if(run===bookLoadSequence&&openedWork===r)r.chapterError=e.message}
 finally{if(run===bookLoadSequence&&openedWork===r){r.loadingChapter=null;if(page==='reader')renderUploadedBook(r)}}
}
function renderUploadedBook(r){
 if(!r.bookCache){r.chapter.directory=r.chapterDirectory;r.bookCache={0:r.chapter}}readerChapter=Math.min(Math.max(0,readerChapter),r.chapterCount-1);
 const c=r.bookCache[readerChapter],pdf=r.format==='pdf',mode=r.readingMode||'pages';
 if(!c&&r.loadingChapter!==readerChapter&&!r.chapterError){loadBookChapter(r,readerChapter);return}
 const dir=c?.directory||r.chapterDirectory||[],options=dir.map(x=>`<option value="${x.index}" ${x.index===readerChapter?'selected':''}>${esc(x.title)}</option>`).join('');
 const navigation=`<div class="chapter-navigation"><button class="text-btn" data-reader-chapter="${readerChapter-1}" ${readerChapter===0?'disabled':''}>← 上一${pdf?'页':'章'}</button><span>${readerChapter+1} / ${r.chapterCount}</span><button class="text-btn" data-reader-chapter="${readerChapter+1}" ${readerChapter+1===r.chapterCount?'disabled':''}>下一${pdf?'页':'章'} →</button></div>`;
 let content=r.chapterError?`<div class="empty"><p>${esc(r.chapterError)}</p><button class="secondary" data-book-retry>重新加载</button></div>`:!c?'<div class="empty" role="status">正在打开正文…</div>':pdf&&mode==='pages'?`<div class="book-page-tools"><button class="text-btn" data-book-zoom>${r.zoomPage?'适应屏幕':'放大原页'}</button></div><div class="book-pdf-page ${r.zoomPage?'zoomed':''}"><img src="/api/library/${esc(r.id)}/pages/${readerChapter}" alt="《${esc(r.title)}》第 ${readerChapter+1} 页原文" data-book-page><p class="book-image-error" hidden>原页暂时无法打开。<button class="text-btn" data-book-mode="text">切换文字阅读</button></p></div>`:`<div class="prose">${c.body.map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('')}</div>`;
 document.querySelector('#main').innerHTML=`<article class="reader sourced-reader library-reader uploaded-reader"><div class="reader-toolbar"><button class="text-btn" data-page="reading">${icon('back')}返回书库</button><button class="text-btn" data-fav="${esc(r.id)}">${icon('bookmark')}${favs.includes(r.id)?'已收藏':'收藏'}</button></div><div class="reader-title"><span class="eyebrow">${esc(r.genre)}</span><h1>${esc(r.title)}</h1><div class="byline">${esc(r.author)} · ${libraryLength(r)}</div></div><details class="reader-directory"><summary>章节目录<span>${readerChapter+1} / ${r.chapterCount}</span></summary><div class="book-directory"><label for="reader-chapter">${pdf?'页码':'章节目录'}</label><select id="reader-chapter" aria-label="${pdf?'选择页码':'选择章节'}">${options}</select><form class="book-jump"><input id="book-jump" type="number" inputmode="numeric" min="1" max="${r.chapterCount}" value="${readerChapter+1}" aria-label="跳到第几${pdf?'页':'章'}"><button type="submit">跳转</button></form></div></details>${pdf?`<div class="book-reading-mode"><button class="${mode==='pages'?'active':''}" data-book-mode="pages">原页</button><button class="${mode==='text'?'active':''}" data-book-mode="text">文字</button></div>`:''}${navigation}<h2 class="chapter-title">${esc(c?.title||'')}</h2>${content}${navigation}<div class="reader-source"><span>个人藏书</span><a href="/api/library/${esc(r.id)}/source" download>下载原文件</a></div><div class="reader-actions"><button class="text-btn" data-action="read-reflect">${icon('pen')}写点读后感</button></div></article>`;
 document.querySelector('.book-jump').addEventListener('submit',e=>{e.preventDefault();const i=Number(document.querySelector('#book-jump').value);if(!Number.isInteger(i)||i<1||i>r.chapterCount)return toast('请输入有效的页码或章节');readerChapter=i-1;r.chapterError='';renderUploadedBook(r)});
 const img=document.querySelector('[data-book-page]');if(img)img.addEventListener('error',()=>{img.hidden=true;document.querySelector('.book-image-error').hidden=false});
 window.scrollTo(0,0);
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-book-mode')){e.stopImmediatePropagation();openedWork.readingMode=b.dataset.bookMode;renderUploadedBook(openedWork)}
 if(b.hasAttribute('data-book-zoom')){e.stopImmediatePropagation();openedWork.zoomPage=!openedWork.zoomPage;renderUploadedBook(openedWork)}
 if(b.hasAttribute('data-book-retry')){e.stopImmediatePropagation();openedWork.chapterError='';loadBookChapter(openedWork,readerChapter)}
},true);

function renderWork(){
 const r=openedWork;if(!r)return;if(r.chunked)return renderUploadedBook(r);const sections=r.sections?.length>1?r.sections:[];
 const section=sections[readerChapter],start=section?.start||0,end=sections[readerChapter+1]?.start??r.body.length;
 const paragraphs=sections.length?r.body.slice(start,end):r.body;
 const photo=coverFor(r),visual={...r,photo};
 document.querySelector('#main').innerHTML=`<article class="reader sourced-reader library-reader"><div class="reader-toolbar"><button class="text-btn" data-page="reading">${icon('back')}返回书库</button><button class="text-btn" data-fav="${esc(r.id)}">${icon('bookmark')}${favs.includes(r.id)?'已收藏':'收藏'}</button></div><div class="reader-title"><span class="eyebrow">${esc(r.genre||r.category)}${r.collection?' · '+esc(r.collection):''}</span><h1>${esc(r.title)}</h1><div class="byline">${esc(r.author)}${r.year?' · '+esc(r.year):''} · 约 ${Math.max(1,Math.ceil(r.characters/400))} 分钟</div></div>${photo?`<div class="reader-cover">${libraryCover(r,'reader-cover-image')}</div>`:''}${sections.length?`<details class="reader-directory"><summary>章节目录<span>${readerChapter+1} / ${sections.length}</span></summary><div class="chapter-select"><label for="reader-chapter">章节目录</label><select id="reader-chapter">${sections.map((c,i)=>`<option value="${i}" ${readerChapter===i?'selected':''}>${esc(c.title)}</option>`).join('')}</select><span>${readerChapter+1} / ${sections.length}</span></div></details><h2 class="chapter-title">${esc(section.title)}</h2>`:''}<div class="prose">${paragraphs.map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('')}</div>${sections.length?`<div class="chapter-navigation"><button class="text-btn" data-reader-chapter="${readerChapter-1}" ${readerChapter===0?'disabled':''}>← 上一章</button><button class="text-btn" data-reader-chapter="${readerChapter+1}" ${readerChapter+1===sections.length?'disabled':''}>下一章 →</button></div>`:''}<div class="reader-source"><span>原文出处</span><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.sourceName)} ·《${esc(r.title)}》 ↗</a>${photo?`<small>配图：<a href="${esc(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(photo.creator)} ↗</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${photo.license==='cc0'?'公共领域':'图片许可'}</a></small>`:''}</div><div class="reader-actions"><button class="text-btn" data-fav="${esc(r.id)}">${icon('bookmark')}${favs.includes(r.id)?'已收藏':'收藏文章'}</button><button class="text-btn" data-action="read-reflect">${icon('pen')}写点读后感</button></div></article>`;window.scrollTo(0,0);
}
showReading=async function(id){
 const request=++readerRequest;if(page==='editor')saveEditor();if(location.hash!=='#reader')history.pushState(null,'','#reader');page='reader';render();document.querySelector('#main').innerHTML='<div class="empty"><h2>正在打开正文</h2><button class="text-btn" data-page="reading">返回书库</button></div>';
 try{const work=await libraryJSON('/api/library/'+encodeURIComponent(id));if(request!==readerRequest||page!=='reader')return;openedWork=work;readerChapter=0;const index=readings.findIndex(x=>x.id===id);if(index<0)readings.push(work);else readings[index]=work;renderWork()}
 catch(error){if(page==='reader')document.querySelector('#main').innerHTML=`<div class="empty"><h2>正文暂时无法打开</h2><p>${esc(error.message)}</p><button class="secondary" data-read="${esc(id)}">重试</button><button class="text-btn" data-page="reading">返回书库</button></div>`}
};
articleRows=function(list){return list.length?list.map(a=>`<article class="article-row with-cover"><button class="article-open" data-edit="${esc(a.id)}"><div class="article-copy"><span class="state-label">${a.status==='draft'?'草稿':'已完成'}</span><h3>${esc(a.title||'尚未命名的一篇')}</h3><p>${esc(a.content||'纸还空着，故事可以从任何地方开始。')}</p><div class="article-meta"><span>${a.date.replaceAll('-',' / ')}</span><span>${count(a.content)} 字</span><span>私密</span></div></div>${libraryCover(a,'article-thumb')}</button><button class="icon-btn" data-delete="${esc(a.id)}" aria-label="管理《${esc(a.title||'未命名文章')}》">⋯</button></article>`).join(''):`<div class="empty"><h2>${query?'没有找到这篇文章':'下一篇，从这里开始'}</h2><p>${query?'试试另一个关键词。':'不必准备完美的开头。'}</p><button class="primary" data-action="new">写一篇</button></div>`};
document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;const s=libraryState;
 const has=name=>b.hasAttribute('data-'+name);
 if(has('library-genre')){event.stopImmediatePropagation();Object.assign(s,{genre:b.dataset.libraryGenre,collection:'',view:'works',page:1});loadLibrary()}
 else if(has('library-collections')){event.stopImmediatePropagation();s.view='collections';s.collection='';render()}
 else if(has('library-collection')){event.stopImmediatePropagation();Object.assign(s,{collection:b.dataset.libraryCollection,genre:'',author:'',q:'',saved:false,view:'works',page:1});loadLibrary()}
 else if(has('library-reset-collection')){event.stopImmediatePropagation();s.collection='';s.page=1;loadLibrary()}
 else if(has('library-page')){event.stopImmediatePropagation();s.page=Number(b.dataset.libraryPage);loadLibrary()}
 else if(has('library-favorites')){event.stopImmediatePropagation();Object.assign(s,{saved:!s.saved,page:1,collection:'',view:'works',q:'',author:'',genre:''});loadLibrary()}
 else if(has('library-retry')){event.stopImmediatePropagation();loadLibrary()}
 else if(has('reader-chapter')){event.stopImmediatePropagation();readerChapter=Number(b.dataset.readerChapter);if(openedWork)openedWork.chapterError='';renderWork()}
 else if(has('fav')&&['reader','reading'].includes(page)){event.stopImmediatePropagation();const id=b.dataset.fav;favs=favs.includes(id)?favs.filter(x=>x!==id):[...favs,id];persist('favs',favs);if(page==='reader'){const y=scrollY;renderWork();window.scrollTo(0,y)}else if(s.saved)loadLibrary();else render();toast(favs.includes(id)?'已收藏这篇作品':'已取消收藏')}
},true);
document.addEventListener('input',event=>{if(event.target.id==='library-search'){clearTimeout(librarySearchTimer);if(event.isComposing)return;libraryState.q=event.target.value;libraryState.page=1;libraryState.view='works';clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(loadLibrary,450)}});
document.addEventListener('compositionend',event=>{if(event.target.id==='library-search'){libraryState.q=event.target.value;libraryState.page=1;libraryState.view='works';clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(loadLibrary,450)}});
document.addEventListener('change',event=>{if(event.target.id==='reader-chapter'){readerChapter=Number(event.target.value);if(openedWork)openedWork.chapterError='';renderWork()}});
render();

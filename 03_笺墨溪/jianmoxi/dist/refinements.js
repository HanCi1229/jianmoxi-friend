// Source-backed inspiration. Excerpts and writing prompts are intentionally separate.
seeds.splice(0,seeds.length);
seedIndex=0;customSeed=null;topic='全部';
const aiNavIndex=nav.findIndex(n=>n[0]==='assistant');if(aiNavIndex>=0)nav.splice(aiNavIndex,1);
let readingFilter='all',partnerTab='works',inspirationCategory='全部',inspirationPage=0,readingCategory='全部';
const initialReading=readings.slice();
let readingFeedIds=initialReading.map(r=>r.id);
const feedProvider=window.xingzouFeedProvider||createLiveFeedProvider({async load(){return {items:initialReading,nextCursor:0}}});
let detailSeed=null;
const INSPIRATION_THEMES=['推荐','爱与牵挂','孤独与自我','成长与告别','自由与远方','日常与慰藉'];
inspirationCategory='推荐';
function inspirationThemes(s){if(s.themes?.length)return s.themes;const t=s.source?.quote||'';const words={'爱与牵挂':/爱|相思|思念|母亲|父亲|朋友|故乡/,'孤独与自我':/孤|独|自己|寂寞|沉默/,'成长与告别':/别|离|成长|岁月|过去|少年/,'自由与远方':/远|旅|自由|山|海/,'日常与慰藉':/日常|生活|花|春|温暖|光|灯/};return Object.keys(words).filter(k=>words[k].test(t))}

const feedState={inspiration:{cursor:Number(load('live-feed-cursor',0))||0,loading:false,status:'正在连接内容来源'},reading:{cursor:1,loading:false}};
const cachedReading=window.xingzouCloud?[]:load('reading-cache',[]);
if(Array.isArray(cachedReading))cachedReading.forEach(r=>{if(validFeedItem('reading',r)&&!readings.some(x=>x.id===r.id))readings.push(r)});
function validFeedItem(kind,item){
 const text=v=>typeof v==='string'&&v.trim().length>0;
 if(!item||!text(item.id)||!['forest','sea','morning'].includes(item.img))return false;
 if(kind==='reading')return [item.title,item.author,item.category,item.intro].every(text)&&Array.isArray(item.body)&&item.body.length>0&&item.body.every(text);
 const source=item.source;
 return [item.topic,item.short,item.desc].every(text)&&Array.isArray(item.questions)&&item.questions.every(text)&&source&&[source.author,source.work,source.quote,source.note].every(text)&&/^https:\/\//.test(source.url);
}
function feedCategories(items,key){return ['全部',...new Set(items.map(item=>item[key]).filter(Boolean))]}
function feedRefreshButton(kind){return `<button class="text-btn feed-refresh" data-feed-refresh="${kind}" ${feedState[kind].loading?'disabled':''} aria-label="换一批${kind==='reading'?'阅读':'灵感'}">${icon('refresh')}${feedState[kind].loading?'更新中':'换一批'}</button>`}
function applyInspirationFeed(result,{authoritative=false}={}){
 if(!result||!Array.isArray(result.items)||!result.items.every(item=>validFeedItem('inspiration',item))||new Set(result.items.map(item=>item.id)).size!==result.items.length)throw new Error('新卡片内容不完整，请重试');
 const state=feedState.inspiration;
 if(authoritative){state.revision=(state.revision||0)+1;state.refreshAgain=false}
 const items=authoritative&&window.xingzouImages?window.xingzouImages.assign(result.items):result.items;
 seeds.splice(0,seeds.length,...items);seedIndex=0;customSeed=null;inspirationPage=0;inspirationCategory='推荐';
 state.status=result.status||'';if(page==='inspiration')render();
 return true;
}
async function refreshFeed(kind){
 const state=feedState[kind];if(state.loading){state.refreshAgain=true;return false}state.loading=true;if(page===kind)render();
 const revision=state.revision||0;
 try{
  const result=await feedProvider.load({kind,cursor:state.cursor});
  // An old startup request must not overwrite the selection returned by AI apply.
  if((state.revision||0)!==revision)return true;
  if(!result||!Array.isArray(result.items)||!result.items.every(item=>validFeedItem(kind,item))||new Set(result.items.map(item=>item.id)).size!==result.items.length)throw new Error('Invalid feed response');
  if(kind==='inspiration')applyInspirationFeed(result);
  else{
   result.items.forEach(item=>{const index=readings.findIndex(r=>r.id===item.id);if(index<0)readings.push(item);else readings[index]=item});
   readingFeedIds=result.items.map(r=>r.id);persist('reading-cache',readings);
   if(!feedCategories(result.items,'category').includes(readingCategory))readingCategory='全部';
  }
  state.cursor=result.nextCursor;if(kind==='inspiration')persist('live-feed-cursor',state.cursor);state.status=result.status||'';
  toast(result.status||'已更新本批推荐');return true;
 }catch{if((state.revision||0)!==revision)return true;state.status=seeds.length?'暂时没能连接，已保留当前内容':'内容来源暂时无法连接，请稍后重试';toast(state.status);return false}
 finally{state.loading=false;if(page===kind)render();if(state.refreshAgain){state.refreshAgain=false;return refreshFeed(kind)}}
}

function sourceHTML(source){return `<span class="source-author">${esc(source.author)}</span><span>《${esc(source.work)}》</span><button class="source-link" data-action="source">查看出处 ↗</button>`}
function categoryBar(items,current,attr,label){return `<div class="category-bar" role="group" aria-label="${label}">${items.map(t=>`<button class="category-item ${current===t?'active':''}" data-${attr}="${esc(t)}" aria-pressed="${current===t}">${esc(t)}</button>`).join('')}</div>`}
function inspirationPageSize(){return matchMedia('(max-width:760px)').matches?2:3}
function inspirationView(){const pageSize=inspirationPageSize(),matching=seeds.filter(s=>inspirationCategory==='推荐'||inspirationThemes(s).includes(inspirationCategory)),pages=Math.max(1,Math.ceil(matching.length/pageSize));inspirationPage=Math.min(inspirationPage,pages-1);const list=matching.slice(inspirationPage*pageSize,inspirationPage*pageSize+pageSize);return `<div class="collection-heading"><div><h1>灵感<span class="heading-count">${String(matching.length).padStart(2,'0')}</span></h1><p>把读到的片刻，留在心上。</p></div><div class="collection-tools">${feedRefreshButton('inspiration')}<button class="text-btn" data-action="saved">${icon('bookmark')}我的收藏</button><button class="text-btn inspiration-chat-entry" data-open-inspiration-chat aria-label="和 AI 聊灵感">${icon('chat')}AI 对话</button></div></div>${categoryBar(INSPIRATION_THEMES,inspirationCategory,'inspiration-category','灵感分类')}<section class="fragment-grid ${list.length===1?'single-fragment':list.length===2?'two-fragments':''}" aria-label="灵感列表">${list.map((s,i)=>`<article class="fragment-card ${i===0?'fragment-featured':''} tone-${i} ${window.xingzouImages?.photo(s)?'':'no-photo'}"><button class="fragment-open" data-seed="${esc(s.id)}" aria-label="查看${esc(s.source.author)}《${esc(s.source.work)}》的灵感">${fragmentPhoto(s,i)}<div class="fragment-copy"><span class="fragment-topic">${esc(inspirationThemes(s)[0]||'片刻随想')}</span><blockquote>${esc(s.source.quote)}</blockquote><div class="fragment-source">${esc(s.source.author)}<span>《${esc(s.source.work)}》</span></div></div></button><div class="fragment-foot"><button class="text-btn" data-seed="${esc(s.id)}">看灵感与出处 ↗</button><button class="text-btn discuss-inspiration" data-discuss="${esc(s.id)}">讨论</button><button class="icon-btn ${saved.some(x=>x.id===s.id)?'is-saved':''}" data-fragment-save="${esc(s.id)}" aria-label="${saved.some(x=>x.id===s.id)?'取消收藏':'收藏'}《${esc(s.source.work)}》灵感">${icon('bookmark')}</button></div></article>`).join('')}</section>${!list.length?`<div class="empty"><h2>${feedState.inspiration.loading?'正在寻找新的片刻':'这个主题还没有新的摘句'}</h2><p>${feedState.inspiration.loading?'从内容来源获取摘句与出处…':'点击换一批，重新连接内容来源。'}</p></div>`:''}<div class="collection-pager"><span>${esc(feedState.inspiration.loading?'正在更新…':/暂|无法|失败/.test(feedState.inspiration.status||'')?'部分内容暂不可用':'')}</span><div><button class="icon-btn" data-fragment-page="prev" aria-label="上一页灵感" ${inspirationPage===0?'disabled':''}>←</button><span class="page-number">${inspirationPage+1} / ${pages}</span><button class="icon-btn" data-fragment-page="next" aria-label="下一页灵感" ${inspirationPage+1>=pages?'disabled':''}>→</button></div></div>`}
function fragmentPhoto(s,i){const p=window.xingzouImages?.photo(s);return p?`<div class="fragment-photo"><img data-library src="${esc(p.url)}" alt="${esc(p.alt)}"><span class="fragment-number">${String(inspirationPage*inspirationPageSize()+i+1).padStart(2,'0')}</span></div>`:''}
function photoDetail(s){const p=window.xingzouImages?.photo(s);return p?`<div class="detail-photo"><img data-library src="${esc(p.url)}" alt="${esc(p.alt)}"></div>`:''}
function inspirationInsight(s){return s.interpretation?`<div class="insight-reading"><p>${esc(s.interpretation)}</p></div>`:`<p class="ai-loading">正在读懂这句话…</p>`}
async function loadInspirationInsight(s){const box=document.querySelector('#inspiration-insight');if(!box)return;try{const result=await requestAI('inspiration',{items:[{id:s.id,topic:s.topic,quote:s.source.quote,author:s.source.author,work:s.source.work}]});const r=result.items?.find(x=>x.id===s.id);if(!r?.interpretation)throw new Error('解读暂未完成');Object.assign(s,r,{promptKind:'ai'});if(box.isConnected&&detailSeed?.id===s.id)box.innerHTML=inspirationInsight(s)}catch(error){if(box.isConnected)box.innerHTML=`<p class="reader-ai-error">${esc(error.name==='AbortError'?'解读超时，请重试':error.message)}</p><button class="secondary" data-insight-retry>重新解读</button>`}}
function seedModal(){const s=currentSeed();detailSeed=s;if(!s?.source)return;modal(`<h2>语录解读</h2><section class="detail-inspiration interpretation-only" id="inspiration-insight" aria-live="polite">${inspirationInsight(s)}</section>`);if(!s.interpretation)loadInspirationInsight(s)}
function nextSeed(){customSeed=null;seedIndex=(seedIndex+1)%seeds.length;render()}
function createArticle(seed){if(page==='editor')saveEditor();const id=Date.now().toString(36);articles.unshift({id,title:'',content:'',status:'draft',date:dayKey(),seed:seed?.short||'',source:seed?.source||null,img:seed?.img});currentId=id;persist('currentId',id);persist('articles',articles);closeModal();navigate('editor',true)}
const baseEditorView=editorView;
editorView=function(){let html=baseEditorView();const a=articles.find(x=>x.id===currentId);if(a?.source)html=html.replace('<span>写作起点 ·',`<button class="editor-source" data-action="editor-source">${esc(a.source.author)}《${esc(a.source.work)}》 ↗</button><span>写作起点 ·`);return html.replace('<p class="writing-note">慢慢写。这里没有倒计时。</p>','')};
function showSource(source){if(source.work==='AI 原创'&&!source.verified){modal(`<h2>${esc(source.author)} · AI 原创</h2><blockquote class="modal-quote">${esc(source.quote)}</blockquote><p>由你的 AI 搭子创作，不是书籍原文。</p>`);return}modal(`<span class="eyebrow">内容出处</span><h2>${esc(source.author)} ·《${esc(source.work)}》</h2><blockquote class="modal-quote">${esc(source.quote)}</blockquote><p>${esc(source.note)}${source.year?' · '+esc(source.year)+' 年':''}</p>${source.credits?`<p class="source-note">${esc(source.credits)}</p>`:''}${source.recordId?`<p class="source-note source-record">来源记录：${esc(source.recordId)}</p>`:''}<p class="source-note">${esc(source.verificationNote||'原文摘句已经核对。')} 写作提示另行标注，与原文摘句分开展示。</p><div class="actions"><a class="primary" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${source.provider?'查看来源记录':'阅读原文'} ↗</a><button class="text-btn" data-action="close">返回</button></div>`)}

function readingView(){const collection=readingFilter==='saved'?readings.filter(r=>favs.includes(r.id)):readingFeedIds.map(id=>readings.find(r=>r.id===id)).filter(Boolean);const categories=feedCategories(collection,'category');if(!categories.includes(readingCategory))readingCategory='全部';const list=collection.filter(r=>readingCategory==='全部'||r.category===readingCategory);return `<div class="collection-heading"><div><h1>阅读<span class="heading-word">慢慢读</span></h1><p>让文字，把日子铺展开。</p></div><div class="collection-tools">${readingFilter==='all'?feedRefreshButton('reading'):''}<button class="text-btn ${readingFilter==='saved'?'selected-reading':''}" data-reading-filter="${readingFilter==='saved'?'all':'saved'}">${icon('bookmark')}${readingFilter==='saved'?'返回精选':'我的收藏'}</button></div></div>${categoryBar(categories,readingCategory,'reading-category','阅读分类')}<div class="reading-list editorial-reading">${list.length?list.map((r,i)=>`<button class="reading-list-item ${i===0?'featured':''}" data-read="${esc(r.id)}">${window.xingzouImages?.photo(r)?`<img data-library src="${esc(r.photo.url)}" alt="${esc(r.photo.alt)}">`:""}<div><span class="eyebrow">${esc(r.category)}</span><h2>${esc(r.title)}</h2><p>${esc(r.intro)}</p><small>${esc(r.author)} · ${Math.max(1,Math.ceil(r.body.join('').length/350))} 分钟</small></div><span class="read-arrow">↗</span></button>`).join(''):`<div class="empty"><h2>${readingFilter==='saved'?'这个分类还没有收藏':'这个分类暂时没有文章'}</h2><p>换一个分类，继续读一会儿。</p><button class="secondary" data-reading-category="全部">查看全部分类</button></div>`}</div>`}
const baseJournalView=journalView;
journalView=function(){return baseJournalView().replace('<button data-page="assistant">AI 写作助手 <span>↗</span></button>','').replace('日子，一页一页地留下','写作记录').replace('不用每天写很多，愿意回来就很好。','')};
const baseArticlesView=articlesView;
articlesView=function(){return baseArticlesView().replace('写过的，都在这里','我的文章').replace('有些已经成篇，有些还在慢慢长大。','')};
// Handle the new controls before the original delegated handler.
document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;
 if(el.hasAttribute('data-insight-retry')){e.stopImmediatePropagation();return loadInspirationInsight(detailSeed)}
 if(el.dataset.feedRefresh){e.stopImmediatePropagation();return refreshFeed(el.dataset.feedRefresh)}
 if(el.dataset.inspirationCategory){e.stopImmediatePropagation();inspirationCategory=el.dataset.inspirationCategory;inspirationPage=0;return render()}
 if(el.dataset.readingCategory){e.stopImmediatePropagation();readingCategory=el.dataset.readingCategory;return render()}
 if(el.dataset.fragmentPage){e.stopImmediatePropagation();inspirationPage+=el.dataset.fragmentPage==='next'?1:-1;return render()}
 if(el.dataset.fragmentSave||el.dataset.detailSave){e.stopImmediatePropagation();const id=el.dataset.fragmentSave||el.dataset.detailSave,s=seeds.find(x=>x.id===id)||saved.find(x=>x.id===id)||(detailSeed?.id===id?detailSeed:null),exists=saved.some(x=>x.id===id);if(!s)return;saved=exists?saved.filter(x=>x.id!==id):[...saved,{...s}];persist('saved',saved);const y=scrollY;render();if(el.dataset.detailSave){customSeed=s;seedModal()}window.scrollTo(0,y);return toast(exists?'已取消收藏':'已收藏灵感与出处')}
 if(el.dataset.action==='source'){e.stopImmediatePropagation();return showSource((detailSeed||currentSeed()).source)}
 if(el.dataset.action==='editor-source'){e.stopImmediatePropagation();return showSource(articles.find(a=>a.id===currentId).source)}
 if(el.dataset.action==='seed-save'){e.stopImmediatePropagation();const s=currentSeed(),exists=saved.some(x=>x.id===s.id);saved=exists?saved.filter(x=>x.id!==s.id):[...saved,{...s}];persist('saved',saved);render();return toast(exists?'已取消收藏':'已收藏，作者和出处一并保留')}
 if(el.dataset.action==='saved'){e.stopImmediatePropagation();const verified=saved.filter(s=>s.source);return modal(`<span class="eyebrow">我的收藏</span><h2>留给下一次写作</h2>${verified.length?verified.map(s=>`<button class="saved-item saved-with-photo" data-saved="${esc(s.id)}"><img data-library src="${esc(window.xingzouImages.photo(s).url)}" alt="灵感配图"><span>${esc(s.source.quote)}<small>${esc(s.source.author)} ·《${esc(s.source.work)}》</small></span></button>`).join(''):'<p>收藏喜欢的灵感，原文与写作思路会一起保留。</p>'}${saved.length>verified.length?'<p class="source-note">部分旧收藏缺少出处，暂不显示；可在备份中查看。</p>':''}`)}
 if(el.dataset.readingFilter){e.stopImmediatePropagation();readingFilter=el.dataset.readingFilter;return render()}
 if(el.dataset.partnerTab){e.stopImmediatePropagation();partnerTab=el.dataset.partnerTab;return render()}
},true);
if(page==='assistant'||page==='partners')page='articles';render();

// Live excerpts preserve their upstream attribution; readings come from the server catalog.
refreshFeed('inspiration');

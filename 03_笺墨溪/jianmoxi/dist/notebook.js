/* A quiet notebook layer. Appearance stays on this device; writing remains cloud-saved. */
(() => {
 document.documentElement.classList.add('notebook');
 const sheet=document.querySelector('#notebook-style');if(sheet)document.head.append(sheet);
 const key=(window.xingzouCloud?.storageKey('jianmoxi-notebook-appearance')||'jianmoxi-notebook-appearance');
 let appearance={name:'我的手记',cover:'forest',paper:'ivory'},listMode=false;
 try{Object.assign(appearance,JSON.parse(localStorage.getItem(key)||'{}'))}catch{}
 const covers=['forest','sea','morning'],papers=['ivory','sage','rose'];
 function apply(){
  if(!covers.includes(appearance.cover))appearance.cover='forest';
  if(!papers.includes(appearance.paper))appearance.paper='ivory';
  appearance.name=String(appearance.name||'我的手记').slice(0,24);
  document.documentElement.dataset.paper=appearance.paper;
 }
 apply();
 function dateStamp(){const d=new Date();return `<div class="notebook-date"><strong>${String(d.getDate()).padStart(2,'0')}</strong><div><span>${d.getFullYear()} 年 ${d.getMonth()+1} 月</span><span>星期${'日一二三四五六'[d.getDay()]}</span></div></div>`}
 const oldInspiration=inspirationView;
 inspirationPageSize=()=>Math.max(1,seeds.length);
 inspirationView=function(){
  const box=document.createElement('div');box.innerHTML=oldInspiration();
  box.querySelector('.collection-heading')?.remove();box.querySelector('.collection-pager')?.remove();box.querySelector('.category-bar')?.remove();
  const rail=box.querySelector('.fragment-grid');if(rail&&!listMode){rail.tabIndex=0;rail.setAttribute('aria-label','灵感卡片，可左右滑动');}
  box.querySelectorAll('.fragment-foot button').forEach(b=>{
   const kind=b.hasAttribute('data-fragment-save')?'save':b.hasAttribute('data-discuss')?'discuss':'read';
   const label=kind==='read'?'解读':kind==='discuss'?'讨论':b.classList.contains('is-saved')?'已藏':'收藏';
   b.classList.add('paper-action');b.dataset.paperAction=kind;
   if(kind!=='save')b.setAttribute('aria-label',kind==='read'?'查看语录解读':'和 AI 搭子讨论这句');
   b.innerHTML=`<span class="fragment-action-face">${icon(kind==='read'?'letterReading':kind==='discuss'?'letterConversation':'letterCollection')}<span>${label}</span></span>`;
  });
  const empty=box.querySelector('.empty p');if(empty)empty.textContent=feedState.inspiration.status||'暂时没有符合条件的文学摘句，可以和小溪调整偏好。';
  return `<section class="notebook-inspiration notebook-focus"><header class="notebook-masthead moment-masthead">${dateStamp()}<div id="moment-controls"></div></header><div class="paper-stage">${box.innerHTML}</div></section>`;
 };
 // Keep search in the heading, alongside the section's primary action.
 const roomyReading=readingView,roomyArticles=articlesView;
 readingView=function(){
  const box=document.createElement('div');box.innerHTML=roomyReading();
  const heading=box.querySelector('.library-heading'),search=box.querySelector('.library-search'),tools=box.querySelector('.collection-tools'),tabs=box.querySelector('.library-tabs');
  heading.classList.add('compact-heading');heading.querySelector('.eyebrow')?.remove();heading.querySelector('.heading-word')?.remove();heading.querySelector('p')?.remove();
  heading.append(search);box.querySelector('.library-search-row')?.remove();
  const filters=document.createElement('div');filters.className='compact-library-filters';tabs.before(filters);filters.append(tabs,tools);
  tools.querySelectorAll('button').forEach(b=>{b.title=b.textContent.trim();b.setAttribute('aria-label',b.title);const label=document.createElement('span');label.className='compact-action-label';label.textContent=b.textContent;[...b.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());b.append(label)});
  return box.innerHTML;
 };
 articlesView=function(){
  const box=document.createElement('div');box.innerHTML=roomyArticles();
  const heading=box.querySelector('.page-heading'),search=box.querySelector('.article-search'),create=heading.querySelector('[data-action="new"]');
  box.querySelector(':scope > .eyebrow')?.remove();heading.querySelector('p')?.remove();heading.classList.add('compact-heading');
  heading.insertBefore(search,create);search.querySelector('input').placeholder='搜索文稿';
  create.classList.add('compact-create');create.setAttribute('aria-label','新建文章');create.innerHTML=icon('pen')+'<span>写一篇</span>';
  return box.innerHTML;
 };
 const oldJournal=journalView;
 journalView=function(){
  const box=document.createElement('div');box.innerHTML=oldJournal();box.querySelector('.collection-heading')?.remove();box.querySelector('.account-setting-grid [data-open-excerpts]')?.remove();
  const stats=box.querySelector('.writing-overview'),calendar=box.querySelector('.journal-grid');
  const details=document.createElement('details');details.className='notebook-records';details.innerHTML='<summary>写作记录与目标<span>展开查看</span></summary>';
  stats?.before(details);if(stats)details.append(stats);if(calendar)details.append(calendar);
  return `<section class="notebook-home"><div class="notebook-cover"><img src="/assets/${appearance.cover}.jpg" alt="手记封面"><div><span>笺墨溪</span><h1>${esc(appearance.name)}</h1><button data-notebook-settings>布置我的手记</button></div></div><div class="notebook-shortcuts"><button data-page="articles">${icon('pen')}我的文稿</button><button data-open-excerpts>${icon('book')}阅读摘录</button><button data-action="saved">${icon('bookmark')}灵感收藏</button></div>${box.innerHTML}</section>`;
 };
 const oldEditor=editorView;
 editorView=function(){
  const box=document.createElement('div');box.innerHTML=oldEditor();const title=box.querySelector('#editor-title');
  if(title){title.placeholder='标题（可以晚点再写）';const a=articles.find(x=>x.id===currentId);const stamp=document.createElement('div');stamp.className='notebook-writing-date';stamp.textContent=a?.date?.replaceAll('-',' / ')||dayKey();title.before(stamp)}
  return box.innerHTML;
 };
 function settings(){
  modal(`<h2>布置我的手记</h2><form id="notebook-appearance"><label for="notebook-name">手记名字</label><input id="notebook-name" class="modal-input" maxlength="24" value="${esc(appearance.name)}" required><fieldset><legend>封面</legend><div class="notebook-cover-options">${covers.map((c,i)=>`<label><input type="radio" name="cover" value="${c}" ${appearance.cover===c?'checked':''}><img src="/assets/${c}.jpg" alt="${['林间','海面','晨光'][i]}"><span>${['林间','海面','晨光'][i]}</span></label>`).join('')}</div></fieldset><fieldset><legend>纸色</legend><div class="notebook-paper-options">${papers.map((p,i)=>`<label data-paper-swatch="${p}"><input type="radio" name="paper" value="${p}" ${appearance.paper===p?'checked':''}>${['暖纸','苔绿','暮玫'][i]}</label>`).join('')}</div></fieldset><p class="notebook-device-note">外观保存在这台设备。</p><button class="primary" type="submit">保存外观</button></form>`);
  document.querySelector('#notebook-appearance').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;appearance={name:form.querySelector('#notebook-name').value.trim()||'我的手记',cover:form.querySelector('[name="cover"]:checked').value,paper:form.querySelector('[name="paper"]:checked').value};apply();try{localStorage.setItem(key,JSON.stringify(appearance));toast('手记外观已保存')}catch{toast('外观已应用，但设备未能记住设置')}closeModal();if(page==='journal')render()});
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-notebook-settings'))settings();
  if(b.hasAttribute('data-notebook-list')){listMode=!listMode;inspirationPage=0;render()}
 });
 // Return to the last chapter and scroll position on this device. Never save a loading screen.
 const progressKey=(window.xingzouCloud?.storageKey('jianmoxi-reading-positions')||'jianmoxi-reading-positions');let positions={},pending=null,timer;
 try{const saved=JSON.parse(localStorage.getItem(progressKey)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))positions=saved}catch{}
 function remember(){if(page!=='reader'||!openedWork||pending||!document.querySelector('.library-reader .prose,.library-reader .book-pdf-page'))return;positions[openedWork.id]={chapter:readerChapter,y:window.scrollY||0,at:Date.now()};const entries=Object.entries(positions).sort((a,b)=>b[1].at-a[1].at).slice(0,100);positions=Object.fromEntries(entries);try{localStorage.setItem(progressKey,JSON.stringify(positions))}catch{}}
 function restore(){if(!pending)return;if(page!=='reader'||openedWork?.id!==pending.id||readerChapter!==pending.chapter){pending=null;return;}if(!document.querySelector('.library-reader .prose,.library-reader .book-pdf-page'))return;const target=pending;requestAnimationFrame(()=>{if(pending!==target)return;if(page!=='reader'||openedWork?.id!==target.id||readerChapter!==target.chapter){pending=null;return;}window.scrollTo(0,target.y);pending=null})}
 const originalShow=showReading,originalWork=renderWork,originalUpload=renderUploadedBook;
 showReading=async function(id){remember();pending=null;await originalShow(id);if(page!=='reader'||openedWork?.id!==id)return;const p=positions[id];const limit=openedWork.chunked?openedWork.chapterCount:(openedWork.sections?.length||1);if(!p||!Number.isInteger(p.chapter)||p.chapter<0||p.chapter>=limit)return;pending={id,chapter:p.chapter,y:Math.max(0,Number(p.y)||0)};readerChapter=p.chapter;renderWork()};
 renderWork=function(){originalWork();restore()};renderUploadedBook=function(r){originalUpload(r);restore()};
 window.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(remember,250)},{passive:true});
 window.addEventListener('pagehide',remember);document.addEventListener('visibilitychange',()=>{if(document.hidden)remember()});
 document.addEventListener('click',e=>{if(e.target.closest('[data-page],[data-reader-chapter]'))remember()},true);
 if(page!=='editor'&&page!=='reader')render();
})();

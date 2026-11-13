// Product views only show saved work and source-backed content.
journalView=function(){
 const now=new Date(),today=activity[dayKey()]||{chars:0,edits:0};
 const days=Object.values(activity).filter(d=>d.edits>0).length;
 const total=articles.reduce((n,a)=>n+count(a.content),0);
 return `<div class="collection-heading"><div><span class="eyebrow">A WRITING LIFE</span><h1>我的<span class="heading-word">一页一页，慢慢来</span></h1></div><span class="cloud-status">${esc(window.xingzouCloud.status)}</span></div><section class="writing-overview" aria-label="真实写作统计"><div><strong>${articles.length}</strong><span>文章</span></div><div><strong>${total.toLocaleString()}</strong><span>已写字数</span></div><div><strong>${days}</strong><span>写作天数</span></div></section><div class="journal-grid"><section class="writing-calendar"><div class="section-heading"><h2>${now.getFullYear()} 年 ${now.getMonth()+1} 月</h2><span>写作日历</span></div><div class="calendar" id="calendar"></div><div class="journal-day" id="journal-day">${today.edits?`今天新增 ${today.chars} 字，修改 ${today.edits} 次。`:'今天还没有写作记录。'}</div></section><section><div class="goal"><span class="eyebrow">给今天留几行字</span><h3>每日目标 <span>${goal}</span> 字</h3><p>今天已写 ${today.chars} 字${today.chars>=goal?'，目标已完成。':'。'}</p><div class="progress" role="progressbar" aria-label="今日字数目标" aria-valuenow="${Math.min(today.chars,goal)}" aria-valuemin="0" aria-valuemax="${goal}"><i style="width:${Math.min(100,today.chars/goal*100)}%"></i></div><div class="actions"><button class="text-btn" data-action="new">写一会儿 →</button><button class="text-btn" data-action="goal">调整目标</button></div></div></section></div><section class="account-settings" aria-label="写作空间设置"><h2>我的空间</h2><div class="account-setting-grid"><button data-action="trash"><span>${icon('book')}回收站</span><small>${trash.length} 篇 <span>↗</span></small></button><button data-cloud="export"><span>${icon('bookmark')}导出完整备份</span><small>文章与收藏 <span>↓</span></small></button><button data-cloud="import"><span>${icon('refresh')}导入备份</span><small>从文件恢复 <span>↑</span></small></button><button data-action="about"><span>${icon('leaf')}关于笺墨溪</span><small>了解你的空间 <span>↗</span></small></button></div><div class="account-bottom"><span>${window.xingzouCloud.account?'账号 · '+esc(window.xingzouCloud.account.username):'内容随登录设备同步'}</span><div class="actions">${window.xingzouCloud.account?.owner?'<button data-cloud="invite">邀请朋友</button>':''}<button data-cloud="logout">退出登录</button></div></div></section>`;
};
showReading=function(id){
 const r=readings.find(x=>x.id===id);if(!r)return toast('这篇文章暂时无法打开');
 page='reader';render();
 document.querySelector('#main').innerHTML=`<article class="reader sourced-reader"><div class="reader-toolbar"><button class="text-btn" data-page="reading">${icon('back')}返回阅读</button><button class="text-btn" data-fav="${esc(id)}">${icon('bookmark')}${favs.includes(id)?'已收藏':'收藏'}</button></div><div class="reader-title"><span class="eyebrow">${esc(r.category)}</span><h1>${esc(r.title)}</h1><div class="byline">${esc(r.author)}${r.year?' · '+esc(r.year):''} · 约 ${Math.max(1,Math.ceil(r.body.join('').length/350))} 分钟</div></div><div class="prose">${r.body.map(x=>`<p>${esc(x)}</p>`).join('')}</div>${photoDetail(r)}<div class="reader-source"><span>原文出处</span><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.sourceName)} ·《${esc(r.title)}》 ↗</a><small>${esc(r.sourceEdition||'')} · 保留原作文字</small></div><div class="reader-actions"><button class="text-btn" data-fav="${esc(id)}">${icon('bookmark')}${favs.includes(id)?'已收藏':'收藏文章'}</button><button class="text-btn" data-action="read-reflect">${icon('pen')}写点读后感</button></div></article>`;
 window.scrollTo(0,0);
};
const catalogReadingView=readingView;
readingView=function(){return catalogReadingView().replace(feedRefreshButton('reading'),'')};
const cloudOriginalRender=render;
render=function(){
 cloudOriginalRender();
 const status=document.querySelector('#save-status');if(status)status.textContent=window.xingzouCloud.status;
 document.querySelectorAll('.preview-label').forEach(n=>n.hidden=true);
 document.querySelectorAll('[data-page="partners"],[data-page="assistant"]').forEach(n=>n.remove());
 document.querySelectorAll('button[data-page],a[data-page]').forEach(n=>{if(n.dataset.page===page||(page==='reader'&&n.dataset.page==='reading')||(page==='editor'&&n.dataset.page==='articles')){n.setAttribute('aria-current','page');n.classList.add('active')}});
};
render();

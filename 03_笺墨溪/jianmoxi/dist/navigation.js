(() => {
 const css=document.createElement('link');css.rel='stylesheet';css.href='/navigation.css?v=20261104-6';document.head.append(css);
 // The Android host already excludes system bars from its WebView bounds.
 document.documentElement.classList.toggle('native-system-insets',/XingzouAndroid\//.test(navigator.userAgent));
 const tabs=[['inspiration','灵感','letterInspiration'],['conversation','对话','letterConversation'],['reading','阅读','letterReading'],['articles','文章','letterWriting'],['journal','我的','letterCollection']];
 function drawNav(){const selected=!assistantPanel.hidden?'conversation':page==='reader'?'reading':page==='editor'?'articles':page;for(const id of ['mobile-nav','desktop-nav']){const target=document.getElementById(id);if(target)target.innerHTML=tabs.map(([key,label,shape])=>`<button type="button" class="${id==='desktop-nav'?'nav-link ':''}${selected===key?'active':''}" data-shell-page="${key}" ${selected===key?'aria-current="page"':''}>${id==='mobile-nav'?`<span class="nav-bookmark-face">${icon(shape)}<span>${label}</span></span>`:`${icon(shape)}<span>${label}</span>`}</button>`).join('')}}
 const baseRender=render,baseOpen=openAssistant,baseClose=closeAssistant,baseViewport=chatViewport;
 render=function(){baseRender();drawNav()};
 // Every tab shares one viewport anchor, including when the keyboard resizes it.
 function syncNavViewport(){
  const v=window.visualViewport;
  const bottom=Math.max(0,window.innerHeight-((v?.offsetTop||0)+(v?.height||window.innerHeight)));
  document.documentElement.style.setProperty('--shell-viewport-bottom',bottom+'px');
 }
 chatViewport=function(){
  baseViewport();syncNavViewport();
  if(!assistantPanel.hidden&&matchMedia('(max-width:760px)').matches){
   const n=document.getElementById('mobile-nav'),v=window.visualViewport;
   const navHeight=n.getBoundingClientRect().height||48;
   assistantPanel.style.height=Math.max(0,(v?.height||window.innerHeight)-navHeight)+'px';
  }
 };
 window.visualViewport?.addEventListener('resize',syncNavViewport);
 window.visualViewport?.addEventListener('scroll',syncNavViewport);
 window.addEventListener('resize',syncNavViewport);
 syncNavViewport();
 openAssistant=function(context){
  const n=document.getElementById('mobile-nav');assistantPanel.append(n);n.inert=false;delete n.dataset.chatInert;
  const promise=baseOpen(context),desktop=document.documentElement.classList.contains('web-cloud')&&matchMedia('(min-width:681px)').matches;
  if(desktop){const sidebar=document.querySelector('.sidebar');if(sidebar){sidebar.inert=false;delete sidebar.dataset.chatInert}assistantPanel.setAttribute('aria-modal','false')}
  if(document.documentElement.classList.contains('web-cloud'))window.xingzouCloud?.relocateBanner?.();drawNav();return promise
 };
 closeAssistant=function(){const n=document.getElementById('mobile-nav');document.body.append(n);baseClose();if(document.documentElement.classList.contains('web-cloud')){assistantPanel.setAttribute('aria-modal','true');window.xingzouCloud?.relocateBanner?.()}syncNavViewport();drawNav()};
 document.addEventListener('click',e=>{if(document.documentElement.classList.contains('web-cloud')&&e.target.closest('[data-action="new"]')&&!assistantPanel.hidden)closeAssistant();const b=e.target.closest('[data-shell-page]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();const target=b.dataset.shellPage;if(target==='conversation'){if(assistantPanel.hidden)openAssistant();return;}if(!assistantPanel.hidden)closeAssistant();navigate(target)},true);
 // No hidden list or theme filter can survive an older session.
 inspirationCategory='推荐';
 drawNav();if(page==='inspiration')render();
})();

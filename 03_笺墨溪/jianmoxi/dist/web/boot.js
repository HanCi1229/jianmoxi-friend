/* 笺墨溪 Web 入口：本地只读版式预览 / 同源生产运行链。 */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const local = !params.has('cloud-test') && (['127.0.0.1', 'localhost', ''].includes(location.hostname) || params.has('preview'));
  const loadCSS = href => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.onload = resolve; link.onerror = reject;
    document.head.append(link);
  });
  const loadJS = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve; script.onerror = reject;
    document.body.append(script);
  });
  (async () => {
    if (local) {
      document.documentElement.classList.add('web-preview');
      document.querySelector('link[rel="icon"]')?.setAttribute('href', '../dist/assets/jianmoxi-icon.svg');
      await Promise.all([loadCSS('base.css'), loadCSS('layout.css')]);
      await loadCSS('desktop.css');
      document.querySelector('#main').innerHTML = `
        <header class="masthead" id="masthead">
          <div class="date-block"><strong id="m-date">—</strong><div><span id="m-ym">—</span><span id="m-week">—</span></div></div>
          <div class="moment-controls">
            <button class="moment-place" type="button" data-action="place"><span id="m-place">选择地点</span><span class="weather" id="m-weather" hidden></span></button>
            <button class="moment-mood" type="button" data-action="mood"><span id="m-mood">今日心情</span><span aria-hidden="true">⌄</span></button>
          </div>
          <p class="kind-words" id="kind-words" aria-live="polite"></p>
          <button class="info-btn" type="button" data-action="about" aria-label="关于这份预览">i</button>
        </header><div id="view-host"></div>`;
      await loadJS('app.js');
      document.querySelector('#web-startup')?.remove();
      return;
    }
    document.documentElement.classList.add('web-cloud', 'editorial', 'notebook');
    document.documentElement.dataset.webSkin = 'autumn';
    document.body.classList.add('cloud-starting');
    await Promise.all([
      loadCSS('/style.css?v=4'), loadCSS('/cloud.css?v=accounts-1'), loadCSS('/refinements.css?v=10'),
      loadCSS('/editorial.css?v=20261104-1'), loadCSS('/notebook.css?v=20261104-1'), loadCSS('/web/desktop.css?v=20261110-writing-space-1'), loadCSS('/web/skins.css?v=20261110-android-skins-1'), loadCSS('/web/skin-symbols.css?v=1')
    ]);
    // Download modules together while retaining the existing execution order.
    ['/auth.js?v=accounts-3','/cloud-boot.js?v=accounts-3','/image-library.js?v=20261104-create-1','/app.js?v=20261108-buttons-2','/live-feed.js?v=20261104-create-1','/ai-client.js','/refinements.js?v=20261104-create-1','/cloud-ui.js','/library-ui.js','/assistant-ui.js?v=20261110-chat-text-1','/reading-tools.js','/editorial.js?v=20261104-1','/notebook.js?v=20261104-1','/flow.js?v=20261104-create-1','/navigation.js?v=20261108-buttons-2','/moment.js?v=20261104-1','/reading-guide.js?v=20261105-2','/quote-library.js?v=20261105-2','/web/desktop.js?v=20261110-android-skins-1'].forEach(src=>{const link=document.createElement('link');link.rel='preload';link.as='script';link.href=src;document.head.append(link)});
    await loadJS('/auth.js?v=accounts-3');
    await loadJS('/cloud-boot.js?v=accounts-3');
    const ready = await new Promise(resolve => {
      const observer = new MutationObserver(check);
      function finish(value){ observer.disconnect(); resolve(value); }
      function check(){
        if (document.body.classList.contains('auth-page')) finish(false);
        else if (!document.body.classList.contains('cloud-starting') && document.querySelector('#desktop-nav [data-shell-page]')) finish(true);
      }
      observer.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
      check();
    });
    if (ready) {
      await loadJS('/web/appearance.js?v=20261110-android-skins-1');
      await loadJS('/web/desktop.js?v=20261110-android-skins-1');
    }
    document.querySelector('#web-startup')?.remove();
  })().catch(error => {
    console.error('笺墨溪 Web 启动失败', error);
    const startup = document.querySelector('#web-startup');
    if(startup){startup.querySelector('p').textContent='暂时未能打开，请重新连接。已保存的文字仍保留在云端。';startup.querySelector('[data-startup-actions]').hidden=false}
    else if(!document.body.classList.contains('auth-page')){document.body.classList.remove('cloud-starting');const main=document.querySelector('#main');if(main)main.innerHTML='<section class="empty"><h1>页面暂时没有打开</h1><p><a href="/web/index.html">重新打开</a></p></section>';}
  });
})();

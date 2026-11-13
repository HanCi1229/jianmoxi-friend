/* Cloud web and Android share the theme catalog and device preference. */
(() => {
  'use strict';
  const root = document.documentElement;
  const web = root.classList.contains('web-cloud');
  const key = (window.xingzouCloud?.storageKey('jianmoxi-web-skin')||'jianmoxi-web-skin');
  const skins = {
    autumn: {name:'秋日来信', detail:'枫窗、落日与远方的信', edition:'01 / AUTUMN POST', caption:'拾一片秋色，寄往文字的远方。'},
    ink: {name:'烟雨楼', detail:'宣纸墨痕 · 雨中山河', edition:'02 / THE MISTY TOWER', caption:'楼外烟雨，笔下江湖。'},
    sword: {name:'剑照山河', detail:'执剑渡雨 · 烟雨江湖', edition:'江湖卷 · 雨渡', caption:'一身风雨，仍有要去的地方。'},
    weekly: {name:'笺墨周刊', detail:'白纸黑字 · 黑白动漫封面', edition:'LITERARY WEEKLY / NO. 04', caption:'文学、写作与图像'},
    classic: {name:'经典纸笺', detail:'原有外观'}
  };

  function mount() {
    let current = web ? root.dataset.webSkin || 'classic' : 'classic';
    try {
      const stored = localStorage.getItem(key);
      if (Object.hasOwn(skins, stored)) current = stored;
    } catch { /* The setting remains available for this session. */ }
    const feature = document.querySelector('.web-skin-feature');
    const main = document.querySelector('#main');
    const dialog = document.createElement('dialog');
    dialog.id = 'web-skin-dialog';
    dialog.setAttribute('aria-labelledby', 'web-skin-dialog-title');
    dialog.innerHTML = `<form class="web-skin-form">
      <header>
        <div>
          <span class="web-skin-dialog-kicker">JIANMOXI / APPEARANCE</span>
          <h2 id="web-skin-dialog-title">选择写作空间的皮肤</h2>
          <p>外观保存在当前${web ? '浏览器' : '设备'}。</p>
        </div>
        <button class="web-skin-close" type="button" data-close-web-skins aria-label="关闭皮肤选择">×</button>
      </header>
      <fieldset class="web-skin-choices" aria-label="皮肤">
        ${Object.entries(skins).map(([id, skin]) => `<label class="web-skin-option" data-skin-preview="${id}">
          <input type="radio" name="skin" value="${id}">
          <span class="web-skin-sample" aria-hidden="true"></span>
          <span class="web-skin-option-text"><strong>${skin.name}</strong><small>${skin.detail}</small></span>
        </label>`).join('')}
      </fieldset>
      <footer><button class="secondary" type="button" data-close-web-skins>取消</button><button class="primary" type="submit">应用皮肤</button></footer>
    </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');

    function updateNames() {
      for (const name of document.querySelectorAll('[data-web-skin-name]')) name.textContent = skins[current].name;
    }
    function apply(skin) {
      current = skin;
      if (skin === 'classic') delete root.dataset.webSkin;
      else root.dataset.webSkin = skin;
      const theme = skins[skin];
      updateNames();
      if (feature) {
        feature.querySelector('h1').textContent = theme.name;
        feature.querySelector('.web-skin-edition').textContent = theme.edition || '';
        feature.querySelector('.web-skin-caption').textContent = theme.caption || '';
        feature.hidden = skin === 'classic';
      }
      document.dispatchEvent(new Event('jianmoxi:appearance'));
    }
    function addJournalEntry() {
      const notebook = main.querySelector('.notebook-home');
      if (!notebook || notebook.querySelector('[data-open-web-skins]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'web-skin-mobile';
      button.dataset.openWebSkins = '';
      button.setAttribute('aria-haspopup', 'dialog');
      button.innerHTML = '<span>外观皮肤</span><small data-web-skin-name></small>';
      notebook.querySelector('.notebook-cover')?.after(button);
      updateNames();
    }

    document.addEventListener('click', event => {
      if (!event.target.closest('[data-open-web-skins]') || dialog.open) return;
      form.elements.skin.value = current;
      dialog.showModal();
    });
    dialog.querySelectorAll('[data-close-web-skins]').forEach(button => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    form.addEventListener('submit', event => {
      event.preventDefault();
      const skin = form.elements.skin.value;
      if (!Object.hasOwn(skins, skin)) return;
      apply(skin);
      try { localStorage.setItem(key, skin); }
      catch { toast('皮肤已应用，这台设备未能保存外观设置'); }
      dialog.close();
    });
    apply(current);
    addJournalEntry();
    new MutationObserver(addJournalEntry).observe(main, {childList:true});
  }

  if (web) {
    mount();
  } else {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = '/web/skins.css?v=20261110-android-skins-1';
    sheet.onload = () => {
      root.classList.add('app-skins');
      mount();
    };
    document.head.append(sheet);
  }
})();

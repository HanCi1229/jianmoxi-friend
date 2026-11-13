/* 网页入口负责导航提示、快捷键与本地皮肤。 */
(() => {
  'use strict';
  const labels = {inspiration:'发现灵感',conversation:'与小溪对话',reading:'阅读时光',articles:'我的文章',journal:'我的写作生活'};
  const desktopLayout = matchMedia('(min-width:681px)');

  function installPanelToggle(panel, label, target, headers, iconPath) {
    if (!target) return;
    target.id = `web-${panel}-panel`;
    const root = document.documentElement;
    const state = `data-web-${panel}-collapsed`;
    const buttons = headers.filter(Boolean).map(header => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `web-panel-toggle web-panel-toggle-${panel}`;
      button.setAttribute('aria-controls', target.id);
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPath}"/></svg>`;
      header.prepend(button);
      return button;
    });
    function updateButtons() {
      const expanded = !root.hasAttribute(state);
      for (const button of buttons) {
        button.setAttribute('aria-expanded', String(expanded));
        const text = `${expanded ? '收起' : '展开'}${label}`;
        button.title = text;
        button.setAttribute('aria-label', text);
      }
    }
    for (const button of buttons) {
      button.addEventListener('click', () => {
        root.toggleAttribute(state);
        updateButtons();
      });
    }
    updateButtons();
  }

  installPanelToggle('nav', '主导航', document.querySelector('.sidebar'),
    [document.querySelector('.topbar-heading')],
    'M4 5h16v14H4z M9 5v14m-3-11h1m-1 4h1m-1 4h1');

  const chatHeader = assistantPanel.querySelector('.xchat-header');
  const historyPanel = assistantPanel.querySelector('.xchat-sidebar');
  const historyButton = chatHeader.querySelector('[data-chat="sidebar"]');
  const returnButton = chatHeader.querySelector('[data-chat="close"]');
  const newChatButton = chatHeader.querySelector('[data-chat="new"]');
  const historyRail = matchMedia('(min-width:761px)');
  const historyKey = (window.xingzouCloud?.storageKey('jianmoxi-web-chat-history')||'jianmoxi-web-chat-history');
  const returnLabels = {editor:'返回写作',reader:'返回阅读',reading:'返回书库',articles:'返回文章',journal:'返回我的空间',inspiration:'返回灵感'};
  let historyPreference = null;
  let hasChatHistory = false;
  let chatOrigin;
  let returningToWorkbench = false;
  try {
    const stored = localStorage.getItem(historyKey);
    if (stored === 'open' || stored === 'closed') historyPreference = stored === 'open';
  } catch { /* Keep the setting in this tab when storage is unavailable. */ }

  historyPanel.id = 'web-history-panel';
  historyPanel.querySelector('.xchat-brand').insertAdjacentHTML('afterbegin', '<strong class="web-chat-history-title">对话历史</strong>');
  historyPanel.querySelector('.xchat-new').remove();
  historyPanel.querySelector('.xchat-back').remove();
  historyButton.classList.remove('xchat-mobile');
  historyButton.classList.add('web-chat-history');
  historyButton.setAttribute('aria-controls', historyPanel.id);
  historyButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16v14H4z M9 5v14m3-10h5m-5 4h5"/></svg>';
  delete returnButton.dataset.chat;
  returnButton.className = 'web-chat-return';
  returnButton.innerHTML = chatIcon('back') + '<span>返回工作台</span>';
  chatHeader.prepend(returnButton);
  newChatButton.classList.add('web-chat-new');
  newChatButton.title = '新建对话';
  newChatButton.insertAdjacentHTML('beforeend', '<span>新建对话</span>');
  assistantPanel.setAttribute('aria-label', '小溪 AI');

  function updateHistoryPanel() {
    const railOpen = historyPreference ?? hasChatHistory;
    document.documentElement.toggleAttribute('data-web-history-collapsed', !railOpen);
    const expanded = historyRail.matches ? railOpen : assistantPanel.classList.contains('sidebar-open');
    const label = expanded ? '收起对话历史' : '展开对话历史';
    historyButton.setAttribute('aria-expanded', String(expanded));
    historyButton.setAttribute('aria-label', label);
    historyButton.title = label;
  }

  const drawHistory = drawChatHistory;
  drawChatHistory = function () {
    drawHistory();
    if (!chatArchived) hasChatHistory = chatThreads.length > 0;
    updateHistoryPanel();
  };
  const setHistoryDrawer = chatSidebar;
  chatSidebar = function (open) {
    const focusWasInHistory = historyPanel.contains(document.activeElement);
    setHistoryDrawer(open);
    updateHistoryPanel();
    if (!historyRail.matches && !assistantPanel.hidden) {
      if (open) historyPanel.querySelector('[data-chat="sidebar-close"]').focus();
      else if (focusWasInHistory) historyButton.focus();
    }
  };
  historyButton.addEventListener('click', event => {
    event.stopPropagation();
    if (!historyRail.matches) {
      chatSidebar(!assistantPanel.classList.contains('sidebar-open'));
      return;
    }
    historyPreference = !(historyPreference ?? hasChatHistory);
    try { localStorage.setItem(historyKey, historyPreference ? 'open' : 'closed'); } catch {}
    updateHistoryPanel();
  });
  historyRail.addEventListener('change', () => chatSidebar(false));
  updateHistoryPanel();

  const resizeChat = chatViewport;
  chatViewport = function () {
    resizeChat();
    if (!assistantPanel.hidden) assistantPanel.style.height = (window.visualViewport?.height || innerHeight) + 'px';
  };

  const openChat = openAssistant;
  openAssistant = function (context) {
    if (assistantPanel.hidden) {
      const nav = document.activeElement?.closest('[data-shell-page="conversation"]')?.parentElement.id;
      chatOrigin = {page, x:scrollX, y:scrollY, nav};
      const label = returnLabels[page] || '返回工作台';
      returnButton.querySelector('span').textContent = label;
      returnButton.setAttribute('aria-label', label);
      returnButton.title = label;
      // Keep the workbench URL and DOM intact while adding a browser Back step.
      if (!history.state?.webConversation) history.pushState({...history.state, webConversation:true}, '');
    }
    const result = openChat(context);
    assistantPanel.setAttribute('aria-modal', 'true');
    return result;
  };

  const closeChat = closeAssistant;
  closeAssistant = function () {
    if (assistantPanel.hidden) return;
    for (const dialog of assistantPanel.querySelectorAll('dialog[open]')) dialog.close();
    closeChat();
    if (history.state?.webConversation) {
      const state = {...history.state};
      delete state.webConversation;
      history.replaceState(state, '');
    }
    if (chatOrigin?.page === page) {
      window.scrollTo({left:chatOrigin.x, top:chatOrigin.y, behavior:'instant'});
      if (chatOrigin.nav) document.getElementById(chatOrigin.nav)?.querySelector('[data-shell-page="conversation"]')?.focus({preventScroll:true});
    }
  };

  function returnToWorkbench() {
    if (returningToWorkbench) return;
    if (!history.state?.webConversation) return closeAssistant();
    returningToWorkbench = true;
    history.back();
  }
  returnButton.addEventListener('click', returnToWorkbench);
  assistantPanel.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || assistantPanel.querySelector('dialog[open]') || assistantPanel.classList.contains('sidebar-open')) return;
    event.preventDefault();
    event.stopPropagation();
    returnToWorkbench();
  });
  window.addEventListener('popstate', () => {
    returningToWorkbench = false;
    if (history.state?.webConversation) {
      if (assistantPanel.hidden) openAssistant();
    } else {
      closeAssistant();
    }
  });

  const navigateWorkbench = navigate;
  navigate = function (next, skipSave) {
    if (!assistantPanel.hidden) closeAssistant();
    return navigateWorkbench(next, skipSave);
  };

  const writingFonts = {
    song: 'var(--serif)',
    sans: 'var(--sans)',
    kai: 'KaiTi, STKaiti, var(--serif)'
  };
  const writingSizes = [14, 16, 17, 18, 20, 22, 24, 28, 32];
  const writingMarks = new Map([['B','b'], ['STRONG','b'], ['I','i'], ['EM','i'], ['U','u']]);
  let updateWritingSelection;
  document.addEventListener('selectionchange', () => updateWritingSelection?.());

  function readWritingDocument(editor) {
    // A contenteditable line is usually a div. Its final br is a caret
    // placeholder, not another newline in the saved article.
    const text = [];
    const markup = [];
    let hasMarks = false;
    let pendingBreak = false;
    function append(value, marks = []) {
      text.push(value);
      markup.push(marks.reduceRight((html, mark) => `<${mark}>${html}</${mark}>`, esc(value)));
      hasMarks ||= marks.length > 0;
    }
    function visit(parent, marks = []) {
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.data) {
          if (pendingBreak) append('\n');
          append(node.data, marks);
          pendingBreak = false;
        } else if (node.nodeName === 'BR') {
          if (pendingBreak) append('\n');
          pendingBreak = true;
        } else if (node.nodeName === 'DIV' || node.nodeName === 'P') {
          if (text.length || pendingBreak) append('\n');
          pendingBreak = false;
          visit(node, marks);
          pendingBreak = true;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const mark = writingMarks.get(node.nodeName);
          visit(node, mark && !marks.includes(mark) ? [...marks, mark] : marks);
        }
      }
    }
    visit(editor);
    return {value: text.join(''), body: hasMarks ? markup.join('') : ''};
  }

  function installWritingTools(plain) {
    if (!plain || plain.hidden || !document.queryCommandSupported?.('bold')) return;
    const wrap = plain.closest('.editor-wrap');
    const article = articles.find(item => item.id === wrap.dataset.articleId);
    if (!article) return;
    const savedFormat = article.writingFormat;
    const toolbar = document.createElement('div');
    toolbar.className = 'web-writing-tools';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', '正文格式');
    toolbar.innerHTML = `<label>字体 <select><option value="song">宋体</option><option value="sans">黑体</option><option value="kai">楷体</option></select></label>
      <label>字号 <select>${writingSizes.map(size => `<option value="${size}">${size}</option>`).join('')}</select></label>
      <button type="button" aria-label="加粗" aria-pressed="false" aria-keyshortcuts="Control+B Meta+B" title="加粗（Ctrl / ⌘ + B）"><strong>B</strong></button>`;
    const [font, size] = toolbar.querySelectorAll('select');
    const bold = toolbar.querySelector('button');
    font.value = Object.hasOwn(writingFonts, savedFormat?.font) ? savedFormat.font : 'song';
    size.value = writingSizes.includes(savedFormat?.size) ? String(savedFormat.size) : '17';

    const editor = document.createElement('div');
    editor.className = 'editor-body web-writing-body';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-label', '文章正文');
    editor.setAttribute('aria-multiline', 'true');
    editor.dataset.placeholder = plain.placeholder;
    plain.hidden = true;
    plain.value = article.content;
    plain.before(editor);
    wrap.querySelector('[data-action="format"]')?.remove();
    const actions = wrap.querySelector('.editor-top .actions');
    const formatMenu = editorMenu('格式', '格式', toolbar);
    actions.prepend(formatMenu);

    // Other clients and AI tools still use the plain-text article. Reuse its
    // formatted prefix after an append, and never restore outdated words.
    const stored = document.createElement('template');
    if (typeof savedFormat?.body === 'string') stored.innerHTML = savedFormat.body;
    const previous = readWritingDocument(stored.content);
    if (previous.body && plain.value.startsWith(previous.value)) {
      editor.innerHTML = previous.body;
      editor.append(plain.value.slice(previous.value.length));
    } else {
      editor.textContent = plain.value;
    }

    function applyFont() {
      editor.style.fontFamily = writingFonts[font.value];
      editor.style.fontSize = `${size.value}px`;
    }
    function saveInput() {
      const {value, body} = readWritingDocument(editor);
      const format = {font: font.value, size: Number(size.value)};
      if (body) format.body = body;
      const previous = article.writingFormat;
      const customized = !!body || format.font !== 'song' || format.size !== 17;
      if (plain.value === value && JSON.stringify(previous) === JSON.stringify(customized ? format : undefined)) return;
      if (customized) article.writingFormat = format;
      else delete article.writingFormat;
      plain.value = value;
      plain.dispatchEvent(new Event('input', {bubbles:true}));
    }

    let lastRange;
    function rememberSelection() {
      if (!editor.isConnected || document.activeElement !== editor) return;
      const selection = getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      lastRange = selection.getRangeAt(0).cloneRange();
      bold.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
    }
    function toggleBold() {
      if (document.activeElement !== editor) {
        editor.focus({preventScroll:true});
        const range = lastRange && editor.contains(lastRange.commonAncestorContainer) ? lastRange : document.createRange();
        if (range !== lastRange) {
          range.selectNodeContents(editor);
          range.collapse(false);
        }
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('bold');
      saveInput();
      rememberSelection();
    }

    applyFont();
    updateWritingSelection = rememberSelection;
    toolbar.addEventListener('change', () => { applyFont(); saveInput(); });
    bold.addEventListener('mousedown', event => event.preventDefault());
    bold.addEventListener('click', () => {
      toggleBold();
      setEditorMenu(formatMenu, false);
    });
    editor.addEventListener('input', event => {
      if (!event.isComposing) saveInput();
      rememberSelection();
    });
    editor.addEventListener('compositionend', saveInput);
    editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleBold();
      }
    });
    editor.addEventListener('paste', event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain');
      if (text) document.execCommand('insertText', false, text);
    });
    editor.addEventListener('drop', event => event.preventDefault());
  }

  function setEditorMenu(menu, open) {
    menu.classList.toggle('is-open', open);
    menu.firstElementChild.setAttribute('aria-expanded', String(open));
  }

  function editorMenu(label, caption, panel) {
    const menu = document.createElement('div');
    menu.className = 'web-editor-menu';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'web-editor-trigger';
    trigger.setAttribute('aria-label', label);
    trigger.title = label;
    trigger.textContent = caption;
    panel.classList.add('web-editor-popover');
    menu.append(trigger, panel);
    setEditorMenu(menu, false);
    trigger.addEventListener('click', () => setEditorMenu(menu, !menu.classList.contains('is-open')));
    menu.addEventListener('focusout', event => {
      if (event.relatedTarget && !menu.contains(event.relatedTarget)) setEditorMenu(menu, false);
    });
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !menu.classList.contains('is-open')) return;
      event.preventDefault();
      setEditorMenu(menu, false);
      trigger.focus();
    });
    return menu;
  }

  document.addEventListener('pointerdown', event => {
    for (const menu of document.querySelectorAll('.web-editor-menu.is-open')) {
      if (!menu.contains(event.target)) setEditorMenu(menu, false);
    }
  });

  function prepareWebEditor() {
    const plain = document.querySelector('#editor-content');
    if (!plain) return;
    const wrap = plain.closest('.editor-wrap');
    const top = wrap.querySelector('.editor-top');
    if (!top.querySelector('.web-editor-meta')) {
      const actions = top.querySelector('.actions');
      const meta = document.createElement('div');
      meta.className = 'web-editor-meta';
      top.querySelector('#save-status').before(meta);
      meta.append(top.querySelector('#save-status'));
      const date = wrap.querySelector('.notebook-writing-date');
      if (date) meta.append(date);
      const exportButton = actions.querySelector('[data-action="export"]');
      const morePanel = document.createElement('div');
      morePanel.className = 'web-editor-more';
      morePanel.append(exportButton);
      const more = editorMenu('更多操作', '⋯', morePanel);
      exportButton.addEventListener('click', () => {
        setEditorMenu(more, false);
        more.firstElementChild.focus();
      });
      actions.append(more);
    }
    const helper = wrap.querySelector('[data-action="editor-ai"]');
    if (helper && !wrap.querySelector('[data-editorial-discuss]')) {
      const discuss = document.createElement('button');
      discuss.type = 'button';
      discuss.className = 'text-btn';
      discuss.dataset.editorialDiscuss = wrap.dataset.articleId;
      discuss.innerHTML = icon('chat') + '和小溪聊这篇';
      discuss.addEventListener('click', () => saveEditor());
      helper.after(discuss);
    }
    installWritingTools(plain);
  }
  const bindPlainEditor = bindEditor;
  bindEditor = function () {
    bindPlainEditor();
    prepareWebEditor();
  };
  prepareWebEditor();

  function updateInspirationLabel() {
    const list = document.querySelector('.notebook-inspiration .fragment-grid');
    if (!list) return;
    const vertical = desktopLayout.matches || !!document.documentElement.dataset.webSkin;
    list.setAttribute('aria-label', vertical ? '灵感列表' : '灵感卡片，可左右滑动');
    if (vertical) list.removeAttribute('tabindex');
    else list.tabIndex = 0;
  }

  document.addEventListener('jianmoxi:appearance', updateInspirationLabel);

  const update = () => {
    updateInspirationLabel();
    const conversationOpen = document.body.classList.contains('assistant-open');
    const current = conversationOpen ? 'conversation' : document.body.dataset.page || 'inspiration';
    document.querySelector('#desktop-nav [data-shell-page="journal"]')?.remove();
    const breadcrumb = document.querySelector('#breadcrumb');
    if (breadcrumb) breadcrumb.textContent = labels[current] || labels[current === 'reader' ? 'reading' : current === 'editor' ? 'articles' : current] || '发现灵感';
    document.querySelectorAll('#desktop-nav [data-shell-page],.profile[data-shell-page]').forEach(button => {
      const key = button.dataset.shellPage;
      const active = key === current || (current === 'reader' && key === 'reading') || (current === 'editor' && key === 'articles');
      button.title = labels[key] || key;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const search = document.querySelector('#library-search,#article-search');
    const searchButton = document.querySelector('#context-search');
    if (searchButton) searchButton.hidden = !search;
  };
  const observer = new MutationObserver(update);
  observer.observe(document.querySelector('#main'), {childList:true,subtree:true});
  observer.observe(document.body, {attributes:true,attributeFilter:['class','data-page']});
  desktopLayout.addEventListener('change', update);
  const desktopNav = document.querySelector('#desktop-nav');
  if (desktopNav) observer.observe(desktopNav, {childList:true});
  document.querySelector('#context-search')?.addEventListener('click', () => {
    const search = document.querySelector('#library-search,#article-search');
    if (search) { search.focus(); search.select(); }
  });
  document.addEventListener('keydown', event => {
    if (document.querySelector("#web-skin-dialog")?.open) return;
    const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
    if (event.key === 'Escape' && document.querySelector('#dialog')?.open) return;
    if (!editing && event.key === '/') {
      const search = document.querySelector('#library-search,#article-search');
      if (search) {event.preventDefault();event.stopImmediatePropagation();search.focus();search.select();}
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' &&
        page === 'editor' && !document.body.classList.contains('assistant-open') &&
        !document.querySelector('dialog[open]') && document.querySelector('#editor-content')) {
      event.preventDefault();
      saveEditor();
      window.xingzouCloud?.flush();
    }
  }, true);
  update();
  if (history.state?.webConversation) openAssistant();
})();

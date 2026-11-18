/* 笺墨溪 · Friend — 运行时
 * 零依赖静态应用。状态机口径来自 02_工程规范/状态与流程/原型说明.md：
 *   LIFE（首页生活态）→ CHAT（轻量对话）→ 用完退回；PT-10 离开存时间点，PT-11 归来给具体变化。
 * 场景使用静帧背景。
 * 登录后通过 Friend 服务连接笺墨溪书库和模型。
 */
(() => {
  'use strict';

  const KEY = 'jmx-friend-v1';
  const DEFAULT_SCENE = 'morning-rest';
  const DEFAULT_COMPANION_NAME = '小溪';
  const androidApp = navigator.userAgent.includes('JianmoxiFriendAndroid/');
  const clientVersion = /JianmoxiFriendAndroid\/([\d.]+)/.exec(navigator.userAgent)?.[1] || '网页版';
  const supportsEditorSelection = androidApp && navigator.userAgent.includes('FriendEditorSelection/1');
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const now = () => Date.now();
  const rand = a => a[Math.floor(Math.random() * a.length)];

  const saved = load() || {};
  if (saved.companionName === '辰雪' && !saved.companionNameCustomized) delete saved.companionName;
  const state = Object.assign({
    module: 'chat', scene: DEFAULT_SCENE, tab: 'article', mode: 'companion',
    title: '', doc: '', motion: true, autoRead: false, companionName: DEFAULT_COMPANION_NAME, companionAddress: '', companionAvatar: '', frequency: 'normal', paperOpacity: 86, fontSize: 19, done: false,
    lastEditAt: now(), leaveAt: 0, lastStuck: '',
    excerpts: [], chat: [], readerFontSize: 18, lastSuggestAt: 0, caret: null
  }, saved);

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
  const articleFields = ['title', 'doc', 'done', 'caret', 'lastStuck', 'lastEditAt'];
  state.articles ??= [];
  let cloudArticle = null, localDraft = null;
  function articleId() { return crypto.randomUUID(); }
  function snapshotArticle() {
    if (cloudArticle) return;
    if (!state.activeArticle && !state.title.trim() && !state.doc.trim()) return;
    state.activeArticle ||= articleId();
    let article = state.articles.find(item => item.id === state.activeArticle);
    if (!article) { article = { id: state.activeArticle }; state.articles.push(article); }
    for (const key of articleFields) article[key] = state[key];
  }
  function save() {
    snapshotArticle();
    try { localStorage.setItem(KEY, JSON.stringify(localDraft ? { ...state, ...localDraft } : state)); } catch {}
  }
  snapshotArticle();
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- 数据（来自 03_笺墨溪/jianmoxi/data/library-modern.json） ---------------- */
  let LIB = { works: [] };
  fetch('./data/library.json').then(r => r.json()).then(d => {
    LIB = d;
    renderShelf(); renderExcerpts();
    if (!currentWork && LIB.works.length) openWork(LIB.works.find(w => w.id === state.currentWork) || LIB.works[0]);
  }).catch(() => toast('书库数据未加载，请通过本地服务打开'));

  /* ---------------- 场景 ---------------- */
  const sceneChoices = $$('.scene-choice');
  const sceneNames = new Map(sceneChoices.map(button => [button.dataset.scene, button.textContent.trim()]));
  function applyScene(key, persist = true) {
    const isAvailable = sceneNames.has(key);
    if (!isAvailable) key = DEFAULT_SCENE;
    state.scene = key;
    document.body.dataset.scene = key;
    $$('.scene-bg').forEach(el => el.classList.toggle('is-active', el.dataset.scene === key));
    sceneChoices.forEach(el => setPressed(el, el.dataset.scene === key));
    if (persist || !isAvailable) save();
  }

  /* ---------------- 模块 / 页签 / 模式 ---------------- */
  function setModule(m, persist = true) {
    if (m !== 'chat') cancelChatDictation();
    if (m !== state.module) { hangup(); stopSpeaking(); }
    setSceneDrawer(false);
    state.module = m; document.body.dataset.module = m;
    $$('#entry button').forEach(b => setPressed(b, b.dataset.go === m));
    // 沉浸只属于写作模块，回到首页/聊天时恢复场景与她
    document.body.dataset.mode = (m === 'writing' && state.tab === 'article') ? state.mode : 'companion';
    if (m === 'writing') { setTab(state.tab, false); setMode(state.mode, false); }
    if (m !== 'writing' || state.tab === 'reading') {
      syncNativeEditorSelection(m === 'writing' && document.body.hasAttribute('data-reader-open'));
    }
    if (m === 'chat') renderChat(false, true);
    closeNote(); positionNote();
    queueWritingViewport();
    if (persist) save();
  }
  function setTab(t, persist = true) {
    if (t !== 'reading') showReader(false);
    state.tab = t; document.body.dataset.tab = t;
    $('#editorOptions').open = false;
    $('#documentOptions').open = false;
    document.body.dataset.mode = t === 'article' && state.module === 'writing' ? state.mode : 'companion';
    $$('.paper-tools [data-tab]').forEach(b => setPressed(b, b.dataset.tab === t));
    $('#tab-article').hidden = t !== 'article';
    $('#tab-reading').hidden = t !== 'reading';
    $('#tab-articles').hidden = t !== 'articles';
    $('#tab-excerpts').hidden = t !== 'excerpts';
    if (state.module === 'writing') {
      if (t === 'articles') void loadArticles();
      if (t === 'excerpts') void loadExcerpts();
    }
    closeNote(); positionNote();
    queueWritingViewport();
    if (persist) save();
  }
  function setMode(m, persist = true) {
    state.mode = m;
    document.body.dataset.mode = (state.module === 'writing' && state.tab === 'article') ? m : 'companion';
    $$('.writing-modes [data-mode]').forEach(b => setPressed(b, b.dataset.mode === m));
    $('#documentOptions').open = false;
    closeNote(); positionNote();
    queueWritingViewport();

    if (persist) save();
  }
  function setPressed(button, active) {
    button.classList.toggle('on', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $$('#entry button').forEach(b => b.addEventListener('click', () => setModule(b.dataset.go)));
  $$('.paper-tools [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.writing-modes [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#exitImmersive').addEventListener('click', () => setMode('companion'));

  const opacity = $('#paperOpacity');
  opacity.value = state.paperOpacity;
  function applyOpacity() {
    state.paperOpacity = Number(opacity.value);
    document.body.style.setProperty('--paper-alpha', state.paperOpacity / 100);
  }
  opacity.addEventListener('input', () => { applyOpacity(); save(); });
  applyOpacity();

  /* ---------------- 编辑器：同一 DOM，切换不丢光标 ---------------- */
  const ed = $('#editor');
  let nativeEditorSelection = false;
  function syncNativeEditorSelection(active) {
    if (!supportsEditorSelection || nativeEditorSelection === active) return;
    nativeEditorSelection = window.prompt('friend:editor-selection', active ? '1' : '0') === 'ok' && active;
  }
  ed.addEventListener('pointerdown', () => syncNativeEditorSelection(true));
  ed.addEventListener('focus', () => syncNativeEditorSelection(true));
  ed.addEventListener('blur', () => syncNativeEditorSelection(false));
  ed.innerHTML = cleanMarkup(state.doc);
  $('#docTitle').value = state.title;
  document.documentElement.style.setProperty('--doc-size', state.fontSize + 'px');

  function saveCaret() {
    const s = getSelection();
    if (!s?.rangeCount || !ed.contains(s.anchorNode)) return;
    const before = document.createRange();
    before.selectNodeContents(ed);
    before.setEnd(s.anchorNode, s.anchorOffset);
    state.caret = { textOffset: before.toString().length };
  }
  function restoreCaret() {
    if (!state.caret || ed.closest('[hidden]') || state.module !== 'writing') return;
    let offset = state.caret.textOffset;
    let root = ed;
    if (offset == null) {
      root = $$('#editor p, #editor div')[state.caret.p] || ed;
      offset = state.caret.off || 0;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      if (offset <= node.length) { range.setStart(node, offset); break; }
      offset -= node.length;
    }
    if (!node) { range.selectNodeContents(root); range.collapse(false); }
    range.collapse(true);
    const s = getSelection();
    s.removeAllRanges(); s.addRange(range);
  }
  let saveTimer;
  ed.addEventListener('input', () => {
    state.doc = ed.innerHTML; state.lastEditAt = now(); saveCaret();
    state.lastStuck = currentParagraph().slice(0, 36);
    document.body.dataset.typing = 'true';
    $('#saveState').textContent = '正在保存…';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { save(); if (cloudArticle) void saveCloudDraft(); else $('#saveState').textContent = '本机已自动保存 ' + timeStr(); }, 800);
    detect();
  });
  ed.addEventListener('keyup', saveCaret);
  ed.addEventListener('mouseup', saveCaret);
  $('#docTitle').addEventListener('input', e => {
    state.title = e.target.value; state.lastEditAt = now(); save();
    if (cloudArticle) { clearTimeout(saveTimer); saveTimer = setTimeout(saveCloudDraft, 800); }
  });
  function timeStr() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }

  function paragraphAtCaret() {
    const node = getSelection()?.anchorNode;
    if (!node || !ed.contains(node)) return null;
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return parent?.closest('#editor :is(p,div,h2,h3,li,blockquote)') || ed;
  }
  function currentParagraph() {
    return (paragraphAtCaret()?.textContent || ed.lastElementChild?.textContent || ed.textContent).trim();
  }

  let authenticated = false;
  let activeChat = { messages: [], thread: '' };
  let rtcCall = null;
  let chatAccountKey = '', historyRequest = 0;
  let noteThread = '';
  let accountGeneration = 0;
  let readContext, readPlayback;
  async function api(route, payload) {
    const response = await fetch(new URL("." + route, document.baseURI), payload === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '服务暂不可用'), { status: response.status });
    return data;
  }
  async function aiReply(kind, text, excerpt = '', thread = '') {
    try { return await api('/api/friend/reply', { kind, text, excerpt, thread }); }
    catch (error) { return { error: error.message }; }
  }

  let detectTimer, lastSay = 0, noteParagraph = null, noteText = '';
  const dot = $('#syncDot'), note = $('#sayCard'), docWrap = $('.doc-wrap');
  function positionNote() {
    if (!noteParagraph?.isConnected || !companionActive()) { dot.hidden = true; return; }
    const paragraph = noteParagraph.getBoundingClientRect();
    const host = $('#tab-article').getBoundingClientRect();
    const visible = docWrap.getBoundingClientRect();
    const top = paragraph.top + Math.min(14, paragraph.height / 2);
    dot.hidden = top < visible.top + 9 || top > visible.bottom - 9;
    dot.style.setProperty('--note-top', (top - host.top) + 'px');
  }
  function companionActive() {
    return authenticated && state.module === 'writing' && state.tab === 'article' &&
           state.mode === 'companion' && !document.hidden;
  }
  let selectionTimer, interpretationRange = null, noteVersion = 0;
  function closeNote() {
    clearTimeout(selectionTimer);
    interpretationRange = null;
    noteVersion++;
    $('#selectedTools').hidden = true;
    note.hidden = true;
    dot.setAttribute('aria-expanded', 'false');
  }
  function detect() {
    clearTimeout(detectTimer);
    if (!note.hidden) closeNote();
    noteParagraph = null; dot.hidden = true;
    const paragraph = paragraphAtCaret();
    detectTimer = setTimeout(() => {
      delete document.body.dataset.typing;
      const interval = state.frequency === 'low' ? 120000 : 45000;
      if (!note.hidden || !companionActive() || state.frequency === 'off' || !ed.contains(paragraph) || now() - lastSay < interval) return;
      const text = paragraph.textContent.trim();
      if (text.length < 12) return;
      lastSay = now();
      noteParagraph = paragraph;
      note.classList.remove('selection-note');
      prepareNote('写作灵感', text, '');
      positionNote();
    }, state.frequency === 'low' ? 12000 : 6000);
  }
  function prepareNote(title, text, reply) {
    noteText = text;
    noteThread = '';
    noteVersion++;
    $('#sayK').textContent = title;
    $('#noteQuote').textContent = text;
    $('#sayT').textContent = reply;
    $('#noteInput').value = '';
    $('#noteAnalyze').hidden = true;
    $('#noteAnalyze').disabled = false;
    $('#noteForm button').disabled = false;
    $('#noteLog').replaceChildren();
    note.scrollTop = 0;
  }
  function positionInterpretation() {
    if (!interpretationRange) return;
    const host = $('#tab-article').getBoundingClientRect();
    const rects = interpretationRange.getClientRects();
    const end = rects[rects.length - 1];
    if (!end) return;
    note.style.setProperty('--selection-left', Math.max(8, Math.min(end.left - host.left, host.width - note.offsetWidth - 8)) + 'px');
    note.style.setProperty('--selection-top', end.bottom - host.top + 7 + 'px');
  }
  function selectedEditorRange() {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    return ed.contains(range.commonAncestorContainer) && range.toString().trim() ? range : null;
  }
  function openInterpretation(range = selectedEditorRange()) {
    if (state.module !== 'writing' || state.tab !== 'article' || !range ||
        !ed.contains(range.startContainer) || !ed.contains(range.endContainer)) return;
    const text = range.toString().trim();
    if (!text || (interpretationRange && range.compareBoundaryPoints(Range.START_TO_START, interpretationRange) === 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, interpretationRange) === 0)) return;
    closeNote();
    noteParagraph = null;
    dot.hidden = true;
    interpretationRange = range.cloneRange();
    prepareNote('AI 解读', text, '点击解读后发送选中的文字。');
    $('#noteAnalyze').hidden = false;
    note.classList.add('selection-note');
    note.hidden = false;
    positionInterpretation();
    const overflow = note.getBoundingClientRect().bottom - docWrap.getBoundingClientRect().bottom + 8;
    if (overflow > 0) { docWrap.scrollTop += overflow; positionInterpretation(); }
  }
  $('#selectionAI').addEventListener('click', () => {
    openInterpretation();
    if (interpretationRange) void analyzeNote('interpret');
  });
  $('#documentAI').addEventListener('click', () => {
    documentOptions.open = false;
    openInterpretation(documentSelection);
    if (interpretationRange) void analyzeNote('interpret');
  });
  let selectingWithPointer = false;
  function scheduleInterpretation() {
    clearTimeout(selectionTimer);
    if (!selectingWithPointer && document.activeElement === ed) {
      selectionTimer = setTimeout(showEditorTools, 120);
    }
  }
  ed.addEventListener('pointerdown', () => {
    selectingWithPointer = true;
    clearTimeout(selectionTimer);
  });
  function finishSelection() {
    if (!selectingWithPointer) return;
    selectingWithPointer = false;
    scheduleInterpretation();
  }
  window.addEventListener('pointerup', finishSelection);
  window.addEventListener('pointercancel', finishSelection);
  window.addEventListener('blur', finishSelection);
  document.addEventListener('selectionchange', scheduleInterpretation);
  docWrap.addEventListener('scroll', () => { positionNote(); positionInterpretation(); });
  window.addEventListener('resize', () => { positionNote(); positionInterpretation(); });
  dot.addEventListener('pointerdown', event => event.preventDefault());
  dot.addEventListener('click', () => {
    note.hidden = !note.hidden;
    dot.setAttribute('aria-expanded', String(!note.hidden));
    if (!note.hidden && !noteThread) void analyzeNote('idea');
  });
  $('#sayIgnore').addEventListener('click', () => {
    closeNote(); noteParagraph = null; dot.hidden = true;
    ed.focus({ preventScroll: true }); restoreCaret();
  });
  async function analyzeNote(kind) {
    const version = noteVersion;
    const account = accountGeneration;
    const trigger = $('#noteAnalyze');
    trigger.disabled = true;
    $('#noteForm button').disabled = true;
    $('#sayT').textContent = '正在思考…';
    const reply = await aiReply(kind, '', noteText, noteThread);
    if (version !== noteVersion || account !== accountGeneration) return;
    $('#sayT').textContent = reply.text || reply.error;
    noteThread = reply.thread || noteThread;
    trigger.disabled = false;
    trigger.hidden = !reply.error;
    $('#noteForm button').disabled = false;
  }
  $('#noteAnalyze').addEventListener('click', () => analyzeNote(interpretationRange ? 'interpret' : 'idea'));
  $('#noteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#noteInput'), message = input.value.trim();
    if (!message) return;
    input.value = '';
    const version = noteVersion;
    const account = accountGeneration;
    const button = $('#noteForm button');
    button.disabled = true;
    const reply = await aiReply('followup', message, noteText, noteThread);
    if (version !== noteVersion || account !== accountGeneration) return;
    button.disabled = false;
    noteThread = reply.thread || noteThread;
    for (const line of ['你：' + message, reply.text ? '她：' + reply.text : reply.error]) {
      const p = document.createElement('p');
      p.className = 'message-arrival'; p.textContent = line; $('#noteLog').append(p);
    }
    note.scrollTop = note.scrollHeight;
  });

  function gotoSource(src) {
    setModule('writing'); setTab('reading');
    const w = LIB.works.find(x => x.title === src.title);
    if (w) { openWork(w); showReader(true); }
    const hit = w && $$('#readBody p').find(p => p.textContent.includes(src.text));
    if (hit) { hit.classList.add('hit'); showReaderParagraph(hit); }
    toast(hit ? '已回到原文：' + src.title : '当前书库未收录这条引文的完整出处');
  }
  async function openCloudSource(workId, chapter, quote) {
    const account = accountGeneration;
    const request = ++workRequest;
    try {
      const route = '/api/library/' + encodeURIComponent(workId);
      const work = await api(route);
      if (work.chunked && chapter > 0) {
        work.chapter = await api(route + '/chapters/' + chapter);
        work.body = work.chapter.body;
      }
      if (account !== accountGeneration || request !== workRequest) return;
      setModule('writing'); setTab('reading'); openWork({ ...work, cloud: true }); showReader(true);
      const compact = value => value.replace(/\s/g, '');
      const match = $$('#readBody p').find(p => compact(p.textContent).includes(compact(quote)));
      if (match) {
        match.classList.add('hit');
        showReaderParagraph(match);
      } else toast('已打开出处，未定位到摘录所在段落');
    } catch (error) { toast(error.message); }
  }

  /* ---------------- 聊天 ---------------- */
  function pushMsg(who, text, citations, voice = false) {
    const message = { who, text, citations, at: now() };
    if (voice) message.voiceId = crypto.randomUUID();
    activeChat.messages.push(message);
    if (activeChat.messages.length > 60) activeChat.messages.shift();
    saveChat(); renderChat(true);
    return message;
  }
  const chatInput = $('#chatInput');
  const chatStatus = $('#chatStatus');
  function chatAtEnd(log) {
    return log.scrollHeight - log.clientHeight - log.scrollTop < 64;
  }
  function renderChat(animateLatest = false, followLatest = animateLatest) {
    $('#chatNew').hidden = !activeChat.messages.length;
    const log = $('#chatLog');
    const scroll = log.scrollTop;
    log.replaceChildren();
    for (const m of activeChat.messages) {
      const mine = m.who === 'me';
      const bubble = document.createElement('div');
      bubble.className = 'msg ' + (mine ? 'me' : 'her');
      const content = document.createElement('div');
      content.className = 'chat-content';
      if (mine) content.textContent = m.text;
      else renderChatMarkdown(m.text, content);
      bubble.append(content);
      if (m.src) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'src';
        link.textContent = m.src.author + '《' + m.src.title + '》· ' + m.src.section + '　点回原文 ↗';
        link.addEventListener('click', () => gotoSource(m.src));
        bubble.appendChild(link);
      }
      if (m.citations?.length) {
        const sources = document.createElement('details');
        sources.className = 'chat-sources';
        const summary = document.createElement('summary');
        summary.textContent = '查看出处 · ' + m.citations.length;
        sources.append(summary);
        m.citations.forEach((source, index) => {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'src';
          link.textContent = `[${index + 1}] ${source.author}《${source.title}》` + (source.chapterTitle ? ' · ' + source.chapterTitle : '');
          link.addEventListener('click', () => void openCloudSource(source.workId, source.chapter, source.quote));
          sources.append(link);
        });
        bubble.append(sources);
      }
      const message = document.createElement('div');
      message.className = mine ? 'chat-message chat-user' : 'chat-message chat-assistant';
      if (!mine) {
        const author = document.createElement('div');
        author.className = 'chat-author';
        const avatar = document.createElement('span');
        avatar.className = 'chat-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        applyAvatar(avatar);
        author.append(avatar, state.companionName);
        message.append(author);
      }
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'chat-copy';
      copy.title = '复制';
      copy.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/></svg>';
      copy.setAttribute('aria-label', mine ? '复制你的消息' : '复制小溪的回复');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(m.text); toast('已复制'); }
        catch { toast('复制失败，可长按文字手动复制'); }
      });
      message.append(bubble, copy);
      if (m.failed) {
        const actions = document.createElement('div');
        actions.className = 'chat-actions';
        const failure = document.createElement('span');
        failure.textContent = '未收到回复';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '重新编辑';
        edit.addEventListener('click', () => {
          if (chatInput.value.trim()) { toast('请先处理输入框中的草稿'); return; }
          chatInput.value = m.text;
          editingChatMessage = m;
          resizeChatInput();
          chatInput.focus();
        });
        actions.append(failure, edit);
        message.append(actions);
      }
      log.appendChild(message);
    }
    if (animateLatest) log.lastElementChild?.classList.add('message-arrival');
    log.scrollTop = followLatest ? log.scrollHeight : scroll;
  }
  function resizeChatInput() {
    const log = $('#chatLog');
    const follow = chatAtEnd(log);
    chatInput.style.height = 'auto';
    const limit = Math.ceil(parseFloat(getComputedStyle(chatInput).lineHeight) * 5 + 18);
    chatInput.style.height = Math.min(limit, chatInput.scrollHeight) + 'px';
    chatInput.style.overflowY = chatInput.scrollHeight > limit ? 'auto' : 'hidden';
    if (follow) log.scrollTop = log.scrollHeight;
  }
  let chatPending = false, editingChatMessage = null;
  async function send() {
    const text = chatInput.value.trim();
    if (!text || chatPending || rtcCall) return;
    if (!authenticated) { openLogin(); return; }
    if (editingChatMessage) {
      activeChat.messages = activeChat.messages.filter(m => m !== editingChatMessage);
      editingChatMessage = null;
    }
    chatInput.value = '';
    resizeChatInput();
    const chat = activeChat;
    stopSpeaking();
    if (state.autoRead) prepareReadAloud();
    const result = await cloudChat(text);
    if (result?.text && state.autoRead && activeChat === chat && state.module === 'chat' &&
        !rtcCall && !recording && !dictationTarget && !voiceRec) void speak(result.text);
  }
  async function cloudChat(text) {
    if (chatPending) return null;
    chatPending = true;
    const message = pushMsg('me', text);
    const account = accountGeneration;
    $('#chatSend').disabled = true;
    chatStatus.textContent = state.companionName + '正在回复…';
    chatStatus.hidden = false;
    const result = await aiReply('chat', text, '', activeChat.thread);
    chatPending = false;
    $('#chatSend').disabled = false;
    chatStatus.hidden = true;
    if (account !== accountGeneration) return;
    const follow = chatAtEnd($('#chatLog'));
    if (result.error) {
      message.failed = true;
      saveChat(); renderChat(false, follow);
      toast(result.error);
      return result;
    }
    activeChat.thread = result.thread;
    if (state.companionAddress) result.text = state.companionAddress + '，' + result.text;
    const scroll = $('#chatLog').scrollTop;
    pushMsg('her', result.text, result.citations);
    if (!follow) $('#chatLog').scrollTop = scroll;
    return result;
  }
  function saveChat() {
    if (chatAccountKey && activeChat.messages.length) {
      state.chatSessions[chatAccountKey] = activeChat;
      const voiceMessages = activeChat.messages.filter(message => message.voiceId);
      if (voiceMessages.length) {
        state.voiceChatHistory ??= {};
        const history = state.voiceChatHistory[chatAccountKey] ??= {};
        const previousId = activeChat.voiceHistoryId;
        const id = activeChat.thread || previousId || crypto.randomUUID();
        const messages = new Map((history[id]?.messages || history[previousId]?.messages || []).map(message => [message.voiceId, message]));
        for (const message of voiceMessages) messages.set(message.voiceId, message);
        if (previousId && previousId !== id) delete history[previousId];
        activeChat.voiceHistoryId = id;
        history[id] = { thread: activeChat.thread, voiceHistoryId: id, messages: [...messages.values()].slice(-60) };
        const newest = Object.values(history).sort((a, b) => b.messages.at(-1).at - a.messages.at(-1).at);
        for (const chat of newest.slice(40)) delete history[chat.voiceHistoryId];
      }
    }
    save();
  }
  const chatHistory = $('#chatHistory'), historyList = $('#chatHistoryList'), historyStatus = $('#chatHistoryStatus');
  const historySearch = $('#chatHistorySearch');
  historySearch.addEventListener('input', () => {
    const query = historySearch.value.trim().toLowerCase();
    for (const entry of $$('.history-row', historyList)) entry.hidden = !entry.dataset.search.includes(query);
    for (const group of $$('.history-project', historyList)) {
      group.hidden = !group.querySelector('.history-row:not([hidden])');
      if (query) group.open = true;
    }
  });
  const manageDialog = $('#chatManage'), manageName = $('#chatManageName'), manageStatus = $('#chatManageStatus');
  let managedChat = null, manageAction = '';
  function manageChat(chat, action) {
    managedChat = chat; manageAction = action;
    $('#chatManageTitle').textContent = action === 'rename' ? '重命名对话' : action === 'create' ? '新建项目' : '移动到项目';
    manageName.value = action === 'rename' ? chat.title : chat?.project || '';
    manageName.maxLength = action === 'rename' ? 80 : 40;
    manageName.required = action !== 'project';
    manageName.placeholder = action === 'project' ? '留空移出项目' : '';
    manageName.setAttribute('list', action === 'rename' ? '' : 'chatProjectNames');
    manageStatus.textContent = '';
    manageDialog.showModal();
    manageName.select();
  }
  $('#chatProjectNew').addEventListener('click', () => manageChat(null, 'create'));
  $('#chatManageForm').addEventListener('submit', async event => {
    event.preventDefault();
    const account = accountGeneration, action = manageAction, chat = managedChat;
    const button = event.submitter;
    button.disabled = true;
    try {
      await api('/api/friend/history' + (chat ? '/' + chat.id : ''), action === 'rename' ?
        { title: manageName.value.trim() } : { project: manageName.value.trim() });
      if (account !== accountGeneration) return;
      manageDialog.close();
      $('#chatHistoryOpen').click();
    } catch (error) { if (account === accountGeneration) manageStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });
  function showChat(chat) {
    hangup();
    stopSpeaking();
    cancelChatDictation();
    activeChat = chat;
    editingChatMessage = null;
    chatInput.value = '';
    resizeChatInput();
    renderChat(false, true);
  }
  $('#chatNew').addEventListener('click', () => {
    if (chatPending) { toast('小溪正在回复，完成后可开启新对话'); return; }
    showChat({ messages: [], thread: '' });
  });
  chatHistory.addEventListener('close', () => ++historyRequest);
  $('#chatHistoryOpen').addEventListener('click', async () => {
    if (!authenticated) { openLogin(); return; }
    const account = accountGeneration;
    const request = ++historyRequest;
    historyList.replaceChildren();
    historySearch.value = '';
    historyStatus.textContent = '正在读取历史对话…';
    if (!chatHistory.open) chatHistory.showModal();
    const groups = new Map();
    function addEntry(title, date, open, metadata) {
      let parent = historyList;
      if (metadata?.project) {
        if (!groups.has(metadata.project)) {
          const group = document.createElement('details');
          group.className = 'history-project'; group.open = true;
          const heading = document.createElement('summary');
          heading.textContent = metadata.project;
          const create = document.createElement('button');
          create.type = 'button'; create.textContent = '＋ 新对话';
          create.addEventListener('click', async () => {
            if (chatPending) { toast('请等待当前回复结束'); return; }
            create.disabled = true;
            try {
              const chat = await api('/api/friend/history', { project: metadata.project });
              if (account !== accountGeneration || !chatHistory.open) return;
              showChat({ messages: [], thread: chat.id });
              chatHistory.close();
            } catch (error) { toast(error.message); }
            finally { create.disabled = false; }
          });
          group.append(heading, create);
          historyList.append(group); groups.set(metadata.project, group);
        }
        parent = groups.get(metadata.project);
      }
      const row = document.createElement('div');
      row.className = 'history-row';
      row.dataset.search = (title + ' ' + (metadata?.project || '')).toLowerCase();
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('span');
      label.textContent = title;
      button.append(label);
      if (date) {
        const time = document.createElement('time');
        time.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
        button.append(time);
      }
      button.addEventListener('click', async () => {
        if (chatPending) { toast('小溪正在回复，请稍后切换'); return; }
        const opening = ++historyRequest;
        try {
          const chat = await open();
          if (opening !== historyRequest || account !== accountGeneration || !chatHistory.open) return;
          showChat(chat);
          chatHistory.close();
        } catch (error) { if (opening === historyRequest) historyStatus.textContent = error.message; }
      });
      row.append(button);
      if (metadata) {
        const menu = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '⋯'; summary.setAttribute('aria-label', '管理对话 ' + title);
        const items = document.createElement('div');
        for (const [action, label] of [['rename', '重命名'], ['project', '移动到项目']]) {
          const item = document.createElement('button');
          item.type = 'button'; item.textContent = label;
          item.addEventListener('click', () => { menu.open = false; manageChat(metadata, action); });
          items.append(item);
        }
        menu.append(summary, items); row.append(menu);
      }
      parent.append(row);
    }
    const local = state.chatSessions[chatAccountKey];
    const voiceHistory = state.voiceChatHistory?.[chatAccountKey] || {};
    const voiceOnly = Object.values(voiceHistory).filter(chat => !chat.thread);
    try {
      const { chats } = await api('/api/friend/history');
      if (request !== historyRequest || account !== accountGeneration || !chatHistory.open) return;
      historyStatus.textContent = chats.length || local?.messages.length || voiceOnly.length ? '' : '还没有历史对话';
      $('#chatProjectNames').replaceChildren(...[...new Set(chats.map(chat => chat.project).filter(Boolean))].map(name => {
        const option = document.createElement('option'); option.value = name; return option;
      }));
      for (const chat of chats) addEntry(chat.title, chat.updatedAt * 1000, async () => {
        const data = await api('/api/friend/history/' + chat.id);
        const cached = voiceHistory[data.id];
        const messages = cached ? [...data.messages, ...cached.messages].sort((a, b) => a.at - b.at) : data.messages;
        return { messages, thread: data.id, voiceHistoryId: cached?.voiceHistoryId };
      }, chat);
      for (const chat of voiceOnly) {
        const entry = local?.voiceHistoryId === chat.voiceHistoryId ? local : chat;
        addEntry(entry.messages.find(item => item.who === 'me')?.text || '语音通话', entry.messages.at(-1).at, () => structuredClone(entry));
      }
      if (!local?.messages.length || chats.some(chat => local.thread === chat.id) ||
          voiceOnly.some(chat => chat.voiceHistoryId === local.voiceHistoryId)) return;
    } catch (error) {
      if (request !== historyRequest || account !== accountGeneration || !chatHistory.open) return;
      historyStatus.textContent = error.message;
      if (!local?.messages.length) return;
    }
    addEntry(local.messages.find(item => item.who === 'me')?.text || '本机对话', 0, () => local);
  });
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); void send(); });
  chatInput.addEventListener('input', resizeChatInput);
  chatInput.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229 || e.key !== 'Enter' ||
        !(e.ctrlKey || e.metaKey || (!e.shiftKey && !mobileWriting.matches))) return;
    e.preventDefault();
    void send();
  });
  /* ---------------- 书库和摘录 ---------------- */
  let currentWork = null;
  let shelfRequest = 0, shelfPage = 1, workRequest = 0;
  async function renderShelf(filter = $('#shelfSearch').value.trim(), page = 1) {
    const request = ++shelfRequest;
    const list = $('#shelfList'), next = $('#shelfNext');
    next.hidden = true;
    let works = LIB.works.filter(w => (w.title + w.author + (w.body || []).join('')).includes(filter));
    if (authenticated) {
      try {
        const catalog = await api('/api/library?' + new URLSearchParams({ q: filter, page, limit: 24 }));
        if (request !== shelfRequest) return;
        shelfPage = catalog.page;
        next.hidden = catalog.pages <= 1;
        next.dataset.page = shelfPage < catalog.pages ? shelfPage + 1 : 1;
        next.textContent = shelfPage < catalog.pages ? '下一页' : '回首页';
        works = (catalog.items || []).map(w => ({ ...w, cloud: true }));
      } catch (error) {
        if (request !== shelfRequest) return;
        toast(error.message + '，显示本地书库');
      }
    }
    list.replaceChildren();
    for (const w of works) {
      const button = document.createElement('button');
      const author = document.createElement('small');
      author.textContent = w.author + ' · ' + (w.genre || '散文');
      button.dataset.work = w.id;
      const cover = document.createElement('span');
      cover.className = 'shelf-cover';
      cover.textContent = w.title;
      cover.setAttribute('aria-hidden', 'true');
      const bookCover = w.cloud && w.bookCover?.url === '/api/library/' + w.id + '/cover' ? w.bookCover.url : '';
      const catalogCover = w.cloud && /^[a-z0-9-]{1,80}$/.test(w.coverId || '') ? '/api/friend/library-image/' + w.coverId : '';
      if (bookCover || catalogCover) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        const sourceId = w.bookCover?.sourceWorkId;
        const shared = bookCover && w.bookCover.seriesKey && /^upload-[a-z0-9-]{1,80}$/.test(sourceId || '') && sourceId !== w.id;
        image.addEventListener('load', () => {
          cover.replaceChildren(image);
          cover.classList.add('has-cover');
        }, { once: true });
        image.addEventListener('error', () => {
          if (shared && image.getAttribute('src') !== '.' + bookCover) image.src = '.' + bookCover;
          else image.remove();
        });
        cover.append(image);
        image.src = '.' + (shared ? '/api/library/' + sourceId + '/cover' : bookCover || catalogCover);
      }
      const label = document.createElement('span');
      label.append(w.title, author);
      button.append(cover, label);
      button.addEventListener('click', async () => {
        const request = ++workRequest;
        try {
          const work = w.cloud ? { ...await api('/api/library/' + encodeURIComponent(w.id)), cloud: true } : w;
          if (request === workRequest && state.module === 'writing' && state.tab === 'reading') {
            openWork(work); showReader(true);
          }
        } catch (error) { toast(error.message); }
      });
      list.append(button);
    }
    if (!works.length) list.textContent = '没有匹配的作品';
    markShelf();
  }
  $('#shelfNext').addEventListener('click', e => renderShelf(undefined, Number(e.target.dataset.page)));
  const chapterControl = $('#chapterControl');
  const chapterStatus = $('#chapterStatus');
  const readerViewport = $('#readerViewport'), readerBody = $('#readBody');
  const readerTools = $('#readerTools'), readerType = $('#readerType'), readerPage = $('#readerPage');
  const readerPrevious = $('#readerPrevious'), readerNext = $('#readerNext');
  const directorySize = 100;
  let directoryPage = 0, directoryRequest = 0, activeSection = 0, chapterPending = 0;
  let readerPageIndex = 0, readerPageCount = 1, readerGesture = null, suppressReaderClick = 0;
  function readerStep() {
    return readerViewport.clientWidth + (parseFloat(getComputedStyle(readerBody).columnGap) || 0);
  }
  function showReaderPage(index = readerPageIndex) {
    if (!readerViewport.clientWidth) return;
    const step = readerStep();
    readerPageCount = Math.max(1, 1 + Math.ceil((readerViewport.scrollWidth - readerViewport.clientWidth - 2) / step));
    readerPageIndex = Math.max(0, Math.min(index, readerPageCount - 1));
    readerViewport.scrollLeft = readerPageIndex * step;
    readerPage.textContent = chapterPending ? '打开章节中…' : (readerPageIndex + 1) + ' / ' + readerPageCount;
    readerPage.setAttribute('aria-label', '第 ' + (readerPageIndex + 1) + ' 页，共 ' + readerPageCount + ' 页，阅读工具');
    const chapter = currentWork?.chapter?.index || 0;
    readerPrevious.disabled = Boolean(chapterPending || (!readerPageIndex && !chapter));
    readerNext.disabled = Boolean(chapterPending || (readerPageIndex === readerPageCount - 1 &&
      (!currentWork?.chunked || chapter + 1 >= currentWork.chapterCount)));
    $('#readerSelectionTools').hidden = true;
  }
  function showReaderPosition(position) {
    if (!position || !readerViewport.clientWidth) return;
    const rect = position.getClientRects()[0];
    if (!rect) return;
    const offset = rect.left - readerViewport.getBoundingClientRect().left + readerViewport.scrollLeft;
    showReaderPage(Math.floor((offset + 2) / readerStep()));
  }
  function showReaderParagraph(paragraph) { showReaderPosition(paragraph); }
  function setReaderTools(visible) {
    readerTools.hidden = !visible;
    readerPage.setAttribute('aria-expanded', String(visible));
    if (!visible) chapterControl.open = readerType.open = false;
  }
  function turnReaderPage(direction) {
    if (!currentWork || chapterPending) return;
    const index = readerPageIndex + direction;
    if (index >= 0 && index < readerPageCount) {
      getSelection()?.removeAllRanges();
      showReaderPage(index);
    } else if (currentWork.chunked) {
      const chapter = (currentWork.chapter?.index || 0) + direction;
      if (chapter >= 0 && chapter < currentWork.chapterCount) void openChapter(chapter, direction < 0);
    }
  }
  function changeReaderFont(delta = 0) {
    const viewport = readerViewport.getBoundingClientRect();
    const paragraph = delta && [...readerBody.children].find(p => [...p.getClientRects()].some(rect =>
      rect.left < viewport.right && rect.right > viewport.left));
    const fragment = paragraph && [...paragraph.getClientRects()].find(rect => rect.left < viewport.right && rect.right > viewport.left);
    const range = fragment && document.caretRangeFromPoint?.(
      Math.max(viewport.left, fragment.left) + 4, Math.max(viewport.top, fragment.top) + 10
    );
    const anchor = range && readerBody.contains(range.startContainer) ? range : paragraph;
    const font = Math.max(14, Math.min(28, (Number(state.readerFontSize) || 18) + delta));
    state.readerFontSize = font;
    readerViewport.style.setProperty('--reader-font', font + 'px');
    $('#readerFontSize').value = font;
    $('#readerSmaller').disabled = font === 14;
    $('#readerLarger').disabled = font === 28;
    if (anchor) showReaderPosition(anchor);
    else showReaderPage();
    if (delta) save();
  }
  $('#readerSmaller').addEventListener('click', () => changeReaderFont(-1));
  $('#readerLarger').addEventListener('click', () => changeReaderFont(1));
  readerPrevious.addEventListener('click', () => turnReaderPage(-1));
  readerNext.addEventListener('click', () => turnReaderPage(1));
  readerPage.addEventListener('click', () => setReaderTools(readerTools.hidden));
  chapterControl.addEventListener('toggle', () => { if (chapterControl.open) readerType.open = false; });
  readerType.addEventListener('toggle', () => { if (readerType.open) chapterControl.open = false; });
  readerViewport.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key) || event.shiftKey) return;
    event.preventDefault();
    turnReaderPage(['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 1);
  });
  readerViewport.addEventListener('pointerdown', event => {
    readerGesture = event.isPrimary ? { x: event.clientX, y: event.clientY, at: event.timeStamp } : null;
  });
  readerViewport.addEventListener('pointercancel', () => { readerGesture = null; });
  readerViewport.addEventListener('pointerup', event => {
    const start = readerGesture;
    readerGesture = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || event.timeStamp - start.at > 450) suppressReaderClick = now() + 250;
    if (event.pointerType === 'touch' && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 &&
        !(getSelection()?.toString().trim())) turnReaderPage(dx < 0 ? 1 : -1);
  });
  readerViewport.addEventListener('click', event => {
    if (now() < suppressReaderClick || getSelection()?.toString().trim()) return;
    const rect = readerViewport.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x < .24) turnReaderPage(-1);
    else if (x > .76) turnReaderPage(1);
    else setReaderTools(readerTools.hidden);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => showReaderPage()).observe(readerViewport);
  changeReaderFont();
  function renderDirectory(entries, page = 0) {
    directoryPage = page;
    const work = currentWork;
    const list = $('#chapterList');
    list.replaceChildren();
    for (const { index, title } of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title || '第 ' + (index + 1) + ' 章';
      if (index === (work.chapter?.index ?? activeSection)) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => void openChapter(index));
      list.append(button);
    }
    const hasNext = Boolean(work.chunked && (page + 1) * directorySize < work.chapterCount);
    $('#chapterPages').hidden = !page && !hasNext;
    $('#chaptersPrevious').disabled = !page;
    $('#chaptersNext').disabled = !hasNext;
  }
  async function loadDirectory(page) {
    const work = currentWork;
    const request = ++directoryRequest;
    chapterStatus.textContent = '正在读取目录…';
    chapterStatus.hidden = false;
    try {
      const data = await api('/api/library/' + encodeURIComponent(work.id) + '/chapters/' + page * directorySize);
      if (request !== directoryRequest || currentWork !== work) return;
      renderDirectory(data.directory || [], page);
      chapterStatus.hidden = true;
      $('#chapterList button')?.focus();
    } catch (error) {
      if (request === directoryRequest) chapterStatus.textContent = error.message;
    }
  }
  $('#chaptersPrevious').addEventListener('click', () => void loadDirectory(directoryPage - 1));
  $('#chaptersNext').addEventListener('click', () => void loadDirectory(directoryPage + 1));
  async function openChapter(index, lastPage = false) {
    const work = currentWork;
    if (!work || chapterPending) return;
    if (!work.chunked) {
      activeSection = index;
      renderDirectory(work.sections.map((section, i) => ({ index: i, title: section.title })));
      chapterControl.open = false;
      showReaderParagraph(readerBody.children[work.sections[index].start]);
      readerViewport.focus({ preventScroll: true });
      return;
    }
    if (index === work.chapter?.index) { chapterControl.open = false; return; }
    const request = ++workRequest;
    chapterPending = request;
    showReaderPage();
    chapterStatus.textContent = '正在打开章节…';
    chapterStatus.hidden = false;
    try {
      const chapter = await api('/api/library/' + encodeURIComponent(work.id) + '/chapters/' + index);
      if (request === workRequest && currentWork === work) {
        openWork({ ...work, chapter, body: chapter.body });
        showReaderPage(lastPage ? Infinity : 0);
        readerViewport.focus({ preventScroll: true });
      }
    } catch (error) {
      if (request === workRequest) { chapterStatus.textContent = error.message; toast(error.message); }
    } finally {
      if (chapterPending === request) { chapterPending = 0; showReaderPage(); }
    }
  }
  function showReader(open) {
    document.body.toggleAttribute('data-reader-open', open);
    syncNativeEditorSelection(open && state.module === 'writing');
    $('#readerSelectionTools').hidden = true;
    if (open) showReaderPage();
    else { ++workRequest; chapterPending = 0; selectionText = ''; setReaderTools(false); }
  }
  $('#readerBack').addEventListener('click', () => {
    showReader(false);
    $('#shelfList button.on')?.focus();
  });
  function markShelf() {
    $$('#shelfList button').forEach((b, i) => b.classList.toggle('on', !!currentWork && b.dataset.work === currentWork.id));
  }
  function openWork(w) {
    currentWork = w; state.currentWork = w.id; save(); markShelf();
    ++directoryRequest;
    activeSection = 0;
    const entries = w.chunked ? w.chapter?.directory || w.chapterDirectory || [] :
      (w.sections || []).map((section, index) => ({ index, title: section.title }));
    chapterControl.hidden = !entries.length;
    chapterControl.open = false;
    chapterStatus.hidden = true;
    renderDirectory(entries, Math.floor((w.chapter?.index || 0) / directorySize));
    const title = $('#readTitle');
    title.textContent = w.chapter?.title || w.title;
    title.title = w.title;
    readerBody.replaceChildren();
    w.body.forEach((p, i) => {
      const el = document.createElement('p'); el.dataset.i = i; el.textContent = p; readerBody.appendChild(el);
    });
    readerPageIndex = 0;
    showReaderPage();
  }
  $('#shelfSearch').addEventListener('input', e => renderShelf(e.target.value.trim()));

  let selectionText = '';
  const readingSelectionTools = $('#readerSelectionTools');
  const readerInterpretation = $('#readerInterpretation');
  let readerInterpretationRequest = 0;
  function onSelect() {
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const active = state.tab === 'reading' && state.module === 'writing' && document.body.hasAttribute('data-reader-open');
    selectionText = active && range && readerBody.contains(range.startContainer) &&
      readerBody.contains(range.endContainer) ? selection.toString().trim() : '';
    readingSelectionTools.hidden = !selectionText;
    if (!selectionText) return;
    const rect = range.getBoundingClientRect();
    const host = $('#paper').getBoundingClientRect();
    const width = readingSelectionTools.offsetWidth;
    const top = rect.top - host.top - readingSelectionTools.offsetHeight - 8;
    readingSelectionTools.style.left = Math.max(8, Math.min(rect.left - host.left + (rect.width - width) / 2, host.width - width - 8)) + 'px';
    readingSelectionTools.style.top = (top >= 8 ? top : rect.bottom - host.top + 8) + 'px';
    $('#btnExcerpt').disabled = selectionText.length < 4;
  }
  document.addEventListener('selectionchange', onSelect);
  readerBody.addEventListener('pointerdown', () => syncNativeEditorSelection(true));
  readingSelectionTools.addEventListener('pointerdown', e => e.preventDefault());
  function clearReadingSelection() {
    readingSelectionTools.hidden = true;
    selectionText = '';
    getSelection()?.removeAllRanges();
  }
  $('#readerInterpret').addEventListener('click', async () => {
    const text = selectionText;
    if (!text) return;
    if (text.length > 1000) { toast('请选取 1000 字以内的原文'); return; }
    const request = ++readerInterpretationRequest, account = accountGeneration;
    const answer = $('#readerInterpretationReply');
    $('#readerInterpretationQuote').textContent = text;
    answer.textContent = '正在解读…';
    clearReadingSelection();
    readerInterpretation.showModal();
    const reply = await aiReply('interpret', '请根据选中文字解读。', text);
    if (request === readerInterpretationRequest && account === accountGeneration && readerInterpretation.open) {
      answer.textContent = reply.text || reply.error;
    }
  });
  readerInterpretation.addEventListener('close', () => { ++readerInterpretationRequest; });
  $('#readerCopy').addEventListener('click', async () => {
    const text = selectionText;
    if (!text) return;
    try {
      const copiedNatively = nativeEditorSelection && window.prompt('friend:copy-selection', text) === 'ok';
      if (!copiedNatively) await navigator.clipboard.writeText(text);
      if (selectionText === text) clearReadingSelection();
      toast('已复制');
    } catch { toast('复制失败，请重试'); }
  });
  $('#btnExcerpt').addEventListener('click', async () => {
    const text = selectionText;
    const work = currentWork;
    if (text.length < 4 || !work) return;
    const p = getSelection()?.anchorNode?.parentElement?.closest('#readBody p');
    const sec = p ? `第 ${Number(p.dataset.i) + 1} 段` : work.title;
    if (work.cloud) {
      try {
        await api('/api/excerpts', {workId:work.id, chapter:work.chapter?.index || 0, text});
        toast('已收藏到笺墨溪');
      } catch (error) { toast(error.message); return; }
    } else {
      state.excerpts.unshift({ text, title: work.title, author: work.author, section: sec });
      state.excerpts = state.excerpts.slice(0, 20); save(); renderExcerpts();
      toast('已摘录 · ' + work.title + ' ' + sec);
    }
    if (currentWork === work && selectionText === text) clearReadingSelection();
  });
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  let excerptRequest = 0;
  async function loadExcerpts() {
    const request = ++excerptRequest, generation = accountGeneration;
    renderExcerpts();
    const status = $('#cloudExcerptStatus');
    status.textContent = authenticated ? '正在读取云端摘录…' : '登录笺墨溪后可查看云端摘录。';
    if (!authenticated) return;
    try {
      const {items} = await api('/api/excerpts');
      if (request !== excerptRequest || generation !== accountGeneration || state.module !== 'writing' || state.tab !== 'excerpts') return;
      status.textContent = items.length ? '笺墨溪云端摘录' : '暂无云端摘录';
      for (const excerpt of items) {
        const item = card({...excerpt, section:excerpt.chapterTitle || '原文'});
        item.dataset.excerptStorage = 'cloud';
        const link = item.querySelector('a');
        link.replaceWith(link.cloneNode(true));
        item.querySelector('a').addEventListener('click', e => {
          e.preventDefault();
          if (generation === accountGeneration) void openCloudSource(excerpt.workId, excerpt.chapter, excerpt.text);
        });
        $('#excerptList').prepend(item);
      }
      applyExcerptFilter();
    } catch (error) { if (request === excerptRequest) status.textContent = error.message; }
  }

  function renderExcerpts() {
    const box = $('#excerptList'); box.innerHTML = '';
    for (const excerpt of state.excerpts) {
      const item = card(excerpt);
      item.dataset.excerptStorage = 'local';
      box.append(item);
    }
    applyExcerptFilter();
  }
  const excerptSearch = $('#excerptQuery'), excerptFilters = $('#excerptFilters');
  let excerptSource = 'all';
  function applyExcerptFilter() {
    const query = excerptSearch.value.trim().toLocaleLowerCase();
    const active = Boolean(query) || excerptSource !== 'all';
    const rows = $$('#excerptList > .card');
    for (const row of rows) {
      row.hidden = (excerptSource !== 'all' && row.dataset.excerptStorage !== excerptSource) ||
        (Boolean(query) && !row.dataset.excerptText.includes(query));
    }
    $('#excerptFilterButton').classList.toggle('on', active);
    const empty = $('#excerptEmpty');
    empty.hidden = rows.some(row => !row.hidden);
    empty.textContent = active ? '没有匹配的摘录。' : '在书中选中文字，即可收藏摘录。';
  }
  $('#excerptFilterButton').addEventListener('click', event => {
    excerptFilters.hidden = !excerptFilters.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!excerptFilters.hidden));
  });
  excerptSearch.addEventListener('input', applyExcerptFilter);
  $$('[data-excerpt-source]').forEach(button => button.addEventListener('click', () => {
    excerptSource = button.dataset.excerptSource;
    $$('[data-excerpt-source]').forEach(item => setPressed(item, item === button));
    applyExcerptFilter();
  }));
  function card(x) {
    const d = document.createElement('div'); d.className = 'card';
    d.dataset.excerptText = [x.text, x.title, x.author].join(' ').toLocaleLowerCase();
    d.innerHTML = `<div class="q">「${escapeHtml(x.text)}」</div><div class="src">${escapeHtml(x.author)}《${escapeHtml(x.title)}》· ${escapeHtml(x.section)}　<a href="#">点回原文 ↗</a></div>`;
    $('.src a', d).addEventListener('click', e => {
      e.preventDefault(); gotoSource(x);
    });
    return d;
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- 语音输入 / 电话 ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function prepareReadAloud() {
    if (!window.AudioContext) return;
    try {
      readContext ||= new AudioContext();
      if (readContext.state !== 'running') void readContext.resume().catch(() => {});
    } catch {}
  }

  function stopSpeaking() {
    const previous = readPlayback;
    readPlayback = null;
    if (!previous) return;
    previous.request.abort();
    previous.source?.stop();
  }

  async function speak(text) {
    stopSpeaking();
    const current = { request: new AbortController(), source: null };
    readPlayback = current;
    try {
      if (!readContext) throw new Error('当前设备暂时无法播放朗读');
      const response = await fetch(new URL('./api/friend/speech', document.baseURI), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: current.request.signal
      });
      if (!response.ok) throw new Error('小溪的朗读暂时不可用');
      const buffer = await readContext.decodeAudioData(await response.arrayBuffer());
      if (readPlayback !== current) return;
      if (readContext.state !== 'running') throw new Error('浏览器暂时未允许播放朗读');
      const source = readContext.createBufferSource();
      source.buffer = buffer;
      source.connect(readContext.destination);
      current.source = source;
      source.onended = () => {
        source.disconnect();
        if (readPlayback === current) readPlayback = null;
      };
      source.start();
    } catch (error) {
      if (readPlayback !== current) return;
      readPlayback = null;
      toast(error.message || '小溪的朗读暂时不可用');
    }
  }
  function recognize(onResult, onEnd) {
    if (!SR) { toast('当前浏览器不支持语音识别，可继续用文字输入'); onEnd && onEnd(); return null; }
    const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => onResult(e.results[0][0].transcript);
    r.onerror = () => { toast('没听清，再说一次也可以'); onEnd && onEnd(); };
    r.onend = () => onEnd && onEnd();
    try { r.start(); } catch { toast('语音识别未能启动'); onEnd?.(); return null; }
    return r;
  }
  let voiceRec = null;
  let dictationTarget = null;
  let serverDictation = false, recording = null;
  const inlineDictation = androidApp && navigator.userAgent.includes('FriendInlineDictation/1');
  const nativeRecording = androidApp && navigator.userAgent.includes('FriendNativeRecording/1');
  let nativeRecordingNumber = 0;
  const dictationBar = $('#dictationBar'), dictationStatus = $('#dictationStatus');
  const dictationStop = $('#dictationStop'), dictationRetry = $('#dictationRetry');
  function displayDictation(active) {
    dictationBar.hidden = !active;
    $('#chatForm').classList.toggle('dictating', active);
    dictationBar.removeAttribute('data-recording');
    dictationStop.disabled = false;
    dictationStop.hidden = false;
    dictationRetry.hidden = true;
    if (active) dictationStatus.textContent = '准备麦克风…';
  }
  function stopMicrophone(session) {
    clearInterval(session.clock);
    session.stream?.getTracks().forEach(track => track.stop());
    session.stream = null;
  }
  function cancelChatDictation() {
    if (recording) {
      const session = recording;
      recording = null;
      session.abort?.abort();
      if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
      if (session.nativeId && !session.audio) window.prompt('friend:record-cancel', session.nativeId);
      stopMicrophone(session);
      displayDictation(false);
    }
    if (dictationTarget === chatInput) {
      dictationTarget = null;
      window.prompt('friend:dictation-cancel', '');
      displayDictation(false);
    }
    if (voiceRec) {
      voiceRec.abort();
      voiceRec = null;
      displayDictation(false);
    }
  }
  function recordingStarted(session) {
    const started = performance.now();
    dictationBar.dataset.recording = '';
    dictationStop.disabled = false;
    dictationStatus.textContent = '正在聆听 · 0:00';
    session.clock = setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      if (seconds >= 30) finishRecording(session);
      else dictationStatus.textContent = '正在聆听 · 0:' + String(seconds).padStart(2, '0');
    }, 250);
  }
  function finishRecording(session) {
    if (recording !== session || !dictationBar.hasAttribute('data-recording')) return;
    clearInterval(session.clock);
    dictationBar.removeAttribute('data-recording');
    dictationStop.disabled = true;
    dictationStatus.textContent = '正在转写…';
    if (session.nativeId) window.prompt('friend:record-stop', session.nativeId);
    else if (session.recorder?.state === 'recording') session.recorder.stop();
  }
  async function uploadDictation(session) {
    const abort = new AbortController();
    session.abort = abort;
    const deadline = setTimeout(() => abort.abort(), 28000);
    dictationStatus.textContent = '正在转写…';
    dictationRetry.hidden = true;
    dictationStop.disabled = true;
    try {
      const response = await fetch(new URL('./api/friend/dictation', document.baseURI), {
        method: 'POST', body: session.audio, signal: abort.signal
      });
      const data = await response.json();
      if (recording !== session) return;
      if (!response.ok || !data.text) {
        throw Object.assign(new Error(data.error || '没收到转写结果'), { status: response.status });
      }
      recording = null;
      displayDictation(false);
      appendDictation(session.input, data.text, session.selection);
    } catch (error) {
      if (recording !== session) return;
      if (!error.status || error.status === 429 || error.status >= 500) {
        dictationStatus.textContent = error.status === 429 ? '服务忙，稍后重试' : '转写失败，可重试这段录音';
        dictationStop.hidden = true;
        dictationRetry.hidden = false;
      } else {
        cancelChatDictation();
        toast(error.message);
      }
    } finally {
      clearTimeout(deadline);
    }
  }
  function recordOnAndroid(input) {
    const session = { input, selection: [input.selectionStart, input.selectionEnd], nativeId: String(++nativeRecordingNumber) };
    recording = session;
    displayDictation(true);
    dictationStop.disabled = true;
    window.prompt('friend:record-start', session.nativeId);
  }
  window.addEventListener('friend:recording', event => {
    const session = recording;
    const { id, state, data } = event.detail || {};
    if (!session?.nativeId || id !== session.nativeId || session.audio) return;
    if (state === 'started') {
      recordingStarted(session);
    } else if (state === 'audio') {
      stopMicrophone(session);
      dictationBar.removeAttribute('data-recording');
      try {
        const bytes = Uint8Array.from(atob(data), byte => byte.charCodeAt(0));
        if (!bytes.length) throw new Error('Empty recording');
        session.audio = new Blob([bytes], { type: 'audio/mp4' });
        void uploadDictation(session);
      } catch {
        cancelChatDictation();
        toast('没有录到可用声音，请重新录制');
      }
    } else if (state === 'error') {
      cancelChatDictation();
      toast(String(data));
    }
  });
  async function recordDictation(input) {
    const session = { input, selection: [input.selectionStart, input.selectionEnd] };
    recording = session;
    displayDictation(true);
    dictationStop.disabled = true;
    try {
      const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('当前设备不支持录音格式');
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recording !== session) { stopMicrophone(session); return; }
      const recorder = new MediaRecorder(session.stream, { mimeType, audioBitsPerSecond: 32000 });
      session.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstart = () => {
        if (recording === session) recordingStarted(session);
      };
      recorder.onerror = () => {
        if (recording !== session) return;
        cancelChatDictation();
        toast('录音中断，请检查麦克风后重试');
      };
      recorder.onstop = () => {
        stopMicrophone(session);
        if (recording !== session) return;
        session.audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (session.audio.size) void uploadDictation(session);
        else { cancelChatDictation(); toast('没有录到声音，请再试一次'); }
      };
      recorder.start();
    } catch (error) {
      if (recording !== session) return;
      cancelChatDictation();
      toast(error.name === 'NotAllowedError' ? '请在系统设置里允许 Friend 使用麦克风' :
        androidApp && error.name === 'NotReadableError' ? '此版本的录音未能启动，请更新 Friend 后重试' :
          '无法开启麦克风，请检查系统麦克风设置后重试');
    }
  }
  dictationStop.addEventListener('click', () => {
    if (recording) { finishRecording(recording); return; }
    dictationStatus.textContent = '正在转文字…';
    if (inlineDictation) window.prompt('friend:dictation-stop', '');
    else voiceRec?.stop();
  });
  $('#dictationCancel').addEventListener('click', cancelChatDictation);
  dictationRetry.addEventListener('click', () => { if (recording?.audio) void uploadDictation(recording); });
  window.addEventListener('pagehide', cancelChatDictation);
  window.addEventListener('friend:dictation-status', event => {
    if (!dictationTarget) return;
    dictationStatus.textContent = String(event.detail);
    if (!['正在聆听', '正在转文字'].includes(event.detail)) toast(String(event.detail));
  });
  $$('[data-voice]').forEach(button => button.addEventListener('click', () => {
    if (voiceRec) { try { voiceRec.stop(); } catch {} return; }
    if (rtcCall || recording || dictationTarget) return;
    const input = button.closest('.inputbar').querySelector('textarea');
    if (nativeRecording) {
      if (!serverDictation) {
        if (!authenticated) openLogin();
        else toast('语音转写暂未就绪，请稍后再试');
        return;
      }
      stopSpeaking();
      recordOnAndroid(input);
      return;
    }
    if (serverDictation && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      stopSpeaking();
      void recordDictation(input);
      return;
    }
    if (inlineDictation) {
      dictationTarget = input;
      stopSpeaking();
      displayDictation(true);
      window.prompt('friend:dictate', '');
      return;
    }
    if (androidApp && !SR) {
      toast('请更新 App 使用语音转写，或先用键盘麦克风');
      return;
    }
    button.classList.add('on');
    button.setAttribute('aria-pressed', 'true');
    stopSpeaking();
    displayDictation(true);
    voiceRec = recognize(text => {
      appendDictation(input, text);
      if (input.getClientRects().length) input.focus();
    }, () => {
      voiceRec = null;
      displayDictation(false);
      button.classList.remove('on');
      button.setAttribute('aria-pressed', 'false');
    });
    if (voiceRec) voiceRec.onstart = () => { dictationStatus.textContent = '正在聆听'; };
  }));
  window.addEventListener('friend:dictation', event => {
    const target = dictationTarget;
    dictationTarget = null;
    if (!recording) displayDictation(false);
    const text = typeof event.detail === 'string' ? event.detail : '';
    if (text && target === chatInput) appendDictation(target, text);
  });
  function appendDictation(input, text, selection) {
    const [from, to] = selection || [input.value.length, input.value.length];
    const available = input.maxLength - (input.value.length - (to - from));
    input.setRangeText(text.slice(0, Math.max(0, available)), from, to, 'end');
    if (text.length > available) toast('已达到输入字数上限');
    resizeChatInput();
  }

  const callButton = $('[data-call]');

  function setCallStatus(text = '') {
    chatStatus.textContent = text;
    chatStatus.hidden = !text;
  }

  function setCallControls(active) {
    const label = active ? '挂断通话' : '开始通话';
    callButton.title = label;
    callButton.setAttribute('aria-label', label);
    callButton.setAttribute('aria-pressed', String(active));
    $('#chatSend').disabled = active;
    $('[data-voice]').disabled = active;
  }

  function commitCallMessage(call, role) {
    const text = call[role]?.trim();
    call[role] = '';
    if (text && call.chat === activeChat) pushMsg(role, text, undefined, true);
  }

  function stopCallPlayback(call) {
    for (const source of call.playing) source.stop();
    call.playing.clear();
    call.playAt = 0;
  }

  function playCallAudio(call, bytes) {
    if (bytes.byteLength < 2 || bytes.byteLength % 2) return;
    const pcm = new DataView(bytes);
    const audio = call.context.createBuffer(1, bytes.byteLength / 2, 24000);
    const target = audio.getChannelData(0);
    for (let i = 0; i < target.length; i++) target[i] = pcm.getInt16(i * 2, true) / 32768;
    const source = call.context.createBufferSource();
    source.buffer = audio;
    source.connect(call.context.destination);
    source.onended = () => {
      call.playing.delete(source);
      source.disconnect();
      if (rtcCall === call && call.synthesisEnded && !call.playing.size && chatStatus.textContent === '小溪正在说话…') {
        setCallStatus('通话中 · 小溪在听');
      }
    };
    const now = call.context.currentTime;
    const start = call.playAt > now ? call.playAt : now + .04;
    call.playAt = start + audio.duration;
    call.playing.add(source);
    source.start(start);
  }

  function closeRtc(call) {
    clearTimeout(call.timer);
    call.socket?.close();
    call.stream?.getTracks().forEach(track => track.stop());
    call.microphone?.port.close();
    stopCallPlayback(call);
    if (call.context?.state !== 'closed') void call.context?.close().catch(() => {});
  }

  window.addEventListener('pagehide', hangup);
  window.addEventListener('pagehide', stopSpeaking);
  function hangup() { if (rtcCall) endRtc(rtcCall); }

  function endRtc(call, message = '') {
    if (rtcCall !== call) return;
    commitCallMessage(call, 'me');
    commitCallMessage(call, 'her');
    rtcCall = null;
    closeRtc(call);
    setCallControls(false);
    setCallStatus();
    if (message) toast(message);
  }

  callButton.addEventListener('click', async () => {
    if (rtcCall) { hangup(); return; }
    if (!authenticated) { openLogin(); return; }
    if (chatPending) { toast('等小溪回完这条消息，就可以打电话。'); return; }
    if (voiceRec || recording || dictationTarget) { toast('请先结束语音输入。'); return; }
    const call = { chat: activeChat, playing: new Set(), playAt: 0, me: '', her: '' };
    rtcCall = call;
    stopSpeaking();
    setCallControls(true);
    setCallStatus('正在连接小溪…');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
        throw new Error('当前浏览器无法使用实时语音，请用 HTTPS 页面或更新浏览器。');
      }
      call.context = new AudioContext({ sampleRate: 16000 });
      if (call.context.sampleRate !== 16000) throw new Error('当前设备不支持通话音频格式。');
      await call.context.resume();
      if (rtcCall !== call) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (rtcCall !== call) { stream.getTracks().forEach(track => track.stop()); return; }
      call.stream = stream;
      await call.context.audioWorklet.addModule(new URL('./assets/call-audio.js', document.baseURI));
      if (rtcCall !== call) return;
      const microphone = new AudioWorkletNode(call.context, 'friend-microphone', { channelCount: 1, channelCountMode: 'explicit' });
      call.microphone = microphone;
      call.context.createMediaStreamSource(stream).connect(microphone);
      microphone.connect(call.context.destination);

      const url = new URL('./api/friend/call/live', document.baseURI);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      call.socket = socket;
      socket.binaryType = 'arraybuffer';
      call.timer = setTimeout(() => endRtc(call, '通话连接超时，请重试。'), 20000);
      microphone.port.onmessage = event => {
        if (rtcCall !== call || !call.ready || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 64000) return endRtc(call, '上传声音太慢，请检查网络。');
        socket.send(event.data);
      };
      socket.onmessage = event => {
        if (rtcCall !== call) return;
        if (event.data instanceof ArrayBuffer) { playCallAudio(call, event.data); return; }
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        switch (message.type) {
          case 'ready':
            clearTimeout(call.timer);
            call.ready = true;
            setCallStatus('通话中 · 小溪在听');
            break;
          case 'interrupt':
            commitCallMessage(call, 'her');
            stopCallPlayback(call);
            setCallStatus('通话中 · 小溪在听');
            break;
          case 'transcript': call.me = message.text; break;
          case 'thinking':
            commitCallMessage(call, 'me');
            setCallStatus('小溪正在想…');
            break;
          case 'speaking': call.synthesisEnded = false; setCallStatus('小溪正在说话…'); break;
          case 'listening':
            commitCallMessage(call, 'her');
            call.synthesisEnded = true;
            if (!call.playing.size) setCallStatus('通话中 · 小溪在听');
            break;
          case 'reply': call.her = message.text; break;
          case 'reply-ended': commitCallMessage(call, 'her'); break;
          case 'error':
          case 'ended': endRtc(call, message.text); break;
        }
      };
      socket.onerror = () => endRtc(call, '实时语音暂时无法连接，请确认已登录后再试。');
      socket.onclose = () => endRtc(call, '实时语音连接已结束，可以重新拨打。');
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        endRtc(call, androidApp ? '请在系统设置里允许 Friend 使用麦克风。' : '请允许浏览器使用麦克风。');
      } else if (error.name === 'NotReadableError') {
        endRtc(call, clientVersion === '0.1.11'
          ? '请更新 Friend 至 0.1.12，再试一次通话。'
          : '麦克风未能启动，请结束其他录音后再试。');
      } else {
        endRtc(call, error.message || '请稍后再试。');
      }
    }
  });

  /* ---------------- 场景抽屉 / 工具 ---------------- */
  function setSceneDrawer(open) {
    const dialog = $('#sceneDrawer');
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
    $('#btnScene').classList.toggle('on', open);
    $('#btnScene').setAttribute('aria-expanded', String(open));
  }
  $('#btnScene').addEventListener('click', () => {
    setSceneDrawer(true);
  });
  $('#sceneDrawer').addEventListener('close', e => {
    if (!e.currentTarget.open) setSceneDrawer(false);
  });
  $('#drawerClose').addEventListener('click', () => { setSceneDrawer(false); });
  sceneChoices.forEach(b => b.addEventListener('click', () => {
    setSceneDrawer(false); applyScene(b.dataset.scene, false);
    requestAnimationFrame(() => setTimeout(save, 0));
    toast('已到 ' + sceneNames.get(b.dataset.scene));
  }));
  $('#btnFontUp').addEventListener('click', () => setFont(1));
  $('#btnFontDown').addEventListener('click', () => setFont(-1));
  function setFont(d) {
    state.fontSize = Math.min(23, Math.max(16, state.fontSize + d));
    document.documentElement.style.setProperty('--doc-size', state.fontSize + 'px'); save();
  }
  function renderDocumentStatus() {
    $('#docMeta').textContent = state.done ? '已完成' : '草稿';
    $('#docMeta').setAttribute('aria-pressed', String(state.done));
  }
  $('#docMeta').addEventListener('click', () => {
    state.done = !state.done; save();
    renderDocumentStatus();
    if (cloudArticle) void saveCloudDraft();
  });
  $('#btnExport').addEventListener('click', () => {
    $('#documentOptions').open = false;
    const text = state.title + '\n\n' + ed.innerText;
    const name = (state.title || '未命名') + '.txt';
    if (androidApp) {
      window.prompt('friend:export', JSON.stringify({ name, text }));
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 TXT');
  });

  /* ---------------- 离开 / 归来 ---------------- */
  function leave() { state.leaveAt = now(); saveCaret(); save(); }
  document.addEventListener('visibilitychange', () => {
    document.body.dataset.idle = String(document.hidden);
    if (document.hidden) leave(); else { positionNote(); renderToday(); }
  });
  window.addEventListener('beforeunload', event => {
    leave();
    if (cloudChanges()) { event.preventDefault(); event.returnValue = ''; }
  });

  const settings = $('#settings');
  function applyAvatar(element) {
    element.style.backgroundImage = state.companionAvatar ? 'url("' + state.companionAvatar + '")' : '';
    element.classList.toggle('custom-avatar', Boolean(state.companionAvatar));
  }
  function applyMotion() { document.body.dataset.motion = state.motion ? 'on' : 'off'; }
  applyMotion();
  $('#settingsOpen').addEventListener('click', () => {
    $('#settingsMotion').checked = state.motion;
    $('#settingsRead').checked = state.autoRead;
    $('#settingsName').value = state.companionName;
    $('#settingsAddress').value = state.companionAddress;
    $$('#settingsFrequency input').forEach(option => { option.checked = option.value === state.frequency; });
    applyAvatar($('#avatarPreview'));
    settings.showModal();
  });
  const loginForm = $('#loginForm');
  function openLogin() {
    if (!settings.open) $('#settingsOpen').click();
    $('[data-settings="general"]').click();
    loginForm.hidden = false;
    loginForm.elements.username.focus();
  }
  function setChatAccount(accountId, restoreLegacy = false) {
    hangup();
    stopSpeaking();
    cancelChatDictation();
    activeChat = { messages: [], thread: '' };
    chatAccountKey = accountId ? 'account:' + accountId : '';
    if (accountId) {
      state.chatSessions ??= {};
      if (!state.chatSessions[chatAccountKey] && restoreLegacy && state.chat?.length) {
        state.chatSessions[chatAccountKey] = { messages: state.chat, thread: '' };
        state.chat = [];
      }
    }
    editingChatMessage = null;
    if (!accountId) chatInput.value = '';
    save();
    resizeChatInput();
    renderChat(false, true);
  }
  async function updateSession(restoreLegacy = false) {
    const session = await api('/api/session');
    authenticated = Boolean(session.authenticated);
    serverDictation = Boolean(session.dictation);
    if (authenticated || !restoreLegacy) setChatAccount(authenticated ? session.accountId || session.username : null, restoreLegacy);
    $('#saveCloudArticle').hidden = !authenticated || Boolean(cloudArticle);
    renderToday();
    $('#accountStatus').textContent = session.username || (authenticated ? '已登录' : '游客');
    $('#accountAction').textContent = authenticated ? '退出登录' : '登录';
  }
  $('#accountAction').addEventListener('click', async () => {
    if (!authenticated) { openLogin(); return; }
    if (!canLeaveCloudArticle()) return;
    try {
      hangup();
      await api('/api/logout', {});
      accountGeneration++;
      workRequest++;
      if (currentWork?.cloud && LIB.works.length) openWork(LIB.works[0]);
      authenticated = false;
      setChatAccount(null);
      if (cloudArticle) openArticle(localDraft);
      closeNote();
      await updateSession();
      renderShelf();
      refreshWritingCollection();
    } catch (error) { toast(error.message); }
  });
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const button = loginForm.querySelector('button');
    button.disabled = true;
    $('#loginStatus').textContent = '正在连接…';
    try {
      await api('/api/login', Object.fromEntries(new FormData(loginForm)));
      accountGeneration++;
      await updateSession();
      loginForm.hidden = true;
      $('#loginStatus').textContent = '';
      renderShelf();
      refreshWritingCollection();
    } catch (error) { $('#loginStatus').textContent = error.message; }
    finally { loginForm.elements.password.value = ''; button.disabled = false; }
  });
  updateSession(true).then(() => { renderShelf(); refreshWritingCollection(); }).catch(() => {});
  function refreshWritingCollection() {
    if (state.module === 'writing' && ['articles', 'excerpts'].includes(state.tab)) setTab(state.tab, false);
  }
  $('#settingsClose').addEventListener('click', () => settings.close());
  $$('[data-settings]').forEach(button => button.addEventListener('click', () => {
    const general = button.dataset.settings === 'general';
    $('#generalSettings').hidden = !general;
    $('#companionSettings').hidden = general;
    $$('[data-settings]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
  }));
  $('#settingsMotion').addEventListener('change', e => { state.motion = e.target.checked; applyMotion(); save(); });
  $('#settingsRead').addEventListener('change', e => {
    state.autoRead = e.target.checked;
    if (state.autoRead) prepareReadAloud();
    else stopSpeaking();
    save();
  });
  $('#settingsName').addEventListener('change', e => {
    const name = e.target.value.trim();
    state.companionNameCustomized = Boolean(name);
    state.companionName = name || DEFAULT_COMPANION_NAME;
    e.target.value = state.companionName;
    renderChat();
    save();
  });
  $('#settingsAddress').addEventListener('change', e => { state.companionAddress = e.target.value.trim(); save(); });
  $('#settingsFrequency').addEventListener('change', e => {
    if (!e.target.matches('input:checked')) return;
    state.frequency = e.target.value;
    if (state.frequency === 'off') { closeNote(); noteParagraph = null; dot.hidden = true; }
    save();
  });
  $('#settingsAvatar').addEventListener('change', e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512 * 1024) {
      toast('请选择 512 KB 以内的 PNG、JPEG 或 WebP'); return;
    }
    const reader = new FileReader();
    reader.onload = () => { state.companionAvatar = reader.result; applyAvatar($('#avatarPreview')); renderChat(); save(); };
    reader.readAsDataURL(file);
  });
  $('#copyDiagnostics').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(['笺墨溪 Friend · ' + clientVersion, '页面：' + state.module, '视口：' + innerWidth + ' × ' + innerHeight, '云端朗读播放支持：' + Boolean(window.AudioContext)].join('\n'));
      $('#copyDiagnostics').textContent = '已复制';
    } catch { $('#copyDiagnostics').textContent = '复制失败'; }
  });

  function openArticle(article, cloud = null) {
    saveCaret();
    clearTimeout(saveTimer);
    clearTimeout(detectTimer);
    save();
    closeNote();
    noteParagraph = null;
    dot.hidden = true;
    delete document.body.dataset.typing;
    if (cloud && !localDraft) {
      localDraft = Object.fromEntries([...articleFields, 'activeArticle'].map(key => [key, state[key]]));
    }
    cloudArticle = cloud;
    if (!cloud) localDraft = null;
    $('#saveCloudArticle').hidden = !authenticated || Boolean(cloudArticle);
    $('#saveCloudArticle').textContent = '同步本机稿到云端';
    state.activeArticle = article.id;
    for (const key of articleFields) state[key] = article[key];
    ed.innerHTML = cleanMarkup(state.doc);
    editorRange = null;
    closeFind();
    if (cloud) cloudMarkup = ed.innerHTML;
    $('#docTitle').value = state.title;
    renderDocumentStatus();
    $('#saveState').textContent = cloud ? '笺墨溪云端文章' : '自动保存';
    setTab('article', false);
    $('.doc-wrap').scrollTop = 0;
    if (!matchMedia('(pointer: coarse)').matches) {
      if (state.caret) { ed.focus({ preventScroll: true }); restoreCaret(); }
      else $('#docTitle').focus();
    } else if (!cloud && !state.title && !state.doc) $('#docTitle').focus();
    save();
  }
  let articleRequest = 0;
  async function loadArticles() {
    const request = ++articleRequest;
    saveCaret();
    save();
    const list = $('#articleList');
    list.replaceChildren();
    const articles = [...state.articles].sort((a, b) => b.lastEditAt - a.lastEditAt);
    if (!articles.length && !authenticated) list.textContent = '还没有文章。新建一篇开始写。';
    for (const article of articles) {
      const button = document.createElement('button');
      const detail = document.createElement('small');
      button.dataset.localArticle = article.id;
      detail.textContent = (article.done ? '已完成' : '草稿') + ' · ' +
        new Date(article.lastEditAt).toLocaleDateString('zh-CN');
      button.append(article.title.trim() || '未命名文章', detail);
      button.classList.toggle('on', article.id === state.activeArticle);
      button.addEventListener('click', () => { if (canLeaveCloudArticle()) openArticle(article); });
      list.append(button);
    }
    const status = $('#cloudArticlesStatus');
    status.textContent = authenticated ? '正在读取笺墨溪云端文章…' : '登录笺墨溪账号后可查看旧文章。';
    if (!authenticated) return;
    const generation = accountGeneration;
    try {
      const { articles: cloudRows } = await api('/api/friend/articles');
      if (request !== articleRequest || generation !== accountGeneration || state.module !== 'writing' || state.tab !== 'articles') return;
      status.textContent = cloudRows.length ? '笺墨溪云端文章' : '这个账号还没有云端文章。';
      const cloudList = document.createDocumentFragment();
      const cloudIds = new Set(cloudRows.map(row => row.id));
      for (const button of list.querySelectorAll('[data-local-article]')) {
        if (cloudIds.has(button.dataset.localArticle)) button.remove();
      }
      for (const row of cloudRows) {
        const button = document.createElement('button');
        const detail = document.createElement('small');
        detail.textContent = '云端 · ' + (row.done ? '已完成' : '草稿') + ' · ' + row.date;
        button.append(row.title || '未命名文章', detail);
        button.addEventListener('click', () => {
          if (cloudArticle?.id === row.id) { setTab('article'); return; }
          if (!canLeaveCloudArticle()) return;
          openArticle({ id: row.id, title: row.title, doc: row.richContent || escapeHtml(row.content.replace(/\r\n?/g, '\n')), done: row.done,
            caret: null, lastStuck: '', lastEditAt: now() }, row);
        });
        cloudList.append(button);
      }
      list.prepend(cloudList);
    } catch (error) { if (request === articleRequest) status.textContent = error.message; }
  }
  $('#newArticle').addEventListener('click', () => {
    if (canLeaveCloudArticle()) openArticle({
      id: articleId(), title: '', doc: '', caret: null, done: false, lastStuck: '', lastEditAt: now()
    });
  });
  let cloudMarkup = '';
  function cloudChanges() {
    return cloudArticle && (state.title !== cloudArticle.title || ed.innerHTML !== cloudMarkup || state.done !== cloudArticle.done);
  }
  function canLeaveCloudArticle() {
    if (!cloudChanges()) return true;
    setTab('article');
    const sync = $('#saveCloudArticle');
    if (!sync.hidden && !sync.disabled) toast('同步失败，请重试同步后再离开');
    else { void saveCloudDraft(); toast('稿件正在同步，请稍等'); }
    return false;
  }
  $('#saveCloudArticle').addEventListener('click', () => void saveCloudDraft());
  async function saveCloudDraft() {
    const button = $('#saveCloudArticle');
    if (button.disabled || !authenticated || (cloudArticle && !cloudChanges())) return;
    const current = cloudArticle, generation = accountGeneration;
    if (!current && !(state.title.trim() || ed.innerText.trim())) { toast('请先为文章写下标题或正文'); return; }
    clearTimeout(saveTimer);
    save();
    const id = current?.id || state.activeArticle;
    button.disabled = true;
    $('#saveState').textContent = '正在同步…';
    const markup = cleanMarkup(ed.innerHTML);
    const savedMarkup = ed.innerHTML;
    try {
      const { article } = await api('/api/friend/articles', {
        id, revision: current?.revision, create: !current,
        title: state.title, content: ed.innerText, richContent: markup, done: state.done
      });
      if (cloudArticle === current && state.activeArticle === id && generation === accountGeneration) {
        if (!current) {
          snapshotArticle();
          localDraft = Object.fromEntries([...articleFields, 'activeArticle'].map(key => [key, state[key]]));
        }
        cloudArticle = article;
        cloudMarkup = savedMarkup;
        $('#saveState').textContent = cloudChanges() ? '还有修改待保存' : '已保存到笺墨溪';
        button.hidden = true;
        if (cloudChanges()) { clearTimeout(saveTimer); saveTimer = setTimeout(saveCloudDraft, 800); }
      }
    } catch (error) {
      if (cloudArticle === current && state.activeArticle === id && generation === accountGeneration) {
        $('#saveState').textContent = '同步失败，修改仍在当前页面';
        button.hidden = false;
        button.textContent = current ? '重试同步' : '同步本机稿到云端';
        toast(error.message);
      }
    }
    finally { button.disabled = false; }
  }

  const weatherDialog = $('#weatherDialog');
  const todayKey = () => new Date().toLocaleDateString('sv-SE');
  let greetingKey = '', greetingVersion = 0;
  function renderToday() {
    const date = new Date(), day = todayKey();
    $('#todayDate').dateTime = day;
    $('#todayDate').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'short'}).format(date);
    const mood = state.moodDay === day ? state.mood : '';
    $('#todayMood').value = mood;
    renderGreeting(day, mood);
    const weather = state.weather;
    $('#weatherOpen').textContent = weather ? weather.name + ' · ' +
      (Date.now() - weather.updatedAt * 1000 < 1800000 ? weather.condition + ' ' + weather.temperature + '°C' : '更新天气') : '选择城市';
  }
  async function renderGreeting(day, mood) {
    const key = JSON.stringify([day, mood, authenticated, accountGeneration]);
    if (key === greetingKey) return;
    greetingKey = key;
    const version = ++greetingVersion;
    const greeting = $('#todayGreeting');
    greeting.textContent = '今天，按自己的节奏慢慢来。';
    greeting.title = greeting.textContent;
    if (!authenticated) return;
    try {
      const result = await api('/api/companion/greeting', { mood });
      if (version !== greetingVersion || !result.text?.trim()) return;
      greeting.textContent = result.text.replace(/\s+/g, ' ').trim();
      greeting.title = greeting.textContent;
    } catch {
      if (version === greetingVersion) greetingKey = '';
    }
  }
  $('#todayMood').addEventListener('change', e => {
    state.mood = e.target.value; state.moodDay = todayKey(); save(); renderToday();
  });
  $('#weatherOpen').addEventListener('click', () => {
    if (!authenticated) { openLogin(); return; }
    const results = $('#cityResults');
    results.replaceChildren();
    if (state.weather) {
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.textContent = '更新 ' + state.weather.name + ' 的天气';
      refresh.addEventListener('click', () => updateWeather(state.weather));
      results.append(refresh);
    }
    weatherDialog.showModal();
  });
  let weatherRequest = 0;
  async function updateWeather(city) {
    const request = ++weatherRequest;
    const results = $('#cityResults');
    results.textContent = '正在查询天气…';
    try {
      const result = await api('/api/weather', {action:'current',name:city.name,lat:city.lat,lon:city.lon});
      if (weatherRequest !== request) return;
      state.weather = result; save(); renderToday();
      if (weatherDialog.open) weatherDialog.close();
    } catch (error) { if (weatherRequest === request) results.textContent = error.message; }
  }
  $('#weatherForm').addEventListener('submit', async e => {
    e.preventDefault();
    const request = ++weatherRequest;
    const results = $('#cityResults');
    results.textContent = '正在查找城市…';
    try {
      const {cities} = await api('/api/weather', {action:'cities',query:$('#cityQuery').value.trim()});
      if (weatherRequest !== request) return;
      results.replaceChildren();
      if (!cities.length) results.textContent = '没有找到这个城市';
      for (const city of cities) {
        const button = document.createElement('button');
        button.textContent = city.name + ' · ' + city.region;
        button.addEventListener('click', () => updateWeather(city));
        results.append(button);
      }
    } catch (error) { if (weatherRequest === request) results.textContent = error.message; }
  });

  function cleanMarkup(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set(['P','DIV','BR','H2','H3','BLOCKQUOTE','UL','OL','LI','B','STRONG','I','EM','U','S','A','HR','SPAN']);
    for (const element of template.content.querySelectorAll('*')) {
      if (['SCRIPT','STYLE','IFRAME','OBJECT','TEMPLATE'].includes(element.tagName)) { element.remove(); continue; }
      if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; }
      const href = element.tagName === 'A' ? element.getAttribute('href') : null;
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      if (href && /^https?:\/\//i.test(href.trim())) element.setAttribute('href', href.trim());
    }
    return template.innerHTML;
  }

  const selectedTools = $('#selectedTools');
  let editorRange = null, documentSelection = null;
  function setEditorRange(range) {
    ed.focus({preventScroll:true});
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function command(name, value = null, range = editorRange) {
    if (range && ed.contains(range.commonAncestorContainer)) setEditorRange(range);
    else { ed.focus({preventScroll:true}); restoreCaret(); }
    document.execCommand(name, false, value);
    showEditorTools();
  }
  function showEditorTools() {
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const valid = state.module === 'writing' && state.tab === 'article' && range &&
      ed.contains(range.commonAncestorContainer) && $('#findPanel').hidden;
    for (const button of $$('#formatTools button[aria-pressed]')) {
      setPressed(button, Boolean(valid && document.queryCommandState(button.dataset.edit)));
    }
    for (const action of ['undo', 'redo']) {
      $('#formatTools [data-edit="' + action + '"]').disabled = !document.queryCommandEnabled(action);
    }
    selectedTools.hidden = true;
    const hasSelection = Boolean(valid && !range.collapsed && range.toString().trim());
    if (!valid) return;
    editorRange = range.cloneRange();
    if ((nativeEditorSelection || (!androidApp && !mobileWriting.matches)) && hasSelection && !interpretationRange) {
      const host = $('#syncLayer').getBoundingClientRect();
      const visible = docWrap.getBoundingClientRect();
      const bounds = [...range.getClientRects()].find(rect => rect.bottom > visible.top && rect.top < visible.bottom);
      if (!bounds) return;
      selectedTools.hidden = false;
      selectedTools.style.left = Math.max(4, Math.min(bounds.left - host.left, host.width - selectedTools.offsetWidth - 4)) + 'px';
      const above = bounds.top - selectedTools.offsetHeight - 6;
      const top = above >= visible.top ? above : Math.min(bounds.bottom + 6, visible.bottom - selectedTools.offsetHeight);
      selectedTools.style.top = Math.max(visible.top, top) - host.top + 'px';
    }
  }
  for (const toolbar of [$('#formatTools'), selectedTools]) {
    toolbar.addEventListener('pointerdown', e => { if (e.target.closest('button, #editorOptions > summary')) e.preventDefault(); });
    toolbar.addEventListener('click', e => {
      const button = e.target.closest('[data-edit]');
      if (button) {
        command(button.dataset.edit);
        if (button.closest('#editorOptions')) $('#editorOptions').open = false;
      }
    });
  }
  const editorOptions = $('#editorOptions');
  const documentOptions = $('#documentOptions');
  const documentMenuButton = $('summary', documentOptions);
  let pendingMenuRange = null;
  documentMenuButton.addEventListener('pointerdown', event => {
    pendingMenuRange = selectedEditorRange()?.cloneRange() || null;
    if (pendingMenuRange) event.preventDefault();
  });
  documentMenuButton.addEventListener('click', event => {
    documentSelection = selectedEditorRange()?.cloneRange() || (event.detail ? pendingMenuRange : null);
    pendingMenuRange = null;
    $('#documentAI').disabled = !documentSelection;
  });
  document.addEventListener('pointerdown', e => {
    if (editorOptions.open && !editorOptions.contains(e.target)) editorOptions.open = false;
    if (documentOptions.open && !documentOptions.contains(e.target)) documentOptions.open = false;
  });
  for (const menu of [editorOptions, documentOptions]) {
    menu.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        $('summary', menu).focus();
      }
    });
  }
  $('#blockFormat').addEventListener('change', e => command('formatBlock', e.target.value));
  $('#selectionCopy').addEventListener('click', async () => {
    const text = editorRange?.toString();
    if (!text) return;
    try {
      const copiedNatively = nativeEditorSelection && window.prompt('friend:copy-selection', text) === 'ok';
      if (!copiedNatively) await navigator.clipboard.writeText(text);
      toast('已复制');
    }
    catch { toast('复制失败，请再试一次'); }
  });
  ed.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html && !plainPaste) document.execCommand('insertHTML', false, cleanMarkup(html));
    else document.execCommand('insertText', false, text);
    plainPaste = false;
  });
  let plainPaste = false;
  ed.addEventListener('keydown', e => {
    if (e.isComposing) return;
    plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); $('#findOpen').click(); return;
    }
    if (e.key !== ' ' || !getSelection()?.isCollapsed) return;
    const selection = getSelection(), node = selection.anchorNode;
    const block = paragraphAtCaret();
    const prefix = node?.nodeType === Node.TEXT_NODE && node.data.slice(0, selection.anchorOffset);
    const shortcut = {'#':['formatBlock','h2'],'##':['formatBlock','h3'],'>':['formatBlock','blockquote'],'-':['insertUnorderedList'],'1.':['insertOrderedList']}[prefix];
    if (!Array.isArray(shortcut) || (block !== ed && block.textContent !== node.data) || (block === ed && ed.firstChild !== node)) return;
    e.preventDefault();
    const range = document.createRange();
    range.setStart(node,0); range.setEnd(node,selection.anchorOffset);
    setEditorRange(range);
    document.execCommand('delete');
    document.execCommand(shortcut[0],false,shortcut[1]);
  });

  let findIndex = -1, currentMatch = null;
  function matchesInEditor() {
    const query = $('#findText').value;
    if (!query) return [];
    const matches = [];
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let start = 0;
      while ((start = node.data.indexOf(query,start)) !== -1) {
        const range = document.createRange();
        range.setStart(node,start); start += query.length; range.setEnd(node,start);
        matches.push(range);
      }
    }
    return matches;
  }
  function find(step = 0) {
    const matches = matchesInEditor();
    findIndex = matches.length ? (Math.max(0, findIndex) + step + matches.length) % matches.length : -1;
    currentMatch = matches[findIndex];
    $('#findCount').textContent = matches.length ? (findIndex + 1) + ' / ' + matches.length : '无匹配';
    $('#replaceOne').disabled = !currentMatch;
    CSS.highlights?.delete('friend-match');
    if (currentMatch) {
      if (globalThis.Highlight) CSS.highlights.set('friend-match', new Highlight(currentMatch));
      currentMatch.startContainer.parentElement.scrollIntoView({block:'nearest'});
    }
  }
  $('#findOpen').addEventListener('click', () => {
    editorOptions.open = false;
    closeNote(); $('#findPanel').hidden = false; $('#findText').focus(); $('#findText').select();
  });
  function closeFind() {
    $('#findPanel').hidden = true; currentMatch = null; CSS.highlights?.delete('friend-match');
  }
  $('#findClose').addEventListener('click', () => {
    closeFind();
    ed.focus({preventScroll:true}); restoreCaret();
  });
  $('#findText').addEventListener('input', () => { findIndex = 0; find(); });
  $('#findText').addEventListener('keydown', e => {
    if (!e.isComposing && e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
  });
  $('#findPanel').addEventListener('keydown', e => { if (e.key === 'Escape') $('#findClose').click(); });
  $('#findPrevious').addEventListener('click', () => find(-1));
  $('#findNext').addEventListener('click', () => find(1));
  $('#replaceOne').addEventListener('click', () => {
    if (!currentMatch) return;
    const replacement = $('#replaceText').value;
    command(replacement ? 'insertText' : 'delete', replacement,currentMatch);
    $('#replaceText').focus();
  });
  ed.addEventListener('input', () => { if (!$('#findPanel').hidden) find(); });
  docWrap.addEventListener('scroll',showEditorTools);

  const mobileWriting = matchMedia('(max-width: 720px), (pointer: coarse) and (orientation: landscape) and (max-height: 540px)');
  const secondaryTools = [...$('#editorExtra').children];
  const clearFormatting = $('#formatTools [data-edit="removeFormat"]');
  const formatTools = $('#formatTools');
  let viewportWidth = 0, fullViewportHeight = 0, writingViewportFrame = 0;
  let nativeKeyboard = null, nativeKeyboardBridge = false;

  function arrangeWritingTools() {
    editorOptions.open = false;
    documentOptions.open = false;
    const destination = mobileWriting.matches ? $('.format-strip') : $('#editorExtra');
    destination.append(...secondaryTools);
    (mobileWriting.matches ? destination : $('.editor-options-panel', editorOptions)).append(clearFormatting);
    const fontDestination = mobileWriting.matches ? $('.format-strip') : $('.editor-font-controls');
    fontDestination.append($('#btnFontDown'), $('#btnFontUp'));
    showEditorTools();
    queueWritingViewport();
  }

  function queueWritingViewport() {
    if (!writingViewportFrame) writingViewportFrame = requestAnimationFrame(updateWritingViewport);
  }

  function updateWritingViewport() {
    writingViewportFrame = 0;
    const viewport = window.visualViewport;
    const layout = document.documentElement;
    const height = viewport?.height ?? layout.clientHeight;
    if (viewportWidth !== layout.clientWidth) {
      viewportWidth = layout.clientWidth;
      fullViewportHeight = height;
    }
    const atNormalZoom = !viewport || Math.abs(viewport.scale - 1) < .05;
    if (atNormalZoom) fullViewportHeight = Math.max(height, fullViewportHeight);
    const field = document.activeElement;
    const editing = field === ed || field?.matches('#docTitle, #findPanel input, #noteInput, #chatInput');
    const minimumChange = Math.max(88, Math.min(140, fullViewportHeight * .18));
    const keyboard = nativeKeyboard ?? (atNormalZoom && editing && fullViewportHeight - height >= minimumChange);
    const mobileArticle = mobileWriting.matches && state.module === 'writing' && state.tab === 'article';
    const expanded = mobileArticle && keyboard;
    const formatting = mobileArticle && (field === ed || formatTools.contains(field));
    document.body.toggleAttribute('data-writing-format', formatting);
    document.body.toggleAttribute('data-writing-keyboard', expanded);
    const chatKeyboard = mobileWriting.matches && state.module === 'chat' && keyboard && field === chatInput;
    const changed = chatKeyboard !== document.body.hasAttribute('data-chat-keyboard');
    document.body.toggleAttribute('data-chat-keyboard', chatKeyboard);
    if (expanded || chatKeyboard) {
      const top = nativeKeyboardBridge && nativeKeyboard !== null ? 0 : Math.max(0, viewport?.offsetTop || 0);
      const bottom = nativeKeyboardBridge && nativeKeyboard !== null ? 0 : Math.max(0, layout.clientHeight - height - top);
      document.body.style.setProperty('--writing-keyboard-top', top + 'px');
      document.body.style.setProperty('--writing-keyboard-bottom', bottom + 'px');
      if (expanded) keepWritingCaretVisible();
    }
    if (changed) requestAnimationFrame(() => {
      if (chatKeyboard) $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
    });
  }

  function keepWritingCaretVisible() {
    if (document.activeElement !== ed) return;
    const selection = getSelection();
    if (!selection?.focusNode || !ed.contains(selection.focusNode)) return;
    const caret = document.createRange();
    caret.setStart(selection.focusNode, selection.focusOffset);
    caret.collapse(true);
    let rect = caret.getBoundingClientRect();
    if (!rect.height && selection.focusNode instanceof Element) {
      const element = selection.focusNode;
      const index = selection.focusOffset;
      const neighbor = element.childNodes[Math.max(0, index - 1)];
      if (neighbor) {
        caret.selectNodeContents(neighbor);
        caret.collapse(index === 0);
        rect = caret.getBoundingClientRect();
      }
      const block = neighbor instanceof Element ? neighbor : element;
      if (!rect.height && block !== ed) rect = block.getBoundingClientRect();
    }
    const visible = docWrap.getBoundingClientRect();
    if (!rect.height || rect.height > visible.height / 2 || visible.height < 32) return;
    const padding = Math.min(24, visible.height / 8);
    if (rect.bottom > visible.bottom - padding) docWrap.scrollTop += rect.bottom - visible.bottom + padding;
    else if (rect.top < visible.top + padding) docWrap.scrollTop -= visible.top + padding - rect.top;
  }

  $('#dismissWritingKeyboard').addEventListener('click', () => {
    saveCaret();
    const active = document.activeElement;
    if (active === ed || active?.matches('#docTitle, #findPanel input, #noteInput')) active.blur();
    if (nativeKeyboardBridge) window.prompt('friend:hide-keyboard', '');
    queueWritingViewport();
  });
  window.addEventListener('friend:keyboard', event => {
    if (!androidApp || (event.detail !== null && typeof event.detail !== 'boolean')) return;
    nativeKeyboardBridge = true;
    nativeKeyboard = event.detail;
    queueWritingViewport();
  });
  mobileWriting.addEventListener('change', arrangeWritingTools);
  window.addEventListener('resize', queueWritingViewport);
  window.visualViewport?.addEventListener('resize', queueWritingViewport);
  window.visualViewport?.addEventListener('scroll', queueWritingViewport);
  document.addEventListener('focusin', queueWritingViewport);
  document.addEventListener('focusout', queueWritingViewport);
  ed.addEventListener('input', queueWritingViewport);
  arrangeWritingTools();

  window.friendBack = () => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (dialog) { dialog.close(); return true; }
    if (rtcCall) { hangup(); return true; }
    if (document.body.hasAttribute('data-reader-open')) {
      if (!readerTools.hidden) setReaderTools(false);
      else $('#readerBack').click();
      return true;
    }
    if (!$('#sayCard').hidden) { closeNote(); return true; }
    if (!$('#findPanel').hidden) { $('#findClose').click(); return true; }
    if (editorOptions.open) { editorOptions.open = false; return true; }
    if (documentOptions.open) { documentOptions.open = false; return true; }
    if (mobileWriting.matches && state.module === 'writing' && state.tab === 'article' && state.mode === 'immersive') {
      setMode('companion');
      return true;
    }
    if (state.module === 'writing') { setModule('chat'); return true; }
    return !canLeaveCloudArticle();
  };


  /* ---------------- 启动 ---------------- */
  applyScene(state.scene, false);
  $('#clientVersion').textContent = clientVersion;
  setModule(state.module === 'writing' ? 'writing' : 'chat', false);
  resizeChatInput();
  renderDocumentStatus();
  $('#saveState').textContent = '已自动保存 ' + timeStr();
  renderChat(); renderExcerpts(); renderToday();
  setTimeout(restoreCaret, 200);
})();

/* 笺墨溪 · Friend — 运行时
 * 零依赖静态应用。状态机口径来自 02_工程规范/状态与流程/原型说明.md：
 *   LIFE（首页生活态）→ CHAT（轻量对话）→ 用完退回；PT-10 离开存时间点，PT-11 归来给具体变化。
 * 场景只用静帧 + CSS 环境呼吸，不加载任何视频。
 * AI 回复目前走本地陪伴脚本（不代笔、引用可逐字回查）。接真模型时只需替换 AI.reply()。
 */
(() => {
  'use strict';

  const KEY = 'jmx-friend-v1';
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const now = () => Date.now();
  const rand = a => a[Math.floor(Math.random() * a.length)];

  const DEFAULT_DOC =
    '<p>秋天，无论在什么地方的秋天，总是好的；可是啊，北国的秋，却特别地来得清，来得静，来得悲凉。</p>' +
    '<p>我的不远千里，要从杭州赶上青岛，更要从青岛赶上北平来的理由，也不过想饱尝一尝这「秋」，这故都的秋味。</p>' +
    '<p><span class="stuck">可是这秋，来得</span></p>';

  const state = Object.assign({
    module: 'home', scene: 'moon-garden', tab: 'article', mode: 'companion',
    title: '故都的秋', doc: DEFAULT_DOC, fontSize: 19, done: false,
    lastEditAt: now(), leaveAt: 0, lastStuck: '可是这秋，来得',
    excerpts: [], chat: [], quoteCursor: 0, lastSuggestAt: 0, caret: null
  }, load());

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- 数据（来自 03_笺墨溪/jianmoxi/data/library-modern.json） ---------------- */
  let LIB = { works: [], quotes: [] };
  fetch('./data/library.json').then(r => r.json()).then(d => {
    LIB = d;
    renderShelf(); renderQuotes(); renderExcerpts();
    openWork(LIB.works.find(w => w.id === state.currentWork) || LIB.works[0]);
  }).catch(() => toast('书库数据未加载，请通过本地服务打开'));

  /* ---------------- 场景 / 时段 ---------------- */
  const SCENES = {
    'moon-garden':   { name: '月海花园', lines: ['夜色尚静，世界正在继续', '窗边的灯还亮着', '她在翻你摘过的句子'] },
    'wind-plain':    { name: '风眠浮原', lines: ['风从纸外吹过', '白昼很长，足够慢慢写', '远处的草光一明一暗'] },
    'cloud-terminal':{ name: '云上列车终点站', lines: ['列车停在这里，不催你走', '远方的微光收拢了一点', '归来时总有位置留着'] }
  };
  function dayPart() {
    const h = new Date().getHours();
    if (h < 6) return '深夜'; if (h < 10) return '晨光';
    if (h < 17) return '白昼'; if (h < 20) return '暮色'; return '夜色';
  }
  function applyScene(key, persist = true) {
    state.scene = key;
    document.body.dataset.scene = key;
    $$('.scene-bg').forEach(el => el.classList.toggle('is-active', el.dataset.scene === key));
    $$('.scene-choice').forEach(el => el.classList.toggle('on', el.dataset.scene === key));
    $('#homeStatus').textContent = SCENES[key].name + ' · ' + dayPart() + ' · ' + rand(SCENES[key].lines);
    $('#herLabel').innerHTML = rand(SCENES[key].lines) + '<br><small>静息档 · 不弹窗 · 不催促</small>';
    if (persist) save();
  }

  /* ---------------- 归来（PT-10 / PT-11） ---------------- */
  function showReturn() {
    const hours = state.leaveAt ? (now() - state.leaveAt) / 3600000 : 0;
    const title = state.title || '这份稿子';
    let text, meta;
    if (!state.leaveAt || hours < 1) {
      text = `你停在《${title}》那句「${state.lastStuck}」`;
      meta = '刚刚 · 她替你留着灯';
    } else if (hours < 24) {
      text = `你停在《${title}》那句「${state.lastStuck}」`;
      meta = `离开 ${Math.round(hours)} 小时 · 那句还在原处 · ${dayPart()}`;
    } else {
      text = `隔了 ${Math.floor(hours / 24)} 天，《${title}》那句还停在原处`;
      meta = `「${state.lastStuck}」· 她没替你落一个字`;
    }
    $('#returnText').textContent = text;
    $('#returnMeta').textContent = meta;
    if (state.leaveAt) { state.leaveAt = 0; save(); }
  }
  $('#returnGo').addEventListener('click', e => {
    e.preventDefault();
    setModule('writing'); setTab('article'); setMode('companion');
    setTimeout(() => focusStuck(), 60);
  });
  function focusStuck() {
    const ed = $('#editor');
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(state.lastStuck);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + state.lastStuck.length);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        ed.scrollTop = Math.max(0, n.parentElement.offsetTop - 160);
        ed.focus(); return;
      }
    }
    ed.focus();
  }

  /* ---------------- 模块 / 页签 / 模式 ---------------- */
  function setModule(m, persist = true) {
    state.module = m; document.body.dataset.module = m;
    $$('#entry button').forEach(b => b.classList.toggle('on', b.dataset.go === m));
    // 沉浸只属于写作模块，回到首页/聊天时恢复场景与她
    document.body.dataset.mode = (m === 'writing') ? state.mode : 'companion';
    if (m === 'writing') { setTab(state.tab, false); setMode(state.mode, false); }
    if (m === 'chat') renderChat();
    if (persist) save();
  }
  function setTab(t, persist = true) {
    state.tab = t; document.body.dataset.tab = t;
    $$('.paper-tools [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $('#tab-article').hidden = t !== 'article';
    $('#tab-reading').hidden = t !== 'reading';
    if (persist) save();
  }
  function setMode(m, persist = true) {
    state.mode = m;
    document.body.dataset.mode = (state.module === 'writing') ? m : 'companion';
    $$('.paper-tools [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('#saveState').textContent = m === 'immersive' ? '沉浸 · 自动保存' : '陪伴 · 自动保存';
    if (m === 'companion') scheduleSay();
    if (persist) save();
  }
  $$('#entry button').forEach(b => b.addEventListener('click', () => setModule(b.dataset.go)));
  $$('.paper-tools [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.paper-tools [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* ---------------- 编辑器：同一 DOM，切换不丢光标 ---------------- */
  const ed = $('#editor');
  ed.innerHTML = state.doc;
  $('#docTitle').value = state.title;
  document.documentElement.style.setProperty('--doc-size', state.fontSize + 'px');

  function saveCaret() {
    const s = getSelection();
    if (!s || !s.rangeCount || !ed.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    const ps = $$('#editor p, #editor div');
    const p = s.anchorNode.parentElement?.closest('#editor p, #editor div');
    state.caret = { p: p ? ps.indexOf(p) : 0, off: r.startOffset };
  }
  function restoreCaret() {
    if (!state.caret) return;
    const p = $$('#editor p, #editor div')[state.caret.p];
    if (!p) return;
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const n = tw.nextNode(); if (!n) return;
    const off = Math.min(state.caret.off, n.nodeValue.length);
    const r = document.createRange(); r.setStart(n, off); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  let saveTimer;
  ed.addEventListener('input', () => {
    state.doc = ed.innerHTML; state.lastEditAt = now(); saveCaret();
    $('#saveState').textContent = '正在保存…';
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { save(); $('#saveState').textContent = '已自动保存 ' + timeStr(); }, 600);
    detect();
  });
  ed.addEventListener('keyup', saveCaret);
  ed.addEventListener('mouseup', saveCaret);
  $('#docTitle').addEventListener('input', e => { state.title = e.target.value; save(); });
  function timeStr() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }

  function currentParagraph() {
    const s = getSelection();
    const fallback = ($$('#editor p, #editor div').at(-1)?.textContent || '').trim();
    if (!s || !s.rangeCount || !ed.contains(s.anchorNode)) return fallback;
    const p = s.anchorNode?.parentElement?.closest('#editor p, #editor div');
    return (p?.textContent || fallback).trim();
  }

  /* ---------------- 共时层：实时检测 + 不定时建议 / 攀谈 ---------------- */
  const AI = {
    // 接真模型时替换这里；约定：只给看法与引文，不往编辑器写入任何字。
    async reply(text) {
      const para = currentParagraph();
      if (/卡|写不出|不知道|怎么办/.test(text))
        return { text: `你停在「${state.lastStuck}」。不必今晚写完，那句我替你留着。`, src: null };
      if (/累|疲|困|休息/.test(text))
        return { text: '写久了就抬头看看窗外，灯还亮着。我不催你回话。', src: null };
      const q = LIB.quotes.length ? rand(LIB.quotes) : null;
      if (q) return {
        text: `读到「${q.text}」，想起你刚写的「${para.slice(0, 14) || '这一段'}」。${q.author}那句的节奏，或许可以对照着看。`,
        src: q
      };
      return { text: '我在。你想从哪一句接着写？', src: null };
    }
  };

  let detectTimer, sayTimer, lastSay = 0;
  function detect() {
    // 用户判断：实时检测。每次停笔后做一次轻量判断，不改动正文。
    clearTimeout(detectTimer);
    detectTimer = setTimeout(() => {
      if (!companionActive()) return;
      const p = currentParagraph();
      if (p.length < 12 || now() - lastSay < 20000) return;
      showSay('suggest');
    }, 900);
  }
  function companionActive() {
    return state.module === 'writing' && state.tab === 'article' &&
           state.mode === 'companion' && !document.hidden;
  }
  function scheduleSay() {
    clearTimeout(sayTimer);
    // 用户判断：不定时建议与攀谈。18–38 秒随机一次，不弹窗不出声。
    sayTimer = setTimeout(() => {
      if (companionActive()) showSay(Math.random() < .35 ? 'disagree' : 'chat');
      scheduleSay();
    }, 18000 + Math.random() * 20000);
  }
  let activeSource = null;
  function showSay(kind) {
    if (!companionActive()) return;
    lastSay = now(); state.lastSuggestAt = now();
    const para = currentParagraph();
    const q = LIB.quotes.length ? rand(LIB.quotes) : null;
    let k, t, src = null, disagree = false;
    if (kind === 'suggest' && q) {
      k = '不定时的一句 · 绑在当前段';
      t = `「${q.text}」——${q.author}《${q.title}》。你刚写到「${para.slice(0, 14)}」，可以对照着看。`;
      src = q;
    } else if (kind === 'disagree') {
      k = '她会不同意 · 攀谈'; disagree = true;
      t = `我不太同意这一段「${para.slice(0, 8) || '来得静'}」——你前一段写的那句更静。`;
    } else {
      k = '攀谈 · 不必回话';
      t = rand([
        '窗外那点光又移了一寸，你不用抬头看我。',
        '写累了就把光标停着，句子不会跑掉。',
        '我翻到昨天你摘的那句了，出处还在。',
        '这里不催你回话，我只是在。'
      ]);
    }
    activeSource = src;
    const card = $('#sayCard');
    card.classList.toggle('disagree', disagree);
    $('#sayK').textContent = k; $('#sayT').textContent = t;
    $('#saySource').style.display = src ? '' : 'none';
    card.hidden = false; $('#syncDot').hidden = false;
    $('#syncLayer').scrollTop = 0;
    save();
  }
  $('#syncDot').addEventListener('click', () => { $('#sayCard').hidden = false; });
  $('#sayIgnore').addEventListener('click', e => {
    e.preventDefault(); $('#sayCard').hidden = true; $('#syncDot').hidden = true; activeSource = null;
  });
  $('#sayExpand').addEventListener('click', e => {
    e.preventDefault();
    $('#sayT').textContent += '（这里只给看法，不替你落一个字。）';
  });
  $('#saySource').addEventListener('click', e => {
    e.preventDefault();
    if (activeSource) gotoSource(activeSource);
  });
  function gotoSource(src) {
    setModule('writing'); setTab('reading');
    const w = LIB.works.find(x => x.title === src.title);
    if (w) { openWork(w); }
    const hit = $$('#readBody p').find(p => p.textContent.includes(src.text.slice(0, 8)));
    if (hit) { hit.classList.add('hit'); hit.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
    toast(w ? '已回到原文：' + src.title + ' · ' + src.section : '出处：' + src.author + ' · ' + src.section);
  }

  /* ---------------- 聊天 ---------------- */
  function pushMsg(who, text, src) {
    state.chat.push({ who, text, src: src ? { title: src.title, author: src.author, section: src.section, text: src.text } : null, at: now() });
    if (state.chat.length > 60) state.chat.shift();
    save(); renderChat();
  }
  function renderChat() {
    const log = $('#chatLog'); log.innerHTML = '';
    if (!state.chat.length) {
      const d = document.createElement('div');
      d.className = 'msg her'; d.textContent = `你停在「${state.lastStuck}」。不必先说话，我在。`;
      log.appendChild(d);
    }
    state.chat.forEach(m => {
      const d = document.createElement('div'); d.className = 'msg ' + (m.who === 'me' ? 'me' : 'her');
      d.textContent = m.text;
      if (m.src) {
        const s = document.createElement('span'); s.className = 'src';
        s.textContent = `${m.src.author}《${m.src.title}》· ${m.src.section}　点回原文 ↗`;
        s.style.cursor = 'pointer';
        s.addEventListener('click', () => gotoSource(m.src));
        d.appendChild(s);
      }
      log.appendChild(d);
    });
    log.scrollTop = log.scrollHeight;
  }
  async function send(text, inputEl) {
    text = (text || '').trim(); if (!text) return;
    pushMsg('me', text); inputEl.value = '';
    const r = await AI.reply(text);
    setTimeout(() => pushMsg('her', r.text, r.src), 420);
  }
  $('#homeSend').addEventListener('click', () => send($('#homeInput').value, $('#homeInput')));
  $('#chatSend').addEventListener('click', () => send($('#chatInput').value, $('#chatInput')));
  [$('#homeInput'), $('#chatInput')].forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') send(i.value, i);
  }));
  [$('#homeHistory'), $('#chatHistory')].forEach(b => b.addEventListener('click', () => setModule('chat')));
  [$('#homeAttach'), $('#chatAttach')].forEach(b => b.addEventListener('click', () =>
    toast('上下文：当前稿《' + state.title + '》 · 上次停在「' + state.lastStuck + '」')));

  /* ---------------- 阅读：真实书库 / 选中摘录 / 一言 ---------------- */
  let currentWork = null;
  function renderShelf(filter = '') {
    const list = $('#shelfList'); list.innerHTML = '';
    LIB.works.filter(w => (w.title + w.author + (w.body || []).join('')).includes(filter)).forEach(w => {
      const b = document.createElement('button');
      b.innerHTML = `${w.title}<small>${w.author} · ${w.genre || '散文'}</small>`;
      b.addEventListener('click', () => openWork(w));
      list.appendChild(b);
    });
    if (!list.children.length) list.innerHTML = '<small style="color:var(--ink3)">没有匹配的作品</small>';
    markShelf();
  }
  function markShelf() {
    $$('#shelfList button').forEach((b, i) => b.classList.toggle('on', !!currentWork && b.textContent.includes(currentWork.title)));
  }
  function openWork(w) {
    currentWork = w; state.currentWork = w.id; save(); markShelf();
    $('#readTitle').textContent = w.title;
    $('#readMeta').textContent = `${w.author} · ${w.genre || '散文'} · 共 ${w.body.length} 段 · 逐字可回查`;
    const body = $('#readBody'); body.innerHTML = '';
    w.body.forEach((p, i) => {
      const el = document.createElement('p'); el.dataset.i = i; el.textContent = p; body.appendChild(el);
    });
    $('#reader').scrollTop = 0;
  }
  $('#shelfSearch').addEventListener('input', e => renderShelf(e.target.value.trim()));

  let selectionText = '';
  function onSelect(e) {
    if (state.tab !== 'reading' || state.module !== 'writing') return;
    const s = getSelection();
    selectionText = s ? s.toString().trim() : '';
    const btn = $('#btnExcerpt');
    if (!selectionText || selectionText.length < 4) { btn.hidden = true; return; }
    const r = s.getRangeAt(0).getBoundingClientRect();
    const host = $('#paper').getBoundingClientRect();
    btn.style.left = Math.min(r.left - host.left + r.width / 2 - 30, host.width - 100) + 'px';
    btn.style.top = (r.top - host.top - 40) + 'px';
    btn.hidden = false;
  }
  document.addEventListener('mouseup', e => { if (e.target.closest('#reader')) setTimeout(() => onSelect(e), 10); });
  $('#btnExcerpt').addEventListener('click', () => {
    if (!selectionText || !currentWork) return;
    const p = getSelection().anchorNode?.parentElement?.closest('#readBody p');
    const sec = p ? `第 ${Number(p.dataset.i) + 1} 段` : currentWork.title;
    state.excerpts.unshift({ text: selectionText, title: currentWork.title, author: currentWork.author, section: sec });
    state.excerpts = state.excerpts.slice(0, 20); save(); renderExcerpts();
    $('#btnExcerpt').hidden = true; getSelection().removeAllRanges();
    toast('已摘录 · ' + currentWork.title + ' ' + sec);
  });
  function renderExcerpts() {
    const box = $('#excerptList'); box.innerHTML = '';
    if (!state.excerpts.length) { box.innerHTML = '<div class="card"><span class="q">选中正文里的一句，会出现「摘录」。</span></div>'; return; }
    state.excerpts.forEach(x => box.appendChild(card(x, true)));
  }
  function renderQuotes() {
    const box = $('#quoteList'); box.innerHTML = '';
    LIB.quotes.slice(0, 9).forEach(q => box.appendChild(card(q, false)));
  }
  function card(x, isExcerpt) {
    const d = document.createElement('div'); d.className = 'card';
    d.innerHTML = `<div class="q">「${escapeHtml(x.text)}」</div><div class="src">${escapeHtml(x.author)}《${escapeHtml(x.title)}》· ${escapeHtml(x.section)}　<a href="#">点回原文 ↗</a></div>`;
    $('.src a', d).addEventListener('click', e => {
      e.preventDefault(); gotoSource(x);
    });
    if (isExcerpt) d.style.borderColor = 'rgba(83,74,183,.35)';
    return d;
  }
  function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- 语音输入 / 电话（浏览器原生，无外部服务） ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function recognize(onResult, onEnd) {
    if (!SR) { toast('当前浏览器不支持语音识别，可继续用文字输入'); onEnd && onEnd(); return null; }
    const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => onResult(e.results[0][0].transcript);
    r.onerror = () => { toast('没听清，再说一次也可以'); onEnd && onEnd(); };
    r.onend = () => onEnd && onEnd();
    try { r.start(); } catch { toast('语音识别未能启动'); onEnd && onEnd(); }
    return r;
  }
  function speak(text) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = .95;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  let voiceTarget = null;
  $('#btnVoice').addEventListener('click', () => {
    if (!SR) { toast('当前浏览器不支持语音识别'); return; }
    const active = document.activeElement;
    voiceTarget = (active && (active.tagName === 'INPUT' || active.id === 'editor')) ? active : null;
    $('#btnVoice').classList.add('on'); $('#btnVoice').textContent = '正在听…';
    recognize(text => {
      if (voiceTarget === ed || (!voiceTarget && state.module === 'writing')) {
        ed.focus(); document.execCommand('insertText', false, text); state.doc = ed.innerHTML; save();
      } else if (voiceTarget) {
        voiceTarget.value += text; voiceTarget.focus();
      } else {
        $('#homeInput').value += text; $('#homeInput').focus();
      }
    }, () => { $('#btnVoice').classList.remove('on'); $('#btnVoice').textContent = '语音输入'; });
  });

  let callRec = null;
  $('#btnCall').addEventListener('click', () => {
    const p = $('#callPanel'); p.hidden = !p.hidden;
    $('#btnCall').classList.toggle('on', !p.hidden);
    if (p.hidden) hangup(); else $('#callState').textContent = '通话中 · 她在线';
  });
  $('#callHang').addEventListener('click', hangup);
  function hangup() {
    if (callRec) { try { callRec.stop(); } catch {} callRec = null; }
    window.speechSynthesis?.cancel();
    $('#callPanel').hidden = true; $('#btnCall').classList.remove('on');
  }
  const talkBtn = $('#callTalk');
  talkBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); talkBtn.textContent = '正在听…';
    $('#callText').textContent = '我在听。';
    callRec = recognize(async text => {
      $('#callText').textContent = '你：' + text;
      pushMsg('me', text);
      const r = await AI.reply(text);
      $('#callText').textContent = '她：' + r.text;
      pushMsg('her', r.text, r.src);
      speak(r.text);
    }, () => { talkBtn.textContent = '按住说话'; });
  });
  talkBtn.addEventListener('pointerup', () => { if (callRec) { try { callRec.stop(); } catch {} } });

  /* ---------------- 场景抽屉 / 工具 ---------------- */
  $('#btnScene').addEventListener('click', () => {
    const d = $('#sceneDrawer'); d.hidden = !d.hidden;
    $('#btnScene').classList.toggle('on', !d.hidden);
  });
  $('#drawerClose').addEventListener('click', () => { $('#sceneDrawer').hidden = true; $('#btnScene').classList.remove('on'); });
  $$('.scene-choice').forEach(b => b.addEventListener('click', () => {
    applyScene(b.dataset.scene); $('#sceneDrawer').hidden = true; $('#btnScene').classList.remove('on');
    toast('已到 ' + SCENES[b.dataset.scene].name);
  }));
  $('#btnFontUp').addEventListener('click', () => setFont(1));
  $('#btnFontDown').addEventListener('click', () => setFont(-1));
  function setFont(d) {
    state.fontSize = Math.min(23, Math.max(16, state.fontSize + d));
    document.documentElement.style.setProperty('--doc-size', state.fontSize + 'px'); save();
  }
  $('#btnDone').addEventListener('click', () => {
    state.done = !state.done; save();
    $('#btnDone').textContent = state.done ? '已完成 ✓' : '完成标记';
    $('#docMeta').textContent = (state.done ? '已完成' : '草稿') + ' · 同一份稿子，切换不丢光标';
  });
  $('#btnExport').addEventListener('click', () => {
    const text = state.title + '\n\n' + ed.innerText;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = (state.title || '未命名') + '.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 TXT');
  });

  /* ---------------- 离开 / 归来 ---------------- */
  function leave() { state.leaveAt = now(); saveCaret(); save(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); else showReturn(); });
  window.addEventListener('beforeunload', leave);
  window.addEventListener('focus', () => { if (state.leaveAt) showReturn(); });

  /* ---------------- 启动 ---------------- */
  applyScene(state.scene || 'moon-garden', false);
  setModule(state.module || 'home', false);
  $('#btnDone').textContent = state.done ? '已完成 ✓' : '完成标记';
  $('#docMeta').textContent = (state.done ? '已完成' : '草稿') + ' · 同一份稿子，切换不丢光标';
  $('#saveState').textContent = '已自动保存 ' + timeStr();
  renderChat(); renderExcerpts(); showReturn(); scheduleSay();
  setTimeout(restoreCaret, 200);
})();

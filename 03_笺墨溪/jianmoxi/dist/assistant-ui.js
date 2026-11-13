// Shared assistant. Conversations and operation receipts live in the cloud.
let assistantBusy=false,assistantContext=null,assistantMessages=[],articleGroup='';
let chatId=null,chatThreads=[],chatArchived=false,chatLoaded=false,chatRun=null,chatError='',chatStage='',chatSelecting=false,chatOpened=false;
const chatDrafts=new Map(),chatIcons={
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 send:'<path d="M12 19V5m-6 6 6-6 6 6"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
 edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15z"/>',retry:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 back:'<path d="m14 6-6 6 6 6"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
const chatIcon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${chatIcons[name]||chatIcons.plus}</svg>`;
const chatCSS=document.createElement('link');chatCSS.rel='stylesheet';chatCSS.href='/assistant.css?v=20261108-wb2';document.head.append(chatCSS);
const assistantRoot=document.createElement('div');assistantRoot.id='assistant-root';
assistantRoot.innerHTML=`<button class="assistant-launch" aria-label="打开 AI 对话">${icon('chat')}<span>AI 对话</span></button>
<section class="xchat" role="dialog" aria-modal="true" aria-label="搭子对话" hidden>
 <div class="xchat-sidebar-shade" hidden></div><aside class="xchat-sidebar" aria-label="对话历史">
 <div class="xchat-brand"><span>小溪</span><span class="xchat-brand-ai">AI</span><button class="xchat-icon xchat-mobile" data-chat="sidebar-close" aria-label="收起历史">${chatIcon('close')}</button></div>
 <button class="xchat-new" data-chat="new">${chatIcon('plus')}<span>新建对话</span></button>
 <label class="xchat-search">${chatIcon('search')}<input type="search" aria-label="搜索对话" placeholder="搜索对话标题" autocomplete="off"></label>
 <div class="xchat-history-heading"><span>最近对话</span><button data-chat="archive-view">已删除</button></div>
 <div class="xchat-history"></div><button class="xchat-back" data-chat="close">${chatIcon('back')}返回笺墨溪</button>
 </aside><div class="xchat-main" role="main">
 <header class="xchat-header"><button class="xchat-icon xchat-mobile" data-chat="sidebar" aria-label="展开历史对话">${chatIcon('menu')}</button><div class="xchat-heading"><span>小溪 AI</span><span class="xchat-current"></span></div><div class="xchat-header-actions"><button class="xchat-icon" data-chat="settings" aria-label="人设与记忆设置">⚙</button><button class="xchat-icon" data-chat="new" aria-label="新建对话">${chatIcon('plus')}</button><button class="xchat-icon" data-chat="close" aria-label="关闭 AI 对话">${chatIcon('close')}</button></div></header>
 <div class="xchat-scroll" tabindex="0" aria-label="对话内容"><div class="xchat-messages"></div></div>
 <button class="xchat-bottom" data-chat="bottom" aria-label="回到最新消息" hidden>↓</button>
 <div class="xchat-footer"><div class="xchat-notice" role="status" hidden></div><div class="xchat-context" hidden></div>
 <form class="xchat-compose"><textarea aria-label="给 AI 发消息" placeholder="发消息，聊灵感、阅读或写作" rows="1" maxlength="2000"></textarea><div class="xchat-compose-tools"><span class="xchat-compose-status"></span><button type="submit" class="xchat-send" aria-label="发送消息">${chatIcon('send')}</button></div></form></div>
 </div><dialog class="xchat-rename"><form><h3>重命名对话</h3><input aria-label="对话名称" maxlength="80" required><div><button type="button" data-chat="rename-cancel">取消</button><button type="submit">保存</button></div></form></dialog><dialog class="xchat-rename xchat-project-dialog"><form><h3>移动到项目</h3><input aria-label="项目名称" maxlength="40" placeholder="输入项目名，例如：长篇练习" required><div class="xchat-project-suggest"></div><div><button type="button" data-chat="project-cancel">取消</button><button type="submit">保存</button></div></form></dialog>
<dialog class="xchat-settings" aria-label="人设与记忆设置"><div class="xchat-settings-content"></div></dialog></section>`;
document.body.append(assistantRoot);
const assistantPanel=assistantRoot.querySelector('.xchat'),assistantBox=assistantRoot.querySelector('.xchat-messages'),assistantInput=assistantRoot.querySelector('textarea'),chatScroll=assistantRoot.querySelector('.xchat-scroll'),chatSearch=assistantRoot.querySelector('[type="search"]');
let chatReturnFocus=null,chatRenameId=null,companionSettings=null,chatProgress=null,chatProjectId=null;const chatCollapsedProjects=new Set();

async function assistantAPI(url,body,method='POST',signal){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),url.endsWith('/messages')?180000:80000),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
 try{const r=await fetch(url,{credentials:'same-origin',signal:controller.signal,...(body!==undefined?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'对话暂时不可用');return d}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
// WorkBuddy code-block icons (verbatim).
const chatCbCopyIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" class="_icon_12mgp_36" aria-hidden="true"><path fill="currentColor" transform="matrix(1 0 0 1 5.32129 4.1958)" fill-rule="evenodd" d="M0.5246 0.9675C0 1.6428 0 2.6285 0 4.6L0 5.74C0 7.7114 0 8.6972 0.5246 9.3724C0.6532 9.5379 0.8021 9.6868 0.9675 9.8153C1.6428 10.34 2.6285 10.34 4.6 10.34C6.5714 10.34 7.5572 10.34 8.2324 9.8153C8.3979 9.6868 8.5468 9.5379 8.6753 9.3724C9.2 8.6972 9.2 7.7114 9.2 5.74L9.2 4.6C9.2 2.6285 9.2 1.6428 8.6753 0.9675C8.5468 0.8021 8.3979 0.6532 8.2324 0.5246C7.5572 0 6.5714 0 4.6 0C2.6285 0 1.6428 0 0.9675 0.5246C0.8021 0.6532 0.6532 0.8021 0.5246 0.9675ZM1.3 5.74L1.3 4.6Q1.3 2.9486 1.3573 2.4444Q1.4144 1.9411 1.5512 1.7651Q1.6447 1.6447 1.7651 1.5512Q1.9411 1.4144 2.4444 1.3573Q2.9486 1.3 4.6 1.3Q6.2514 1.3 6.7555 1.3573Q7.2588 1.4144 7.4349 1.5512Q7.5552 1.6447 7.6487 1.7651Q7.7855 1.9411 7.8427 2.4444Q7.9 2.9485 7.9 4.6L7.9 5.74Q7.9 7.3914 7.8427 7.8956Q7.7855 8.3988 7.6487 8.5749Q7.5552 8.6952 7.4349 8.7888Q7.2588 8.9255 6.7555 8.9827Q6.2514 9.04 4.6 9.04Q2.9485 9.04 2.4444 8.9827Q1.9411 8.9255 1.7651 8.7888Q1.6447 8.6952 1.5512 8.5749Q1.4144 8.3988 1.3573 7.8956Q1.3 7.3914 1.3 5.74Z"/><path fill="currentColor" transform="matrix(1 0 0 1 2.1897 1.25708)" fill-rule="evenodd" d="M2.3264 10.7839Q2.7258 10.8134 3.8545 10.8134L3.8545 9.6134Q2.0873 9.6134 1.7155 9.4445Q1.0645 9.1489 0.7689 8.4979Q0.6 8.1261 0.6 6.3589L0.6 4.2155Q0.6 2.8386 0.6417 2.3911Q0.6955 1.8141 0.8689 1.5248Q1.1148 1.1148 1.5248 0.8689Q1.8141 0.6955 2.3911 0.6417Q2.8386 0.6 4.2155 0.6L4.8503 0.6Q6.2591 0.6 6.5647 0.7081Q7.4202 1.0107 7.7228 1.8662Q7.8309 2.1719 7.8309 3.5806L9.0309 3.5806Q9.0309 1.9659 8.8542 1.4661Q8.3605 0.0704 6.9648 -0.4232Q6.465 -0.6 4.8503 -0.6L4.2155 -0.6Q2.7828 -0.6 2.2798 -0.5531Q1.4311 -0.474 0.9078 -0.1603Q0.24 0.24 -0.1603 0.9078Q-0.474 1.4311 -0.5531 2.2798Q-0.6 2.7828 -0.6 4.2155L-0.6 6.3589Q-0.6 7.4876 -0.5706 7.887Q-0.521 8.5598 -0.3238 8.9941Q0.1581 10.0552 1.2193 10.5371Q1.6536 10.7344 2.3264 10.7839Z"/></svg>`;
const chatCbCopiedIcon=`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" class="_icon-check_12mgp_49" aria-hidden="true"><path d="M13.2997 4.45597C13.5519 4.28973 13.8951 4.31806 14.1171 4.53995C14.3705 4.79373 14.3705 5.20516 14.1171 5.45889L7.0458 12.5302L6.94424 12.6142C6.92674 12.6257 6.90687 12.6328 6.88857 12.6425C6.87159 12.6515 6.85534 12.6615 6.83779 12.6689C6.82472 12.6743 6.81109 12.6779 6.79775 12.6825C6.77353 12.6909 6.74938 12.6986 6.72451 12.704C6.70769 12.7077 6.69074 12.7095 6.67373 12.7118C6.65192 12.7148 6.63026 12.7169 6.6083 12.7177C6.59131 12.7183 6.5745 12.7184 6.55752 12.7177C6.53457 12.7167 6.51192 12.7143 6.48916 12.7108C6.47275 12.7084 6.45654 12.7058 6.44033 12.7021C6.41742 12.6968 6.39529 12.6893 6.37295 12.6816C6.35687 12.676 6.34078 12.6708 6.32509 12.664C6.30911 12.657 6.29371 12.6489 6.27822 12.6405C6.22396 12.6113 6.17168 12.576 6.12588 12.5302L1.88369 8.288L2.34365 7.82804L2.80263 7.36807L6.58584 11.1513L13.1972 4.53995L13.2997 4.45597ZM1.88369 7.36807C2.13744 7.11473 2.54889 7.11473 2.80263 7.36807L1.88369 8.288C1.62995 8.03415 1.62988 7.62188 1.88369 7.36807Z" fill="currentColor"/></svg>`;
// Escape first. Render a Markdown subset with the exact WorkBuddy cb-markdown structure.
function chatInline(s){return esc(s)
 .replace(/`([^`]+)`/g,'<code>$1</code>')
 .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
 .replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
 .replace(/~~([^~]+)~~/g,'<del>$1</del>')
 .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')}
function chatMarkdown(text){
 const lines=String(text??'').split('\n');const out=[];let i=0;
 const flushPara=buf=>{if(buf.length)out.push('<p>'+buf.map(chatInline).join('<br>')+'</p>')};
 let para=[];
 while(i<lines.length){
  const line=lines[i];
  if(/^```/.test(line)){flushPara(para);para=[];const lang=line.slice(3).trim();const buf=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))buf.push(lines[i++]);i++;
   out.push('<div class="cb-markdown-pre-wrapper"><div class="cb-markdown-pre-container"><div class="cb-markdown-pre__header"><strong class="cb-markdown-pre__title">'+(esc(lang)||'code')+'</strong><div class="_actions_12mgp_6"><button type="button" class="_action_12mgp_6" data-cb-copy title="复制" aria-label="复制">'+chatCbCopyIcon+'</button></div></div><pre class="cb-markdown-pre"><code>'+esc(buf.join('\n'))+'</code></pre></div></div>');continue}
  if(/^\s*$/.test(line)){flushPara(para);para=[];i++;continue}
  if(/^(---+|\*\*\*+|___+)\s*$/.test(line)){flushPara(para);para=[];out.push('<hr>');i++;continue}
  const h=line.match(/^(#{1,6})\s+(.*)$/);
  if(h){flushPara(para);para=[];out.push('<h'+h[1].length+'>'+chatInline(h[2])+'</h'+h[1].length+'>');i++;continue}
  if(/^>\s?/.test(line)){flushPara(para);para=[];const q=[];while(i<lines.length&&/^>\s?/.test(lines[i]))q.push(lines[i++].replace(/^>\s?/,''));out.push('<blockquote>'+chatMarkdown(q.join('\n'))+'</blockquote>');continue}
  if(/\|/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}/.test(lines[i+1])&&/\|/.test(lines[i+1])){
   flushPara(para);para=[];
   const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>chatInline(c.trim()));
   const head=cells(line);i+=2;const rows=[];
   while(i<lines.length&&/\|/.test(lines[i])&&!/^\s*$/.test(lines[i])){rows.push(cells(lines[i]));i++}
   out.push('<div class="cb-markdown-table-wrapper"><table><thead><tr>'+head.map(c=>'<th><p>'+c+'</p></th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td><p>'+c+'</p></td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue}
  const li=line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if(li){flushPara(para);para=[];
   const items=[];let ordered=/^\d/.test(li[2]);
   while(i<lines.length){const m=lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);if(!m)break;items.push({indent:m[1].length,text:m[3],ordered:/^\d/.test(m[2])});i++}
   const renderList=(start,indent)=>{
    const tag=items[start].ordered?'ol':'ul';let html='<'+tag+'>';let j=start;
    while(j<items.length&&items[j].indent>=indent){
     if(items[j].indent>indent){const sub=renderList(j,items[j].indent);html=html.replace(/<\/li>$/,'')+sub.html+'</li>';j=sub.j;continue}
     html+='<li>'+chatInline(items[j].text);j++;
     if(j>=items.length||items[j].indent<=indent)html+='</li>';
    }
    return{html:html+'</'+tag+'>',j};
   };
   out.push(renderList(0,items[0].indent).html);continue}
  para.push(line);i++;
 }
 flushPara(para);return out.join('');
}
function chatFitInput(){assistantInput.style.height='auto';assistantInput.style.height=Math.min(180,assistantInput.scrollHeight)+'px';const send=assistantRoot.querySelector('.xchat-send');send.disabled=chatSelecting||(assistantBusy?chatStage!=='thinking':!assistantInput.value.trim());send.setAttribute('aria-label',assistantBusy?'停止回复':'发送消息');send.innerHTML=assistantBusy?'<span class="xchat-stop"></span>':chatIcon('send');assistantRoot.querySelector('.xchat-compose-status').textContent=assistantBusy?(chatStage==='applying'?'正在执行操作…':chatStage==='thinking'?'正在思考…':'正在准备…'):''}
function chatBottom(){chatScroll.scrollTop=chatScroll.scrollHeight;assistantRoot.querySelector('.xchat-bottom').hidden=true}
function chatSidebar(open){assistantPanel.classList.toggle('sidebar-open',open);assistantRoot.querySelector('.xchat-sidebar-shade').hidden=!open}
function chatProjectOf(t){const c=t?.context||{};return c.project||(c.articleId?'写作':c.readingId?'阅读':c.inspiration?'灵感':'日常')}
function chatThreadRow(t){return `<div class="xchat-thread ${t.id===chatId?'active':''}"><button data-chat-select="${esc(t.id)}" title="${esc(t.title)}">${esc(t.title)}</button><details><summary aria-label="管理对话：${esc(t.title)}">${chatIcon('more')}</summary><div>${chatArchived?`<button data-chat-restore="${esc(t.id)}">恢复对话</button>`:`<button data-chat-rename="${esc(t.id)}">重命名</button><button data-chat-project="${esc(t.id)}">移动到项目</button><button data-chat-delete="${esc(t.id)}">删除对话</button>`}</div></details></div>`}
function drawChatHistory(){
 const query=chatSearch.value.trim().toLocaleLowerCase(),rows=chatThreads.filter(t=>t.title.toLocaleLowerCase().includes(query));
 assistantRoot.querySelector('.xchat-history-heading span').textContent=chatArchived?'已删除的对话':'最近对话';assistantRoot.querySelector('[data-chat="archive-view"]').textContent=chatArchived?'返回历史':'已删除';
 const projects=new Map();rows.forEach(t=>{const name=chatProjectOf(t);if(!projects.has(name))projects.set(name,[]);projects.get(name).push(t)});
 const caret='<svg class="xchat-project-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
 assistantRoot.querySelector('.xchat-history').innerHTML=rows.length?[...projects].map(([name,list])=>`<section class="xchat-project ${chatCollapsedProjects.has(name)?'collapsed':''}"><button type="button" class="xchat-project-head" data-chat-project-toggle="${esc(name)}" aria-expanded="${!chatCollapsedProjects.has(name)}">${caret}<span class="xchat-project-name">${esc(name)}</span><span class="xchat-project-count">${list.length}</span></button><div class="xchat-project-body">${list.map(chatThreadRow).join('')}</div></section>`).join(''):`<p class="xchat-history-empty">${query?'没有匹配的对话':chatArchived?'没有已删除的对话':'聊过的内容会留在这里'}</p>`;
}
function drawAssistant(scroll=true){
 const current=chatThreads.find(t=>t.id===chatId);assistantRoot.querySelector('.xchat-current').textContent=current?.title||'';
 assistantBox.innerHTML=assistantMessages.length?assistantMessages.map((m,i)=>`<article class="xchat-message ${esc(m.role)}">${chatEvidence(m,i)}<div class="xchat-message-body ${m.role==='assistant'?'cb-markdown':m.role==='user'?'_userMessageBubble_h5v4w_8':''}" ${m.role==='assistant'?'data-md-theme="loose"':''}>${m.role==='assistant'?chatMarkdown(m.text):esc(m.text).replaceAll('\n','<br>')}</div>${m.links?.map(link=>`<button class="assistant-result-link" data-assistant-open="${esc(link.id)}" data-kind="${esc(link.kind)}">${esc(link.title)} ↗</button>`).join('')||''}${m.role==='assistant'?`<div class="xchat-message-actions"><button class="xchat-icon" data-chat-copy="${i}" aria-label="复制回复">${chatIcon('copy')}</button>${i===assistantMessages.map(x=>x.role).lastIndexOf('assistant')?`<button class="xchat-icon" data-chat-retry="${i}" aria-label="编辑并重发">${chatIcon('edit')}</button>`:''}</div>`:''}${m.retry?`<button class="xchat-retry" data-chat-retry="${i}">${chatIcon('retry')}重试</button>`:''}</article>`).join(''):`<div class="xchat-welcome"><div class="xchat-emblem">笺</div><h2>${assistantContext?'一起聊聊这段文字':'今天，想聊些什么？'}</h2><div class="xchat-suggestions">${[['找些灵感','推荐几个适合写散文的灵感'],['一起阅读','推荐几篇适合今晚读的作品'],['整理文章','先看看我的文章，建议怎样按主题分组']].map(([label,prompt])=>`<button data-assistant-prompt="${prompt}">${label}<span>↗</span></button>`).join('')}</div></div>`;
 if(assistantBusy)assistantBox.insertAdjacentHTML('beforeend',`<div class="xchat-thinking" role="status">${chatProgressHTML()}</div>`);
 const notice=assistantRoot.querySelector('.xchat-notice');notice.hidden=!chatError;notice.textContent=chatError;
 notice.classList.toggle('is-duplicate',!!chatError&&assistantMessages.some(m=>m.role==='system'&&m.text===chatError));
 const chip=assistantRoot.querySelector('.xchat-context');chip.hidden=!assistantContext;if(assistantContext)chip.innerHTML=`<span>${esc(assistantContext.label||'讨论当前内容')}</span><button data-assistant-clear-context aria-label="移除讨论上下文">×</button>`;
 chatFitInput();if(scroll)requestAnimationFrame(chatBottom);
}
async function chatLoadList(){const data=await assistantAPI('/api/conversations'+(chatArchived?'?archived=1':''));chatThreads=data.conversations;drawChatHistory();chatLoaded=true}
function chatRememberDraft(){chatDrafts.set(chatId||'new',assistantInput.value)}
function chatNew(){if(assistantBusy||chatSelecting)return toast('请先停止当前回复');chatRememberDraft();chatId=null;assistantContext=null;assistantMessages=[];assistantInput.value=chatDrafts.get('new')||'';chatError='';chatSidebar(false);drawChatHistory();drawAssistant();assistantInput.focus()}
async function chatSelect(id){
 if(assistantBusy||chatSelecting)return toast('请先停止当前回复');chatSelecting=true;chatFitInput();chatRememberDraft();chatError='';
 try{const d=await assistantAPI('/api/conversations/'+id);if(d.conversation.archived){await assistantAPI('/api/conversations/'+id,{archived:false},'PATCH');chatArchived=false;await chatLoadList()}chatId=id;assistantContext=Object.keys(d.conversation.context).length?d.conversation.context:null;assistantMessages=d.messages;assistantInput.value=chatDrafts.get(id)||'';chatSidebar(false);drawChatHistory()}
 catch(e){chatError=e.message}finally{chatSelecting=false;drawAssistant()}
}
async function openAssistant(context){
 if(page==='editor')saveEditor();if(document.querySelector('#dialog')?.open)closeModal();chatReturnFocus=document.activeElement;
 if(context===undefined&&!chatOpened&&!chatId&&!assistantMessages.length){if(page==='editor'){const a=articles.find(x=>x.id===currentId);if(a)context={label:'写作 · '+(a.title||'未命名文章'),articleId:a.id}}else if(page==='reader'&&openedWork)context={label:'阅读 · '+openedWork.title,readingId:openedWork.id,chapter:readerChapter}}
 if(context!==undefined&&!assistantBusy){chatRememberDraft();chatId=null;assistantMessages=[];assistantContext=context;assistantInput.value='';chatError=''}
 chatOpened=true;assistantPanel.hidden=false;document.body.classList.add('assistant-open');chatViewport();drawAssistant();assistantRoot.querySelector('.xchat-header [data-chat="new"]').focus({preventScroll:true});
 // Prevent focus and clicks from reaching the writing page behind the dialog.
 [...document.body.children].filter(el=>el!==assistantRoot&&el.id!=='toast'&&el.tagName!=='SCRIPT').forEach(el=>{if(!el.inert){el.dataset.chatInert='1';el.inert=true}});
 try{await chatLoadList();await loadCompanionSettings()}catch(e){chatError=e.message;drawAssistant(false)}
}
function closeAssistant(){if(projectDialog.open)projectDialog.close();if(companionDialog.open)companionDialog.close();if(assistantPanel.contains(document.activeElement))document.activeElement.blur();assistantPanel.hidden=true;chatSidebar(false);document.body.classList.remove('assistant-open');document.querySelectorAll('[data-chat-inert]').forEach(el=>{el.inert=false;delete el.dataset.chatInert});chatReturnFocus?.focus?.({preventScroll:true})}
function syncAssistantSnapshot(snapshot){window.xingzouCloud.acceptSnapshot(snapshot);articles=load('articles',[]);trash=load('trash',[]);favs=load('favs',[]);saved=load('saved',[]);goal=load('goal',300);currentId=load('currentId',null);if(page==='reader'&&openedWork)renderWork();else render()}
function openAssistantArticle(id){saveEditor();currentId=id;persist('currentId',currentId);navigate('editor',true)}
async function chatApply(result){
 if(!result.actions.length)return;
 chatStage='applying';drawAssistant();saveEditor();await window.xingzouCloud.flush();if(!window.xingzouCloud.isSynced)throw new Error('本机内容已变化，操作没有执行，请重新发送。');
 const applied=await assistantAPI('/api/assistant/apply',{planId:result.planId});syncAssistantSnapshot(applied);
 if(applied.readingRecommendation)window.xingzouReadingGuide?.accept(applied.readingRecommendation,true);
 for(const action of applied.actions){if(action.type==='find_reading'){Object.assign(libraryState,{q:action.query,genre:action.genre,author:action.author,collection:'',saved:false,view:'works',page:1});if(page==='reading')await loadLibrary()}
 if(action.type==='navigate')navigate(action.page);if(action.type==='open_article')openAssistantArticle(action.id);
 if(action.type==='set_preferences'&&action.scope==='reading'){libraryState.result=null;if(page==='reading')await loadLibrary()}
 if((action.type==='set_preferences'&&action.scope==='inspiration')||action.type==='create_inspiration_cards'){
  if(applied.inspirationFeed){applyInspirationFeed(applied.inspirationFeed,{authoritative:true});toast(applied.inspirationFeed.status||'灵感卡片已更新')}
  else if(!await refreshFeed('inspiration'))throw new Error('偏好已保存，但卡片还没更新，请稍后重试。')
 }}
}
async function sendAssistant(message){
 message=message.trim();if(assistantBusy||chatSelecting||!message)return;assistantBusy=true;chatStage='preparing';chatError='';drawAssistant();
 let cid=chatId,sent=false;
 try{saveEditor();await window.xingzouCloud.flush();if(!window.xingzouCloud.isSynced)throw new Error('文章还有待同步的修改，保存完成后再发送。');
 if(!cid){const base=assistantContext||{};const d=await assistantAPI('/api/conversations',{context:{...base,project:chatProjectOf({context:base})}});cid=chatId=d.conversation.id;chatArchived=false;chatThreads.unshift(d.conversation);drawChatHistory()}
 chatProgress=null;chatRun={id:crypto.randomUUID(),cid,controller:new AbortController(),stopped:false};assistantInput.value='';chatDrafts.delete(cid);chatDrafts.delete('new');assistantMessages.push({role:'user',text:message});sent=true;chatStage='thinking';drawAssistant();
 pollChatProgress(chatRun);
 const result=await assistantAPI('/api/conversations/'+cid+'/messages',{message,requestId:chatRun.id},'POST',chatRun.controller.signal);
 if(!result.stopped&&!chatRun.stopped){assistantMessages.push({role:'assistant',text:result.reply,thinkingSummary:result.thinkingSummary,citations:result.citations,savedMemories:result.savedMemories});drawAssistant();await chatApply(result)}
 }catch(error){if(!chatRun?.stopped)chatError=error.name==='AbortError'?'等待回复超时。重新打开这段对话可查看结果。':error.message}
 finally{assistantBusy=false;chatStage='';if(chatRun)clearTimeout(chatRun.pollTimer);chatRun=null;chatProgress=null;
 if(sent){try{const d=await assistantAPI('/api/conversations/'+cid);assistantMessages=d.messages;if(chatError&&!assistantMessages.some(m=>m.retry===message))assistantMessages.push({role:'system',text:chatError,retry:message})}catch{chatError=chatError||'暂时无法刷新记录，请稍后重新打开对话'}}
 try{await chatLoadList()}catch{}drawAssistant()}
}
async function chatStop(){if(!chatRun||chatStage!=='thinking')return;const run=chatRun;try{await assistantAPI('/api/conversations/'+run.cid+'/cancel',{requestId:run.id});run.stopped=true;run.controller.abort()}catch(e){chatError=e.message;drawAssistant(false)}}
async function chatCopy(text){try{await navigator.clipboard.writeText(text);toast('已复制')}catch{const area=document.createElement('textarea');area.value=text;assistantPanel.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'已复制':'复制失败，请长按选中文字')}}
function chatViewport(){if(assistantPanel.hidden)return;const v=window.visualViewport;assistantPanel.style.height=(v?.height||window.innerHeight)+'px';assistantPanel.style.top=(v?.offsetTop||0)+'px'}
window.visualViewport?.addEventListener('resize',()=>chatViewport());window.visualViewport?.addEventListener('scroll',()=>chatViewport());window.addEventListener('resize',()=>chatViewport());
assistantRoot.querySelector('.assistant-launch').addEventListener('click',()=>openAssistant());
assistantRoot.querySelector('.xchat-compose').addEventListener('submit',e=>{e.preventDefault();assistantBusy?chatStop():sendAssistant(assistantInput.value)});
assistantInput.addEventListener('input',()=>{chatRememberDraft();chatFitInput()});assistantInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(pointer:fine)').matches){e.preventDefault();if(!assistantBusy)sendAssistant(assistantInput.value)}});
chatSearch.addEventListener('input',drawChatHistory);assistantRoot.querySelector('.xchat-sidebar-shade').addEventListener('click',()=>chatSidebar(false));
chatScroll.addEventListener('scroll',()=>{assistantRoot.querySelector('.xchat-bottom').hidden=chatScroll.scrollHeight-chatScroll.scrollTop-chatScroll.clientHeight<160});
const renameDialog=assistantRoot.querySelector('.xchat-rename:not(.xchat-project-dialog)'),projectDialog=assistantRoot.querySelector('.xchat-project-dialog');
projectDialog.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const value=projectDialog.querySelector('input').value.trim();if(!value||!chatProjectId)return;try{const t=chatThreads.find(x=>x.id===chatProjectId);await assistantAPI('/api/conversations/'+chatProjectId,{context:{...(t?.context||{}),project:value}},'PATCH');projectDialog.close();await chatLoadList();drawAssistant(false);toast('已移动到项目「'+value+'」')}catch(error){toast(error.message)}});
renameDialog.querySelector('form').addEventListener('submit',async e=>{
e.preventDefault();const value=renameDialog.querySelector('input').value.trim();if(!value)return;try{await assistantAPI('/api/conversations/'+chatRenameId,{title:value},'PATCH');renameDialog.close();await chatLoadList();drawAssistant(false)}catch(error){toast(error.message)}});
assistantRoot.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||b.classList.contains('assistant-launch'))return;
 try{const action=b.dataset.chat;
 if(action==='settings')await showCompanionSettings();if(action==='close')closeAssistant();if(action==='sidebar')chatSidebar(true);if(action==='sidebar-close')chatSidebar(false);if(action==='bottom')chatBottom();if(action==='new')chatNew();if(action==='rename-cancel')renameDialog.close();if(action==='project-cancel')projectDialog.close();
 if(b.dataset.chatProjectToggle){const name=b.dataset.chatProjectToggle;chatCollapsedProjects.has(name)?chatCollapsedProjects.delete(name):chatCollapsedProjects.add(name);drawChatHistory()}
 if(b.dataset.chatProject){chatProjectId=b.dataset.chatProject;const cur=chatProjectOf(chatThreads.find(t=>t.id===chatProjectId));projectDialog.querySelector('input').value=cur==='日常'?'':cur;projectDialog.querySelector('.xchat-project-suggest').innerHTML=[...new Set([cur,...chatThreads.map(chatProjectOf)])].filter(x=>x&&x!=='日常').map(x=>`<button type="button" data-chat-project-suggest="${esc(x)}">${esc(x)}</button>`).join('');b.closest('details').open=false;projectDialog.showModal();projectDialog.querySelector('input').select()}
 if(b.dataset.chatProjectSuggest){projectDialog.querySelector('input').value=b.dataset.chatProjectSuggest}
 if(b.hasAttribute('data-cb-copy')){const code=b.closest('.cb-markdown-pre-container')?.querySelector('code');if(code)chatCopy(code.innerText).then(()=>{b.innerHTML=chatCbCopiedIcon;b.title='已复制';setTimeout(()=>{b.innerHTML=chatCbCopyIcon;b.title='复制'},1600)})}
 if(action==='archive-view'){chatArchived=!chatArchived;await chatLoadList()}
 if(b.dataset.chatSelect)await chatSelect(b.dataset.chatSelect);
 if(b.dataset.chatRename){chatRenameId=b.dataset.chatRename;renameDialog.querySelector('input').value=chatThreads.find(t=>t.id===chatRenameId)?.title||'';b.closest('details').open=false;renameDialog.showModal();renameDialog.querySelector('input').select()}
 if(b.dataset.chatDelete||b.dataset.chatRestore){const id=b.dataset.chatDelete||b.dataset.chatRestore;if(assistantBusy)return toast('请先停止当前回复');await assistantAPI('/api/conversations/'+id,{archived:!!b.dataset.chatDelete},'PATCH');if(id===chatId)chatNew();await chatLoadList();toast(b.dataset.chatDelete?'已删除，可在“已删除”中恢复':'已恢复对话')}
 if(b.hasAttribute('data-chat-copy'))chatCopy(assistantMessages[Number(b.dataset.chatCopy)].text);
 if(b.hasAttribute('data-chat-retry')){const i=Number(b.dataset.chatRetry),m=assistantMessages[i];const prompt=m.retry||assistantMessages.slice(0,i).reverse().find(x=>x.role==='user')?.text;if(prompt){if(m.retry)sendAssistant(prompt);else{assistantInput.value=prompt;chatFitInput();assistantInput.focus()}}}
 if(b.hasAttribute('data-assistant-clear-context')){if(assistantBusy)return toast('请等这次回复完成');if(chatId)await assistantAPI('/api/conversations/'+chatId,{context:{}},'PATCH');assistantContext=null;drawAssistant(false)}
 if(b.hasAttribute('data-assistant-prompt')){assistantInput.value=b.dataset.assistantPrompt;chatFitInput();assistantInput.focus()}
 if(b.hasAttribute('data-assistant-open')){if(b.dataset.kind==='article'&&!articles.some(a=>a.id===b.dataset.assistantOpen))return toast('这篇文章已移入回收站，可以让 AI 恢复');closeAssistant();if(b.dataset.kind==='reading')showReading(b.dataset.assistantOpen);else openAssistantArticle(b.dataset.assistantOpen)}
 }catch(error){chatError=error.message;drawAssistant(false)}
});
document.addEventListener('keydown',e=>{if(assistantPanel.hidden)return;if(e.key==='Escape'&&!renameDialog.open&&!projectDialog.open&&!companionDialog.open){e.preventDefault();assistantPanel.classList.contains('sidebar-open')?chatSidebar(false):closeAssistant()}if(e.key==='Tab'&&!renameDialog.open&&!projectDialog.open&&!companionDialog.open){const all=[...assistantPanel.querySelectorAll('button,input,textarea,summary,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.disabled);if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0].focus()}}});
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-discuss')){event.stopImmediatePropagation();const s=seeds.find(x=>x.id===b.dataset.discuss)||saved.find(x=>x.id===b.dataset.discuss)||(detailSeed?.id===b.dataset.discuss?detailSeed:null);if(s)return openAssistant({label:'讨论 · '+s.source.work,...(s.source.readingId?{readingId:s.source.readingId,chapter:s.source.chapter||0,readingSelection:{workId:s.source.readingId,chapter:s.source.chapter||0,text:s.source.quote}}:{}),inspiration:{id:s.id,quote:s.source.quote,author:s.source.author,work:s.source.work,topic:s.topic}})}
 if(b.hasAttribute('data-article-group')){articleGroup=b.dataset.articleGroup;render()}
 if(b.hasAttribute('data-article-summary')){event.stopImmediatePropagation();const a=articles.find(x=>x.id===b.dataset.articleSummary);if(a?.summary)modal(`<span class="eyebrow">文章归纳</span><h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p>`)}
},true);
const ungroupedRows=articleRows;
articleRows=function(list){const filtered=list.filter(a=>!articleGroup||(a.group||'未分组')===articleGroup);const template=document.createElement('template');template.innerHTML=ungroupedRows(filtered);template.content.querySelectorAll('.article-row').forEach(row=>{const a=filtered.find(x=>x.id===row.querySelector('[data-edit]')?.dataset.edit);if(a?.group)row.querySelector('.state-label').insertAdjacentHTML('beforeend',`<span class="article-group-name"> · ${esc(a.group)}</span>`);if(a?.summary)row.insertAdjacentHTML('beforeend',`<button class="text-btn article-summary-control" type="button" data-article-summary="${esc(a.id)}">查看归纳 ↗</button>`)});return template.innerHTML};
const originalArticlesView=articlesView;
articlesView=function(){const groups=[...new Set(articles.map(a=>a.group||'未分组'))];if(articleGroup&&!groups.includes(articleGroup))articleGroup='';let html=originalArticlesView();if(groups.some(x=>x!=='未分组'))html=html.replace('<div id="article-list">',`<div class="article-groups"><button class="${!articleGroup?'active':''}" data-article-group="">所有分组</button>${groups.map(g=>`<button class="${articleGroup===g?'active':''}" data-article-group="${esc(g)}">${esc(g)}</button>`).join('')}</div><div id="article-list">`);return html};
render();

// Only user-facing reasoning summaries and actual server progress are displayed.
function chatEvidence(m,index){
 if(m.role!=='assistant')return '';
 const summary=m.thinkingSummary?`<details class="xchat-reasoning"><summary>思考摘要</summary><p>${esc(m.thinkingSummary)}</p></details>`:'';
 const sources=m.citations?.length?`<details class="xchat-sources"><summary>查阅 ${m.citations.length} 处原文</summary>${m.citations.map((s,j)=>`<div><button type="button" data-chat-source="${index}:${j}">[${j+1}] ${esc(s.title)} · ${esc(s.author)}<small>${esc(s.chapterTitle||'正文')} ↗</small></button><blockquote>${esc(s.quote)}</blockquote></div>`).join('')}</details>`:'';
 const memory=m.savedMemories?.length?`<button type="button" class="xchat-memory-receipt" data-chat="settings">已记住 ${m.savedMemories.length} 条偏好 · 查看</button>`:'';
 return summary+sources+memory;
}
function chatProgressHTML(){
 const detail=chatStage==='applying'?'正在执行操作…':chatProgress?.detail||'正在读取对话上下文…';
 return `<details class="xchat-research-progress" open><summary><span class="xchat-progress-dot"></span>${esc(detail)}</summary>${chatProgress?.sources?.length?`<ul>${chatProgress.sources.slice(0,6).map(s=>`<li>《${esc(s.title)}》 · ${esc(s.chapterTitle||'正文')}</li>`).join('')}</ul>`:''}</details>`;
}
async function pollChatProgress(run){
 if(chatRun!==run||run.stopped)return;
 try{const p=await assistantAPI('/api/conversations/'+run.cid+'/progress/'+run.id);if(chatRun!==run)return;chatProgress=p;const box=assistantBox.querySelector('.xchat-thinking');if(box)box.innerHTML=chatProgressHTML()}catch{}
 if(chatRun===run&&!run.stopped)run.pollTimer=setTimeout(()=>pollChatProgress(run),1000);
}
async function loadCompanionSettings(){const d=await assistantAPI('/api/companion/settings');companionSettings=d;assistantRoot.querySelector('.xchat-heading>span').textContent=d.profile.name+' AI';assistantRoot.querySelector('.xchat-brand>span').textContent=d.profile.name;return d}
const companionDialog=assistantRoot.querySelector('.xchat-settings');
async function showCompanionSettings(){
 const expandedSettings=new Set([...companionDialog.querySelectorAll('[data-setting-section][open]')].map(panel=>panel.dataset.settingSection));
 chatSidebar(false);companionDialog.querySelector('.xchat-settings-content').innerHTML='<p role="status">正在读取设置…</p>';if(!companionDialog.open)companionDialog.showModal();
 try{
  const d=await loadCompanionSettings(),p=d.profile,short=chatId?await assistantAPI('/api/conversations/'+chatId+'/memory'):null;
  companionDialog.querySelector('.xchat-settings-content').innerHTML=`<header><h2>我的阅读搭子</h2><button type="button" data-companion="close" aria-label="关闭设置">×</button></header><p class="xchat-settings-note">人设与长期记忆在每次对话生效，当前写作空间的设备共用这些设置。</p><form data-companion-profile><label>搭子的名字<input name="name" maxlength="40" required value="${esc(p.name)}"></label><label>人设<textarea name="persona" maxlength="2000" rows="3" placeholder="希望它是怎样的阅读搭子">${esc(p.persona)}</textarea></label><label>回答风格<textarea name="style" maxlength="1000" rows="3" placeholder="例如：先给结论，少用比喻；分析小说时细讲人物与原文">${esc(p.style)}</textarea></label><label class="xchat-setting-switch"><input type="checkbox" name="autoMemory" ${p.autoMemory?'checked':''}>记住我明确表达的偏好与“请记住”的内容</label><button class="primary" type="submit">保存设置</button><span data-companion-status role="status"></span></form><details class="settings-section" data-setting-section="long"><summary>长期记忆 <small>${d.memories.length} / 100</small></summary><div class="xchat-memory-list">${memoryListHTML(d.memories)}</div><form data-companion-add><textarea name="text" rows="2" maxlength="300" required placeholder="添加一条希望它长期记住的事"></textarea><button class="secondary" type="submit">添加记忆</button></form></details><details class="settings-section" data-setting-section="short"><summary>当前会话记忆</summary><p class="xchat-short-memory">${esc(short?.summary||'聊过几轮后，会在这里保留当前话题的要点。')}</p>${chatId?'<button type="button" class="secondary" data-companion="clear-short">清除当前话题记忆</button>':''}</details><p class="xchat-settings-note">书库可检索 ${d.library.works} 部作品；已缓存 ${d.library.analysed} 部作品的跨章分析。</p>`;
  companionDialog.querySelectorAll('[data-setting-section]').forEach(panel=>{panel.open=expandedSettings.has(panel.dataset.settingSection)});
 }catch(e){companionDialog.querySelector('.xchat-settings-content').innerHTML=`<p>${esc(e.message)}</p><button type="button" data-companion="close">关闭</button>`}
}
function memoryListHTML(rows){return rows.length?rows.map(m=>`<article data-memory-row="${esc(m.id)}"><textarea aria-label="长期记忆" maxlength="300" rows="2">${esc(m.text)}</textarea><div><button type="button" data-memory-save="${esc(m.id)}">保存修改</button><button type="button" data-memory-delete="${esc(m.id)}">删除</button></div></article>`).join(''):'<p class="xchat-settings-note">还没有长期记忆。你可以手动添加，也可以在对话里说“请记住”。</p>'}
companionDialog.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,b=f.querySelector('[type="submit"]');b.disabled=true;
 try{if(f.hasAttribute('data-companion-profile')){const data={version:companionSettings.profile.version,name:f.elements.name.value,persona:f.elements.persona.value,style:f.elements.style.value,autoMemory:f.elements.autoMemory.checked};const r=await assistantAPI('/api/companion/settings',data,'PUT');companionSettings.profile=r.profile;assistantRoot.querySelector('.xchat-heading>span').textContent=r.profile.name+' AI';assistantRoot.querySelector('.xchat-brand>span').textContent=r.profile.name;document.dispatchEvent(new Event('companion-profile-updated'));f.querySelector('[data-companion-status]').textContent='已保存，下次回复生效'}
 else if(f.hasAttribute('data-companion-add')){const r=await assistantAPI('/api/companion/memories',{text:f.elements.text.value});companionSettings.memories=r.memories;companionDialog.querySelector('.xchat-memory-list').innerHTML=memoryListHTML(r.memories);f.reset();toast('已添加长期记忆')}}catch(e){toast(e.message)}finally{b.disabled=false}
});
companionDialog.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 try{if(b.dataset.companion==='close')companionDialog.close();
 if(b.dataset.companion==='clear-short'&&chatId){await assistantAPI('/api/conversations/'+chatId+'/memory',{},'DELETE');companionDialog.querySelector('.xchat-short-memory').textContent='当前话题记忆已清除，历史消息仍可查看。'}
 if(b.dataset.memorySave||b.dataset.memoryDelete){b.disabled=true;const id=b.dataset.memorySave||b.dataset.memoryDelete,r=await assistantAPI('/api/companion/memories/'+id,b.dataset.memorySave?{text:b.closest('[data-memory-row]').querySelector('textarea').value}:{},b.dataset.memorySave?'PATCH':'DELETE');companionSettings.memories=r.memories;companionDialog.querySelector('.xchat-memory-list').innerHTML=memoryListHTML(r.memories);toast(b.dataset.memorySave?'记忆已更新':'记忆已删除')}}catch(e){toast(e.message);b.disabled=false}
});
async function openCitedPassage(s){
 if(!s?.workId)return;closeAssistant();if(document.querySelector('#dialog')?.open)closeModal();await showReading(s.workId);
 if(openedWork?.id!==s.workId)return;readerChapter=s.chapter||0;
 if(openedWork.chunked&&!openedWork.bookCache?.[readerChapter])await loadBookChapter(openedWork,readerChapter);else renderWork();
 const needle=String(s.quote||'').replace(/\s+/g,'').slice(0,45);
 const p=Array.from(document.querySelectorAll('.library-reader .prose p')).find(p=>needle&&p.textContent.replace(/\s+/g,'').includes(needle));
 if(p){p.classList.add('reader-cited-passage');p.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});setTimeout(()=>p.classList.remove('reader-cited-passage'),4000)}
}
assistantRoot.addEventListener('click',e=>{const b=e.target.closest('[data-chat-source]');if(!b)return;const [i,j]=b.dataset.chatSource.split(':').map(Number);openCitedPassage(assistantMessages[i]?.citations?.[j]).catch(e=>toast(e.message))});
const originalSourceHTML=sourceHTML;sourceHTML=function(source){return source.readingId?`<span class="source-author">${esc(source.author)}</span><span>《${esc(source.work)}》${source.chapterTitle?' · '+esc(source.chapterTitle):''}</span><button type="button" class="source-link" data-library-quote="${esc(source.readingId)}" data-library-quote-chapter="${source.chapter||0}">回到原文 ↗</button>`:originalSourceHTML(source)};
document.addEventListener('click',e=>{const b=e.target.closest('[data-library-quote]');if(!b)return;e.stopImmediatePropagation();const source=(detailSeed||currentSeed())?.source;openCitedPassage({workId:b.dataset.libraryQuote,chapter:Number(b.dataset.libraryQuoteChapter),quote:source?.quote||''}).catch(e=>toast(e.message))},true);

// Only this same-origin API is called; model credentials stay on the server.
function aiConnection(label){const node=document.querySelector('.preview-label');if(node)node.textContent=label}
async function requestAI(task,payload,signal){
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,65000);
 try{
  const response=await fetch('/api/ai/'+task,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'AI 暂未完成请求，请稍后重试');
  aiConnection('DeepSeek · 已连接');return result;
 }catch(error){if(!signal?.aborted)aiConnection('DeepSeek · 暂不可用');throw error}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
async function enrichInspirations(items){
 const ready=items.filter(s=>s.promptKind==='ai'&&s.summary&&s.interpretation&&s.writingHint),pending=items.filter(s=>!ready.includes(s));
 if(!pending.length)return {items,status:'书库精选 · 原文与章节已核对'};
 try{
  const result=await requestAI('inspiration',{items:pending.map(s=>({id:s.id,topic:s.topic,quote:s.source.quote,author:s.source.author,work:s.source.work}))});
  const originals=new Map(pending.map(s=>[s.id,s]));
  if(!Array.isArray(result.items)||result.items.length!==pending.length||new Set(result.items.map(s=>s.id)).size!==pending.length||result.items.some(s=>!originals.has(s.id)))throw new Error('推荐结果不完整');
  return {items:[...ready,...result.items.map(s=>({...originals.get(s.id),short:s.short,desc:s.desc,questions:s.questions,summary:s.summary,interpretation:s.interpretation,writingHint:s.writingHint,themes:s.themes,promptKind:'ai',aiModel:result.model}))],status:'DeepSeek 推荐 · 原文保留出处'};
 }catch(error){return {items,status:'已显示原文 · '+(error.name==='AbortError'?'AI 响应超时':error.message)+'，提示暂用预设'}}
}

let aiRun=null,aiDraft=null,aiSnapshot=null;
function cancelEditorAI(){if(aiRun){aiRun.abort();aiRun=null}}
document.querySelector('#dialog').addEventListener('close',cancelEditorAI);
editorAI=function(){
 saveEditor();cancelEditorAI();aiDraft=null;
 const article=articles.find(a=>a.id===currentId);if(!article)return;
 aiSnapshot={id:article.id,title:article.title,content:article.content};
 modal(`<div class="eyebrow">DeepSeek · 写作助手</div><h2>一起读一遍这篇文字</h2><p>《${esc(article.title||'未命名文章')}》 · ${count(article.content)} 字</p><p class="source-note">点击下方按钮后，将当前文章发送给 DeepSeek。建议与续写先供你审阅。</p><div id="ai-result" aria-live="polite"></div><div class="actions"><button class="primary" data-ai-task="advice">给我修改建议</button><button class="secondary" data-ai-task="continue">沿着这段续写</button></div>`);
};
async function runEditorAI(task){
 if(aiRun||!aiSnapshot)return;
 if(!aiSnapshot.content.trim())return toast('先写一点正文，再请 AI 一起读');
 if(aiSnapshot.content.length>12000)return toast('这篇超过 12000 字，暂时只支持较短的文章');
 const snapshot={...aiSnapshot},controller=new AbortController();aiRun=controller;aiDraft=null;
 const box=document.querySelector('#ai-result');
 box.innerHTML='<p class="ai-loading">'+(task==='advice'?'正在读你的文字…':'正在接着这一段往下写…')+'</p>';
 document.querySelectorAll('[data-ai-task]').forEach(b=>b.disabled=true);
 try{
  const result=await requestAI(task,{title:snapshot.title,content:snapshot.content},controller.signal);
  if(controller.signal.aborted||aiRun!==controller||!box.isConnected)return;
  if(task==='advice')box.innerHTML=`<div class="draft-preview"><p>${esc(result.summary)}</p><ol>${result.suggestions.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></div>`;
  else {aiDraft={...snapshot,text:result.text};box.innerHTML=`<div class="draft-preview ai-continuation">${esc(result.text)}</div><div class="actions"><button class="primary" data-ai-insert>插入正文</button><button class="text-btn" data-action="close">暂不采用</button></div>`}
 }catch(error){if(!controller.signal.aborted&&box.isConnected)box.innerHTML=`<p class="ai-error">${esc(error.name==='AbortError'?'等待超时，请重试':error.message)}。正文已保留。</p>`}
 finally{if(aiRun===controller){aiRun=null;document.querySelectorAll('[data-ai-task]').forEach(b=>b.disabled=false)}}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.aiTask){event.stopImmediatePropagation();return runEditorAI(button.dataset.aiTask)}
 if(button.hasAttribute('data-ai-insert')){
  event.stopImmediatePropagation();if(!aiDraft)return;
  const article=articles.find(a=>a.id===aiDraft.id);
  if(!article||currentId!==aiDraft.id||article.content!==aiDraft.content)return toast('正文已经变化，请重新生成续写');
  article.undoContent=article.content;article.content+=(article.content?'\n\n':'')+aiDraft.text;
  persist('articles',articles);aiDraft=null;closeModal();render();
  modal('<div class="eyebrow">续写已插入</div><h2>接下来，按你的意思修改</h2><div class="actions"><button class="primary" data-action="close">回到正文</button><button class="secondary" data-action="undo-draft">撤销插入</button></div>');return;
 }
 if(button.dataset.action==='close')cancelEditorAI();
 if(button.dataset.action==='about'){
  event.stopImmediatePropagation();modal('<div class="eyebrow">关于笺墨溪</div><h2>把生活写下来</h2><p>收藏一句灵感，慢慢读一篇文章，也给自己的故事留一页纸。</p><p>文章与收藏保存在当前写作空间，并在登录的设备间同步。写作助手可提供修改建议和续写，由你决定是否采用。</p><p class="source-note">当前使用空间密码登录，共用密码的设备会访问同一份内容。阅读与摘句保留作者和来源；AI 生成的写作提示另行标注。</p><button class="primary" data-action="close">继续写作</button>');
 }
},true);
fetch('/api/ai/status').then(r=>r.json()).then(s=>{if(!document.querySelector('.preview-label')?.textContent.includes('已连接'))aiConnection(s.configured?'DeepSeek · 已配置':'DeepSeek · 未配置')}).catch(()=>aiConnection('DeepSeek · 未连接'));

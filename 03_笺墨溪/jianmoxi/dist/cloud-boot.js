/* Cloud bootstrap loads server state before the existing application starts. */
(async()=>{
 // Let the Android shell open source links in the system browser.
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[target="_blank"]');
  if(event.isTrusted&&link&&/XingzouAndroid\//.test(navigator.userAgent))link.target='_self';
 },true);
 const cloudKeys=new Set(['articles','trash','saved','favs','activity','goal','currentId','comment','preferences']);
 const backupBase='xingzou-cloud-pending-v1';
 let account=null,backupKey=backupBase;
 let state={},version=0,changed=0,committed=0,saving=false,blocked=false,timer,status='已同步云端';
 const shell=document.body.innerHTML;
 const e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function api(path,options={}){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(path,{credentials:'same-origin',...options,signal:controller.signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'云端连接失败');error.status=response.status;throw error}return data}finally{clearTimeout(timeout)}}
 function downloadBackup(value){const url=URL.createObjectURL(new Blob([JSON.stringify({format:'xingzou-v1',state:value},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='笺墨溪-完整备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function indicator(text,error=false){status=text;document.querySelectorAll('.cloud-status,#save-status').forEach(el=>{el.textContent=text;el.dataset.error=String(error)})}
 function placeBanner(box){
  if(!document.documentElement.classList.contains('web-cloud')){document.body.append(box);return}
  if(typeof assistantPanel!=='undefined'&&!assistantPanel.hidden){box.inert=false;delete box.dataset.chatInert;assistantPanel.after(box)}else document.body.append(box)
 }
 function banner(text,buttons=[]){document.querySelector('.cloud-bar')?.remove();const box=document.createElement('div');box.className='cloud-bar';const label=document.createElement('span');label.textContent=text;box.append(label);buttons.forEach(([name,fn])=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=fn;box.append(b)});placeBanner(box)}
 function pending(){try{localStorage.setItem(backupKey,JSON.stringify({version,state}))}catch{indicator('未同步，请导出副本',true)}}
 let inFlight=null;
 function flush(){if(inFlight)return inFlight;inFlight=flushOnce().finally(()=>{inFlight=null});return inFlight}
 async function flushOnce(){
  clearTimeout(timer);if(saving||blocked||changed===committed)return;
  saving=true;const sending=changed,payload=JSON.stringify({version,state});indicator('正在同步…');
  try{const result=await api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:payload,keepalive:payload.length<60000});version=result.version;committed=sending;
   if(changed===committed){localStorage.removeItem(backupKey);indicator('已同步云端');document.querySelector('.cloud-bar')?.remove()}else pending();
  }catch(error){
   if([400,401,409,413].includes(error.status)){blocked=true;indicator('未同步，请保留副本',true);banner(error.message,[['导出当前副本',()=>downloadBackup(state)],['重新加载',()=>{downloadBackup(state);location.reload()}]])}
   else{indicator('网络中断，待同步',true);banner('修改已暂存在本机，联网后重试。',[['重试',()=>flush()],['导出副本',()=>downloadBackup(state)]])}
  }finally{saving=false;if(!blocked&&changed!==committed)timer=setTimeout(flush,5000)}
 }
 function storageKey(key){
  if(!account)return key;
  const scoped=key+':'+account.id;
  if(account.owner)try{
   const legacy=localStorage.getItem(key);
   if(legacy!==null){if(localStorage.getItem(scoped)===null)localStorage.setItem(scoped,legacy);localStorage.removeItem(key)}
  }catch{}
  return scoped;
 }
 function load(key,fallback){if(cloudKeys.has(key))return structuredClone(state[key]??fallback);try{return JSON.parse(localStorage.getItem(storageKey('xingzou-cloud-cache-'+key)))??fallback}catch{return fallback}}
 function persist(key,value){
  if(!cloudKeys.has(key)){try{localStorage.setItem(storageKey('xingzou-cloud-cache-'+key),JSON.stringify(value))}catch{}return true}
  const next=JSON.parse(JSON.stringify(value));if(JSON.stringify(state[key])===JSON.stringify(next))return true;
  state[key]=next;changed++;pending();indicator('等待同步…');clearTimeout(timer);timer=setTimeout(flush,650);return true;
 }
 function bindAccount(){
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options)=>{
   const url=new URL(input instanceof Request?input.url:input,location.href);
   if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return originalFetch(input,options);
   const headers=new Headers(options?.headers??(input instanceof Request?input.headers:undefined));
   headers.set('X-Xingzou-Space',account.id);
   return originalFetch(input,{...options,headers});
  };
  function reopen(){
   clearTimeout(timer);blocked=true;committed=changed;
   document.body.replaceChildren();location.reload();
  }
  window.addEventListener('storage',event=>{if(event.key===window.xingzouAuth.sessionEvent)reopen()});
  window.addEventListener('pageshow',event=>{if(event.persisted)reopen()});
 }
 function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s)})}
 try{
  const session=await api('/api/session');
  if(!session.authenticated)return window.xingzouAuth.showLogin(api,session.personalAccounts);
  account=session.account||null;
  if(account){backupKey=storageKey(backupBase);bindAccount()}
  const [snapshot,catalog,images]=await Promise.all([api('/api/state'),api('/api/readings'),api('/api/images').catch(()=>[])]);state=snapshot.state;version=snapshot.version;
  let recovery;try{recovery=JSON.parse(localStorage.getItem(backupKey))}catch{}
  document.body.className='cloud-starting';document.body.innerHTML=shell;document.querySelector('script[src^="/cloud-boot.js"]')?.remove();
  window.xingzouCloud={load,persist,flush,storageKey,account,relocateBanner(){const box=document.querySelector('.cloud-bar');if(box&&document.documentElement.classList.contains('web-cloud'))placeBanner(box)},get status(){return status},get isSynced(){return changed===committed&&!saving&&!blocked},acceptSnapshot(snapshot){if(changed!==committed||saving||blocked)throw new Error('本机有待同步修改，请先保存');state=snapshot.state;version=snapshot.version;localStorage.removeItem(backupKey);indicator('已同步云端')},catalog,export:()=>downloadBackup(state)};
  await script('/image-library.js?v=20261104-create-1');window.xingzouImages.set(images);catalog.splice(0,catalog.length,...window.xingzouImages.assign(catalog));await script('/app.js?v=20261108-buttons-2');await script('/live-feed.js?v=20261104-create-1');await script('/ai-client.js');
  const base=createLiveFeedProvider({async load(){return {items:catalog,nextCursor:0}}});
  window.xingzouFeedProvider={async load(args){if(args.kind==='reading'){const fresh=await api('/api/readings');return {items:fresh,nextCursor:0,status:'云端内容库'}}return base.load(args)}};
  await script('/refinements.js?v=20261104-create-1');await script('/cloud-ui.js');await script('/library-ui.js');await script('/assistant-ui.js?v=20261110-chat-text-1');await script('/reading-tools.js');await script('/editorial.js?v=20261104-1');await script('/notebook.js?v=20261104-1');await script('/flow.js?v=20261104-create-1');await script('/navigation.js?v=20261108-buttons-2');await script('/moment.js?v=20261104-1');await script('/reading-guide.js?v=20261105-2');await script('/quote-library.js?v=20261105-2');document.body.classList.remove('cloud-starting');
  if(!document.documentElement.classList.contains('web-cloud')){
   script('/web/appearance.js?v=20261110-android-skins-1').catch(error=>console.warn('皮肤暂未加载',error));
  }
  if(recovery?.state){blocked=true;banner('上次有未同步的修改，请先保存副本，再继续使用云端内容。',[['导出未同步副本',()=>downloadBackup(recovery.state)],['使用云端内容',()=>{downloadBackup(recovery.state);localStorage.removeItem(backupKey);location.reload()}]])}
  window.addEventListener('online',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)setTimeout(flush,0)});
  window.addEventListener('beforeunload',event=>{if(changed!==committed){event.preventDefault();event.returnValue=''}});
  document.addEventListener('click',async event=>{
   const button=event.target.closest('[data-cloud]');if(!button)return;
   if(button.dataset.cloud==='export'){saveEditor();downloadBackup(state)}
   if(button.dataset.cloud==='logout'){
    saveEditor();await flush();
    if(changed!==committed||blocked)return banner('请先保存未同步的副本，再退出。',[['导出副本',()=>downloadBackup(state)]]);
    try{await api('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(account)window.xingzouAuth.notifySession();document.body.replaceChildren();location.assign(location.pathname)}
    catch(error){toast(error.message)}
   }
   if(button.dataset.cloud==='invite'){
    button.disabled=true;
    try{
     const result=await api('/api/account/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
     modal('<h2>邀请朋友</h2><p>请把邀请码私下发给朋友。有效期 7 天，使用一次后失效。</p><label>邀请码<input class="search" id="invite-code" readonly></label><div class="actions"><button type="button" class="primary" id="copy-invite">复制邀请码</button></div>');
     const field=document.querySelector('#invite-code');
     field.value=result.code;
     document.querySelector('#copy-invite').onclick=async()=>{
      try{await navigator.clipboard.writeText(field.value);toast('已复制邀请码')}
      catch{field.focus();field.select();toast('请手动复制邀请码')}
     };
    }catch(error){toast(error.message)}finally{button.disabled=false}
   }
   if(button.dataset.cloud==='import'){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.onchange=async()=>{try{const file=input.files[0];if(!file||file.size>8*1024*1024)throw new Error('备份文件过大');const parsed=JSON.parse(await file.text());const incoming=Array.isArray(parsed)?{articles:parsed}:parsed.state;if(!incoming||!Array.isArray(incoming.articles))throw new Error('请选择笺墨溪导出的备份');saveEditor();await flush();if(changed!==committed||blocked)throw new Error('请先解决未同步的修改');
     const merged=structuredClone(state);
     const ids=new Set([...merged.articles,...merged.trash].map(article=>article.id));
     const versions=new Map();
     for(const key of ['articles','trash'])for(const article of incoming[key]||[]){
      const origin=article.importedFrom||article.id;
      const versionKey=key+':'+origin;
      if(!versions.has(versionKey))versions.set(versionKey,merged[key].filter(row=>(row.importedFrom||row.id)===origin));
      const matches=versions.get(versionKey);
      const {id,importedFrom,...content}=article;
      if(matches.some(row=>{
       const {id,importedFrom,...existing}=row;
       return JSON.stringify(existing)===JSON.stringify(content);
      }))continue;
      const copy=structuredClone(article);
      if(ids.has(copy.id)){
       copy.id='import-'+crypto.randomUUID();
       copy.importedFrom=origin;
      }
      merged[key].push(copy);
      ids.add(copy.id);
      matches.push(copy);
     }
     merged.saved=[...merged.saved,...(incoming.saved||[]).filter(s=>!merged.saved.some(x=>x.id===s.id))];merged.favs=[...new Set([...merged.favs,...(incoming.favs||[])])];
     for(const [day,log] of Object.entries(incoming.activity||{})){const old=merged.activity[day]||{chars:0,edits:0};merged.activity[day]={chars:Math.max(old.chars,log.chars),edits:Math.max(old.edits,log.edits)}}
     if(JSON.stringify(merged)===JSON.stringify(state))return toast('备份内容已在写作空间中');
     await api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,state:merged})});location.reload();
    }catch(err){banner(err.message)}};input.click();
   }
  });
 }catch(error){window.xingzouAuth.showConnectionError()}
})();

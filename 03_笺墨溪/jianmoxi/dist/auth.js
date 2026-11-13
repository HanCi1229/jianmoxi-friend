/* Accessible login and invitation enrollment for the writing space. */
window.xingzouAuth = (() => {
 const svg=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${({arrow:'M4 12h16m-6-6 6 6-6 6',eye:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Zm7 4v3',book:'M4 4h6c2 0 2 2 2 2s0-2 2-2h6v15h-6c-2 0-2 2-2 2s0-2-2-2H4ZM12 6v15'})[name]}"/></svg>`;
 const brand=`<a class="auth-brand" href="#" aria-label="笺墨溪首页"><img class="auth-brand-icon" src="/assets/jianmoxi-icon.svg" width="40" height="40" alt=""><span>笺墨溪</span><small>把生活写下来</small></a>`;
 function frame(content){
  delete document.body.dataset.page;
  document.body.className='auth-page';
  document.body.innerHTML=`<div class="auth-layout"><header class="auth-header">${brand}<span class="auth-header-note">A PLACE FOR YOUR WORDS</span></header><main class="auth-main"><section class="auth-cover" aria-labelledby="cover-title"><div class="auth-photo"><img src="/assets/forest.jpg" alt="阳光穿过树木，落在一条安静的林间小路上" fetchpriority="high"><span class="auth-photo-caption">留一点时间，给自己。</span></div><div class="auth-cover-copy"><span class="auth-kicker">生活有迹，文字有声</span><h1 id="cover-title">把生活<span>写下来</span></h1><p>一段文字，一处风景。<br>那些微小的瞬间，都值得被记住。</p></div></section><section class="auth-panel">${content}</section></main><footer class="auth-footer"><span>笺墨溪 · 为每一个想写下来的瞬间</span><span>READ · NOTICE · WRITE</span></footer></div>`;
 }
 function help(){
  const panel=document.querySelector('.auth-help-detail');panel.hidden=!panel.hidden;
  document.querySelector('[data-login-help]').setAttribute('aria-expanded',String(!panel.hidden));
 }
 const sessionEvent='xingzou-account-session';
 function notifySession(){
  try{localStorage.setItem(sessionEvent,String(Date.now())+'-'+Math.random())}catch{}
 }
 function showLogin(api, personal=false, registering=false){
  const action=registering?'创建账号':'进入笺墨溪';
  const label=personal?'密码':'访问密码';
  const identity=personal?`<label class="auth-label" for="login-username">账号</label><div class="auth-password"><input id="login-username" name="username" autocomplete="username" autocapitalize="none" maxlength="32" placeholder="字母或数字开头，至少 3 位" required></div>`:'';
  const code=registering?`<label class="auth-label" for="login-code">邀请码</label><div class="auth-password"><input id="login-code" name="code" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" required></div>`:'';
  frame(`<div class="auth-form-heading"><span class="auth-kicker">YOUR WRITING SPACE</span><h2>${registering?'开启你的写作空间':'欢迎回来'}</h2><p>${registering?'用朋友给你的邀请码，创建自己的写作空间。':'登录笺墨溪，接着写你的故事。'}</p></div><form id="cloud-login"><div class="auth-fields">${identity}<label class="auth-label" for="login-password">${label}</label><div class="auth-password">${svg('lock')}<input id="login-password" name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" placeholder="${registering?'设置你的密码':'输入你的'+label}" aria-describedby="login-error" required><button class="auth-reveal" type="button" aria-label="显示密码" aria-pressed="false">${svg('eye')}</button></div>${code}</div><p id="login-error" class="auth-error" role="alert" aria-live="polite"></p><button class="auth-submit" type="submit"><span>${action}</span>${svg('arrow')}</button><p class="auth-session-note">登录后，在此设备保留 7 天登录状态</p></form><div class="auth-support"><span>${svg('book')} 给文字一个安静的地方</span>${personal?`<button type="button" data-enroll>${registering?'返回登录':'使用邀请码'}</button>`:`<button type="button" data-login-help aria-expanded="false" aria-controls="login-help">登录帮助</button>`}</div><div class="auth-help-detail" id="login-help" hidden><p>使用你的写作空间访问密码登录。若忘记密码，请联系空间管理者重置。</p></div>`);
  const form=document.querySelector('#cloud-login'),input=form.elements.password,button=form.querySelector('[type="submit"]'),error=document.querySelector('#login-error');
  let busy=false;
  document.querySelector('.auth-reveal').onclick=event=>{
   const visible=input.type==='password';input.type=visible?'text':'password';
   event.currentTarget.setAttribute('aria-label',visible?'隐藏密码':'显示密码');event.currentTarget.setAttribute('aria-pressed',String(visible));
  };
  const enrollment=document.querySelector('[data-enroll]');
  if(enrollment)enrollment.onclick=()=>showLogin(api,personal,!registering);
  else document.querySelector('[data-login-help]').onclick=help;
  input.addEventListener('input',()=>{error.textContent='';input.removeAttribute('aria-invalid')});
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   if(!form.reportValidity())return;
   const fields=Object.fromEntries(new FormData(form));
   if(registering)fields.code=fields.code.trim();
   busy=true;button.disabled=true;input.readOnly=true;form.setAttribute('aria-busy','true');error.textContent='';button.querySelector('span').textContent=registering?'正在创建':'正在登录';
   try{await api(registering?'/api/register':'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});if(personal)notifySession();button.querySelector('span').textContent='正在打开你的空间';location.assign(location.pathname)}
   catch(err){
    error.textContent=err.status?err.message:err.name==='AbortError'?'连接超时，请检查网络后重试。':!navigator.onLine?'网络已断开，请联网后重试。':'暂时无法连接，请稍后重试。';
    if(err.status===401)input.setAttribute('aria-invalid','true');
    busy=false;button.disabled=false;input.readOnly=false;form.removeAttribute('aria-busy');button.querySelector('span').textContent=action;
   }
  };
 }
 function showConnectionError(){
  frame(`<div class="auth-form-heading"><span class="auth-kicker">WE’LL BE RIGHT HERE</span><h2>稍等，再试一次</h2><p>暂时无法打开你的写作空间。<br>请检查网络连接，或稍后再回来。</p></div><button class="auth-submit" id="auth-retry"><span>重新连接</span>${svg('arrow')}</button><p class="auth-session-note">本次未能读取文章，不会改动已保存的内容。</p>`);
  document.querySelector('#auth-retry').onclick=()=>location.reload();
 }
 return {showLogin,showConnectionError,notifySession,sessionEvent};
})();

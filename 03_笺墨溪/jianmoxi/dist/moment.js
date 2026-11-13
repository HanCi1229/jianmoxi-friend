/* Today's mood and the selected weather location stay on this device. */
(() => {
 const css=document.createElement('link');css.rel='stylesheet';css.href='/moment.css?v=20261104-9';document.head.append(css);
 const key=(window.xingzouCloud?.storageKey('jianmoxi-today-v1')||'jianmoxi-today-v1'),moods=['平静','愉快','期待','想念','低落','疲惫'];let state={},busy=false,epoch=0;
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`};
 let greeting=null,greetingRequest=null,greetingAttempt='',greetingAt=0;
 function moodValue(){return state.day===today()&&moods.includes(state.mood)?state.mood:''}
 function greetingKey(){return today()+'|'+moodValue()}
 function requestGreeting(){
  if(page!=='inspiration')return;
  const key=greetingKey();if(greetingAttempt===key&&Date.now()-greetingAt<60000)return;
  greetingAttempt=key;greetingAt=Date.now();const marker={key};greetingRequest=marker;
  const control=new AbortController(),timer=setTimeout(()=>control.abort(),22000);
  fetch('/api/companion/greeting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mood:moodValue()}),credentials:'same-origin',signal:control.signal})
   .then(async r=>{if(!r.ok)throw new Error('Greeting unavailable');return r.json()})
   .then(value=>{if(greetingRequest!==marker||key!==greetingKey())return;greeting={key,text:typeof value.text==='string'?value.text:'',name:value.name||'搭子'};paintGreeting()})
   .catch(()=>{}).finally(()=>clearTimeout(timer));
 }
 function paintGreeting(){const note=document.getElementById('moment-kind-words');if(!note)return;const current=greeting?.key===greetingKey()?greeting:null;note.textContent=current?.text||'';note.setAttribute('aria-label',(current?.name||'搭子')+'的问候')}
 function invalidateGreeting(){greeting=null;greetingAttempt='';greetingRequest=null;paintGreeting()}
 const previousCloseAssistant=closeAssistant;closeAssistant=function(){previousCloseAssistant();invalidateGreeting()};
 document.addEventListener('companion-profile-updated',invalidateGreeting);
 try{state=JSON.parse(localStorage.getItem(key)||'{}')||{}}catch{}
 if(typeof state!=='object'||Array.isArray(state))state={};
 if(!state.place||!Number.isFinite(state.place.lat)||!Number.isFinite(state.place.lon))state.place=null;
 function save(){try{localStorage.setItem(key,JSON.stringify(state))}catch{toast('当前设置未能保存到设备')}}
 function fresh(){return state.weather&&Date.now()-state.weather.updatedAt*1000<1800000}
 function header(){
  const target=document.getElementById('moment-controls');if(!target)return;
  const place=state.place?.name||'选择地点',weather=busy?'更新天气…':fresh()?`${state.weather.condition} ${state.weather.temperature}°C`:state.place?'天气待更新':'';
  const mood=state.day===today()&&moods.includes(state.mood)?state.mood:'今日心情';
  let note=document.getElementById('moment-kind-words');if(!note){note=document.createElement('p');note.id='moment-kind-words';note.setAttribute('aria-live','polite');target.parentElement.append(note)}
  paintGreeting();requestGreeting();
  target.innerHTML=`<button class="moment-location" data-moment-place aria-label="选择地点并查看天气"><span>${esc(place)}</span>${weather?`<span class="moment-weather">${esc(weather)}</span>`:''}</button><button class="moment-mood" data-moment-mood>${esc(mood)}<span aria-hidden="true">⌄</span></button>`;
 }
 const baseRender=render;render=function(){baseRender();header()};
 async function api(data){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);try{const r=await fetch('/api/weather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),credentials:'same-origin',signal:controller.signal});const value=await r.json();if(!r.ok)throw new Error(value.error||'天气暂时不可用');return value}finally{clearTimeout(timer)}}
 async function weather(place){
  const version=++epoch;busy=true;state.place=place;delete state.weather;save();header();
  try{const value=await api({action:'current',...place});if(version!==epoch)return;state.place={lat:value.lat,lon:value.lon,name:value.name};state.weather=value;save()}
  catch(e){if(version===epoch)toast(e.name==='AbortError'?'天气查询超时，请稍后重试':e.message)}
  finally{if(version===epoch){busy=false;header()}}
 }
 function placeDialog(){
  const oldAndroid=/XingzouAndroid\/(0\.1\.[012])\b/.test(navigator.userAgent);
  modal(`<h2>地点与天气</h2><p class="moment-note">开启定位后查询附近天气；也可以手动选择城市。</p>${oldAndroid?'<p class="moment-note">安装新版后可使用定位。<a href="/downloads/jianmoxi-0.1.3.apk">下载新版</a></p>':'<button class="secondary" type="button" data-moment-locate>使用当前位置</button>'}<form id="moment-city-form"><label for="moment-city">城市名称</label><div class="moment-search"><input id="moment-city" maxlength="80" placeholder="例如：杭州" autocomplete="off" required minlength="2"><button class="secondary" type="submit">查找</button></div></form><div id="moment-results" aria-live="polite"></div>${state.place?'<div class="actions"><button class="text-btn" data-moment-refresh>更新天气</button><button class="text-btn" data-moment-clear>清除地点</button></div>':''}<p class="moment-credit">天气：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · 城市：GeoNames / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a><br>位置仅用于查询天气，不记录轨迹。</p>`);
  const form=document.getElementById('moment-city-form'),result=document.getElementById('moment-results');
  form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;result.textContent='正在查找城市…';try{const value=await api({action:'cities',query:form.querySelector('input').value.trim()});if(!result.isConnected)return;result.replaceChildren();if(!value.cities.length)result.textContent='没有找到这个城市，换一个名称试试。';for(const city of value.cities){const b=document.createElement('button');b.className='moment-city-result';b.type='button';b.textContent=city.name+' · '+city.region;b.onclick=()=>{closeModal();weather({lat:city.lat,lon:city.lon,name:city.name})};result.append(b)}}catch(e){result.textContent=e.name==='AbortError'?'查询超时，请重试':e.message}finally{button.disabled=false}});
 }
 function locate(button){
  if(!navigator.geolocation)return toast('设备暂不支持定位，请手动选择城市');
  button.disabled=true;button.textContent='正在定位…';const version=++epoch;
  navigator.geolocation.getCurrentPosition(p=>{if(version!==epoch)return;closeModal();weather({lat:Math.round(p.coords.latitude*100)/100,lon:Math.round(p.coords.longitude*100)/100,name:''})},e=>{if(version!==epoch)return;button.disabled=false;button.textContent='使用当前位置';toast(e.code===1?'未开启定位权限，可以手动选择城市':'暂时无法定位，可以手动选择城市')},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-moment-place]'))return placeDialog();
  if(e.target.closest('[data-moment-mood]'))return modal(`<h2>此刻的心情</h2><div class="moment-moods">${moods.map(m=>`<button type="button" class="moment-mood-option" aria-pressed="${moodValue()===m}" data-moment-set="${m}">${m}</button>`).join('')}</div>`);
  const mood=e.target.closest('[data-moment-set]');if(mood){if(!moods.includes(mood.dataset.momentSet))return;state.day=today();state.mood=mood.dataset.momentSet;save();invalidateGreeting();closeModal();header();return}
  const geo=e.target.closest('[data-moment-locate]');if(geo)return locate(geo);
  if(e.target.closest('[data-moment-refresh]')&&state.place){closeModal();weather(state.place);return}
  if(e.target.closest('[data-moment-clear]')){++epoch;busy=false;delete state.weather;state.place=null;save();closeModal();header()}
 });
 document.getElementById('dialog').addEventListener('close',()=>{if(!busy)++epoch});
 header();if(state.place&&!fresh())weather(state.place);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){header();if(state.place&&!busy&&!fresh())weather(state.place)}});
})();

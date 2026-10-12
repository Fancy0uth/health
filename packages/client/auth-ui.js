export async function openLogin(client,{initialize=false}={}) {
  if(!document.querySelector('link[data-healththread-auth]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/packages/client/auth.css';style.dataset.healththreadAuth='';document.head.append(style);
  }
  const mobile=location.pathname.startsWith('/mobile/');
  const screen=document.createElement('section');screen.className='ht-auth'+(mobile?' ht-auth-mobile':'');screen.setAttribute('aria-label','HealthThread 登录');
  screen.innerHTML=`<div class="ht-auth-layout"><div class="ht-auth-intro"><img src="/web/assets/healththread-logo.svg" alt="HealthThread" width="176" height="121"><h1>健康信息，<br>始终连贯。</h1><p>记录身体感受，整理就诊资料。<br>手机和电脑，连接同一份健康档案。</p></div><form class="ht-auth-card"><span class="ht-auth-eyebrow">欢迎回来</span><h2>登录 HealthThread</h2><p class="ht-auth-description">继续整理你的健康信息</p><label>账号<input name="username" autocomplete="username" placeholder="请输入账号" required></label><label>密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></label><p class="ht-auth-status" role="status" aria-live="polite"></p><button type="submit">登录并继续</button><p class="ht-auth-footnote">使用同一账号，两端共享记录和核对结果</p></form></div>`;
  document.body.append(screen);
  const form=screen.querySelector('form'),status=form.querySelector('[role=status]'),button=form.querySelector('button');
  const app=document.getElementById('app');app.inert=true;
  const remove=()=>{app.inert=false;screen.remove();};
  if(initialize){
    try{await client.initialize();if(client.state.user){remove();return;}}
    catch(error){status.textContent='无法连接后端：'+error.message+'。请确认本地服务已启动，再登录重试。';}
  }
  form.elements.username.focus();
  await new Promise(resolve=>form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;button.disabled=true;button.textContent='正在登录…';status.textContent='';
    try{await client.login(form.elements.username.value.trim(),form.elements.password.value);remove();resolve();}
    catch(error){status.textContent=error.message||'登录失败，请重试。';}
    finally{button.disabled=false;button.textContent='登录并继续';}
  }));
}

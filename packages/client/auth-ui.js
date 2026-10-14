export async function openLogin(client,{initialize=false}={}) {
  if(!document.querySelector('link[data-healththread-auth]')){
    const style=document.createElement('link');style.rel='stylesheet';style.href='/packages/client/auth.css';style.dataset.healththreadAuth='';document.head.append(style);
  }
  const mobile=location.pathname.startsWith('/mobile/');
  const screen=document.createElement('section');screen.className='ht-auth'+(mobile?' ht-auth-mobile':'');screen.setAttribute('aria-label','HealthThread 登录');
  screen.innerHTML=`<div class="ht-auth-layout"><div class="ht-auth-intro"><img src="/web/assets/healththread-logo.svg" alt="HealthThread" width="176" height="121"><h1>健康信息，<br>始终连贯。</h1><p>记录身体感受，整理就诊资料。<br>手机和电脑，连接同一份健康档案。</p></div><form class="ht-auth-card" novalidate><span class="ht-auth-eyebrow">欢迎回来</span><h2 class="ht-auth-title">登录 HealthThread</h2><p class="ht-auth-description">继续整理你的健康信息</p><label>账号<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="请输入账号" maxlength="200" required aria-describedby="ht-auth-username-help"></label><p id="ht-auth-username-help" class="ht-auth-input-help ht-auth-username-help" hidden>3–32 位，可使用字母、数字、点、下划线或短横线</p><label>密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" maxlength="1024" required aria-describedby="ht-auth-password-help"></label><p id="ht-auth-password-help" class="ht-auth-input-help ht-auth-password-help" hidden>10–128 位，不能全部使用空格</p><label class="ht-auth-confirm" hidden>确认密码<input name="confirm_password" type="password" autocomplete="new-password" placeholder="请再次输入密码" maxlength="256"></label><p class="ht-auth-status" role="status" aria-live="polite"></p><button class="ht-auth-submit" type="submit">登录并继续</button><p class="ht-auth-mode-hint"><span class="ht-auth-mode-label">还没有账号？</span><button class="ht-auth-switch" type="button" data-auth-switch>注册账号</button></p><p class="ht-auth-footnote">使用同一账号，两端共享记录和核对结果</p></form></div>`;
  document.body.append(screen);
  const form=screen.querySelector('form'),status=form.querySelector('[role=status]'),button=form.querySelector('[type=submit]'),switchButton=form.querySelector('[data-auth-switch]');
  const username=form.elements.username,password=form.elements.password,confirmation=form.elements.confirm_password;
  let registering=false;
  const app=document.getElementById('app');app.inert=true;
  const remove=()=>{password.value='';confirmation.value='';app.inert=false;screen.remove();};
  const setMode=register=>{
    if(button.disabled)return;
    registering=register;password.value='';confirmation.value='';status.textContent='';
    screen.setAttribute('aria-label',register?'HealthThread 注册':'HealthThread 登录');
    form.querySelector('.ht-auth-eyebrow').textContent=register?'从这里开始':'欢迎回来';
    form.querySelector('.ht-auth-title').textContent=register?'注册 HealthThread':'登录 HealthThread';
    form.querySelector('.ht-auth-description').textContent=register?'创建你的独立健康档案账号':'继续整理你的健康信息';
    form.querySelector('.ht-auth-confirm').hidden=!register;confirmation.required=register;
    form.querySelector('.ht-auth-username-help').hidden=!register;form.querySelector('.ht-auth-password-help').hidden=!register;
    username.maxLength=register?32:200;password.maxLength=register?256:1024;password.autocomplete=register?'new-password':'current-password';
    button.textContent=register?'注册并继续':'登录并继续';switchButton.textContent=register?'登录':'注册账号';
    form.querySelector('.ht-auth-mode-label').textContent=register?'已有账号？':'还没有账号？';
    form.querySelector('.ht-auth-footnote').textContent=register?'新账号的健康资料整理默认关闭，可在设置中另行授权':'使用同一账号，两端共享记录和核对结果';
    username.focus();
  };
  switchButton.addEventListener('click',()=>setMode(!registering));
  if(initialize){
    try{await client.initialize();if(client.state.user){remove();return;}}
    catch(error){status.textContent='无法连接后端：'+error.message+'。请确认本地服务已启动，再登录重试。';}
  }
  username.focus();
  await new Promise(resolve=>form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;status.textContent='';
    const account=username.value.trim(),secret=password.value;
    const invalid=(message,field)=>{status.textContent=message;field.focus();};
    if(!account)return invalid('请输入账号。',username);
    if(registering&&!/^[A-Za-z0-9_.-]{3,32}$/.test(account))return invalid('账号需为 3–32 位，可使用字母、数字、点、下划线或短横线。',username);
    if(!secret)return invalid('请输入密码。',password);
    const passwordLength=registering?Array.from(secret).length:0;
    if(registering&&(passwordLength<10||passwordLength>128||!secret.trim()))return invalid('密码需为 10–128 位，不能全部使用空格。',password);
    if(registering&&secret!==confirmation.value)return invalid('两次输入的密码不一致，请重新确认。',confirmation);
    button.disabled=true;switchButton.disabled=true;button.textContent=registering?'正在注册…':'正在登录…';
    try{await (registering?client.register(account,secret):client.login(account,secret));remove();resolve();}
    catch(error){status.textContent=error.message||(registering?'注册失败，请重试。':'登录失败，请重试。');}
    finally{button.disabled=false;switchButton.disabled=false;button.textContent=registering?'注册并继续':'登录并继续';}
  }));
}

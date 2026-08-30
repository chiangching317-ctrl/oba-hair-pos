function currentEntryViewerLabel(){
  const session=window.OBA_ACCESS_SESSION;
  if(!session)return '';
  if(session.kind==='owner-control')return '總控／擁有者';
  if(session.kind==='boss')return 'BOSS 唯讀';
  return String(session.name||session.id||'員工');
}
function updateCashierDisplay(){
  const badge=$('#cashierDisplay');
  if(!badge)return;
  const viewer=currentEntryViewerLabel();
  if(typeof isAssignOnlyDevice==='function' && isAssignOnlyDevice() && !isBossMode()){
    badge.textContent=`${viewer?`登入：${viewer} ｜ `:''}未授權設備｜只能刷單入業績`;
    return;
  }
  const operator=CURRENT_CASHIER?` ｜ 本單經手人：${CURRENT_CASHIER.name}`:'';
  const identity=viewer?` ｜ 登入：${viewer}`:' ｜ 尚未登入';
  badge.textContent=`現金 / 轉帳 / LINE Pay${identity}${operator}`;
}
const PAGE_TAB_AUTH={manage:null,expense:null,report:null};
function activeTabName(){return document.querySelector('.tab.active')?.dataset?.tab||''}
function clearPageTabAuthorizationExcept(name){Object.keys(PAGE_TAB_AUTH).forEach(key=>{if(key!==name)PAGE_TAB_AUTH[key]=null})}
function authorizePageTab(name,authority){if(Object.prototype.hasOwnProperty.call(PAGE_TAB_AUTH,name)){PAGE_TAB_AUTH[name]=authority||null;return !!PAGE_TAB_AUTH[name]}return false}
function isPageTabAuthorized(name){return !!PAGE_TAB_AUTH[name]&&activeTabName()===name}
function requirePageTabAuthorization(name){if(isPageTabAuthorized(name))return true;alert(name==='manage'?'管理頁授權已失效，請重新進入管理頁並驗證 PIN':'支出頁授權已失效，請重新進入支出頁並驗證 PIN');return false}
function applyPageOperatorIdentity(name){
  if(isBossMode()) return;
  const authority=PAGE_TAB_AUTH[name];
  const ownerControl=authority?.kind==='owner-control';
  window.USER_ROLE=ownerControl?'owner':'staff';
  CURRENT_LOGIN_LEVEL=ownerControl?'owner':'staff';
  CURRENT_CASHIER=authority?.kind==='staff'?{id:authority.id,name:authority.name,permissions:[...(authority.permissions||[])]}:null;
  updateCashierDisplay();
}
function setActiveTab(name){
  const bossReadonlyExpense=isBossMode()&&name==='expense';
  if((name==='manage'||name==='expense')&&!PAGE_TAB_AUTH[name]&&!bossReadonlyExpense){alert(name==='manage'?'請先輸入具有 manage 權限的員工 PIN':'請先輸入具有支出頁權限的員工 PIN');return false}
  clearPageTabAuthorizationExcept(name);
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));
  $('#tab-'+name).classList.remove('hidden');
  applyPageOperatorIdentity(name);
  window.dispatchEvent(new CustomEvent('oba:tabchange',{detail:{name}}));
  return true;
}
function focusScanIfNeeded(name){if(name==='assign')setTimeout(()=>$('#assignOrderNo').focus(),50)}

// BOSS PIN only uses the private server-side credential. No frontend fallback.
async function verifyBossPin(pin){
  const p=String(pin||'').trim();
  if(!/^\d{6}$/.test(p)) return false;
  const verified=await verifyPinSecure(p,'boss-report');
  return !!(verified.ok&&verified.kind==='boss');
}
window.USER_ROLE = window.USER_ROLE || 'staff';
function isBossMode(){return window.USER_ROLE === 'boss'}
function guardBossAction(){if(isBossMode()){alert('目前模式只能查看，不能操作或修改資料');return true}return false}
function applyBossMode(){
  if(!isBossMode()) return;
  document.body.classList.add('boss-mode');
  document.body.classList.remove('assign-only','phone-mode');
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('panel-readonly'));
  document.querySelectorAll('.tab').forEach(tab=>{
    const readonlyTab=tab.dataset.tab==='report'||tab.dataset.tab==='expense';
    tab.classList.toggle('hidden',!readonlyTab);
    tab.disabled = !readonlyTab;
    tab.style.opacity = '';
    tab.style.pointerEvents = '';
  });
  document.querySelectorAll('.panel button,.panel input,.panel select,.panel textarea').forEach(el=>{
    const allowBossReportQuery=el.closest('#tab-report')&&(el.tagName==='INPUT'||el.tagName==='SELECT');
    const allowBossPayrollQuery=['payrollTrialMonth','btnPayrollAuthorityRefresh','btnPayrollAuthorityHistory'].includes(el.id);
    if(allowBossReportQuery||allowBossPayrollQuery){
      el.disabled = false;
      el.removeAttribute('aria-disabled');
    }else{
      el.disabled = true;
      el.setAttribute('aria-disabled','true');
    }
  });
  document.querySelectorAll('.panel a').forEach(el=>{
    el.setAttribute('aria-disabled','true');
    el.style.pointerEvents='none';
  });
  const badge = $('#cashierDisplay');
  if(badge) badge.textContent = '系統檢視模式｜'+(state.branchName||DEFAULT_BRANCH_NAME);
  if(activeTabName()==='report')renderReport();
}


function markOwnerLoginLevel(){
  CURRENT_LOGIN_LEVEL='owner';
}
function markStaffLoginLevel(){
  CURRENT_LOGIN_LEVEL='staff';
}

async function isValidManagerPin(pin){
  const ok = !!(await verifyPinSecure(pin,'manage')).ok;
  if(ok) CURRENT_LOGIN_LEVEL='manage';
  return ok;
}
async function verifySensitiveAdminCredential(pin){
  const result=await verifyPinSecure(pin,'credential-admin');
  return result.ok?result:null;
}
async function requestSensitiveAdminAuthorization(action){
  if(!isPageTabAuthorized('manage')){
    alert(`${action}需要先以具有 manage 權限的員工 PIN 進入管理頁`);
    return null;
  }
  return PAGE_TAB_AUTH.manage;
}
async function verifyPageOperatorPin(pin,targetTab){
  const purpose=targetTab==='expense'?'expense':'manage';
  const result=await verifyPinSecure(pin,purpose);
  return result.ok?result:null;
}
async function isValidPinForTab(pin,targetTab){
  const purpose=targetTab==='expense'?'expense':targetTab==='manage'?'manage':'report';
  return !!(await verifyPinSecure(pin,purpose)).ok;
}

function enterBossMode(){
  window.USER_ROLE='boss';
  closeAccessGate();
  setActiveTab('expense');
  applyBossMode();
}
function askMaskedPassword(title, placeholder='輸入後會以 ●●●● 顯示'){
  return new Promise(resolve=>{
    const dialog=$('#maskedPasswordDialog');
    const input=$('#maskedPasswordInput');
    const ok=$('#btnMaskedPasswordOk');
    const cancel=$('#btnMaskedPasswordCancel');
    $('#maskedPasswordTitle').textContent=title;
    input.value='';
    input.placeholder=placeholder;
    const cleanup=(value)=>{
      ok.onclick=null;
      cancel.onclick=null;
      input.onkeydown=null;
      dialog.close();
      resolve(value);
    };
    ok.onclick=()=>cleanup(input.value);
    cancel.onclick=()=>cleanup(null);
    input.onkeydown=(e)=>{if(e.key==='Enter') cleanup(input.value); if(e.key==='Escape') cleanup(null);};
    dialog.showModal();
    setTimeout(()=>input.focus(),60);
  });
}
async function requireCashier(){
  if(guardBossAction()) return false;
  const pin = await askMaskedPassword('請輸入密碼', '密碼');
  if(pin===null) return false;
  const verified=await verifyPinSecure(pin,'checkout');
  if(!verified.ok||verified.kind!=='staff'){alert(pinFailureMessage(verified,'收款')); CURRENT_CASHIER=null; updateCashierDisplay(); return false}
  CURRENT_CASHIER={id:verified.id,name:verified.name};
  updateCashierDisplay();
  return true
}

document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{
  const name=tab.dataset.tab;
  if(isBossMode()){
    if(!['report','expense'].includes(name)){alert('BOSS 模式只能查看報表與損益');return}
    setActiveTab(name);
    if(name==='report'&&typeof renderReport==='function')renderReport();
    applyBossMode();
    return;
  }
  if(typeof isAssignOnlyDevice==='function' && isAssignOnlyDevice() && name!=='assign'){
    alert('此設備尚未授權為收銀設備，只能刷單入業績。');
    applyDeviceAuthorizationMode();
    return;
  }
  if((name==='manage'||name==='expense')&&isPageTabAuthorized(name)){setActiveTab(name);focusScanIfNeeded(name);return}
  if(tab.classList.contains('locked')){pendingLockedTab=name;openPassword(name);return}
  setActiveTab(name);focusScanIfNeeded(name)
});
function openPassword(targetTab){pwdMode=targetTab;$('#pwdOld').closest('.pwd-wrap')?.classList.remove('hidden');$('#pwdOld').value='';$('#pwdNew').value='';$('#pwdNewWrap').classList.add('hidden');$('#pwdTitle').textContent=(targetTab==='manage'||targetTab==='expense')?'請輸入操作者 PIN':'輸入 PIN';$('#passwordDialog').showModal();setTimeout(()=>$('#pwdOld').focus(),60)}
$('#btnPwdCancel').onclick=()=>$('#passwordDialog').close();
async function changeManagementPasswordSecurely(oldPwd,newPwd){
  if(isBossMode()){alert('目前模式不可修改密碼');return false}
  if(!isPageTabAuthorized('manage')){alert('管理頁授權已失效，未修改管理密碼');return false}
  const next=String(newPwd||'').trim();
  if(!/^\d{6}$/.test(next)){alert('新總控 PIN 必須是固定 6 位數字');return false}
  const current=await askMaskedPassword('請再次輸入目前總控／擁有者 PIN','6 位數 PIN');
  if(current===null) return false;
  const changed=await changeOwnerPinSecure(current,next);
  if(!changed.ok){alert('目前總控 PIN 驗證失敗，未修改');return false}
  alert('密碼已修改');
  return true;
}
$('#btnPwdOk').onclick=async()=>{const oldPwd=$('#pwdOld').value.trim(), newPwd=$('#pwdNew').value.trim(); if(pwdMode==='change'){if(await changeManagementPasswordSecurely(oldPwd,newPwd)) $('#passwordDialog').close(); return;}
 if(pwdMode==='report' && await verifyBossPin(oldPwd)){
   $('#passwordDialog').close();
   pendingLockedTab='';
   enterBossMode();
   return;
 }
 const protectedPage=(pwdMode==='manage'||pwdMode==='expense');
 const pageAuthority=protectedPage?await verifyPageOperatorPin(oldPwd,pwdMode):null;
 if(protectedPage&&!pageAuthority){alert(pwdMode==='manage'?'PIN 錯誤、員工已停用或沒有 manage 權限':'PIN 錯誤、員工已停用或沒有支出頁權限');$('#pwdOld').value='';$('#pwdOld').focus();return}
 if(protectedPage){
   const ownerControl=pageAuthority.kind==='owner-control';
   window.USER_ROLE=ownerControl?'owner':'staff';CURRENT_LOGIN_LEVEL=ownerControl?'owner':'staff';CURRENT_CASHIER=pageAuthority.kind==='staff'?{id:pageAuthority.id,name:pageAuthority.name,permissions:[...pageAuthority.permissions]}:null;
  } else {
   const verified=await verifyPinSecure(oldPwd,'report');
   if(!verified.ok){ alert(pinFailureMessage(verified,'報表')); $('#pwdOld').value=''; $('#pwdOld').focus(); return; }
   authorizePageTab('report',verified);
   window.USER_ROLE=verified.kind==='owner-control'?'owner':'staff';
   CURRENT_LOGIN_LEVEL=verified.kind==='owner-control'?'owner':'staff';
   CURRENT_CASHIER=verified.kind==='staff'?{id:verified.id,name:verified.name,permissions:verified.permissions||[]}:null;
 }
 updateCashierDisplay();
 $('#passwordDialog').close();

 // V11.1.42：先用剛驗證完成的登入身份把目標頁完整重算，再顯示頁籤。
 // 避免報表先短暫顯示上一位員工（例如 Milin），數秒後才跳成目前登入的 JEAN。
 if(pendingLockedTab){
   const targetTab=pendingLockedTab;
   if((targetTab==='manage'||targetTab==='expense')&&!authorizePageTab(targetTab,pageAuthority)){alert('頁籤授權建立失敗，未進入頁籤');pendingLockedTab='';return}
   if(targetTab==='report' && typeof renderReport==='function') renderReport();
   if(targetTab==='manage' && typeof renderManage==='function') renderManage();
   pendingLockedTab='';
   const activated=setActiveTab(targetTab);
   if(activated&&targetTab==='expense'&&pageAuthority.kind!=='owner-control'&&typeof renderExpenses==='function')renderExpenses();
   focusScanIfNeeded(targetTab);
 }};
$('#btnChangePwd').onclick=()=>{if(!requirePageTabAuthorization('manage'))return;pwdMode='change';$('#pwdOld').closest('.pwd-wrap')?.classList.add('hidden');$('#pwdOld').value='';$('#pwdNew').value='';$('#pwdNewWrap').classList.remove('hidden');$('#pwdTitle').textContent='設定新管理密碼（本次管理頁已授權）';$('#passwordDialog').showModal();setTimeout(()=>$('#pwdNew').focus(),60)}

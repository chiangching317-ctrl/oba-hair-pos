function updateCashierDisplay(){ if(typeof isAssignOnlyDevice==='function' && isAssignOnlyDevice() && !isBossMode()){ $('#cashierDisplay').textContent='未授權設備｜只能刷單入業績'; return; } $('#cashierDisplay').textContent = CURRENT_CASHIER ? `現金 / 轉帳 / LINE Pay ｜ 本單經手人：${CURRENT_CASHIER.name}` : '現金 / 轉帳 / LINE Pay ｜ 尚未登入'}
function setActiveTab(name){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden'));$('#tab-'+name).classList.remove('hidden')}
function focusScanIfNeeded(name){if(name==='assign')setTimeout(()=>$('#assignOrderNo').focus(),50)}

// V11.0.40：檢視模式＋分店欄位預留＋歸零退票帳務（只可看報表，不可操作收款/退票/管理）
const BOSS_PASSWORD = ''; // V11.1.17：移除前端明碼 BOSS 密碼；BOSS 之後改由 Supabase Auth / 權限控管
const BOSS_SESSION_KEY = 'oba_boss_mode_v38';
window.USER_ROLE = sessionStorage.getItem(BOSS_SESSION_KEY)==='yes' ? 'boss' : (window.USER_ROLE || 'staff');
function isBossMode(){return window.USER_ROLE === 'boss'}
function guardBossAction(){if(isBossMode()){alert('目前模式只能查看，不能操作或修改資料');return true}return false}
function applyBossMode(){
  if(!isBossMode()) return;
  document.body.classList.add('boss-mode');
  document.body.classList.remove('assign-only','phone-mode');
  document.querySelectorAll('.panel').forEach(p=>p.classList.add('panel-readonly'));
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.classList.remove('hidden');
    tab.disabled = false;
    tab.style.opacity = '';
    tab.style.pointerEvents = '';
  });
  document.querySelectorAll('.panel button,.panel input,.panel select,.panel textarea').forEach(el=>{
    const allowBossReportQuery = el.closest('#tab-report') && (el.tagName === 'INPUT' || el.tagName === 'SELECT');
    if(allowBossReportQuery){
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
  renderReport();
}


function markOwnerLoginLevel(){
  CURRENT_LOGIN_LEVEL='owner';
}
function markStaffLoginLevel(){
  CURRENT_LOGIN_LEVEL='staff';
}

function isValidManagerPin(pin){
  const ok = isValidPinForTab(pin, 'manage');
  if(ok) CURRENT_LOGIN_LEVEL='manage';
  return ok;
}
function isValidPinForTab(pin, targetTab){
  const p=String(pin||'').trim();
  if(!p) return false;
  // 密碼本身仍可進入管理/報表；密碼 一律只看權限勾選，不再用 owner / systemRole 放行。
  if(String(state.managementPassword||'').trim()===p) return true;
  const staff = Array.isArray(state.staff) ? state.staff.find(s=>s && s.active && String(s.pin||'').trim()===p) : null;
  if(!staff || !Array.isArray(staff.permissions)) return false;
  if(targetTab === 'report') return staff.permissions.includes('report');
  if(targetTab === 'manage') return staff.permissions.includes('manage');
  if(targetTab === 'password') return staff.permissions.includes('password');
  if(targetTab === 'expense') return staff.permissions.includes('report') || staff.permissions.includes('manage') || staff.permissions.includes('view_all');
  return false;
}

function enterBossMode(){
  window.USER_ROLE='boss';
  sessionStorage.setItem(BOSS_SESSION_KEY,'yes');
  sessionStorage.setItem(ACCESS_SESSION_KEY,'yes');
  closeAccessGate();
  setActiveTab('cashier');
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
  let cashier = state.staff.find(s=>String(s.pin||'').trim()===String(pin).trim() && s.permissions.includes('checkout') && s.active);
  if(!cashier){alert('密碼錯誤或沒有權限'); CURRENT_CASHIER=null; updateCashierDisplay(); return false}
  CURRENT_CASHIER={id:cashier.id,name:cashier.name};
  updateCashierDisplay();
  return true
}

document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{
  const name=tab.dataset.tab;
  if(isBossMode()){
    setActiveTab(name);
    applyBossMode();
    return;
  }
  if(typeof isAssignOnlyDevice==='function' && isAssignOnlyDevice() && name!=='assign'){
    alert('此設備尚未授權為收銀設備，只能刷單入業績。');
    applyDeviceAuthorizationMode();
    return;
  }
  if(tab.classList.contains('locked')){pendingLockedTab=name;openPassword(name);return}
  setActiveTab(name);focusScanIfNeeded(name)
});
function openPassword(targetTab){pwdMode=targetTab;$('#pwdOld').value='';$('#pwdNew').value='';$('#pwdNewWrap').classList.add('hidden');$('#pwdTitle').textContent=state.managementPassword?'輸入密碼':'第一次設定密碼';$('#passwordDialog').showModal();setTimeout(()=>$('#pwdOld').focus(),60)}
$('#btnPwdCancel').onclick=()=>$('#passwordDialog').close();
$('#btnPwdOk').onclick=()=>{const oldPwd=$('#pwdOld').value.trim(), newPwd=$('#pwdNew').value.trim(); if(pwdMode==='change'){if(isBossMode()){alert('目前模式不可修改密碼');return} if(!isValidManagerPin(oldPwd)){alert('舊密碼錯誤');return} if(!newPwd){alert('請輸入新密碼');return} state.managementPassword=newPwd; saveState(); $('#passwordDialog').close(); alert('密碼已修改'); return;}
 if(BOSS_PASSWORD && pwdMode==='report' && oldPwd===BOSS_PASSWORD){$('#passwordDialog').close();pendingLockedTab='';enterBossMode();return;}
 if(!state.managementPassword){ if(!oldPwd){alert('請先設定密碼');return} state.managementPassword=oldPwd; saveState(); } else if(!isValidPinForTab(oldPwd, pwdMode)){ alert('密碼錯誤或沒有此頁權限'); $('#pwdOld').value=''; $('#pwdOld').focus(); return; }
 window.USER_ROLE='owner';$('#passwordDialog').close(); if(pendingLockedTab){ setActiveTab(pendingLockedTab); focusScanIfNeeded(pendingLockedTab); pendingLockedTab=''; }};
$('#btnChangePwd').onclick=()=>{pwdMode='change';$('#pwdOld').value='';$('#pwdNew').value='';$('#pwdNewWrap').classList.remove('hidden');$('#pwdTitle').textContent='修改密碼';$('#passwordDialog').showModal();setTimeout(()=>$('#pwdOld').focus(),60)}

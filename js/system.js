$('#btnExport').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='oba_hair_v2_backup.json'; a.click(); URL.revokeObjectURL(a.href)}
function buildGoLiveResetState(){
  const clean = normalizeCloudState(clone(state));
  // V11.0.48 測試期清空：真的清掉假訂單/假退票/假業績；員工、品項、PIN、權限、抽成、密碼全部保留。
  clean.orders=[];
  clean.refunds=[];
  clean.cart=[];
  clean.pendingPay='';
  clean.pendingCheckoutCart=null;
  clean.lastResetAt=new Date().toISOString();
  clean.lastTestResetAt=clean.lastResetAt;
  setLocalResetMarker(clean.lastResetAt);
  // V11.0.56：清空測試資料時，測試流水號也要歸零；下一張單必須回到 OBA-YYYYMMDD-001。
  clean.monthlyOrderCounter={};
  clean.branchId=clean.branchId||DEFAULT_BRANCH_ID;
  clean.branchName=clean.branchName||DEFAULT_BRANCH_NAME;
  return clean;
}
async function resetAllDataForGoLive(){
  cloudResetting=true;
  const cleanState = buildGoLiveResetState();
  state=cleanState;
  setLocalResetMarker(state.lastResetAt);
  CURRENT_CASHIER=null;
  LAST_ASSIGNED_ORDER_NO='';
  ITEM_DIRTY=false;
  STAFF_DIRTY=false;
  ['assignOrderNo','refundOrderNo','reportStartTime','reportEndTime'].forEach(id=>{const el=$('#'+id); if(el) el.value='';});
  const startDateEl=$('#reportStartDate'); if(startDateEl) startDateEl.value=todayStr();
  const endDateEl=$('#reportEndDate'); if(endDateEl) endDateEl.value=todayStr();

  // 先把本機固定成乾淨狀態，再重建/覆蓋雲端 main row。
  localStorage.setItem(KEY, JSON.stringify(state));
  refreshAllScreens();
  setActiveTab('cashier');

  const cloudOk = await replaceCloudMainRowForReset(state);
  localStorage.setItem(KEY, JSON.stringify(state));
  refreshAllScreens();
  setActiveTab('cashier');
  return cloudOk;
}
$('#btnResetAll').onclick=async()=>{
  if(guardBossAction()) return;
  if(!confirm('確定要清空測試資料嗎？（會清掉測試訂單/退票/業績/刷單暫存，保留員工、品項、PIN、權限、抽成、密碼）'))return;
  if(!confirm('再次確認：這會清掉測試訂單、退票紀錄、今日/本月業績與今日單號列表。'))return;
  const cloudOk = await resetAllDataForGoLive();
  if(cloudOk){
    alert('已完整歸零：雲端 main row 已清乾淨，單號已回到 001，業績/抽成/今日列表已清空，員工與品項設定已保留');
  }else{
    alert('本機測試資料已清空，但雲端重建沒有成功。請不要先 F5，先看 Console 的雲端 reset 訊息。');
  }
}

async function closeSalaryPeriod(){
  if(guardBossAction()) return false;
  state.salaryResetAt=new Date().toISOString();
  state.cart=[];
  state.pendingPay='';
  state.pendingCheckoutCart=null;
  CURRENT_CASHIER=null;
  LAST_ASSIGNED_ORDER_NO='';
  ['assignOrderNo','refundOrderNo'].forEach(id=>{const el=$('#'+id); if(el) el.value='';});
  localStorage.setItem(KEY, JSON.stringify(state));
  await saveState(true);
  refreshAllScreens();
  return true;
}
const salaryBtn=$('#btnSalaryClose');
if(salaryBtn){
  salaryBtn.onclick=async()=>{
    if(guardBossAction()) return;
    if(!confirm('確定要做薪資結算歸零嗎？正式營運後使用：歷史訂單會保留，但本期薪資/本月個人業績會從現在重新計算。'))return;
    if(!confirm('再次確認：這不是刪單，是把現在設為新的薪資起算點。'))return;
    const ok=await closeSalaryPeriod();
    if(ok) alert('薪資結算已歸零：歷史訂單保留，本期個人業績與抽成從現在重新計算。');
  };
}
function isPhoneDevice(){
  const sw = Math.min(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
  const lw = Math.max(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
  const ua = navigator.userAgent || '';
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  const isiPhone = /iPhone|iPod/i.test(ua);
  const sizeLooksPhone = sw <= 600 && lw <= 1100;
  return isiPhone || isAndroidPhone || sizeLooksPhone;
}
function applyDeviceMode(){
  const phoneOnly = isPhoneDevice();
  document.body.classList.toggle('phone-mode', phoneOnly);
  if(phoneOnly){
    setActiveTab('assign');
  }else{
    const active = document.querySelector('.tab.active')?.dataset?.tab || 'cashier';
    setActiveTab(active);
  }
}

// V11.0.61：裝置授權收銀。不是入口 PIN；本機下載檔 file:// 一律完整放行，只有線上網址才需要授權。
const CASHIER_DEVICE_KEY='oba_hair_cashier_device_v58';
function isLocalUnrestrictedDevice(){
  try{
    const protocol = String(location.protocol || '').toLowerCase();
    const host = String(location.hostname || '').toLowerCase();
    const href = String(location.href || '').toLowerCase();
    // 下載到電腦直接打開的 HTML 會是 file://，主機名稱通常是空白；本機開發才會是 localhost / 127.0.0.1。
    return protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || href.startsWith('file:///');
  }catch(e){
    return true; // 判斷失敗時偏向保護店長本機，不鎖住本機。
  }
}
function isOnlineUrl(){
  const protocol = String(location.protocol || '').toLowerCase();
  return protocol === 'http:' || protocol === 'https:';
}
function isCashierDevice(){
  if(isLocalUnrestrictedDevice()) return true;
  return localStorage.getItem(CASHIER_DEVICE_KEY)==='yes';
}
function isAssignOnlyDevice(){
  if(isLocalUnrestrictedDevice()) return false;
  return !isBossMode() && isOnlineUrl() && !isCashierDevice();
}
function restoreDeviceTabsForLocal(){
  document.body.classList.remove('assign-only');
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.disabled=false;
    tab.style.opacity='';
    tab.style.pointerEvents='';
  });
}
function applyDeviceAuthorizationMode(){
  if(isBossMode()){
    document.body.classList.remove('assign-only');
    applyBossMode();
    return;
  }
  if(isLocalUnrestrictedDevice()){
    restoreDeviceTabsForLocal();
    applyDeviceMode();
    updateCashierDisplay();
    return;
  }
  if(isAssignOnlyDevice()){
    document.body.classList.add('assign-only');
    document.body.classList.remove('phone-mode');
    setActiveTab('assign');
  }else{
    document.body.classList.remove('assign-only');
    applyDeviceMode();
  }
  updateCashierDisplay();
}
async function authorizeCashierDevice(){
  if(isLocalUnrestrictedDevice()){
    localStorage.setItem(CASHIER_DEVICE_KEY,'yes');
    restoreDeviceTabsForLocal();
    applyDeviceAuthorizationMode();
    alert('本機下載檔已完整放行，不需要設備授權。');
    return;
  }
  // V11.0.71：平板/電腦設備授權密碼一律走遮罩輸入，不使用明碼輸入。
  const pwd = await askMaskedPassword('請輸入密碼，授權這台設備可以收銀', '密碼');
  if(pwd===null) return;
  const val=String(pwd||'').trim();
  if(BOSS_PASSWORD && val===BOSS_PASSWORD){ enterBossMode(); return; }
  if(!state.managementPassword){ alert('尚未設定密碼，請先用已授權設備進入管理設定。'); return; }
  if(val!==String(state.managementPassword||'').trim()){
    alert('密碼錯誤，這台設備仍只能刷單');
    applyDeviceAuthorizationMode();
    return;
  }
  localStorage.setItem(CASHIER_DEVICE_KEY,'yes');
  document.body.classList.remove('assign-only');
  alert('本機已授權為收銀設備。');
  applyDeviceAuthorizationMode();
}
function revokeCashierDevice(){
  localStorage.removeItem(CASHIER_DEVICE_KEY);
  CURRENT_CASHIER=null;
  applyDeviceAuthorizationMode();
}

function getRedeemableItems(){
  return activeItems().filter(i => i.active && (i.redeemable===true || i.redeemable==='true' || i.redeem==='Y' || i.redeem===true));
}
function getRedeemItemFallback(){
  const items = activeItems().filter(i=>i.active);
  return items.slice(0, 8);
}
function openRedeemDialog(){
  if(guardBossAction()) return;
  const itemSel = $('#redeemItemSelect');
  const redeemItems = getRedeemableItems();
  const itemsToShow = redeemItems.length ? redeemItems : getRedeemItemFallback();
  itemSel.innerHTML = itemsToShow.map(i => `<option value="${i.id}">${i.name}｜${money(i.price)}</option>`).join('');
  $('#redeemCustomer').value = '';
  $('#redeemUid4').value = '';
  $('#redeemDialog').showModal();
  setTimeout(function(){
    const el = $('#redeemCustomer');
    if(el){
      el.focus();
      try{el.click();}catch(e){}
      setTimeout(function(){
        el.focus();
        try{el.click();}catch(e){}
      },260);
    }
  },80);
}
function submitRedeem(){
  if(guardBossAction()) return;
  const customer = $('#redeemCustomer').value.trim();
  const uid4 = $('#redeemUid4').value.trim();
  const itemId = $('#redeemItemSelect').value;
  if(!customer || !uid4 || !itemId){
    alert('請填完整資料');
    return;
  }
  const item = activeItems().find(i => i.id===itemId);
  if(!item){ alert('資料讀取失敗'); return; }
  const order = {
    id: currentOrderNo(),
    date: todayStr(),
    time: nowTime(),
    branchId: state.branchId || DEFAULT_BRANCH_ID,
    branchName: state.branchName || DEFAULT_BRANCH_NAME,
    items: [{id:item.id,name:item.name,price:0,category:item.category||''}],
    total: 0,
    paymentMethod: '集點卡兌換',
    cashierId: '',
    cashierName: '集點卡兌換',
    assignedDesignerId: '',
    assignedDesignerName: '',
    commission: 0,
    assignedAt: '',
    refunded: false,
    createdAt: new Date().toISOString(),
    redeemMeta: {
      customer,
      uid4,
      sourcePrice: Number(item.price || 0),
      redeemType: true
    }
  };
  state.orders.unshift(order);
  state.nextNo += 1;
  saveState();
  renderCashier();
  renderAssign();
  renderReport();
  $('#redeemDialog').close();
  openReceipt(order);
  alert('已開立集點卡0元票，請至刷單入業績頁籤完成登錄');
}
document.addEventListener('click', function(e){
  if(e.target && e.target.id === 'btnAuthorizeCashierDevice') authorizeCashierDevice();
  if(e.target && e.target.id === 'btnRedeemOpen') openRedeemDialog();
  if(e.target && e.target.id === 'btnRedeemCancel') $('#redeemDialog').close();
   if(e.target && e.target.id === 'btnRedeemSubmit') submitRedeem();
if(e.target && e.target.id === 'btnClearCart'){ state.cart=[]; CURRENT_CASHIER=null; renderCart(); updateCashierDisplay(); saveState(true); }
  if(e.target && e.target.id === 'btnReprintOpen') openReprintDialog();
  if(e.target && e.target.id === 'btnCloseReprint') $('#reprintDialog').close();
});
document.addEventListener('input', function(e){
  if(e.target && ['reprintDate','reprintOrderNo'].includes(e.target.id)) renderReprintList();
});
document.addEventListener('change', function(e){
  if(e.target && ['reprintDate','reprintOrderNo'].includes(e.target.id)) renderReprintList();
});


const ACCESS_KEY='oba_hair_access_password_v27';
const ACCESS_SESSION_KEY='oba_hair_access_granted_v27';
function getAccessPassword(){
  // V11.1.17 安全止血：不再自動建立固定入口密碼 oba2026。
  // 若舊設備 localStorage 已有入口密碼，仍暫時相容；之後改 Supabase Auth。
  const saved=localStorage.getItem(ACCESS_KEY);
  if(saved!==null) return saved;
  return null;
}
function closeAccessGate(){
  const gate=$('#accessGate');
  if(gate) gate.classList.add('hidden-gate');
}
function openAccessGate(){
  const gate=$('#accessGate');
  if(gate) gate.classList.remove('hidden-gate');
  setTimeout(function(){
    const el=$('#accessPassword');
    if(el){ el.focus(); try{el.click();}catch(e){} }
  },80);
}
function verifyAccessPassword(){
  const input=$('#accessPassword');
  const val=(input?.value||'').trim();
  if(!val){ alert('請輸入密碼'); return; }
  if(BOSS_PASSWORD && val===BOSS_PASSWORD){
    enterBossMode();
    return;
  }
  // V11.0.88：入口登入修正。總控管理密碼也可以進入系統；員工 PIN 維持原本可進。
  const isManagementPassword = String(state.managementPassword||'').trim() === val;
  const loginStaff = Array.isArray(state.staff) ? state.staff.find(s=>s && s.active && String(s.pin||'').trim()===val) : null;
  if(isManagementPassword || loginStaff){
    window.USER_ROLE = isManagementPassword ? 'owner' : 'staff';
    CURRENT_LOGIN_LEVEL = isManagementPassword ? 'owner' : 'staff';
    CURRENT_CASHIER = loginStaff ? {id:loginStaff.id,name:loginStaff.name,permissions:loginStaff.permissions||[]} : null;
    sessionStorage.removeItem(BOSS_SESSION_KEY);
    sessionStorage.setItem(ACCESS_SESSION_KEY,'yes');
    closeAccessGate();
    applyDeviceAuthorizationMode();
    updateCashierDisplay();
    renderAssign();
    return;
  }
  const legacyAccessPassword=getAccessPassword();
  if(!legacyAccessPassword || val!==legacyAccessPassword){
    alert('密碼錯誤');
    input.value='';
    input.focus();
    return;
  }
  sessionStorage.setItem(ACCESS_SESSION_KEY,'yes');
  closeAccessGate();
  applyDeviceAuthorizationMode();
}
document.addEventListener('click',function(e){
  if(e.target && e.target.id==='btnAccessEnter') verifyAccessPassword();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter' && document.activeElement && document.activeElement.id==='accessPassword'){
    verifyAccessPassword();
  }
});






const BOOT_TEST_CLEAR_VERSION='V11.0.56_test_reset_counter_fix';
const BOOT_TEST_CLEAR_KEY='oba_hair_boot_test_clear_version';
async function hardClearTestDataOnBoot(){
  // V11.0.56：測試期根本清除。這一版第一次開啟時，直接把舊測試單/退票/業績/流水號從本機與雲端 main row 清乾淨。
  // 保留：員工、品項、PIN、權限、抽成、密碼；測試流水號歸零回 001。
  if(localStorage.getItem(BOOT_TEST_CLEAR_KEY)===BOOT_TEST_CLEAR_VERSION) return true;
  const cleanState=buildGoLiveResetState();
  cleanState.forceTestClearVersion=BOOT_TEST_CLEAR_VERSION;
  state=cleanState;
  CURRENT_CASHIER=null;
  LAST_ASSIGNED_ORDER_NO='';
  ITEM_DIRTY=false;
  STAFF_DIRTY=false;
  localStorage.setItem(KEY,JSON.stringify(state));
  localStorage.setItem(BOOT_TEST_CLEAR_KEY,BOOT_TEST_CLEAR_VERSION);
  setLocalResetMarker(state.lastResetAt);
  console.log('V11.0.58 測試資料根本清除：本機已清空 orders/refunds/cart/monthlyOrderCounter，準備重建雲端 main row');
  const cloudOk=await replaceCloudMainRowForReset(state);
  localStorage.setItem(KEY,JSON.stringify(state));
  console.log('V11.0.58 測試資料根本清除完成', {cloudOk, orders:state.orders.length, refunds:state.refunds.length, cart:state.cart.length, monthlyOrderCounter:state.monthlyOrderCounter});
  return cloudOk;
}
async function init(){
  ensureBranchFields(state);
  // V11.0.75：保留既有測試資料，開機不再執行 hardClearTestDataOnBoot()，不清 orders/refunds/cart/monthlyOrderCounter，也不重建雲端 main row。
  updateCashierDisplay();
  renderCashier();
  renderAssign();
  renderReport();
  renderTimeclock();
  renderExpenses();
  renderManage();
  if(sessionStorage.getItem(ACCESS_SESSION_KEY)==='yes' || isBossMode()){
    closeAccessGate();
    applyDeviceAuthorizationMode();
  }else{
    openAccessGate();
  }
  window.addEventListener('resize', function(){ if(!isBossMode()) applyDeviceAuthorizationMode(); });
  startCloudSync();
}
init();

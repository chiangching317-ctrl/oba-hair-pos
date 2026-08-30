$('#btnExport').onclick=()=>{
  const canExport=!!(
    (typeof isBossMode==='function' && isBossMode()) ||
    CURRENT_LOGIN_LEVEL==='owner' ||
    window.USER_ROLE==='owner' ||
    (Array.isArray(CURRENT_CASHIER?.permissions) && CURRENT_CASHIER.permissions.includes('view_all'))
  );
  if(!canExport){ alert('沒有匯出全店資料的權限'); return; }
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='oba_hair_v2_backup.json'; a.click(); URL.revokeObjectURL(a.href)
}
async function closeSalaryPeriod(){
  alert('舊版「薪資結算歸零」已停用；請使用損益頁的正式月結／revision 功能。');
  return false;
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
    const active = document.querySelector('.tab.active')?.dataset?.tab || '';
    if(active!=='assign') setActiveTab('assign');
  }
}

// V11.0.61：裝置授權收銀。不是入口 PIN；本機下載檔 file:// 一律完整放行，只有線上網址才需要授權。
const CASHIER_DEVICE_KEY=String(window.OBA_RUNTIME_CONFIG?.storageKeys?.cashierDevice||'');
if(!CASHIER_DEVICE_KEY)throw new Error('OBA_RUNTIME_STORAGE_CONFIG_INVALID');
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
  if(await verifyBossPin(val)){ enterBossMode(); return; }
  const verified=await verifyPinSecure(val,'device-authorize');
  if(!verified.ok||verified.kind!=='owner-control'){
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
  const orderDate=todayStr();
  const orderNo=reserveNextMonthlyOrderNo(orderDate);
  const order = {
    id: orderNo,
    date: orderDate,
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


function closeAccessGate(){
  const gate=$('#accessGate');
  if(gate) gate.classList.add('hidden-gate');
}
function openAccessGate(){
  const gate=$('#accessGate');
  if(gate) gate.classList.remove('hidden-gate');
}






function setDevAccessReady(ready, message){
  const status=$('#accessLoadStatus');
  if(status) status.textContent=message||'';
}
async function waitForSecureEntry(){
  if(!window.OBA_POS_ENTRY_READY)return false;
  setTimeout(()=>$('#accessPin')?.focus(),60);
  return window.OBA_POS_ENTRY_READY;
}
async function init(){
  ensureBranchFields(state);
  openAccessGate();
  setDevAccessReady(false, '請輸入 6 位 PIN 驗證身分。');

  const entryOk=await waitForSecureEntry();
  if(!entryOk)return;

  // V11.1.68：只有伺服器建立入口 session 後才允許讀取 DEV state。
  let bootstrapOk=false,bootstrapFailureShown=false;
  try{
    bootstrapOk=await bootstrapDevCloudState();
  }catch(error){
    showPersistentEntryError('AUTHORIZATION_DATA_LOAD_EXCEPTION',{code:error?.code||'BOOTSTRAP_EXCEPTION',message:error?.message||String(error),details:error?.details||error?.stack||'',hint:error?.hint||''});
    bootstrapFailureShown=true;
  }
  if(!bootstrapOk){
    if(!bootstrapFailureShown)showPersistentEntryError(window.OBA_LAST_CLOUD_ERROR?.source||'AUTHORIZATION_DATA_LOAD',window.OBA_LAST_CLOUD_ERROR||{code:'BOOTSTRAP_FAILED',message:`Authorized session was created, but ${cloudEnvironmentName()} state could not be loaded.`,details:'',hint:''});
    setDevAccessReady(false, `${cloudEnvironmentName()}雲端資料載入失敗。已停止進入與寫入，請檢查網路或資料庫後重新整理。`);
    console.error(`${cloudEnvironmentName()}啟動封鎖：無法取得可用資料`);
    return;
  }

  applyEntryRolePermissions();
  updateCashierDisplay();
  renderCashier();
  renderAssign();
  renderReport();
  renderTimeclock();
  renderExpenses();
  renderManage();
  setDevAccessReady(true, '授權資料已安全載入。');
  if(window.OBA_ACCESS_SESSION?.kind==='boss'){
    enterBossMode();
    return;
  }
  if(!isBossMode()){
    const entryKind=window.OBA_ACCESS_SESSION?.kind||'staff';
    const ownerEntry=entryKind==='owner-control';
    window.USER_ROLE=ownerEntry?'owner':'staff';
    CURRENT_LOGIN_LEVEL=ownerEntry?'owner':'staff';
    CURRENT_CASHIER=null;
  }
  closeAccessGate();
  applyDeviceAuthorizationMode();
  updateCashierDisplay();
  window.addEventListener('resize', function(){ if(!isBossMode()) applyDeviceAuthorizationMode(); });
  startCloudSync(true);
}
init();

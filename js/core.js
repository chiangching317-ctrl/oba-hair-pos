// V11.1.26 第13刀：核心狀態模組拆分
// 由 index.html 搬出；只搬程式，不改邏輯。
const KEY='oba_hair_v2_owner';
const RESET_MARKER_KEY='oba_hair_v2_owner_reset_at';
const EXPENSE_KEY='oba_hair_dev_expenses_v11101'; // V11.1.04a：沿用 V11.1.01~V11.1.03 支出本機資料，不寫入正式雲端
const defaultState={
 managementPassword:'',monthlyOrderCounter:{},cart:[],pendingPay:'',pendingCheckoutCart:null,
 staff:[
  {id:'JEAN',name:'JEAN',nickname:'JEAN',phone:'',address:'',joinDate:'2024-01-01',role:'店長',systemRole:'擁有者',active:true,owner:true,pin:'',rules:{default:0.5},permissions:['checkout','assign','refund','report','manage','item','password','view_all']},
  {id:'ALAN',name:'ALAN',nickname:'ALAN',phone:'',address:'',joinDate:'2024-01-01',role:'設計師',systemRole:'一般員工',active:true,owner:false,pin:'',rules:{default:0.5,'護髮':0.7,'燙髮':0.7,'染髮':0.7,'隔離':0.7},permissions:['assign']}
 ],
 items:[
  {id:'cut',category:'剪髮',name:'cut',price:300,active:true,quick:true},
  {id:'wash',category:'沖洗',name:'沖洗',price:100,active:true,quick:true},
  {id:'isolation',category:'隔離',name:'隔離',price:100,active:true,quick:true},
  {id:'color_s',category:'染髮',name:'染髮(S)',price:700,active:true},
  {id:'color_m',category:'染髮',name:'染髮(M)',price:1000,active:true},
  {id:'color_l',category:'染髮',name:'染髮(L)',price:1400,active:true},
  {id:'perm_basic',category:'燙髮',name:'燙髮',price:800,active:true},
  {id:'perm_men',category:'燙髮',name:'男士燙髮',price:1000,active:true},
  {id:'perm_women',category:'燙髮',name:'女士燙髮',price:1500,active:true},
  {id:'care_basic',category:'護理',name:'護髮',price:300,active:true},
  {id:'care_struct',category:'護理',name:'結構式頭皮護理',price:600,active:true},
  {id:'scalp_basic',category:'護理',name:'頭皮護理',price:300,active:true}
 ],
 orders:[],refunds:[],assignLogs:[],timeClockLogs:[]
};
const MASTER_PIN_6=''; // V11.1.17：安全止血，移除前端預設萬用 PIN
let state=loadState(), pendingLockedTab='', pwdMode='enter', CURRENT_CASHIER=null, CURRENT_LOGIN_LEVEL='staff';

// V11.1.17 安全止血：取消舊版第一次開啟時強制把管理密碼與員工 PIN 重設成固定值。
const PIN_MIGRATE_KEY='oba_hair_v11117_no_default_pin';
localStorage.setItem(PIN_MIGRATE_KEY,'yes');

let LAST_ASSIGNED_ORDER_NO='';
let CHECKOUT_SNAPSHOT=null; // V11.0.85：收款確認前鎖住本單完整快照，避免 LINE Pay/同步造成無品項單
function isCheckoutInProgress(){
  const payDialog=document.getElementById('payDialog');
  return (Array.isArray(state?.cart) && state.cart.length>0) ||
    (Array.isArray(state?.pendingCheckoutCart) && state.pendingCheckoutCart.length>0) ||
    !!CHECKOUT_SNAPSHOT ||
    !!(payDialog && payDialog.open);
}
let ITEM_DIRTY=false;
let STAFF_DIRTY=false;
function markStaffDirty(){
  STAFF_DIRTY=true;
  localStorage.setItem(KEY, JSON.stringify(state));
}
function isManageEditing(){
  const managePanel = document.getElementById('tab-manage');
  if(!managePanel || managePanel.classList.contains('hidden')) return false;
  // V11.0.78：只要人在管理頁，就暫停雲端自動覆蓋畫面。
  // 原本只看輸入框焦點，滾動時沒有焦點也可能被 15 秒同步重畫，造成位置跑掉。
  return true;
}

function renderManageKeepScroll(){
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  renderManage();
  requestAnimationFrame(()=>window.scrollTo(0, y));
}

function removeExtraItemFromState(d){
  if(!d) return d;
  if(Array.isArray(d.items)){
    d.items = d.items.filter(i => !(String(i?.id||'')==='extra' || String(i?.category||'')==='加價' || String(i?.name||'')==='加價'));
  }
  if(Array.isArray(d.staff)){
    d.staff.forEach(s=>{ if(s && s.rules && Object.prototype.hasOwnProperty.call(s.rules,'加價')) delete s.rules['加價']; });
  }
  return d;
}
function ensureBranchFields(data){
  const d = removeExtraItemFromState(data || clone(defaultState));
  if(!d.branchId) d.branchId = DEFAULT_BRANCH_ID;
  if(!d.branchName) d.branchName = DEFAULT_BRANCH_NAME;
  if(Array.isArray(d.orders)){
    d.orders.forEach(o=>{
      if(!o.branchId) o.branchId = d.branchId || DEFAULT_BRANCH_ID;
      if(!o.branchName) o.branchName = d.branchName || DEFAULT_BRANCH_NAME;
    });
  }
  return d;
}
function loadState(){try{const raw=localStorage.getItem(KEY);if(!raw)return ensureBranchFields(clone(defaultState));const data=ensureBranchFields(Object.assign(clone(defaultState),JSON.parse(raw)));if(!data.staff.find(s=>s.owner))data.staff[0].owner=true;return data}catch(e){return ensureBranchFields(clone(defaultState))}}

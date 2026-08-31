let expenseEditingId='';
let expensePendingCreateId='';
const OBA_EXPENSE_CLOUD={authority:null,load:null,busy:false,pendingRequests:new Map()};
const PAYROLL_TRIAL_INPUT_KEY='oba_hair_dev_payroll_trial_inputs_v11169_phase1b';
const PAYROLL_GUARANTEE=40000;
const PAYROLL_TARGET=80000;
const JEAN_MANAGEMENT_SHARE_RATE_KEY='oba_hair_dev_jean_management_share_rates_v11169';
const CUSTOM_EXPENSE_CATEGORY_KEY='oba_hair_dev_custom_expense_categories_v11169_phase1c';
const FIXED_EXPENSE_CATEGORIES=['材料','進貨','租金','水電','廣告','雜支','公司負擔保險','其他公司成本'];
const BLOCKED_EXPENSE_CATEGORY_NAMES=new Set(['實發薪資','員工薪資','薪資','抽成薪資','commission','年終獎金','借支','材料代墊','員工保險自付額']);

function payrollTrialMonth(value){
  const month=String(value||'').trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : monthStr();
}
function loadJeanManagementShareRates(){
  try{
    const parsed=JSON.parse(localStorage.getItem(JEAN_MANAGEMENT_SHARE_RATE_KEY)||'{}');
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch(error){
    return {};
  }
}
function jeanManagementShareRate(monthValue){
  const month=payrollTrialMonth(monthValue);
  const rates=loadJeanManagementShareRates();
  if(!Object.prototype.hasOwnProperty.call(rates,month)) return 0.1;
  const rate=Number(rates[month]);
  return Number.isFinite(rate)?Math.max(0,Math.min(1,rate)):0.1;
}
function jeanManagementSharePercentText(rate){
  const percent=Number(rate||0)*100;
  return Number.isInteger(percent)?String(percent):String(Number(percent.toFixed(2)));
}
function renderJeanManagementShareRate(monthValue){
  const input=$('#jeanManagementShareRate');
  if(!input) return;
  const rate=jeanManagementShareRate(monthValue);
  input.value=jeanManagementSharePercentText(rate);
}
function saveJeanManagementShareRate(){
  if(!requirePageTabAuthorization('expense')){renderJeanManagementShareRate($('#payrollTrialMonth')?.value);return;}
  const month=payrollTrialMonth($('#payrollTrialMonth')?.value);
  const input=$('#jeanManagementShareRate');
  const percent=Number(input?.value);
  if(!Number.isFinite(percent)||percent<0||percent>100){
    alert('JEAN 管理分潤比例請輸入 0～100');
    renderJeanManagementShareRate(month);
    return;
  }
  if(typeof markPayrollLocalDraft==='function'&&!markPayrollLocalDraft('managementShareRate'))return;
  const rates=loadJeanManagementShareRates();
  rates[month]=percent/100;
  localStorage.setItem(JEAN_MANAGEMENT_SHARE_RATE_KEY,JSON.stringify(rates));
  renderPayrollTrial();
}
function loadPayrollTrialInputs(){
  try{
    const parsed=JSON.parse(localStorage.getItem(PAYROLL_TRIAL_INPUT_KEY)||'{}');
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {};
  }catch(error){
    return {};
  }
}
function savePayrollTrialInputs(data){
  localStorage.setItem(PAYROLL_TRIAL_INPUT_KEY,JSON.stringify(data&&typeof data==='object'?data:{}));
}
function payrollTrialNumber(value){
  const amount=Number(value||0);
  return Number.isFinite(amount) && amount>0 ? Math.round(amount) : 0;
}
function isSystemPayrollAccount(staff){
  const values=[staff?.id,staff?.name,staff?.nickname,staff?.role,staff?.systemRole]
    .map(value=>String(value||'').trim().toLowerCase());
  return values.some(value=>value==='開機'||value==='session'||value==='系統帳號'||value==='system'||value==='system account');
}
function payrollTrialOrders(month){
  return salaryBaseOrders().filter(order=>
    String(order?.date||'').startsWith(month) &&
    !!order?.assignedDesignerId &&
    order?.refunded!==true
  );
}
function payrollTrialStaff(month,orders){
  const byId=new Map();
  (state.staff||[]).forEach(staff=>{
    if(!staff?.id||isSystemPayrollAccount(staff)) return;
    const hasMonthOrders=orders.some(order=>String(order.assignedDesignerId)===String(staff.id));
    if(staff.active===true||hasMonthOrders) byId.set(String(staff.id),staff);
  });
  orders.forEach(order=>{
    const id=String(order.assignedDesignerId||'');
    if(!id||byId.has(id)) return;
    const historical={id,name:order.assignedDesignerName||id,nickname:order.assignedDesignerName||'',active:false};
    if(!isSystemPayrollAccount(historical)) byId.set(id,historical);
  });
  return Array.from(byId.values()).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-Hant'));
}
function payrollTrialForStaff(staff,month,orders,manual={}){
  const staffOrders=orders.filter(order=>String(order.assignedDesignerId)===String(staff.id));
  const performanceTotal=staffOrders.reduce((sum,order)=>sum+Number(order.total||0),0);
  const commissionTotal=staffOrders.reduce((sum,order)=>sum+Number(order.commission||0),0);
  const baseSalary=Math.max(PAYROLL_GUARANTEE,commissionTotal);
  const advance=payrollTrialNumber(manual.advance);
  const materialAdvance=payrollTrialNumber(manual.materialAdvance);
  const insurance=payrollTrialNumber(manual.insurance);
  const annualBonus=payrollTrialNumber(manual.annualBonus);
  return {
    staff,month,orderCount:staffOrders.length,performanceTotal,commissionTotal,
    achievementRate:performanceTotal/PAYROLL_TARGET*100,
    baseSalary,advance,materialAdvance,insurance,annualBonus,
    actualSalary:baseSalary+annualBonus-advance-materialAdvance-insurance
  };
}
function payrollTrialSummary(monthValue){
  const month=payrollTrialMonth(monthValue);
  const orders=payrollTrialOrders(month);
  const staffList=payrollTrialStaff(month,orders);
  const allInputs=loadPayrollTrialInputs();
  const monthInputs=allInputs[month]&&typeof allInputs[month]==='object'?allInputs[month]:{};
  const trials=staffList.map(staff=>payrollTrialForStaff(staff,month,orders,monthInputs[String(staff.id)]||{}));
  return {
    month,orders,trials,
    commissionTotal:trials.reduce((sum,row)=>sum+row.commissionTotal,0),
    actualSalaryTotal:trials.reduce((sum,row)=>sum+row.actualSalary,0)
  };
}
function payrollAchievementText(rate){
  const value=Number.isFinite(rate)?rate:0;
  return `${value.toFixed(value%1===0?0:1)}%`;
}
function renderPayrollTrial(){
  if(window.OBA_ACCESS_SESSION?.kind==='boss')return;
  if(typeof shouldPreservePayrollAuthorityView==='function'&&shouldPreservePayrollAuthorityView())return;
  if(typeof buildDraftPayrollPageModel!=='function'||typeof setPayrollPageModel!=='function')return;
  const month=payrollTrialMonth($('#payrollTrialMonth')?.value);
  const revision=(typeof OBA_PAYROLL!=='undefined'&&OBA_PAYROLL.pageModel?OBA_PAYROLL.pageModel.sourceRevision||0:0)+1;
  return setPayrollPageModel(buildDraftPayrollPageModel(month,revision));
}
function savePayrollTrialInput(input){
  if(!requirePageTabAuthorization('expense')){renderPayrollTrial();return;}
  const card=input.closest('.payroll-trial-card');
  const staffId=String(card?.dataset.staffId||'');
  const field=String(input.dataset.field||'');
  if(!staffId||!['advance','materialAdvance','insurance','annualBonus'].includes(field)) return;
  const month=payrollTrialMonth($('#payrollTrialMonth')?.value);
  if(typeof markPayrollLocalDraft==='function'&&!markPayrollLocalDraft('employeeInputs'))return;
  const allInputs=loadPayrollTrialInputs();
  if(!allInputs[month]||typeof allInputs[month]!=='object') allInputs[month]={};
  if(!allInputs[month][staffId]||typeof allInputs[month][staffId]!=='object') allInputs[month][staffId]={};
  allInputs[month][staffId][field]=payrollTrialNumber(input.value);
  savePayrollTrialInputs(allInputs);
  renderPayrollTrial();
}
function loadCustomExpenseCategories(){
  try{
    const list=JSON.parse(localStorage.getItem(CUSTOM_EXPENSE_CATEGORY_KEY)||'[]');
    return Array.isArray(list) ? list.map(value=>String(value||'').trim()).filter(Boolean) : [];
  }catch(error){
    return [];
  }
}
function saveCustomExpenseCategories(list){
  localStorage.setItem(CUSTOM_EXPENSE_CATEGORY_KEY,JSON.stringify(Array.from(new Set((list||[]).map(value=>String(value||'').trim()).filter(Boolean)))));
}
function isBlockedExpenseCategoryName(name){
  return BLOCKED_EXPENSE_CATEGORY_NAMES.has(String(name||'').trim().toLowerCase());
}
function renderExpenseCategoryOptions(preferred=''){
  const select=$('#expenseCategory');
  if(!select) return;
  const current=String(preferred||select.value||'材料');
  const categories=[...FIXED_EXPENSE_CATEGORIES,...loadCustomExpenseCategories()];
  if(current&&!categories.includes(current)) categories.push(current);
  select.innerHTML=Array.from(new Set(categories)).map(category=>`<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  select.value=categories.includes(current)?current:'材料';
}
function rejectClosedPayrollExpenseEdit(){
  if(typeof payrollMonthClosed==='function'&&payrollMonthClosed()){
    const message=typeof closedPayrollMessage==='function'?closedPayrollMessage():'本月份已完成月結，請先重新開放修改。';
    setExpenseStatus(message,'dirty');
    return true;
  }
  return false;
}
function addCustomExpenseCategory(){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const input=$('#customExpenseCategory');
  const name=String(input?.value||'').trim();
  if(!name){alert('請輸入新的支出分類名稱');input?.focus();return;}
  if(name.length>20){alert('支出分類名稱最多 20 個字');input?.focus();return;}
  if(isBlockedExpenseCategoryName(name)){
    alert('薪資、年終、借支、材料代墊與員工保險自付額不得建立為公司一般支出，以免重複扣除');
    input?.focus();
    return;
  }
  const all=[...FIXED_EXPENSE_CATEGORIES,...loadCustomExpenseCategories()];
  if(all.includes(name)){alert('這個支出分類已經存在');renderExpenseCategoryOptions(name);return;}
  saveCustomExpenseCategories([...loadCustomExpenseCategories(),name]);
  if(input) input.value='';
  renderExpenseCategoryOptions(name);
  setExpenseStatus('自訂分類已儲存在本機','saved');
}
function loadExpenses(){
  try{
    const raw=localStorage.getItem(EXPENSE_KEY);
    const list=raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){
    return [];
  }
}
function saveExpenses(list){
  localStorage.setItem(EXPENSE_KEY, JSON.stringify(Array.isArray(list)?list:[]));
}
function setExpenseStatus(text, mode='saved'){
  const status=$('#expenseSaveStatus');
  if(!status) return;
  status.textContent=text;
  status.className='save-status '+(mode==='dirty'?'dirty':'saved');
}
function setExpenseEditingMode(id=''){
  expenseEditingId=String(id||'');
  const saveBtn=$('#btnSaveExpense');
  const cancelBtn=$('#btnCancelExpenseEdit');
  const clearBtn=$('#btnClearExpenseForm');
  if(saveBtn) saveBtn.textContent = expenseEditingId ? '儲存修改' : '儲存支出';
  if(cancelBtn) cancelBtn.classList.toggle('hidden', !expenseEditingId);
  if(clearBtn) clearBtn.textContent = expenseEditingId ? '清空重填' : '清空欄位';
}

function clearExpenseForm(){
  const dateEl=$('#expenseDate'), categoryEl=$('#expenseCategory'), amountEl=$('#expenseAmount'), noteEl=$('#expenseNote');
  if(dateEl) dateEl.value=todayStr();
  renderExpenseCategoryOptions('材料');
  if(amountEl) amountEl.value='';
  if(noteEl) noteEl.value='';
  expensePendingCreateId='';
  setExpenseEditingMode('');
  setExpenseStatus('等待輸入','saved');
}

function cancelExpenseEdit(){
  clearExpenseForm();
  setExpenseStatus('已取消編輯','saved');
}

function expenseMonthOf(date){
  return String(date||'').slice(0,7);
}
async function renderExpenses(){
  bindExpenseEvents();
  const kind=String(window.OBA_ACCESS_SESSION?.kind||'');
  const expenseTab=document.getElementById('tab-expense');
  const expenseVisible=!!expenseTab&&!expenseTab.classList.contains('hidden');
  const recoveryWriteLocked=typeof OBA_PAYROLL!=='undefined'&&OBA_PAYROLL.busy&&OBA_PAYROLL?.pageModel?.source==='draft'&&OBA_PAYROLL?.pageModel?.draft?.recoveryOnly===true&&OBA_PAYROLL?.pageModel?.draft?.recoveryPending===true;
  if(expenseVisible&&recoveryWriteLocked&&typeof renderPayrollPage==='function'){
    renderPayrollPage(OBA_PAYROLL.pageModel);
    return true;
  }
  if(expenseVisible&&['owner-control','boss'].includes(kind)&&typeof loadPayrollAuthorityOverview==='function'){
    return await loadPayrollAuthorityOverview();
  }
  if(kind==='boss')return;
  renderExpenseCategoryOptions();
  const dateEl=$('#expenseDate');
  if(dateEl && !dateEl.value) dateEl.value=todayStr();
  if(typeof shouldPreservePayrollAuthorityView==='function'&&shouldPreservePayrollAuthorityView())return;
  if(kind==='staff'){
    await loadExpenseAuthorityOverview(payrollTrialMonth($('#payrollTrialMonth')?.value));
    return;
  }
  renderPayrollTrial();
}

async function refreshExpenseAuthority(){
  const kind=String(window.OBA_ACCESS_SESSION?.kind||'');
  if(['owner-control','boss'].includes(kind)&&typeof loadPayrollAuthorityOverview==='function'){
    return await loadPayrollAuthorityOverview();
  }
  if(kind==='staff'){
    return await loadExpenseAuthorityOverview(payrollTrialMonth($('#payrollTrialMonth')?.value));
  }
  return false;
}

function expenseSessionCanWrite(){
  const session=window.OBA_ACCESS_SESSION;
  if(!session||session.kind==='boss')return false;
  if(session.kind==='owner-control')return true;
  return session.kind==='staff'&&Array.isArray(session.permissions)&&session.permissions.includes('expense');
}
function expenseAuthorityRows(){
  const modelRows=typeof OBA_PAYROLL!=='undefined'&&Array.isArray(OBA_PAYROLL.pageModel?.expenses)?OBA_PAYROLL.pageModel.expenses:null;
  if(window.OBA_ACCESS_SESSION?.kind==='owner-control'&&modelRows)return modelRows;
  return Array.isArray(OBA_EXPENSE_CLOUD.authority?.expenses)?OBA_EXPENSE_CLOUD.authority.expenses:[];
}
function expenseAuthorityPeriod(){
  if(window.OBA_ACCESS_SESSION?.kind==='owner-control')return OBA_PAYROLL?.pageModel?.period||{};
  const period=OBA_EXPENSE_CLOUD.authority?.period||{};
  return {status:String(period.status||'not_created'),currentRevision:Number(period.current_revision||0)};
}
function expenseMutationReady(){
  if(!expenseSessionCanWrite())return {ok:false,message:'目前身分沒有支出寫入權限。'};
  if(typeof OBA_PAYROLL!=='undefined'&&OBA_PAYROLL.busy)return {ok:false,message:'目前有其他損益操作正在進行，請稍後再試。'};
  const period=expenseAuthorityPeriod();
  if(String(period.status||'')==='closed')return {ok:false,message:typeof closedPayrollMessage==='function'?closedPayrollMessage():'本月份已完成月結，請先重新開放修改。'};
  if(window.OBA_ACCESS_SESSION?.kind==='owner-control'){
    const model=OBA_PAYROLL?.pageModel;
    if(model?.source!=='authority'||model?.consistency?.valid!==true||OBA_PAYROLL.localDraftDirty)return {ok:false,message:'目前不是已確認的雲端權威資料；請先完成衝突處理或薪資草稿儲存。'};
  }else if(!OBA_EXPENSE_CLOUD.authority?.ok){
    return {ok:false,message:'支出權威資料尚未載入完成，請重新整理後再試。'};
  }
  return {ok:true};
}
function expenseRequestId(key){
  if(OBA_EXPENSE_CLOUD.pendingRequests.has(key))return OBA_EXPENSE_CLOUD.pendingRequests.get(key);
  const value=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  OBA_EXPENSE_CLOUD.pendingRequests.set(key,value);return value;
}
async function expenseReadonlyResult(month){
  const result=await payrollRpc('oba_expense_overview_readonly_v1',{p_month:month});
  if(!result.ok||result.readOnly!==true)return {ok:false,result};
  return {ok:true,result};
}
function renderStaffExpenseAuthority(result){
  OBA_EXPENSE_CLOUD.authority=result;
  const rows=Array.isArray(result?.expenses)?result.expenses:[];
  const summary=result?.summary||{};
  safeSetText('expenseMonthTotal',money(Number(summary.totalExpenses||0)));
  safeSetText('expenseMonthCount',String(Number(summary.count||0)));
  safeSetText('expenseTodayTotal',money(rows.filter(row=>String(row.expenseDate)===todayStr()).reduce((sum,row)=>sum+Number(row.amount||0),0)));
  const table=$('#expenseTable');
  if(table)table.innerHTML=rows.length?rows.map(row=>`<div class="tr"><div>${escapeHtml(row.expenseDate)}</div><div>${escapeHtml(row.category)}</div><div>${money(row.amount)}</div><div>${escapeHtml(row.note||'-')}</div><div><button class="btn btn-soft btnEditExpense" data-id="${escapeHtml(row.expenseId)}" type="button">編輯</button> <button class="btn btn-danger btnDeleteExpense" data-id="${escapeHtml(row.expenseId)}" type="button">刪除</button></div></div>`).join(''):'<div class="tr"><div>本月沒有有效支出明細</div></div>';
  setExpenseStatus('支出雲端權威資料已更新','saved');
}
async function loadExpenseAuthorityOverview(monthValue){
  const month=payrollTrialMonth(monthValue);
  if(OBA_EXPENSE_CLOUD.load?.month===month)return OBA_EXPENSE_CLOUD.load.promise;
  const load={month,promise:null};
  load.promise=(async()=>{
    setExpenseStatus('正在讀取支出雲端權威資料…','dirty');
    const read=await expenseReadonlyResult(month);
    if(!read.ok){OBA_EXPENSE_CLOUD.authority=null;setExpenseStatus(typeof payrollFailure==='function'?payrollFailure(read.result):'支出雲端權威資料載入失敗','dirty');return false;}
    renderStaffExpenseAuthority(read.result);return true;
  })().catch(error=>{OBA_EXPENSE_CLOUD.authority=null;setExpenseStatus(`支出雲端權威資料載入失敗：${error?.message||error}`,'dirty');return false;}).finally(()=>{if(OBA_EXPENSE_CLOUD.load===load)OBA_EXPENSE_CLOUD.load=null;});
  OBA_EXPENSE_CLOUD.load=load;return load.promise;
}
function expenseReadbackMatches(action,payload,result){
  const row=(result?.expenses||[]).find(item=>String(item.expenseId)===String(payload.expenseId));
  if(action==='void')return !row;
  return !!row&&String(row.expenseDate)===String(payload.expenseDate)&&String(row.category)===String(payload.category)&&Number(row.amount)===Number(payload.amount)&&String(row.note||'')===String(payload.note||'');
}
function mirrorConfirmedExpenseMonth(monthValue,rows,options={}){
  const month=payrollTrialMonth(monthValue),removedIds=new Set((options.removeIds||[]).map(String));
  const allLocal=loadExpenses(),otherMonths=allLocal.filter(item=>expenseMonthOf(item?.date)!==month);
  const confirmed=(Array.isArray(rows)?rows:[]).map(row=>({
    id:String(row?.expenseId||''),date:String(row?.expenseDate||''),category:String(row?.category||''),amount:Number(row?.amount||0),note:String(row?.note||''),
    createdAt:String(row?.sourceCreatedAt||row?.createdAt||new Date().toISOString()),updatedAt:String(row?.updatedAt||new Date().toISOString()),rowVersion:Number(row?.rowVersion||0)
  })).filter(row=>row.id&&expenseMonthOf(row.date)===month&&!removedIds.has(row.id));
  const authorityIds=new Set(confirmed.map(row=>row.id));
  const localOnly=allLocal.filter(item=>expenseMonthOf(item?.date)===month&&!authorityIds.has(String(item?.id||''))&&!removedIds.has(String(item?.id||'')));
  saveExpenses([...confirmed,...localOnly,...otherMonths]);
  return {confirmed,localOnly};
}
async function expenseCloudMutation(action,payload,expectedRowVersion,options={}){
  const key=JSON.stringify([action,payload,Number(expectedRowVersion||0)]),requestId=expenseRequestId(key);
  const result=await payrollRpc('oba_expense_write_v1',{p_action:action,p_expense:payload,p_request_id:requestId,p_expected_row_version:expectedRowVersion==null?null:Number(expectedRowVersion),p_action_token:OBA_PAYROLL.action.token});
  if(!result.ok)return {ok:false,result};
  const targetMonth=String((action==='void'?options.originalDate:payload.expenseDate)||'').slice(0,7);
  const read=await expenseReadonlyResult(targetMonth);
  if(!read.ok||!expenseReadbackMatches(action,payload,read.result))return {ok:false,result:{ok:false,reason:'expense_readback_mismatch'}};
  let oldRead=null;
  if(options.originalDate&&String(options.originalDate).slice(0,7)!==targetMonth){
    oldRead=await expenseReadonlyResult(String(options.originalDate).slice(0,7));
    if(!oldRead.ok||(oldRead.result.expenses||[]).some(row=>String(row.expenseId)===String(payload.expenseId)))return {ok:false,result:{ok:false,reason:'expense_readback_mismatch'}};
  }
  const confirmed=(read.result.expenses||[]).find(row=>String(row.expenseId)===String(payload.expenseId))||result.expense;
  if(!options.skipLocalMirror){
    mirrorConfirmedExpenseMonth(targetMonth,read.result.expenses||[],{removeIds:action==='void'?[payload.expenseId]:[]});
    if(oldRead?.ok)mirrorConfirmedExpenseMonth(String(options.originalDate).slice(0,7),oldRead.result.expenses||[],{removeIds:[payload.expenseId]});
  }
  OBA_EXPENSE_CLOUD.pendingRequests.delete(key);
  return {ok:true,result,readback:read.result,targetMonth,confirmed};
}
async function refreshExpenseAuthorityAfterMutation(outcome){
  const monthInput=$('#payrollTrialMonth');if(monthInput)monthInput.value=outcome.targetMonth;
  if(window.OBA_ACCESS_SESSION?.kind==='owner-control'){
    const loaded=await loadPayrollAuthorityOverview();
    const model=OBA_PAYROLL?.pageModel;
    return loaded===true&&model?.source==='authority'&&model?.consistency?.valid===true&&model?.month===outcome.targetMonth;
  }
  renderStaffExpenseAuthority(outcome.readback);return true;
}

function startExpenseEdit(id){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const modelItem=expenseAuthorityRows().find(e=>String(e.expenseId)===String(id));
  const item=modelItem?{id:modelItem.expenseId,date:modelItem.expenseDate,category:modelItem.category,amount:modelItem.amount,note:modelItem.note,rowVersion:modelItem.rowVersion}:null;
  if(!item){ alert('找不到這筆支出'); return; }
  const dateEl=$('#expenseDate'), categoryEl=$('#expenseCategory'), amountEl=$('#expenseAmount'), noteEl=$('#expenseNote');
  if(dateEl) dateEl.value=item.date||todayStr();
  renderExpenseCategoryOptions(item.category||'材料');
  if(amountEl) amountEl.value=Number(item.amount||0);
  if(noteEl) noteEl.value=item.note||'';
  setExpenseEditingMode(item.id);
  setExpenseStatus('正在編輯這筆支出','dirty');
  const panel=$('#tab-expense');
  if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
  setTimeout(()=>amountEl?.focus(),120);
}

async function saveExpenseEntry(){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const date=($('#expenseDate')?.value || todayStr()).trim();
  const category=($('#expenseCategory')?.value || '').trim();
  const rawAmount=String($('#expenseAmount')?.value || '').trim();
  const amount=Number(rawAmount);
  const note=($('#expenseNote')?.value || '').trim();

  if(!date){ alert('請選擇支出日期'); $('#expenseDate')?.focus(); setExpenseStatus('日期未填','dirty'); return; }
  if(!category){ alert('請選擇支出分類'); $('#expenseCategory')?.focus(); setExpenseStatus('分類未選','dirty'); return; }
  if(!rawAmount || !Number.isFinite(amount) || amount<=0){ alert('請輸入正確的支出金額'); $('#expenseAmount')?.focus(); setExpenseStatus('金額未完成','dirty'); return; }

  const ready=expenseMutationReady();if(!ready.ok){setExpenseStatus(ready.message,'dirty');return false;}
  const current=expenseEditingId?expenseAuthorityRows().find(row=>String(row.expenseId)===String(expenseEditingId)):null;
  if(expenseEditingId&&!current){setExpenseStatus('找不到原本的雲端支出，請重新整理後再試','dirty');return false;}
  const action=expenseEditingId?'update':'create';
  const expenseId=expenseEditingId||(expensePendingCreateId||(expensePendingCreateId=`EXP-${crypto.randomUUID?crypto.randomUUID():Date.now()}`));
  const payload={expenseId,expenseDate:date,category,amount:Math.round(amount),note,sourceCreatedAt:current?.sourceCreatedAt||new Date().toISOString()};
  if(!confirm(`確定${action==='create'?'新增':'修改'}這筆正式支出？\n${date}｜${category}｜${money(payload.amount)}\n成功後其他裝置會讀到相同雲端資料。`))return false;
  if(!(await authorizePayrollAction('支出正式儲存')))return false;
  const recheck=expenseMutationReady();if(!recheck.ok){setExpenseStatus(recheck.message,'dirty');return false;}
  OBA_EXPENSE_CLOUD.busy=true;setExpenseStatus('正在安全儲存支出並查回驗證…','dirty');
  const outcome=await expenseCloudMutation(action,payload,current?.rowVersion??null,{originalDate:current?.expenseDate});
  OBA_EXPENSE_CLOUD.busy=false;
  if(!outcome.ok){setExpenseStatus(typeof payrollFailure==='function'?payrollFailure(outcome.result):'支出儲存失敗','dirty');return false;}
  clearExpenseForm();
  if(!(await refreshExpenseAuthorityAfterMutation(outcome))){setExpenseStatus('支出 RPC 已完成，但完整權威畫面尚未通過查回驗證；請重新查詢，禁止繼續其他損益操作。','dirty');return false;}
  setExpenseStatus('支出已儲存並通過雲端查回驗證','saved');return true;
}
function addExpense(){
  // 保留舊函式名稱，避免舊按鈕或舊事件找不到。
  saveExpenseEntry();
}
async function deleteExpense(id){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const modelItem=expenseAuthorityRows().find(e=>String(e.expenseId)===String(id));
  const item=modelItem?{id:modelItem.expenseId,date:modelItem.expenseDate,category:modelItem.category,amount:modelItem.amount,note:modelItem.note,rowVersion:modelItem.rowVersion}:null;
  if(!item){setExpenseStatus('找不到這筆雲端支出，請重新整理後再試','dirty');return false;}
  const label=item ? `${item.date || ''} ${item.category || ''} ${money(item.amount || 0)}` : '這筆支出';
  if(!confirm(`確定刪除 ${label} 嗎？`)) return;
  const ready=expenseMutationReady();if(!ready.ok){setExpenseStatus(ready.message,'dirty');return false;}
  if(!(await authorizePayrollAction('支出作廢')))return false;
  const recheck=expenseMutationReady();if(!recheck.ok){setExpenseStatus(recheck.message,'dirty');return false;}
  OBA_EXPENSE_CLOUD.busy=true;setExpenseStatus('正在安全作廢支出並查回驗證…','dirty');
  const payload={expenseId:String(id)};
  const outcome=await expenseCloudMutation('void',payload,item.rowVersion,{originalDate:item.date});
  OBA_EXPENSE_CLOUD.busy=false;
  if(!outcome.ok){setExpenseStatus(typeof payrollFailure==='function'?payrollFailure(outcome.result):'支出作廢失敗','dirty');return false;}
  if(String(expenseEditingId)===String(id))clearExpenseForm();
  if(!(await refreshExpenseAuthorityAfterMutation(outcome))){setExpenseStatus('支出作廢 RPC 已完成，但完整權威畫面尚未通過查回驗證；請重新查詢。','dirty');return false;}
  setExpenseStatus('支出已作廢並通過雲端查回驗證','saved');return true;
}

async function syncExpenseRecoveryToCloud(model){
  if(model?.source!=='draft'||model?.draft?.recoveryOnly!==true||window.OBA_ACCESS_SESSION?.kind!=='owner-control')return false;
  const rows=Array.isArray(model?.draft?.recoveryExpenses)?model.draft.recoveryExpenses:[];
  if(!rows.length){payrollStatus('Recovery 內容不是已確認的本機單筆支出，已拒絕。','error');return false;}
  if(payrollMonthClosed(model)){payrollStatus(closedPayrollMessage(),'error');return false;}
  if(!confirm(`即將只儲存已確認的本機支出 Recovery：\n月份 ${model.month}\n支出 ${rows.length} 筆／${money(rows.reduce((sum,row)=>sum+Number(row.amount||0),0))}\n不會同步任何薪資人工項目或分潤設定。\n\n確定繼續？`))return false;
  if(!(await authorizePayrollAction('支出 Recovery 正式儲存')))return false;
  OBA_PAYROLL.busy=true;payrollStatus('正在逐筆儲存已確認的支出 Recovery…','dirty');
  for(const row of rows){
    const payload={expenseId:String(row.expenseId),expenseDate:String(row.expenseDate),category:String(row.category),amount:Number(row.amount),note:String(row.note||''),sourceCreatedAt:String(row.sourceCreatedAt||new Date().toISOString())};
    const outcome=await expenseCloudMutation('create',payload,null,{originalDate:null,skipLocalMirror:true});
    if(!outcome.ok){
      OBA_PAYROLL.busy=false;
      await loadPayrollAuthorityOverview();
      payrollStatus(`支出 Recovery 未完成：${payrollFailure(outcome.result)}。已重新查回雲端；成功的單筆保留，未完成項目必須重新確認。`,'error');
      return false;
    }
  }
  OBA_PAYROLL.busy=false;
  const confirmed=await loadPayrollAuthorityOverview();
  if(!confirmed||OBA_PAYROLL.pageModel?.source!=='authority'){payrollStatus('支出已送出，但完整雲端權威查回尚未確認；禁止繼續月結。','error');return false;}
  payrollStatus('支出 Recovery 已逐筆儲存並通過雲端查回驗證；未同步其他薪資草稿。','saved');return true;
}

function bindExpenseEvents(){
  const saveBtn=$('#btnSaveExpense') || $('#btnAddExpense');
  const clearBtn=$('#btnClearExpenseForm');
  const cancelBtn=$('#btnCancelExpenseEdit');
  const refreshBtn=$('#btnExpenseRefresh');
  const table=$('#expenseTable');
  const payrollMonth=$('#payrollTrialMonth');
  const payrollList=$('#payrollTrialStaffList');
  const customCategoryInput=$('#customExpenseCategory');
  const addCategoryBtn=$('#btnAddExpenseCategory');
  const managementShareRate=$('#jeanManagementShareRate');
  const inputs=['#expenseDate','#expenseCategory','#expenseAmount','#expenseNote'];

  if(saveBtn && !saveBtn.dataset.bound){
    saveBtn.dataset.bound='yes';
    saveBtn.onclick=saveExpenseEntry;
  }
  if(clearBtn && !clearBtn.dataset.bound){
    clearBtn.dataset.bound='yes';
    clearBtn.onclick=clearExpenseForm;
  }
  if(cancelBtn && !cancelBtn.dataset.bound){
    cancelBtn.dataset.bound='yes';
    cancelBtn.onclick=cancelExpenseEdit;
  }
  if(refreshBtn && !refreshBtn.dataset.bound){
    refreshBtn.dataset.bound='yes';
    refreshBtn.onclick=refreshExpenseAuthority;
  }
  if(table && !table.dataset.bound){
    table.dataset.bound='yes';
    table.addEventListener('click', e=>{
      const editBtn=e.target.closest('.btnEditExpense');
      const deleteBtn=e.target.closest('.btnDeleteExpense');
      if(editBtn) startExpenseEdit(editBtn.dataset.id);
      if(deleteBtn) deleteExpense(deleteBtn.dataset.id);
    });
  }
  // V11.1.76：月份切換只由 payroll.js 的單一狀態機處理，避免雙重 renderer。
  if(payrollList&&!payrollList.dataset.bound){
    payrollList.dataset.bound='yes';
    payrollList.addEventListener('change',event=>{
      const input=event.target.closest('.payrollTrialInput');
      if(input) savePayrollTrialInput(input);
    });
  }
  if(addCategoryBtn&&!addCategoryBtn.dataset.bound){
    addCategoryBtn.dataset.bound='yes';
    addCategoryBtn.addEventListener('click',addCustomExpenseCategory);
  }
  if(customCategoryInput&&!customCategoryInput.dataset.bound){
    customCategoryInput.dataset.bound='yes';
    customCategoryInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCustomExpenseCategory();}});
  }
  if(managementShareRate&&!managementShareRate.dataset.bound){
    managementShareRate.dataset.bound='yes';
    managementShareRate.addEventListener('change',saveJeanManagementShareRate);
    managementShareRate.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveJeanManagementShareRate();}});
  }
  inputs.forEach(sel=>{
    const el=$(sel);
    if(el && !el.dataset.expenseDirtyBound){
      el.dataset.expenseDirtyBound='yes';
      el.addEventListener('input', ()=>setExpenseStatus(expenseEditingId?'修改尚未儲存':'尚未儲存','dirty'));
      el.addEventListener('change', ()=>setExpenseStatus(expenseEditingId?'修改尚未儲存':'尚未儲存','dirty'));
      if(sel==='#expenseAmount'){
        el.addEventListener('keydown', e=>{ if(e.key==='Enter') saveExpenseEntry(); });
      }
    }
  });
  setExpenseEditingMode(expenseEditingId);
}

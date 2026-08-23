let expenseEditingId='';
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
function renderExpenses(){
  if(window.OBA_ACCESS_SESSION?.kind==='boss')return;
  bindExpenseEvents();
  renderExpenseCategoryOptions();
  const dateEl=$('#expenseDate');
  if(dateEl && !dateEl.value) dateEl.value=todayStr();
  if(typeof shouldPreservePayrollAuthorityView==='function'&&shouldPreservePayrollAuthorityView())return;
  renderPayrollTrial();
}

function startExpenseEdit(id){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const list=loadExpenses();
  const modelItem=(typeof OBA_PAYROLL!=='undefined'&&OBA_PAYROLL.pageModel?.expenses||[]).find(e=>String(e.expenseId)===String(id));
  const item=list.find(e=>String(e.id)===String(id))||(modelItem?{id:modelItem.expenseId,date:modelItem.expenseDate,category:modelItem.category,amount:modelItem.amount,note:modelItem.note}:null);
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

function saveExpenseEntry(){
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

  if(typeof markPayrollLocalDraft==='function'&&!markPayrollLocalDraft('expenses'))return;
  const list=loadExpenses();
  if(expenseEditingId){
    const idx=list.findIndex(e=>String(e.id)===String(expenseEditingId));
    if(idx<0){
      alert('找不到原本那筆支出，請重新整理後再試');
      setExpenseStatus('修改失敗','dirty');
      return;
    }
    list[idx]={
      ...list[idx],
      date,
      category,
      amount:Math.round(amount),
      note,
      updatedAt:new Date().toISOString()
    };
    saveExpenses(list);
    clearExpenseForm();
    setExpenseStatus('支出修改已儲存','saved');
    renderExpenses();
    return;
  }

  list.unshift({
    id:'EXP-'+Date.now(),
    date,
    category,
    amount:Math.round(amount),
    note,
    createdAt:new Date().toISOString()
  });
  saveExpenses(list);
  clearExpenseForm();
  setExpenseStatus('支出已儲存','saved');
  renderExpenses();
}
function addExpense(){
  // 保留舊函式名稱，避免舊按鈕或舊事件找不到。
  saveExpenseEntry();
}
function deleteExpense(id){
  if(guardBossAction()) return;
  if(!requirePageTabAuthorization('expense')) return;
  if(rejectClosedPayrollExpenseEdit()) return;
  const list=loadExpenses();
  const modelItem=(typeof OBA_PAYROLL!=='undefined'&&OBA_PAYROLL.pageModel?.expenses||[]).find(e=>String(e.expenseId)===String(id));
  const item=list.find(e=>String(e.id)===String(id))||(modelItem?{id:modelItem.expenseId,date:modelItem.expenseDate,category:modelItem.category,amount:modelItem.amount,note:modelItem.note}:null);
  const label=item ? `${item.date || ''} ${item.category || ''} ${money(item.amount || 0)}` : '這筆支出';
  if(!confirm(`確定刪除 ${label} 嗎？`)) return;
  if(typeof markPayrollLocalDraft==='function'&&!markPayrollLocalDraft('expenses'))return;
  const draftList=loadExpenses();
  const next=draftList.filter(e=>String(e.id)!==String(id));
  saveExpenses(next);
  if(String(expenseEditingId)===String(id)) clearExpenseForm();
  setExpenseStatus('支出已刪除','saved');
  renderExpenses();
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
    refreshBtn.onclick=renderExpenses;
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

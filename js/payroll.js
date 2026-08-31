// V11.1.81 - authority/local expense conflicts fail closed; expense writes use a dedicated cloud path.
// Action tokens live in memory only. PIN values are never persisted or logged.
const OBA_PAYROLL={action:null,lastPayload:'',preview:null,previewContext:null,uiCheckContext:null,history:null,busy:false,backgroundRefreshPending:false,pageModel:null,requestSeq:0,authorityRequestSerial:0,authorityResult:null,authorityMonth:'',authorityLoad:null,localDraftDirty:false,recoveryCandidate:null};
const PAYROLL_AUTHORITY_LOAD_TIMEOUT_MS=Number.isFinite(Number(window.OBA_PAYROLL_AUTHORITY_TIMEOUT_MS))?Math.max(1,Number(window.OBA_PAYROLL_AUTHORITY_TIMEOUT_MS)):15000;
const OBA_PAYROLL_LOCAL_MIGRATION_KEY='oba_hair_dev_payroll_phase1d_cloud_migration_v1';
const OBA_PAYROLL_DRAFT_META_KEY='oba_hair_payroll_draft_meta_v11180';

function payrollRpcResult(data){return Array.isArray(data)?(data[0]||{}):(data&&typeof data==='object'?data:{});}
async function payrollRpc(name,args,options={}){
  try{
    const client=getCloudClient();
    if(!client) return {ok:false,reason:'cloud_unavailable'};
    let request=client.rpc(name,args||{});
    if(options.signal&&typeof request?.abortSignal==='function')request=request.abortSignal(options.signal);
    const {data,error}=await request;
    if(error) return {ok:false,reason:'rpc_error',code:error.code||'',message:error.message||'',details:error.details||'',hint:error.hint||''};
    return payrollRpcResult(data);
  }catch(error){return {ok:false,reason:'network_error',message:error?.message||String(error)};}
}
function payrollStatus(text,mode=''){
  const el=document.getElementById('payrollFormalStatus'); if(!el)return;
  el.textContent=String(text||''); el.className='save-status '+(mode||'');
}
function payrollCloudEnvironmentName(){
  const channel=String(window.OBA_RUNTIME_CONFIG?.channel||window.OBA_RUNTIME_CHANNEL||'').trim().toUpperCase();
  if(channel==='PRODUCTION')return '正式';
  if(channel==='DEV')return 'DEV';
  return '目前';
}
function payrollFailure(result){
  const reason=String(result?.reason||'unknown');
  const cloud=payrollCloudEnvironmentName();
  const map={unauthorized:'目前身分沒有此操作權限',entry_unauthorized:'目前入口身分不可執行此操作',expense_permission_required:'操作者沒有支出權限',action_actor_mismatch:'目前操作授權與登入身分不一致',invalid_action:'支出操作類型不正確',request_id_required:'支出操作缺少安全識別碼',request_id_conflict:'支出操作識別碼與先前內容衝突',invalid_expense_id:'支出識別碼格式不正確',invalid_expense_payload:'支出日期或金額格式不正確',invalid_expense_category:'支出分類不符合規則',expense_note_too_long:'支出備註過長',expense_not_found:'找不到這筆雲端支出',expense_already_voided:'這筆支出已經作廢',expense_conflict:'支出已被其他裝置修改，請重新查詢',expense_id_conflict:'支出識別碼已存在，請重新查詢',already_closed:'本月份已完成月結，請先重新開放修改',period_closed_requires_reopen:'本月份已完成月結，請先按「重新開放修改」後才能修改或儲存支出',payload_month_required:'儲存資料缺少明確月份，已安全拒絕',payload_month_mismatch:'儲存資料包含其他月份，已安全拒絕',not_closed:'本月份目前不是已完成月結狀態',reason_required:'請填寫至少 3 個字的原因',preview_changed:'雲端資料已改變，請重新儲存薪資試算並進行月結前確認',cloud_unavailable:`${cloud}雲端目前無法使用`,rpc_error:`${cloud} RPC 尚未安裝或執行失敗`,network_error:'網路連線失敗'};
  return `${map[reason]||reason}${result?.code?' ['+result.code+']':''}${result?.message?'：'+result.message:''}`;
}
function payrollCurrentMonth(){return payrollTrialMonth(document.getElementById('payrollTrialMonth')?.value);}
function payrollMonthDisplay(monthValue=payrollCurrentMonth()){
  const match=String(monthValue||'').match(/^(\d{4})-(\d{2})$/);
  return match?`${Number(match[1])} 年 ${Number(match[2])} 月`:String(monthValue||'本月');
}
function isPayrollAuthorityViewer(){return ['boss','owner-control'].includes(window.OBA_ACCESS_SESSION?.kind||'');}
function payrollModelNumber(value){const n=Number(value||0);return Number.isFinite(n)?Math.round(n):0;}
function payrollMonthClosed(model=OBA_PAYROLL.pageModel){return String(model?.period?.status||'')==='closed';}
function closedPayrollMessage(){return '本月份已完成月結，請先按「重新開放修改」後才能修改或儲存薪資試算。';}
function payrollModelFingerprint(model){
  const payload={month:model?.month||'',employees:(model?.employees||[]).map(row=>[row.staffId,row.actualSalary,row.advance,row.materialAdvance,row.insuranceSelf,row.annualBonus]),totals:model?.totals||{},expenses:(model?.expenses||[]).map(row=>[row.expenseId,row.expenseDate,row.category,row.amount,row.note]),period:model?.period||{}};
  return JSON.stringify(payload);
}
function payrollRoleCapabilities(model=OBA_PAYROLL.pageModel){
  const kind=window.OBA_ACCESS_SESSION?.kind||'';
  const boss=kind==='boss';
  const owner=kind==='owner-control';
  const staff=kind==='staff';
  const closed=payrollMonthClosed(model);
  const authorityReady=model?.source==='authority'&&model?.consistency?.valid===true&&!OBA_PAYROLL.localDraftDirty;
  const draftReady=!closed&&model?.source==='draft'&&model?.consistency?.valid===true&&OBA_PAYROLL.localDraftDirty;
  const recoveryOnly=!!model?.draft?.recoveryOnly;
  const recoveryReopenReady=owner&&closed&&['conflict','local-review'].includes(model?.source||'')&&model?.consistency?.valid===true&&!OBA_PAYROLL.localDraftDirty;
  const staffSynced=staff&&!OBA_PAYROLL.localDraftDirty&&!!OBA_PAYROLL.lastPayload&&OBA_PAYROLL.lastPayload===payrollPayloadText();
  const blockedSource=['loading','conflict','local-review','error'].includes(model?.source||'');
  return {boss,owner,staff,authorityReady,draftReady,staffSynced,canEditDraft:!recoveryOnly&&!blockedSource&&!closed&&!boss&&(owner||staff),canSync:!closed&&!boss&&draftReady,canPreview:!boss&&(authorityReady||staffSynced),canClose:!closed&&!boss&&(authorityReady||staffSynced)&&!!OBA_PAYROLL.previewContext,canReopen:!boss&&(authorityReady&&closed||recoveryReopenReady||staffSynced)};
}
function payrollConsistency(totals,employees,expenses=[]){
  const salarySum=(employees||[]).reduce((sum,row)=>sum+payrollModelNumber(row.actualSalary),0);
  const reportedSalary=payrollModelNumber(totals?.staffSalaryCost);
  const expectedProfit=payrollModelNumber(totals?.grossSales)-payrollModelNumber(totals?.refunds)-payrollModelNumber(totals?.generalExpenses)-reportedSalary-payrollModelNumber(totals?.companyInsurance)-payrollModelNumber(totals?.managementShare);
  const reportedProfit=payrollModelNumber(totals?.finalProfit);
  const expenseGeneral=(expenses||[]).filter(row=>String(row.category||'')!=='公司負擔保險').reduce((sum,row)=>sum+payrollModelNumber(row.amount),0);
  const expenseInsurance=(expenses||[]).filter(row=>String(row.category||'')==='公司負擔保險').reduce((sum,row)=>sum+payrollModelNumber(row.amount),0);
  const errors=[];
  if(salarySum!==reportedSalary)errors.push(`員工實發合計 ${salarySum} 與摘要 ${reportedSalary} 不一致`);
  if(expectedProfit!==reportedProfit)errors.push(`損益公式結果 ${expectedProfit} 與摘要 ${reportedProfit} 不一致`);
  if(expenseGeneral!==payrollModelNumber(totals?.generalExpenses)||expenseInsurance!==payrollModelNumber(totals?.companyInsurance))errors.push('支出明細與支出摘要不一致');
  return {valid:errors.length===0,errors,employeeSalarySum:salarySum,reportedStaffSalaryCost:reportedSalary,calculatedFinalProfit:expectedProfit,reportedFinalProfit:reportedProfit};
}
function payrollSyncEvidence(model){
  const month=String(model?.month||'');
  return JSON.stringify({
    month,
    employees:(model?.employees||[]).map(row=>({staffId:String(row.staffId||''),advance:payrollModelNumber(row.advance),materialAdvance:payrollModelNumber(row.materialAdvance),insuranceSelf:payrollModelNumber(row.insuranceSelf),annualBonus:payrollModelNumber(row.annualBonus)})).sort((a,b)=>a.staffId.localeCompare(b.staffId)),
    expenses:(model?.expenses||[]).map(row=>({expenseId:String(row.expenseId||''),expenseDate:String(row.expenseDate||''),category:String(row.category||''),amount:payrollModelNumber(row.amount),note:String(row.note||'')})).sort((a,b)=>`${a.expenseDate}|${a.expenseId}`.localeCompare(`${b.expenseDate}|${b.expenseId}`)),
    managementShareRate:Number(model?.totals?.managementShareRate||0)
  });
}
function payrollNormalizeExpense(row){
  return {expenseId:String(row?.expenseId||row?.id||''),expenseDate:String(row?.expenseDate||row?.date||''),category:String(row?.category||''),amount:payrollModelNumber(row?.amount),note:String(row?.note||'')};
}
function payrollExpenseEvidence(rows){
  return JSON.stringify((rows||[]).map(payrollNormalizeExpense).sort((a,b)=>`${a.expenseDate}|${a.expenseId}|${a.category}|${a.amount}|${a.note}`.localeCompare(`${b.expenseDate}|${b.expenseId}|${b.category}|${b.amount}|${b.note}`)));
}
function payrollLocalMonthExpenses(monthValue){
  const month=payrollTrialMonth(monthValue);
  return loadExpenses().filter(row=>String(row?.date||'').slice(0,7)===month).map(payrollNormalizeExpense);
}
function loadPayrollDraftMeta(){
  try{const value=JSON.parse(localStorage.getItem(OBA_PAYROLL_DRAFT_META_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch(_error){return {};}
}
function savePayrollDraftMeta(monthValue,domains){
  const month=payrollTrialMonth(monthValue),all=loadPayrollDraftMeta();
  all[month]={dirty:true,domains:Array.from(new Set((domains||[]).map(String))),updatedAt:new Date().toISOString(),runtimeVersion:String(window.OBA_RUNTIME_CONFIG?.version||'11.1.81')};
  localStorage.setItem(OBA_PAYROLL_DRAFT_META_KEY,JSON.stringify(all));
}
function clearPayrollDraftMeta(monthValue){
  const month=payrollTrialMonth(monthValue),all=loadPayrollDraftMeta();
  if(Object.prototype.hasOwnProperty.call(all,month)){delete all[month];localStorage.setItem(OBA_PAYROLL_DRAFT_META_KEY,JSON.stringify(all));}
}
function payrollExpenseConflict(authorityModel){
  if(window.OBA_ACCESS_SESSION?.kind!=='owner-control'||authorityModel?.source!=='authority')return null;
  const local=payrollLocalMonthExpenses(authorityModel.month),authority=(authorityModel.expenses||[]).map(payrollNormalizeExpense);
  if(!local.length||payrollExpenseEvidence(local)===payrollExpenseEvidence(authority))return null;
  const authorityById=new Map(authority.map(row=>[row.expenseId,row])),localById=new Map(local.map(row=>[row.expenseId,row]));
  const localOnly=local.filter(row=>!authorityById.has(row.expenseId));
  const authorityOnly=authority.filter(row=>!localById.has(row.expenseId));
  const differingIds=local.filter(row=>authorityById.has(row.expenseId)&&payrollExpenseEvidence([row])!==payrollExpenseEvidence([authorityById.get(row.expenseId)])).map(row=>row.expenseId);
  return {domains:['expenses'],month:authorityModel.month,local,authority,localOnly,authorityOnly,differingIds,localFingerprint:payrollExpenseEvidence(local),authorityFingerprint:payrollExpenseEvidence(authority),localCount:local.length,authorityCount:authority.length,localTotal:local.reduce((sum,row)=>sum+row.amount,0),authorityTotal:authority.reduce((sum,row)=>sum+row.amount,0),detectedAt:new Date().toISOString()};
}
function payrollExpenseRowsSameContent(left,right){
  if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
  const signature=row=>JSON.stringify([String(row?.expenseDate||''),String(row?.category||''),payrollModelNumber(row?.amount),String(row?.note||'')]);
  const leftKeys=left.map(row=>signature(payrollNormalizeExpense(row))).sort();
  const rightKeys=right.map(row=>signature(payrollNormalizeExpense(row))).sort();
  return leftKeys.every((key,index)=>key===rightKeys[index]);
}
function payrollExpenseRecoveryEligible(conflict){
  return !!conflict&&Array.isArray(conflict.localOnly)&&conflict.localOnly.length>0&&!(conflict.differingIds||[]).length;
}
function payrollTodaySummary(expenses){
  const today=typeof todayStr==='function'?todayStr():'',orders=typeof activeReportOrders==='function'?activeReportOrders().filter(row=>!row.refunded):[],refunds=typeof activeReportRefunds==='function'?activeReportRefunds():[],salaryOrders=typeof salaryBaseOrders==='function'?salaryBaseOrders():[];
  const sales=orders.filter(row=>row.date===today).reduce((sum,row)=>sum+payrollModelNumber(row.total),0),refundTotal=refunds.filter(row=>row.date===today).reduce((sum,row)=>sum+payrollModelNumber(row.total),0),expenseTotal=(expenses||[]).filter(row=>row.expenseDate===today).reduce((sum,row)=>sum+payrollModelNumber(row.amount),0),salary=salaryOrders.filter(row=>row.date===today&&row.assignedDesignerId).reduce((sum,row)=>sum+payrollModelNumber(row.commission),0);
  return {sales,refunds:refundTotal,expenses:expenseTotal,salary,netBeforeSalary:sales-expenseTotal,netAfterSalary:sales-expenseTotal-salary};
}
function payrollRecalculateExpenseModel(authorityModel,expenses,source){
  const rows=(expenses||[]).map(payrollNormalizeExpense),generalExpenses=rows.filter(row=>row.category!=='公司負擔保險').reduce((sum,row)=>sum+row.amount,0),companyInsurance=rows.filter(row=>row.category==='公司負擔保險').reduce((sum,row)=>sum+row.amount,0),baseTotals={...(authorityModel.totals||{}),generalExpenses,companyInsurance};
  const profitBeforeManagementShare=payrollModelNumber(baseTotals.grossSales)-payrollModelNumber(baseTotals.refunds)-generalExpenses-payrollModelNumber(baseTotals.staffSalaryCost)-companyInsurance,rate=Math.max(0,Math.min(1,Number(baseTotals.managementShareRate||0))),managementShare=Math.max(0,Math.round(profitBeforeManagementShare*rate)),finalProfit=profitBeforeManagementShare-managementShare;
  const totals={...baseTotals,profitBeforeManagementShare,managementShare,finalProfit};
  const employees=(authorityModel.employees||[]).map(row=>{const isJean=String(row.staffName||row.staffId||'').trim().toUpperCase()==='JEAN';return {...row,managementShare:isJean?managementShare:0,monthlyTotal:payrollModelNumber(row.actualSalary)+(isJean?managementShare:0)};});
  const consistency=payrollConsistency(totals,employees,rows);
  return {...authorityModel,source,employees,totals,expenses:rows,expenseSummary:{todayTotal:rows.filter(row=>row.expenseDate===(typeof todayStr==='function'?todayStr():'')).reduce((sum,row)=>sum+row.amount,0),monthTotal:rows.reduce((sum,row)=>sum+row.amount,0),monthCount:rows.length},todaySummary:payrollTodaySummary(rows),draft:source==='draft'?{dirty:true,domains:['expenses'],updatedAt:new Date().toISOString()}:null,consistency,error:consistency.valid?null:{message:'本機支出 recovery 與損益摘要不一致，禁止儲存。',details:consistency.errors},sourceRevision:(authorityModel.sourceRevision||0)+1};
}
function payrollBuildExpenseRecoveryModel(conflictModel,source='local-review'){
  const conflict=conflictModel?.conflict;if(!conflict||conflict.differingIds.length)return null;
  const merged=new Map((conflict.authority||[]).map(row=>[row.expenseId,payrollNormalizeExpense(row)]));
  (conflict.localOnly||[]).forEach(row=>merged.set(row.expenseId,payrollNormalizeExpense(row)));
  const model=payrollRecalculateExpenseModel(conflictModel,Array.from(merged.values()),source);model.conflict=conflict;model.recovery={confirmed:source==='draft',domains:['expenses']};return model;
}
function buildAuthorityPayrollPageModel(result,revision){
  const overview=result?.overview||{}, period=result?.period||{};
  const managementShare=payrollModelNumber(overview.managementShare);
  const employees=(Array.isArray(overview.employees)?overview.employees:[]).map(row=>{
    const isJean=String(row.staffName||row.staffId||'').trim().toUpperCase()==='JEAN';
    const actualSalary=payrollModelNumber(row.actualSalary);
    return {staffId:String(row.staffId||''),staffName:String(row.staffName||row.staffId||''),orderCount:payrollModelNumber(row.orderCount),performanceTotal:payrollModelNumber(row.performanceTotal),commissionTotal:payrollModelNumber(row.commissionTotal),guaranteeSalary:payrollModelNumber(row.guaranteeSalary),responsibilityTarget:payrollModelNumber(row.responsibilityTarget),achievementRate:Number(row.achievementRate||0),baseSalary:payrollModelNumber(row.baseSalary),advance:payrollModelNumber(row.advance),materialAdvance:payrollModelNumber(row.materialAdvance),insuranceSelf:payrollModelNumber(row.insuranceSelf),annualBonus:payrollModelNumber(row.annualBonus),actualSalary,managementShare:isJean?managementShare:0,monthlyTotal:actualSalary+(isJean?managementShare:0)};
  });
  const expenses=(Array.isArray(result?.expenses)?result.expenses:[]).map(row=>({expenseId:String(row.expenseId||row.expense_id||''),expenseDate:String(row.expenseDate||row.expense_date||''),category:String(row.category||''),amount:payrollModelNumber(row.amount),note:String(row.note||''),rowVersion:payrollModelNumber(row.rowVersion||row.row_version)}));
  const totals={employeeCount:payrollModelNumber(overview.employeeCount||employees.length),commissionTotal:employees.reduce((sum,row)=>sum+row.commissionTotal,0),staffSalaryCost:payrollModelNumber(overview.staffSalaryCost),grossSales:payrollModelNumber(overview.grossSales),refunds:payrollModelNumber(overview.refunds),generalExpenses:payrollModelNumber(overview.generalExpenses),companyInsurance:payrollModelNumber(overview.companyInsurance),managementShareRate:Number(overview.managementShareRate||0),profitBeforeManagementShare:payrollModelNumber(overview.profitBeforeManagementShare),managementShare,finalProfit:payrollModelNumber(overview.finalProfit)};
  const consistency=payrollConsistency(totals,employees,expenses);
  const model={source:consistency.valid?'authority':'error',month:payrollTrialMonth(result?.month||overview.month),employees,totals,expenses,expenseSummary:{todayTotal:expenses.filter(row=>row.expenseDate===(typeof todayStr==='function'?todayStr():'')).reduce((sum,row)=>sum+row.amount,0),monthTotal:expenses.reduce((sum,row)=>sum+row.amount,0),monthCount:expenses.length},todaySummary:payrollTodaySummary(expenses),period:{status:String(period.status||'not_created'),currentRevision:payrollModelNumber(period.current_revision),closedAt:period.closed_at||null,reopenedAt:period.reopened_at||null},authority:{rawResult:result,previewHash:String(overview.previewHash||''),sourceStateUpdatedAt:String(overview.sourceStateUpdatedAt||''),fetchedAt:new Date().toISOString()},draft:null,conflict:null,recovery:null,consistency,error:consistency.valid?null:{message:'雲端薪資明細與摘要不一致，請重新查詢。',details:consistency.errors},renderedAt:'',sourceRevision:revision};
  model.authority.fingerprint=payrollModelFingerprint(model);return model;
}
function buildDraftPayrollPageModel(monthValue,revision){
  const month=payrollTrialMonth(monthValue), summary=payrollTrialSummary(month), profit=monthlyCompanyProfitBreakdown(month);
  const managementShare=payrollModelNumber(profit.managementShare);
  const employees=summary.trials.map(row=>{const isJean=String(row.staff.name||row.staff.nickname||row.staff.id||'').trim().toUpperCase()==='JEAN';const actualSalary=payrollModelNumber(row.actualSalary);return {staffId:String(row.staff.id||''),staffName:String(row.staff.name||row.staff.nickname||row.staff.id||''),orderCount:payrollModelNumber(row.orderCount),performanceTotal:payrollModelNumber(row.performanceTotal),commissionTotal:payrollModelNumber(row.commissionTotal),guaranteeSalary:PAYROLL_GUARANTEE,responsibilityTarget:PAYROLL_TARGET,achievementRate:Number(row.achievementRate||0),baseSalary:payrollModelNumber(row.baseSalary),advance:payrollModelNumber(row.advance),materialAdvance:payrollModelNumber(row.materialAdvance),insuranceSelf:payrollModelNumber(row.insurance),annualBonus:payrollModelNumber(row.annualBonus),actualSalary,managementShare:isJean?managementShare:0,monthlyTotal:actualSalary+(isJean?managementShare:0)};});
  const expenses=loadExpenses().filter(row=>String(row.date||'').startsWith(month)).map(row=>({expenseId:String(row.id||''),expenseDate:String(row.date||''),category:String(row.category||''),amount:payrollModelNumber(row.amount),note:String(row.note||'')}));
  const totals={employeeCount:employees.length,commissionTotal:employees.reduce((sum,row)=>sum+row.commissionTotal,0),staffSalaryCost:payrollModelNumber(profit.staffSalaries),grossSales:payrollModelNumber(profit.sales),refunds:payrollModelNumber(profit.refunds),generalExpenses:payrollModelNumber(profit.generalExpenses),companyInsurance:payrollModelNumber(profit.companyInsurance),managementShareRate:Number(profit.managementShareRate||0),profitBeforeManagementShare:payrollModelNumber(profit.profitBeforeManagementShare),managementShare,finalProfit:payrollModelNumber(profit.finalProfit)};
  const consistency=payrollConsistency(totals,employees,expenses);
  const previous=OBA_PAYROLL.pageModel?.month===month?OBA_PAYROLL.pageModel:null;
  return {source:consistency.valid?'draft':'error',month,employees,totals,expenses,expenseSummary:{todayTotal:expenses.filter(row=>row.expenseDate===(typeof todayStr==='function'?todayStr():'')).reduce((sum,row)=>sum+row.amount,0),monthTotal:expenses.reduce((sum,row)=>sum+row.amount,0),monthCount:expenses.length},todaySummary:payrollTodaySummary(expenses),period:previous?.period||{status:'not_created',currentRevision:0},authority:previous?.authority||null,draft:{dirty:true,domains:loadPayrollDraftMeta()[month]?.domains||[],localPayloadFingerprint:payrollPayloadText(),updatedAt:new Date().toISOString()},conflict:null,recovery:null,consistency,error:consistency.valid?null:{message:'本機薪資明細與摘要不一致，禁止儲存。',details:consistency.errors},renderedAt:'',sourceRevision:revision};
}
function beginPayrollAuthorityLoad(monthValue){
  if(!isPayrollAuthorityViewer())return false;
  const revision=(OBA_PAYROLL.pageModel?.sourceRevision||0)+1;
  setPayrollPageModel({source:'loading',month:payrollTrialMonth(monthValue),employees:[],totals:{},expenses:[],expenseSummary:{todayTotal:0,monthTotal:0,monthCount:0},todaySummary:{sales:0,refunds:0,expenses:0,salary:0,netBeforeSalary:0,netAfterSalary:0},period:OBA_PAYROLL.pageModel?.period||{status:'not_created',currentRevision:0},authority:null,draft:null,conflict:null,recovery:null,consistency:{valid:false,errors:[]},error:null,renderedAt:'',sourceRevision:revision});
  return true;
}
function shouldPreservePayrollAuthorityView(){
  const model=OBA_PAYROLL.pageModel;
  return isPayrollAuthorityViewer()&&(['loading','authority','conflict','local-review','error'].includes(model?.source||'')||(model?.source==='draft'&&model?.draft?.recoveryOnly===true));
}
function hydratePayrollLocalDraftFromAuthority(model,confirmedExpenses=null){
  if(!['authority','local-review'].includes(model?.source||'')||model.consistency?.valid!==true)return false;
  const month=model.month;
  const inputs=loadPayrollTrialInputs();inputs[month]={};
  (model.employees||[]).forEach(row=>{inputs[month][String(row.staffId)]={advance:payrollModelNumber(row.advance),materialAdvance:payrollModelNumber(row.materialAdvance),insurance:payrollModelNumber(row.insuranceSelf),annualBonus:payrollModelNumber(row.annualBonus)};});
  savePayrollTrialInputs(inputs);
  const rates=loadJeanManagementShareRates();rates[month]=Number(model.totals?.managementShareRate||0);localStorage.setItem(JEAN_MANAGEMENT_SHARE_RATE_KEY,JSON.stringify(rates));
  const otherMonths=loadExpenses().filter(row=>!String(row.date||'').startsWith(month));
  const monthExpenses=(confirmedExpenses||model.expenses||[]).map(row=>({id:String(row.expenseId||''),date:String(row.expenseDate||''),category:String(row.category||''),amount:payrollModelNumber(row.amount),note:String(row.note||''),createdAt:new Date().toISOString()}));
  saveExpenses([...monthExpenses,...otherMonths]);
  return true;
}
function markPayrollLocalDraft(domain='employeeInputs'){
  if(window.OBA_ACCESS_SESSION?.kind==='boss')return false;
  const current=OBA_PAYROLL.pageModel;
  if(payrollMonthClosed(current)){
    payrollStatus(closedPayrollMessage(),'error');
    return false;
  }
  if(isPayrollAuthorityViewer()&&!['authority','draft'].includes(current?.source||'')){
    payrollStatus('權威資料尚未通過一致性驗證，不能建立本機草稿。','error');
    return false;
  }
  if(current?.source==='authority'&&!hydratePayrollLocalDraftFromAuthority(current))return false;
  OBA_PAYROLL.requestSeq++; // invalidate any background authority read that started before this edit
  OBA_PAYROLL.localDraftDirty=true;savePayrollDraftMeta(current?.month||payrollCurrentMonth(),[...(loadPayrollDraftMeta()[current?.month||payrollCurrentMonth()]?.domains||[]),domain]);OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;renderFormalPreview(null);
  const month=current?.month||payrollCurrentMonth();
  setPayrollPageModel(buildDraftPayrollPageModel(month,(current?.sourceRevision||0)+1));
  return true;
}
function setPayrollPageModel(model){
  if(['loading','conflict','local-review','error'].includes(model?.source||'')){OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;renderFormalPreview(null);}
  OBA_PAYROLL.pageModel=model;OBA_PAYROLL.authorityResult=model?.authority?.rawResult||null;OBA_PAYROLL.authorityMonth=model?.source==='authority'?model.month:'';
  renderPayrollPage(model);return model;
}
function renderPayrollRecoveryPanel(model){
  const panel=document.getElementById('payrollExpenseConflictWorkspace'),summary=document.getElementById('payrollExpenseConflictSummary'),review=document.getElementById('btnPayrollReviewLocalExpenses'),confirmButton=document.getElementById('btnPayrollConfirmExpenseRecovery');
  const source=String(model?.source||''),recoveryPending=source==='draft'&&model?.draft?.recoveryOnly===true&&model?.draft?.recoveryPending===true,recoveryWriting=recoveryPending&&OBA_PAYROLL.busy,visible=['conflict','local-review'].includes(source)||recoveryPending,owner=window.OBA_ACCESS_SESSION?.kind==='owner-control';
  const setVisible=(element,show)=>{if(!element)return;element.classList.toggle('hidden',!show);element.hidden=!show;element.setAttribute('aria-hidden',show?'false':'true');};
  setVisible(panel,visible);
  if(!visible)return;
  const conflict=model.conflict||{};
  const closedHint=payrollMonthClosed(model)?' 本月份已完成月結；確認支出 Recovery 維持鎖定，請先按「重新開放修改」。':'';
  const localOnlyRows=Array.isArray(conflict.localOnly)?conflict.localOnly:[];
  const localOnlyText=localOnlyRows.length?localOnlyRows.map(row=>`${row.expenseDate||''}｜${row.category||'未分類'}｜${money(row.amount||0)}${row.note?`｜${row.note}`:''}`).join('；'):'無';
  if(summary)summary.textContent=(recoveryPending?(recoveryWriting?`雲端 authority：${conflict.authorityCount||0} 筆／${money(conflict.authorityTotal||0)}。正在寫入 Recovery：${localOnlyText}。完成逐筆寫入與權威查回前，畫面維持鎖定。`:`支出 Recovery 尚未完成最終權威查回；請按重新整理重新確認雲端狀態。`):source==='local-review'?`正在唯讀檢視 ${model.month} 本機支出 recovery：${localOnlyRows.length} 筆／${money(localOnlyRows.reduce((sum,row)=>sum+Number(row.amount||0),0))}。按「確認並寫入 Recovery」後才會安全寫入雲端並查回驗證。`:`雲端 authority：${conflict.authorityCount||0} 筆／${money(conflict.authorityTotal||0)}。本機 local-only：${localOnlyText}。兩邊資料不一致，已停止自動同步；兩邊資料都不會被覆蓋。`)+closedHint;
  setVisible(review,source==='conflict');
  if(review)review.disabled=source!=='conflict'||!payrollExpenseRecoveryEligible(conflict);
  setVisible(confirmButton,source==='local-review'&&owner);
  if(confirmButton){confirmButton.disabled=source!=='local-review'||!owner||payrollMonthClosed(model)||OBA_PAYROLL.busy;confirmButton.title=payrollMonthClosed(model)?closedPayrollMessage():'';}
}
function reviewPayrollLocalExpenseRecovery(){
  const model=OBA_PAYROLL.pageModel;if(model?.source!=='conflict'||window.OBA_ACCESS_SESSION?.kind!=='owner-control')return false;
  if(!payrollExpenseRecoveryEligible(model.conflict)){payrollStatus('目前沒有可安全上傳的 local-only 支出；authority-only 或同 ID 差異不得進入 Recovery。','error');return false;}
  const review=payrollBuildExpenseRecoveryModel(model,'local-review');if(!review)return false;
  setPayrollPageModel(review);payrollStatus('目前只是在檢視本機支出 recovery；尚未修改 localStorage，也尚未儲存雲端。','dirty');return true;
}
async function confirmPayrollExpenseRecovery(){
  const model=OBA_PAYROLL.pageModel;if(model?.source!=='local-review'||window.OBA_ACCESS_SESSION?.kind!=='owner-control')return false;
  if(OBA_PAYROLL.busy)return false;
  if(payrollMonthClosed(model)){payrollStatus(closedPayrollMessage(),'error');return false;}
  if(model.consistency?.valid!==true||model.recovery?.domains?.length!==1||model.recovery.domains[0]!=='expenses'||!payrollExpenseRecoveryEligible(model.conflict)){payrollStatus('支出 Recovery 狀態未通過一致性或 domain 檢查，已安全阻擋。','error');return false;}
  const recoveryExpenses=Object.freeze(model.conflict.localOnly.map(row=>Object.freeze({...payrollNormalizeExpense(row)})));
  savePayrollDraftMeta(model.month,['expenses']);OBA_PAYROLL.localDraftDirty=true;OBA_PAYROLL.requestSeq++;OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;renderFormalPreview(null);
  const draft=payrollBuildExpenseRecoveryModel(model,'draft');
  if(!draft){payrollStatus('支出 Recovery 草稿建立失敗，系統保持鎖定。','error');return false;}
  draft.draft={...(draft.draft||{}),dirty:true,recoveryOnly:true,recoveryPending:true,domains:['expenses'],recoveryExpenses,localPayloadFingerprint:payrollSyncEvidence(draft),updatedAt:new Date().toISOString()};
  draft.conflict=model.conflict;draft.recovery={confirmed:true,pending:true,domains:['expenses']};
  setPayrollPageModel(draft);
  payrollStatus('支出 Recovery 已確認，正在進入安全寫入與 authority read-back 驗證。','dirty');
  return await syncPayrollLocalToCloud();
}
function renderPayrollControls(model){
  const caps=payrollRoleCapabilities(model);
  const sync=document.getElementById('btnPayrollCloudSync'),check=document.getElementById('btnPayrollAuthorityRefresh'),preview=document.getElementById('btnPayrollFormalPreview'),close=document.getElementById('btnPayrollFormalClose'),reopen=document.getElementById('btnPayrollFormalReopen');
  if(sync)sync.disabled=!caps.canSync;
  const currentFingerprint=model?.authority?.fingerprint||(!OBA_PAYROLL.localDraftDirty?payrollPayloadText():'');
  const checkMatches=!!(OBA_PAYROLL.uiCheckContext&&OBA_PAYROLL.uiCheckContext.month===model?.month&&OBA_PAYROLL.uiCheckContext.fingerprint===currentFingerprint);
  if(check)check.disabled=!!OBA_PAYROLL.busy||model?.source==='loading'||caps.boss;
  if(preview)preview.disabled=!(caps.canPreview&&checkMatches);
  const previewMatches=!!(OBA_PAYROLL.previewContext&&OBA_PAYROLL.previewContext.month===model?.month&&OBA_PAYROLL.previewContext.authorityFingerprint===currentFingerprint);
  if(close)close.disabled=!(caps.canClose&&checkMatches&&previewMatches);
  if(reopen)reopen.disabled=!caps.canReopen;
  ['expenseDate','expenseCategory','expenseAmount','expenseNote','customExpenseCategory','btnAddExpenseCategory','btnSaveExpense','btnCancelExpenseEdit'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!caps.canEditDraft;});
  safeSetText('payrollPeriodState',model?.period?.status||'not_created');
  safeSetText('payrollCurrentRevision',String(model?.period?.currentRevision||0));
  safeSetText('payrollActionState',payrollActionValid()?`已授權：${OBA_PAYROLL.action?.name||'操作者'}`:'未授權');
  const completion=document.getElementById('payrollCompletionStatus');
  if(completion){completion.textContent=payrollMonthClosed(model)?`✓ ${payrollMonthDisplay(model?.month)}已完成月結`:'本月尚未完成月結';completion.className='save-status '+(payrollMonthClosed(model)?'saved':'');}
}
function clearPayrollPageValues(message){
  const list=document.getElementById('payrollTrialStaffList');if(list)list.innerHTML=`<div class="note">${escapeHtml(message||'薪資損益資料尚未就緒。')}</div>`;
  ['payrollTrialEmployeeCount','payrollTrialCommissionTotal','payrollTrialSalaryTotal','payrollManagementShareTotal','profitMonthSales','profitMonthRefund','profitMonthExpense','profitMonthCompanyInsurance','profitMonthSalary','profitBeforeManagementShare','profitMonthManagementBonus','profitMonthAfterSalary','expenseMonthTotal','expenseMonthCount'].forEach(id=>safeSetText(id,'—'));
  const rate=document.getElementById('jeanManagementShareRate');if(rate){rate.value='';rate.disabled=true;}
  const table=document.getElementById('expenseTable');if(table)table.innerHTML='<div class="tr"><div>資料尚未就緒</div></div>';
}
function renderPayrollPage(model){
  if(!model)return;
  const currentRevision=model.sourceRevision;
  const sourceNote=document.getElementById('payrollCommonSourceNote'),list=document.getElementById('payrollTrialStaffList');
  const input=document.getElementById('payrollTrialMonth');if(input&&document.activeElement!==input)input.value=model.month||payrollTrialMonth();
  safeSetText('payrollMonthTitle',`${payrollMonthDisplay(model.month)}薪資`);
  renderPayrollRecoveryPanel(model);
  if(model.source==='loading'){
    if(sourceNote)sourceNote.textContent=`正在讀取${payrollCloudEnvironmentName()}雲端權威資料，本機草稿不會覆蓋目前畫面。`;
    clearPayrollPageValues('正在讀取雲端薪資損益…');
    payrollAuthorityOverviewStatus(`正在讀取${payrollCloudEnvironmentName()}雲端權威薪資損益…`);renderPayrollControls(model);return;
  }
  if(model.source==='conflict'){
    if(sourceNote)sourceNote.textContent='本機支出與雲端權威資料不一致；系統已 fail-closed，兩邊資料都不會被覆蓋。';
    clearPayrollPageValues('偵測到支出來源不一致，請先檢視本機支出 recovery。');
    payrollAuthorityOverviewStatus('支出來源不一致：所有薪資／支出寫入、月結前確認與完成月結均已鎖定。','error');renderPayrollControls(model);return;
  }
  if(model.source==='error'||model.consistency?.valid!==true){
    if(sourceNote)sourceNote.textContent=model.error?.message||'薪資損益資料驗證失敗。';
    clearPayrollPageValues(model.error?.message||'薪資損益資料驗證失敗。');
    payrollAuthorityOverviewStatus((model.error?.details||[]).join('；')||'雲端薪資明細與摘要不一致，請重新查詢。','error');renderPayrollControls(model);return;
  }
  const caps=payrollRoleCapabilities(model),totals=model.totals||{},rate=Number(totals.managementShareRate||0),disabled=caps.canEditDraft?'':' disabled aria-disabled="true"';
  if(sourceNote)sourceNote.textContent=model.source==='local-review'?'目前為本機支出 Recovery 唯讀檢視；確認前不會修改任何資料。':model.source==='draft'?'目前有尚未儲存的薪資調整。':(caps.boss?'本月薪資資料已載入；BOSS 完全唯讀。':'本月薪資資料已載入；修改後請先儲存薪資調整。');
  const rateInput=document.getElementById('jeanManagementShareRate');if(rateInput){rateInput.value=(rate*100).toFixed(1).replace(/\.0$/,'');rateInput.disabled=!caps.canEditDraft;}
  safeSetText('payrollTrialEmployeeCount',String(model.employees.length));safeSetText('payrollTrialCommissionTotal',money(totals.commissionTotal));safeSetText('payrollTrialSalaryTotal',money(totals.staffSalaryCost));safeSetText('payrollManagementShareTotal',money(totals.managementShare));
  const rows=model.employees.map(row=>{const isJean=String(row.staffName||row.staffId).trim().toUpperCase()==='JEAN';return `<div class="payroll-trial-card" data-staff-id="${escapeHtml(row.staffId)}"><div class="row payroll-trial-heading"><div><strong>${escapeHtml(row.staffName)}</strong></div><div class="pill">${escapeHtml(model.month)}</div></div><div class="payroll-trial-stats"><div><span>本月營收／業績顯示</span><strong>${money(row.performanceTotal)}</strong><small>${row.orderCount} 筆；集點卡 $0 不灌入營收</small></div><div><span>責任額／達成率</span><strong>${money(row.responsibilityTarget)}／${Number(row.achievementRate||0).toFixed(Number(row.achievementRate||0)%1===0?0:1)}%</strong><small>只顯示，不影響薪資</small></div><div><span>commission 薪資</span><strong>${money(row.commissionTotal)}</strong><small>直接加總訂單快照</small></div><div><span>保障／應領薪資</span><strong>${money(row.guaranteeSalary)}／${money(row.baseSalary)}</strong><small>max(保障薪資, commission)</small></div></div><div class="payroll-trial-inputs"><label>借支<input class="input payrollTrialInput" type="number" min="0" step="1" data-field="advance" value="${row.advance}"${disabled}></label><label>材料代墊<input class="input payrollTrialInput" type="number" min="0" step="1" data-field="materialAdvance" value="${row.materialAdvance}"${disabled}></label><label>保險自付額<input class="input payrollTrialInput" type="number" min="0" step="1" data-field="insurance" value="${row.insuranceSelf}"${disabled}></label><label>年終獎金<input class="input payrollTrialInput" type="number" min="0" step="1" data-field="annualBonus" value="${row.annualBonus}"${disabled}></label></div><div class="payroll-trial-result"><span>試算實發薪資</span><strong>${money(row.actualSalary)}</strong></div>${isJean?`<div class="payroll-trial-result"><span>JEAN 管理分潤（${(rate*100).toFixed(1).replace(/\.0$/,'')}%）</span><strong>${money(row.managementShare)}</strong></div><div class="payroll-trial-result"><span>本月總領</span><strong>${money(row.monthlyTotal)}</strong></div><div class="note">管理分潤不混入 commission、保障薪資、應領薪資或試算實發薪資。</div>`:''}</div>`;}).join('');
  if(OBA_PAYROLL.pageModel?.sourceRevision!==currentRevision)return;
  if(list)list.innerHTML=rows||'<div class="note">本月沒有員工薪資資料。</div>';
  safeSetText('profitMonthSales',money(totals.grossSales));safeSetText('profitMonthRefund',money(totals.refunds));safeSetText('profitMonthExpense',money(totals.generalExpenses));safeSetText('profitMonthCompanyInsurance',money(totals.companyInsurance));safeSetText('profitMonthSalary',money(totals.staffSalaryCost));safeSetText('profitBeforeManagementShare',money(totals.profitBeforeManagementShare));safeSetText('profitMonthManagementBonusLabel',`JEAN 管理分潤（${(rate*100).toFixed(1).replace(/\.0$/,'')}%）`);safeSetText('profitMonthManagementBonus',money(totals.managementShare));safeSetText('profitMonthAfterSalary',money(totals.finalProfit));
  safeSetText('expenseMonthTotal',money(model.expenseSummary.monthTotal));safeSetText('expenseMonthCount',String(model.expenseSummary.monthCount));
  const expenseTable=document.getElementById('expenseTable');if(expenseTable)expenseTable.innerHTML=model.expenses.length?model.expenses.map(row=>`<div class="tr"><div>${escapeHtml(row.expenseDate)}</div><div>${escapeHtml(row.category)}</div><div>${money(row.amount)}</div><div>${escapeHtml(row.note||'-')}</div><div>${caps.canEditDraft?`<button class="btn btn-soft btnEditExpense" data-id="${escapeHtml(row.expenseId)}" type="button">編輯</button> <button class="btn btn-danger btnDeleteExpense" data-id="${escapeHtml(row.expenseId)}" type="button">刪除</button>`:'唯讀'}</div></div>`).join(''):'<div class="tr"><div>本月沒有有效支出明細</div></div>';
  payrollAuthorityOverviewStatus(model.source==='local-review'?'本機支出 recovery 唯讀檢視；確認前不會修改任何資料。':model.source==='draft'?'目前為尚未儲存的本機薪資試算，不是雲端權威資料':`雲端權威薪資損益已更新（${caps.boss?'BOSS 唯讀':'總控'}）`,['draft','local-review'].includes(model.source)?'dirty':'saved');
  model.renderedAt=new Date().toISOString();renderPayrollControls(model);
}
function payrollPayloadFromModel(model){
  const month=payrollTrialMonth(model?.month),employeeInputs=(model?.employees||[]).map(row=>({month,staffId:String(row.staffId||''),advance:payrollModelNumber(row.advance),materialAdvance:payrollModelNumber(row.materialAdvance),insurance:payrollModelNumber(row.insuranceSelf),annualBonus:payrollModelNumber(row.annualBonus)})),monthSettings=[{month,managementShareRate:Number(model?.totals?.managementShareRate||0)}];
  return {month,categories:[],expenses:[],employeeInputs,monthSettings};
}
function payrollLocalPayload(monthValue=payrollCurrentMonth()){
  if(monthValue&&typeof monthValue==='object')return payrollPayloadFromModel(monthValue);
  const month=payrollTrialMonth(monthValue);
  const inputs=loadPayrollTrialInputs(), rates=loadJeanManagementShareRates();
  const employeeInputs=[]; Object.keys(inputs[month]||{}).sort().forEach(staffId=>employeeInputs.push({month,staffId,...inputs[month][staffId]}));
  const monthSettings=Object.prototype.hasOwnProperty.call(rates,month)?[{month,managementShareRate:Number(rates[month])||0}]:[];
  return {month,categories:[],expenses:[],employeeInputs,monthSettings};
}
function payrollPayloadText(){return JSON.stringify(payrollLocalPayload());}
function payrollActionValid(){return !!(OBA_PAYROLL.action?.token&&Date.parse(OBA_PAYROLL.action.expiresAt||0)>Date.now()+5000);}
async function authorizePayrollAction(label='正式薪資月結'){
  if(payrollActionValid()) return true;
  const pin=await askMaskedPassword(`${label}：請輸入目前操作者 PIN`,'6 位數 PIN');
  if(pin===null)return false;
  if(!/^\d{6}$/.test(String(pin).trim())){payrollStatus('PIN 必須為 6 位數字','error');return false;}
  const result=await payrollRpc('oba_payroll_authorize_v1',{p_pin:String(pin).trim()});
  if(!result.ok){payrollStatus(payrollFailure(result),'error');return false;}
  OBA_PAYROLL.action={token:String(result.token||''),expiresAt:String(result.expiresAt||''),name:String(result.name||'')};
  payrollStatus(`已授權：${OBA_PAYROLL.action.name||'操作者'}（短期授權只存在本頁記憶體）`,'saved');renderPayrollControls(OBA_PAYROLL.pageModel); return true;
}
async function syncPayrollLocalToCloud(){
  const model=OBA_PAYROLL.pageModel;
  if(OBA_PAYROLL.busy)return false;
  if(model?.draft?.recoveryOnly&&typeof syncExpenseRecoveryToCloud==='function'){
    const expectedRows=Array.isArray(model.draft.recoveryExpenses)?model.draft.recoveryExpenses.map(payrollNormalizeExpense):[];
    const completed=await syncExpenseRecoveryToCloud(model);
    if(!completed)return false;
    const authorityModel=OBA_PAYROLL.pageModel,authorityRows=(authorityModel?.expenses||[]).map(payrollNormalizeExpense);
    const rowTotal=authorityRows.reduce((sum,row)=>sum+payrollModelNumber(row.amount),0),summaryCount=payrollModelNumber(authorityModel?.expenseSummary?.monthCount),summaryTotal=payrollModelNumber(authorityModel?.expenseSummary?.monthTotal);
    const recovered=expectedRows.every(expected=>authorityRows.some(actual=>actual.expenseId===expected.expenseId&&actual.expenseDate===expected.expenseDate&&actual.category===expected.category&&actual.amount===expected.amount&&actual.note===expected.note));
    const verified=authorityModel?.source==='authority'&&authorityModel?.consistency?.valid===true&&recovered&&summaryCount===authorityRows.length&&summaryTotal===rowTotal;
    if(!verified){
      const failed={...model,source:'draft',draft:{...model.draft,recoveryPending:true},conflict:model.conflict,recovery:{confirmed:true,pending:true,domains:['expenses']},error:{message:'支出 Recovery 最終 authority 驗證未通過，系統維持 fail-closed。',details:[]},sourceRevision:(authorityModel?.sourceRevision||model.sourceRevision||0)+1};
      setPayrollPageModel(failed);payrollStatus('支出 Recovery 最終 authority 驗證未通過；未標記完成，請停止操作並重新查核。','error');return false;
    }
    if(typeof mirrorConfirmedExpenseMonth==='function')mirrorConfirmedExpenseMonth(model.month,authorityRows);
    clearPayrollDraftMeta(model.month);OBA_PAYROLL.localDraftDirty=false;renderPayrollPage(OBA_PAYROLL.pageModel);renderPayrollControls(OBA_PAYROLL.pageModel);
    payrollStatus('支出 Recovery 已逐筆儲存並通過完整 authority read-back 驗證。','saved');return true;
  }
  if(payrollMonthClosed(model)){payrollStatus(closedPayrollMessage(),'error');return false;}
  if(model?.source!=='draft'||!OBA_PAYROLL.localDraftDirty){payrollStatus('目前沒有尚未儲存的薪資試算','error');return false;}
  if(model.month!==payrollCurrentMonth()){payrollStatus('試算月份與畫面月份不一致，未執行儲存','error');return false;}
  if(model.consistency?.valid!==true){payrollStatus('薪資試算一致性檢查失敗，禁止儲存','error');return false;}
  const expectedEvidence=payrollSyncEvidence(model);
  const summary=`月份 ${model.month}\n員工輸入 ${(model.employees||[]).length} 人\n支出 ${(model.expenses||[]).length} 筆／${money(model.expenseSummary?.monthTotal)}\n員工實發 ${money(model.totals?.staffSalaryCost)}\n最終淨損益 ${money(model.totals?.finalProfit)}`;
  if(!confirm(`即將儲存以下薪資試算至${payrollCloudEnvironmentName()}雲端：\n${summary}\n\n確定繼續？`))return false;
  if(!(await authorizePayrollAction()))return false;
  const currentModel=OBA_PAYROLL.pageModel;
  if(payrollMonthClosed(currentModel)||currentModel?.source!=='draft'||!OBA_PAYROLL.localDraftDirty||currentModel?.month!==model.month){payrollStatus(payrollMonthClosed(currentModel)?closedPayrollMessage():'薪資試算狀態已改變，未執行儲存','error');return false;}
  OBA_PAYROLL.busy=true; payrollStatus(`正在安全儲存薪資試算至${payrollCloudEnvironmentName()}雲端…`);
  const payload=payrollLocalPayload(model);
  const result=await payrollRpc('oba_payroll_import_local_v1',{p_payload:payload,p_action_token:OBA_PAYROLL.action.token});
  OBA_PAYROLL.busy=false;
  if(!result.ok){payrollStatus(payrollFailure(result),'error');return false;}
  OBA_PAYROLL.lastPayload=JSON.stringify(payload); OBA_PAYROLL.preview=null;
  try{localStorage.setItem(OBA_PAYROLL_LOCAL_MIGRATION_KEY,JSON.stringify({completedAt:new Date().toISOString(),expenseCount:Number(result.expenseCount||0),employeeInputCount:Number(result.employeeInputCount||0)}));}catch(_error){}
  payrollStatus(`薪資試算已儲存：支出 ${result.expenseCount||0} 筆、員工輸入 ${result.employeeInputCount||0} 筆`,'saved');
  if(isPayrollAuthorityViewer()){
    const confirmed=await loadPayrollAuthorityOverview();
    if(!confirmed){OBA_PAYROLL.localDraftDirty=true;payrollStatus('儲存要求已送出，但尚未確認雲端權威結果；禁止月結前確認與完成月結','error');return false;}
    if(OBA_PAYROLL.pageModel?.source!=='authority'||payrollSyncEvidence(OBA_PAYROLL.pageModel)!==expectedEvidence){
      OBA_PAYROLL.localDraftDirty=true;
      const failed={...OBA_PAYROLL.pageModel,source:'error',consistency:{valid:false,errors:['儲存後查回的雲端人工薪資／支出／分潤資料與本機試算不一致']},error:{message:'儲存後的雲端權威資料與本機薪資試算不一致，禁止月結前確認與完成月結。',details:['請重新查詢並核對資料，不要重複儲存。']},sourceRevision:(OBA_PAYROLL.pageModel?.sourceRevision||0)+1};
      setPayrollPageModel(failed);payrollStatus('儲存要求已送出，但雲端查回驗證不一致；禁止月結前確認與完成月結','error');return false;
    }
    payrollStatus(`薪資試算已儲存並確認雲端權威資料：支出 ${result.expenseCount||0} 筆、員工輸入 ${result.employeeInputCount||0} 筆`,'saved');
  }else{
    OBA_PAYROLL.localDraftDirty=false;
    payrollStatus(`薪資試算已儲存：支出 ${result.expenseCount||0} 筆、員工輸入 ${result.employeeInputCount||0} 筆；請再進行月結前確認`,'saved');
  }
  return true;
}
function renderFormalPreview(preview){
  const el=document.getElementById('payrollFormalPreview'); if(!el)return;
  if(!preview){el.innerHTML='<div class="note">尚未進行月結前確認。</div>';return;}
  const staff=(preview.employees||[]).map(x=>`<div class="row"><span>${escapeHtml(x.staffName||x.staffId)}</span><span>業績 ${money(x.performanceTotal)}／commission ${money(x.commissionTotal)}／實發 ${money(x.actualSalary)}</span></div>`).join('');
  el.innerHTML=`<div class="stats"><div class="stat"><div class="k">營業額／退款</div><div class="v">${money(preview.grossSales)}／${money(preview.refunds)}</div></div><div class="stat"><div class="k">薪資成本</div><div class="v">${money(preview.staffSalaryCost)}</div></div><div class="stat"><div class="k">最終淨損益</div><div class="v">${money(preview.finalProfit)}</div></div></div><div class="space"></div>${staff}`;
}
async function previewFormalPayroll(){
  if(OBA_PAYROLL.busy)return;
  const model=OBA_PAYROLL.pageModel,staff=window.OBA_ACCESS_SESSION?.kind==='staff';
  const currentFingerprint=model?.authority?.fingerprint||(!OBA_PAYROLL.localDraftDirty?payrollPayloadText():'');
  if(!OBA_PAYROLL.uiCheckContext||OBA_PAYROLL.uiCheckContext.month!==model?.month||OBA_PAYROLL.uiCheckContext.fingerprint!==currentFingerprint){payrollStatus('請先完成「① 檢查本月薪資資料」','error');return;}
  if(OBA_PAYROLL.localDraftDirty||model?.source==='draft'&&OBA_PAYROLL.lastPayload!==payrollPayloadText()){
    payrollStatus('目前有尚未儲存的本機薪資試算，請先完成「儲存薪資試算」並確認雲端權威資料後，再進行月結前確認。','error');return;
  }
  if(!staff&&(model?.source!=='authority'||model?.consistency?.valid!==true||model.month!==payrollCurrentMonth())){payrollStatus('目前不是已確認的一致雲端權威資料，禁止月結前確認','error');return;}
  if(staff&&OBA_PAYROLL.lastPayload!==payrollPayloadText()){payrollStatus('本機薪資試算尚未儲存，請先按「儲存薪資試算」後再進行月結前確認','error');return;}
  if(!(await authorizePayrollAction()))return;
  OBA_PAYROLL.busy=true; payrollStatus(`正在由${payrollCloudEnvironmentName()}雲端重新計算月結前確認資料…`);
  const result=await payrollRpc('oba_payroll_preview_v1',{p_month:payrollCurrentMonth(),p_action_token:OBA_PAYROLL.action.token}); OBA_PAYROLL.busy=false;
  if(!result.ok){payrollStatus(payrollFailure(result),'error');return;}
  const currentModel=OBA_PAYROLL.pageModel;
  if(!staff&&(currentModel?.source!=='authority'||currentModel.month!==model.month||currentModel.authority?.fingerprint!==model.authority?.fingerprint||currentModel.consistency?.valid!==true||OBA_PAYROLL.localDraftDirty)){
    payrollStatus('月結前確認期間權威資料狀態已改變，結果未採用；請重新查詢及確認','error');return;
  }
  OBA_PAYROLL.preview=result.preview;OBA_PAYROLL.previewContext={month:payrollCurrentMonth(),previewHash:String(result.preview?.previewHash||''),authorityFingerprint:model?.authority?.fingerprint||payrollPayloadText(),createdAt:new Date().toISOString()};renderFormalPreview(result.preview);renderPayrollControls(model);payrollStatus('② 月結內容已確認；資料若改變，系統會要求重新檢查。','saved');
}
async function closeFormalPayroll(){
  if(OBA_PAYROLL.busy)return;
  const model=OBA_PAYROLL.pageModel,staff=window.OBA_ACCESS_SESSION?.kind==='staff';
  if(OBA_PAYROLL.localDraftDirty||!model||(!staff&&(model.source!=='authority'||model.consistency?.valid!==true||model.month!==payrollCurrentMonth()||model.period?.status==='closed'))){payrollStatus('目前不是可月結的雲端權威狀態','error');return;}
  if(!OBA_PAYROLL.preview||OBA_PAYROLL.preview.month!==payrollCurrentMonth()){payrollStatus('請先進行目前月份的月結前確認','error');return;}
  const expectedFingerprint=model?.authority?.fingerprint||payrollPayloadText();
  if(!OBA_PAYROLL.previewContext||OBA_PAYROLL.previewContext.month!==payrollCurrentMonth()||OBA_PAYROLL.previewContext.authorityFingerprint!==expectedFingerprint){payrollStatus('月結前確認已不對應目前權威資料，請重新確認','error');return;}
  if(!staff&&model.authority?.previewHash&&String(OBA_PAYROLL.preview.previewHash||'')!==String(model.authority.previewHash)){payrollStatus('月結前確認資料與目前雲端權威資料不一致，請重新查詢及確認','error');return;}
  if(staff&&OBA_PAYROLL.lastPayload!==payrollPayloadText()){payrollStatus('本機薪資試算已改變，請重新儲存並進行月結前確認','error');return;}
  if(!confirm(`確定完成 ${payrollCurrentMonth()} 月結？本次會建立不可覆蓋的月結版本。`))return;
  const reason=String(document.getElementById('payrollSettlementReason')?.value||'首次月結').trim();
  OBA_PAYROLL.busy=true; payrollStatus('正在完成本月月結…');
  const result=await payrollRpc('oba_payroll_close_v1',{p_month:payrollCurrentMonth(),p_preview_hash:OBA_PAYROLL.preview.previewHash,p_request_id:(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`),p_reason:reason,p_action_token:OBA_PAYROLL.action.token}); OBA_PAYROLL.busy=false;
  if(!result.ok){payrollStatus(payrollFailure(result),'error');if(result.reason==='preview_changed'){OBA_PAYROLL.preview=result.preview||null;renderFormalPreview(OBA_PAYROLL.preview);}return;}
  OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;OBA_PAYROLL.uiCheckContext=null;await loadPayrollHistory();if(isPayrollAuthorityViewer())await loadPayrollAuthorityOverview();payrollStatus(`✓ ${payrollMonthDisplay(model.month)}已完成月結`,'saved');renderPayrollControls(OBA_PAYROLL.pageModel);
}
async function reopenFormalPayroll(){
  const model=OBA_PAYROLL.pageModel,staff=window.OBA_ACCESS_SESSION?.kind==='staff';
  if(OBA_PAYROLL.busy)return;
  const ownerRecovery=window.OBA_ACCESS_SESSION?.kind==='owner-control'&&['conflict','local-review'].includes(model?.source||'')&&model?.consistency?.valid===true&&model?.period?.status==='closed';
  if(OBA_PAYROLL.localDraftDirty||!staff&&!ownerRecovery&&(model?.source!=='authority'||model?.consistency?.valid!==true||model?.period?.status!=='closed')){payrollStatus('目前月份不是可安全解鎖的已結算權威狀態','error');return;}
  if(!(await authorizePayrollAction()))return;
  const reason=String(document.getElementById('payrollSettlementReason')?.value||'').trim();
  if(reason.length<3){payrollStatus('重新開放原因至少輸入 3 個字','error');return;}
  if(!confirm(`確定重新開放 ${payrollCurrentMonth()} 修改？既有月結版本將永久保留。`))return;
  OBA_PAYROLL.busy=true; const result=await payrollRpc('oba_payroll_reopen_v1',{p_month:payrollCurrentMonth(),p_reason:reason,p_action_token:OBA_PAYROLL.action.token}); OBA_PAYROLL.busy=false;
  if(!result.ok){payrollStatus(payrollFailure(result),'error');return;} payrollStatus(`已重新開放修改；目前保留月結版本 ${result.currentRevision}`,'saved');OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;await loadPayrollHistory();if(isPayrollAuthorityViewer())await loadPayrollAuthorityOverview();
}
function renderPayrollHistory(result,targetId='payrollFormalHistory'){
  const el=document.getElementById(targetId); if(!el)return;
  const period=result?.period||null, rows=result?.revisions||[];
  const stateText=String(period?.status||'')==='closed'?'已完成月結':'可編輯';
  el.innerHTML=`<div class="note">本月狀態：${stateText}</div>`+rows.map((r,index)=>`<details><summary>第 ${index+1} 次月結｜${escapeHtml(r.settled_at||'')}｜淨損益 ${money(r.final_profit)}</summary><div class="note">結算人：${escapeHtml(r.settled_by_name||r.settled_by_id||'')}｜營業額 ${money(r.gross_sales)}｜退款 ${money(r.refunds)}｜支出 ${money(Number(r.general_expenses||0)+Number(r.company_insurance||0))}｜薪資 ${money(r.staff_salary_cost)}｜管理分潤 ${money(r.jean_management_share)}</div>${(r.employees||[]).map(e=>`<div class="row"><span>${escapeHtml(e.staff_name)}</span><span>實發 ${money(e.actual_salary)}／總領 ${money(e.monthly_total)}</span></div>`).join('')}</details>`).join('');
}
function payrollAuthorityOverviewStatus(text,mode=''){
  const el=document.getElementById('payrollAuthorityStatus');if(!el)return;
  el.textContent=String(text||'');el.className='save-status '+(mode||'');
}
function renderPayrollAuthorityOverview(result){
  const revision=(OBA_PAYROLL.pageModel?.sourceRevision||0)+1;
  if(!result?.ok||result?.readOnly!==true){
    return setPayrollPageModel({source:'error',month:payrollCurrentMonth(),employees:[],totals:{},expenses:[],expenseSummary:{todayTotal:0,monthTotal:0,monthCount:0},period:{status:'not_created',currentRevision:0},authority:null,draft:null,consistency:{valid:false,errors:['尚未取得完整薪資損益資料']},error:{message:'尚未取得完整薪資損益資料。',details:[]},renderedAt:'',sourceRevision:revision});
  }
  const authorityModel=buildAuthorityPayrollPageModel(result,revision);
  if(authorityModel.source!=='authority')return setPayrollPageModel(authorityModel);
  const conflict=payrollExpenseConflict(authorityModel);
  if(conflict){
    if(!conflict.differingIds.length&&conflict.localOnly.length&&conflict.authorityOnly.length&&payrollExpenseRowsSameContent(conflict.localOnly,conflict.authorityOnly)&&typeof mirrorConfirmedExpenseMonth==='function'){
      mirrorConfirmedExpenseMonth(authorityModel.month,authorityModel.expenses);
      OBA_PAYROLL.recoveryCandidate=null;OBA_PAYROLL.localDraftDirty=false;clearPayrollDraftMeta(authorityModel.month);
      return setPayrollPageModel(authorityModel);
    }
    if(!conflict.localOnly.length&&!conflict.differingIds.length&&conflict.authorityOnly.length&&typeof mirrorConfirmedExpenseMonth==='function'){
      mirrorConfirmedExpenseMonth(authorityModel.month,authorityModel.expenses);
      OBA_PAYROLL.recoveryCandidate=null;OBA_PAYROLL.localDraftDirty=false;clearPayrollDraftMeta(authorityModel.month);
      return setPayrollPageModel(authorityModel);
    }
    OBA_PAYROLL.recoveryCandidate=conflict;
    return setPayrollPageModel({...authorityModel,source:'conflict',conflict,recovery:null,sourceRevision:revision+1});
  }
  OBA_PAYROLL.recoveryCandidate=null;OBA_PAYROLL.localDraftDirty=false;clearPayrollDraftMeta(authorityModel.month);
  return setPayrollPageModel(authorityModel);
}
function settlePayrollAuthorityLoadError(month,message,details=[]){
  const revision=(OBA_PAYROLL.pageModel?.sourceRevision||0)+1;
  return setPayrollPageModel({source:'error',month,employees:[],totals:{},expenses:[],expenseSummary:{todayTotal:0,monthTotal:0,monthCount:0},todaySummary:{sales:0,refunds:0,expenses:0,salary:0,netBeforeSalary:0,netAfterSalary:0},period:OBA_PAYROLL.pageModel?.period||{status:'not_created',currentRevision:0},authority:null,draft:null,conflict:null,recovery:null,consistency:{valid:false,errors:[message]},error:{message,details:Array.isArray(details)?details:[]},renderedAt:'',sourceRevision:revision});
}
function payrollAuthorityLoadReusable(load,month){
  return !!(load&&load.month===month&&load.promise&&!load.settled&&!load.aborted&&!load.timedOut&&load.requestSeq===OBA_PAYROLL.requestSeq&&Date.now()<load.deadlineAt);
}
function abortPayrollAuthorityLoad(load,reason='superseded'){
  if(!load||load.settled||load.aborted)return false;
  load.aborted=true;load.abortReason=reason;
  try{load.controller?.abort(reason);}catch(_error){}
  return true;
}
async function loadPayrollAuthorityOverview(options={}){
  const session=window.OBA_ACCESS_SESSION;
  const boss=session?.kind==='boss'&&typeof isBossMode==='function'&&isBossMode();
  const owner=session?.kind==='owner-control'&&typeof isPageTabAuthorized==='function'&&isPageTabAuthorized('expense');
  const input=document.getElementById('payrollTrialMonth');
  const month=payrollTrialMonth(input?.value);if(input)input.value=month;
  if(!boss&&!owner){
    renderPayrollAuthorityOverview(null);
    payrollAuthorityOverviewStatus('目前身分沒有共同權威薪資損益查詢權限。','error');
    return false;
  }
  const activeLoad=OBA_PAYROLL.authorityLoad;
  if(payrollAuthorityLoadReusable(activeLoad,month))return activeLoad.promise;
  if(activeLoad&&!activeLoad.settled)abortPayrollAuthorityLoad(activeLoad,'replaced');
  const requestSeq=++OBA_PAYROLL.requestSeq;
  const requestId=++OBA_PAYROLL.authorityRequestSerial;
  if(!options.background)beginPayrollAuthorityLoad(month);
  payrollAuthorityOverviewStatus(options.background?`正在背景確認${payrollCloudEnvironmentName()}雲端權威薪資損益…`:`正在讀取${payrollCloudEnvironmentName()}雲端權威薪資損益…`);
  const controller=typeof AbortController==='function'?new AbortController():null;
  const load={month,requestSeq,requestId,controller,promise:null,startedAt:Date.now(),deadlineAt:Date.now()+PAYROLL_AUTHORITY_LOAD_TIMEOUT_MS,settled:false,aborted:false,timedOut:false,abortReason:'',timeoutId:null};
  load.promise=(async()=>{
    try{
      const timeoutPromise=new Promise((_resolve,reject)=>{
        load.timeoutId=setTimeout(()=>{
          load.timedOut=true;load.aborted=true;load.abortReason='timeout';
          const error=new Error(`authority_timeout_${PAYROLL_AUTHORITY_LOAD_TIMEOUT_MS}ms`);error.name='PayrollAuthorityTimeoutError';reject(error);
          try{controller?.abort('timeout');}catch(_error){}
        },PAYROLL_AUTHORITY_LOAD_TIMEOUT_MS);
      });
      const result=await Promise.race([payrollRpc('oba_payroll_overview_readonly_v1',{p_month:month},{signal:controller?.signal}),timeoutPromise]);
      if(requestSeq!==OBA_PAYROLL.requestSeq||month!==payrollCurrentMonth()){
        if(OBA_PAYROLL.authorityLoad===load&&OBA_PAYROLL.pageModel?.source==='loading'&&OBA_PAYROLL.pageModel?.month===month){
          settlePayrollAuthorityLoadError(month,'雲端權威資料載入狀態已改變，請重新進入損益頁。',['已安全捨棄過期的查詢結果。']);
          payrollAuthorityOverviewStatus('雲端權威資料載入狀態已改變，未顯示過期資料。','error');
        }
        return false;
      }
      if(!result.ok||result.readOnly!==true){
        settlePayrollAuthorityLoadError(month,payrollFailure(result),[result?.code||'',result?.message||''].filter(Boolean));
        payrollAuthorityOverviewStatus(payrollFailure(result),'error');
        return false;
      }
      const model=renderPayrollAuthorityOverview(result);
      if(model?.source==='conflict'){
        payrollAuthorityOverviewStatus('偵測到本機與雲端支出不一致；未修改任何資料，請先檢視本機支出 recovery。','error');return false;
      }
      if(model?.source!=='authority')return false;
      OBA_PAYROLL.localDraftDirty=false;
      payrollAuthorityOverviewStatus(`雲端權威薪資損益已更新（${boss?'BOSS 唯讀':'總控'}）`,'saved');
      return true;
    }catch(error){
      if(OBA_PAYROLL.authorityLoad===load){
        const timedOut=load.timedOut||error?.name==='PayrollAuthorityTimeoutError';
        const message=timedOut?'雲端權威薪資損益讀取逾時，已安全停止；請按重新整理再試。':'雲端權威薪資損益載入失敗，已安全停止顯示；請按重新整理再試。';
        settlePayrollAuthorityLoadError(month,message,[error?.message||String(error)]);
        payrollAuthorityOverviewStatus(message,'error');
      }
      return false;
    }finally{
      if(load.timeoutId){clearTimeout(load.timeoutId);load.timeoutId=null;}
      load.settled=true;
      if(OBA_PAYROLL.authorityLoad===load)OBA_PAYROLL.authorityLoad=null;
    }
  })();
  OBA_PAYROLL.authorityLoad=load;
  return load.promise;
}
function loadBossPayrollOverview(){return loadPayrollAuthorityOverview();}
function loadOwnerPayrollOverview(){return loadPayrollAuthorityOverview();}
async function checkPayrollMonthData(){
  if(OBA_PAYROLL.busy)return false;
  OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;OBA_PAYROLL.uiCheckContext=null;renderFormalPreview(null);renderPayrollControls(OBA_PAYROLL.pageModel);
  let ready=false;
  if(isPayrollAuthorityViewer())ready=await loadPayrollAuthorityOverview();
  else ready=payrollRoleCapabilities(OBA_PAYROLL.pageModel).staffSynced;
  const model=OBA_PAYROLL.pageModel,fingerprint=model?.authority?.fingerprint||(!OBA_PAYROLL.localDraftDirty?payrollPayloadText():'');
  if(!ready||!fingerprint||model?.consistency?.valid!==true){payrollStatus('① 本月薪資資料檢查未通過；系統保持鎖定。','error');renderPayrollControls(model);return false;}
  OBA_PAYROLL.uiCheckContext={month:model.month,fingerprint,checkedAt:new Date().toISOString()};
  payrollStatus('① 本月薪資資料檢查完成。','saved');renderPayrollControls(model);return true;
}
function handlePayrollMonthChange(input){
  const previous=String(OBA_PAYROLL.pageModel?.month||'');
  const month=payrollTrialMonth(input?.value);
  if(OBA_PAYROLL.localDraftDirty&&previous&&month!==previous){
    if(input)input.value=previous;
    payrollStatus('目前月份有尚未儲存的薪資試算；請先儲存或保留在原月份。','error');
    return false;
  }
  if(input)input.value=month;
  OBA_PAYROLL.preview=null;OBA_PAYROLL.previewContext=null;OBA_PAYROLL.uiCheckContext=null;renderFormalPreview(null);renderPayrollHistory(null);
  if(isPayrollAuthorityViewer()){
    loadPayrollAuthorityOverview();
  }else{
    OBA_PAYROLL.localDraftDirty=false;
    setPayrollPageModel(buildDraftPayrollPageModel(month,(OBA_PAYROLL.pageModel?.sourceRevision||0)+1));
  }
  return true;
}
async function refreshPayrollPageAfterStatePull(){
  const expenseTab=document.getElementById('tab-expense');
  if(!expenseTab||expenseTab.classList.contains('hidden')||OBA_PAYROLL.busy)return false;
  const model=OBA_PAYROLL.pageModel;
  if(model?.source==='authority'){
    if(OBA_PAYROLL.backgroundRefreshPending)return false;
    OBA_PAYROLL.backgroundRefreshPending=true;
    try{return await loadPayrollAuthorityOverview({background:true});}
    finally{OBA_PAYROLL.backgroundRefreshPending=false;}
  }
  if(model?.source==='draft'){
    if(model?.draft?.recoveryOnly===true){
      if(OBA_PAYROLL.busy){renderPayrollPage(model);return true;}
      if(isPayrollAuthorityViewer())return await loadPayrollAuthorityOverview();
    }
    setPayrollPageModel(buildDraftPayrollPageModel(model.month,(model.sourceRevision||0)+1));
    return true;
  }
  // loading/conflict/local-review/error do not fall back to or overwrite either source.
  return false;
}
async function loadPayrollHistory(){
  let token='';
  const sessionKind=window.OBA_ACCESS_SESSION?.kind||'';
  const boss=sessionKind==='boss'&&typeof isBossMode==='function'&&isBossMode();
  const sharedViewer=boss||sessionKind==='owner-control';
  if(!boss){if(!(await authorizePayrollAction()))return;token=OBA_PAYROLL.action.token;}
  const sharedMonth=document.getElementById('payrollTrialMonth');
  const month=payrollTrialMonth(sharedMonth?.value);
  if(sharedMonth)sharedMonth.value=month;
  const targetId='payrollFormalHistory';
  if(sharedViewer)payrollAuthorityOverviewStatus('正在讀取月結紀錄…');else payrollStatus('正在讀取月結紀錄…');
  const result=await payrollRpc('oba_payroll_history_v1',{p_month:month,p_action_token:token});
  if(!result.ok){
    if(sharedViewer)payrollAuthorityOverviewStatus(payrollFailure(result),'error');else payrollStatus(payrollFailure(result),'error');
    return;
  }
  OBA_PAYROLL.history=result;renderPayrollHistory(result,targetId);
  if(sharedViewer)payrollAuthorityOverviewStatus('雲端權威資料與月結紀錄已更新','saved');else payrollStatus('月結紀錄已更新','saved');
}
function bindFormalPayroll(){
  [['btnPayrollCloudSync',syncPayrollLocalToCloud],['btnPayrollFormalPreview',previewFormalPayroll],['btnPayrollFormalClose',closeFormalPayroll],['btnPayrollFormalReopen',reopenFormalPayroll],['btnPayrollHistory',loadPayrollHistory]].forEach(([id,fn])=>{const el=document.getElementById(id);if(el&&!el.dataset.bound){el.dataset.bound='yes';el.addEventListener('click',fn);}});
  const month=document.getElementById('payrollTrialMonth');if(month&&!month.dataset.formalBound){month.dataset.formalBound='yes';month.addEventListener('change',()=>handlePayrollMonthChange(month));}
  const authorityRefresh=document.getElementById('btnPayrollAuthorityRefresh');if(authorityRefresh&&!authorityRefresh.dataset.bound){authorityRefresh.dataset.bound='yes';authorityRefresh.addEventListener('click',checkPayrollMonthData);}
  const authorityHistory=document.getElementById('btnPayrollAuthorityHistory');if(authorityHistory&&!authorityHistory.dataset.bound){authorityHistory.dataset.bound='yes';authorityHistory.addEventListener('click',loadPayrollHistory);}
  const reviewRecovery=document.getElementById('btnPayrollReviewLocalExpenses');if(reviewRecovery&&!reviewRecovery.dataset.bound){reviewRecovery.dataset.bound='yes';reviewRecovery.addEventListener('click',reviewPayrollLocalExpenseRecovery);}
  const confirmRecovery=document.getElementById('btnPayrollConfirmExpenseRecovery');if(confirmRecovery&&!confirmRecovery.dataset.bound){confirmRecovery.dataset.bound='yes';confirmRecovery.addEventListener('click',confirmPayrollExpenseRecovery);}
}
window.addEventListener('beforeunload',()=>{OBA_PAYROLL.action=null;});
window.addEventListener('oba:tabchange',event=>{
  if(event.detail?.name!=='expense')OBA_PAYROLL.action=null;
  if(event.detail?.name==='expense'&&['boss','owner-control'].includes(window.OBA_ACCESS_SESSION?.kind)){
    if(OBA_PAYROLL.pageModel?.source==='draft'&&OBA_PAYROLL.pageModel?.draft?.recoveryOnly===true&&OBA_PAYROLL.busy){
      renderPayrollPage(OBA_PAYROLL.pageModel);
      return;
    }
    void loadPayrollAuthorityOverview();
  }
});
bindFormalPayroll();

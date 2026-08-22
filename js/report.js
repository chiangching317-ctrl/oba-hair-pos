function reportFilterValues(){
  const startDateEl=$('#reportStartDate'), endDateEl=$('#reportEndDate'), startEl=$('#reportStartTime'), endEl=$('#reportEndTime'), staffEl=$('#reportStaff');
  if(startDateEl && !startDateEl.value) startDateEl.value=todayStr();
  if(endDateEl && !endDateEl.value) endDateEl.value=startDateEl?.value||todayStr();
  let startDate=startDateEl?.value||todayStr();
  let endDate=endDateEl?.value||startDate;
  if(endDate<startDate){ const tmp=startDate; startDate=endDate; endDate=tmp; }
  return {startDate,endDate,start:startEl?.value||'',end:endEl?.value||'',staffId:staffEl?.value||'JEAN'};
}

function timeStampOfOrder(o){
  return String(o?.createdAt || ((o?.date||'') + 'T' + (o?.time||'00:00') + ':00'));
}
function isAfterStamp(value, stamp){
  if(!stamp) return true;
  if(!value) return false;
  return String(value) > String(stamp);
}
function salaryBaseOrders(){
  // 本月/個人薪資統計要同時避開：測試清空前舊單、正式薪資結算前舊單。
  const resetAt = newestStamp(newestStamp(state.lastResetAt, getLocalResetMarker()), state.salaryResetAt);
  return (state.orders || []).filter(o=>!o.refunded && isAfterStamp(timeStampOfOrder(o), resetAt));
}
function activeReportOrders(){
  // 測試清空後如果雲端舊 duplicated main row 又回來，舊單不再列入目前報表/業績。
  const testResetAt = Object.prototype.hasOwnProperty.call(window,'OBA_DEV_CLOUD_LAST_RESET_AT')
    ? String(window.OBA_DEV_CLOUD_LAST_RESET_AT||'')
    : String(state.lastResetAt||'');
  return (state.orders || []).filter(o=>!testResetAt || isAfterStamp(timeStampOfOrder(o), testResetAt));
}
function activeReportRefunds(){
  const testResetAt = Object.prototype.hasOwnProperty.call(window,'OBA_DEV_CLOUD_LAST_RESET_AT')
    ? String(window.OBA_DEV_CLOUD_LAST_RESET_AT||'')
    : String(state.lastResetAt||'');
  return (state.refunds || []).filter(r=>!testResetAt || isAfterStamp(timeStampOfOrder(r), testResetAt));
}
function isTimeInRange(time,start,end){
  const t=String(time||'00:00').slice(0,5);
  if(start && t<start) return false;

  if(end && t>end) return false;
  return true;
}
function isDateTimeInReportRange(rowDate,rowTime,f){
  const d=String(rowDate||'');
  if(!d || d<f.startDate || d>f.endDate) return false;
  const t=String(rowTime||'00:00').slice(0,5);
  if(f.start && d===f.startDate && t<f.start) return false;
  if(f.end && d===f.endDate && t>f.end) return false;
  return true;
}

function safeSetText(id, value){
  const el=document.getElementById(id);
  if(el) el.textContent=value;
}

function redemptionSourceValue(order){
  if(!order || order.paymentMethod!=='集點卡兌換') return 0;
  const metaValue=Number(order.redeemMeta?.sourcePrice||0);
  if(metaValue>0) return metaValue;
  return (order.items||[]).reduce((sum,item)=>sum+Number(item.sourcePrice||item.originalPrice||item.price||0),0);
}
function payrollStaffIds(){
  return new Set(activeStaff().filter(s=>s.permissions?.includes('assign')||s.owner).map(s=>String(s.id)));
}
function reconciliationIssueReason(order, visibleStaffIds){
  if(!order.assignedDesignerId) return '未掛業績';
  if(!visibleStaffIds.has(String(order.assignedDesignerId))) return '員工未顯示於個人業績';
  return '';
}

function canViewReconciliation(){
  // 對帳資料採獨立權限：BOSS、管理密碼登入永遠可看；員工需勾選 reconcile_view。
  if(typeof isBossMode==='function' && isBossMode()) return true;
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return true;
  const authority=reportViewerContext().authority;
  const permissions=Array.isArray(authority?.permissions) ? authority.permissions : [];
  return permissions.includes('reconcile_view');
}
function renderReconciliation(rangeOrders){
  const box=$('#reconcileBox');
  if(!box) return;
  const detail=$('#reconcileDetail');
  if(!canViewReconciliation()){
    // 不只隱藏畫面，也不計算、不產生任何對帳明細。
    box.classList.add('hidden');
    safeSetText('reconcileSales','$0');
    safeSetText('reconcilePersonal','$0');
    safeSetText('reconcileDiff','$0');
    safeSetText('reconcileCount','0');
    if(detail) detail.innerHTML='';
    return;
  }
  box.classList.remove('hidden');
  const visibleStaffIds=payrollStaffIds();
  const salesTotal=rangeOrders.reduce((sum,o)=>sum+Number(o.total||0),0);
  const visiblePersonalOrders=rangeOrders.filter(o=>o.assignedDesignerId && visibleStaffIds.has(String(o.assignedDesignerId)));
  const personalTotal=visiblePersonalOrders.reduce((sum,o)=>sum+Number(o.total||0),0);
  const issues=rangeOrders.filter(o=>reconciliationIssueReason(o,visibleStaffIds));
  const issueTotal=issues.reduce((sum,o)=>sum+Number(o.total||0),0);
  const diff=salesTotal-personalTotal;

  safeSetText('reconcileSales',money(salesTotal));
  safeSetText('reconcilePersonal',money(personalTotal));
  safeSetText('reconcileDiff',money(diff));
  safeSetText('reconcileCount',String(issues.length));

  if(!detail) return;
  if(!issues.length && diff===0){
    box.classList.remove('reconcile-warn');
    detail.innerHTML='<div class="note">✅ 對帳一致：區間營業額＝目前個人業績加總，沒有未歸屬有效單。</div>';
    return;
  }
  box.classList.add('reconcile-warn');
  detail.innerHTML=`<div class="note">⚠ 發現 ${issues.length} 筆未納入目前個人業績，合計 ${money(issueTotal)}。以下只列有效單，退票／作廢單已排除。</div>
    <div class="table"><div class="tr header"><div>單號 / 品項</div><div>金額</div><div>日期時間</div><div>原因</div></div>
    ${issues.map(o=>`<div class="tr"><div><strong>${escapeHtml(o.id||'-')}</strong><br><span style="color:#6b7280">${escapeHtml((o.items||[]).map(i=>i.name).join('、')||'-')}</span></div><div>${money(o.total||0)}</div><div>${escapeHtml((o.date||'')+' '+(o.time||''))}</div><div>${escapeHtml(reconciliationIssueReason(o,visibleStaffIds))}</div></div>`).join('')}</div>`;
}
function getExpenseListForProfit(){
  return loadExpenses().filter(e=>e && e.date);
}
function companyMonthlyProfit(values={}){
  return Number(values.sales||0)
    -Number(values.refunds||0)
    -Number(values.generalExpenses||0)
    -Number(values.staffSalaries||0)
    -Number(values.companyInsurance||0)
    -Number(values.managementBonus||0);
}
function jeanManagementBonus(profitBeforeManagementBonus,managementShareRate=0.1){
  const rate=Math.max(0,Math.min(1,Number(managementShareRate||0)));
  return Math.max(0,Number(profitBeforeManagementBonus||0)*rate);
}
function monthlyCompanyProfitBreakdown(monthValue){
  const month=typeof payrollTrialMonth==='function' ? payrollTrialMonth(monthValue) : String(monthValue||monthStr());
  const refunds=activeReportRefunds();
  const expenses=getExpenseListForProfit();
  const salaryOrders=salaryBaseOrders();
  const sales=activeReportOrders().filter(o=>String(o.date||'').startsWith(month)).reduce((sum,o)=>sum+Number(o.total||0),0);
  const refundTotal=refunds.filter(r=>String(r.date||'').startsWith(month)).reduce((sum,r)=>sum+Number(r.total||0),0);
  const expenseRows=expenses.filter(e=>String(e.date||'').startsWith(month));
  const companyInsurance=expenseRows.filter(e=>String(e.category||'')==='公司負擔保險').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const generalExpenses=expenseRows.filter(e=>String(e.category||'')!=='公司負擔保險').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const staffSalaries=typeof payrollTrialSummary==='function'
    ? payrollTrialSummary(month).actualSalaryTotal
    : salaryOrders.filter(o=>String(o.date||'').startsWith(month)&&o.assignedDesignerId).reduce((sum,o)=>sum+Number(o.commission||0),0);
  const profitBeforeManagementShare=companyMonthlyProfit({sales,refunds:refundTotal,generalExpenses,staffSalaries,companyInsurance,managementBonus:0});
  const managementShareRate=typeof jeanManagementShareRate==='function' ? jeanManagementShareRate(month) : 0.1;
  const managementShare=jeanManagementBonus(profitBeforeManagementShare,managementShareRate);
  const finalProfit=companyMonthlyProfit({sales,refunds:refundTotal,generalExpenses,staffSalaries,companyInsurance,managementBonus:managementShare});
  return {month,sales,refunds:refundTotal,generalExpenses,staffSalaries,companyInsurance,profitBeforeManagementShare,managementShareRate,managementShare,finalProfit};
}
function renderProfitSummary(){
  if(window.OBA_ACCESS_SESSION?.kind==='boss')return;
  const today=todayStr();
  const orders=activeReportOrders().filter(o=>!o.refunded);
  const refunds=activeReportRefunds();
  const expenses=getExpenseListForProfit();
  const salaryOrders=salaryBaseOrders();

  const todaySales=orders.filter(o=>o.date===today).reduce((s,o)=>s+Number(o.total||0),0);
  const todayRefund=refunds.filter(r=>r.date===today).reduce((s,r)=>s+Number(r.total||0),0);
  const todayExpense=expenses.filter(e=>e.date===today).reduce((s,e)=>s+Number(e.amount||0),0);
  const todaySalary=salaryOrders.filter(o=>o.date===today && o.assignedDesignerId).reduce((s,o)=>s+Number(o.commission||0),0);
  // 營業額本身已排除 refunded 訂單，所以損益不再重複扣退票金額。
  const todayNetBeforeSalary=todaySales-todayExpense;
  const todayNetAfterSalary=todayNetBeforeSalary-todaySalary;

  // V11.1.76：本函式只保留「今日」資訊；所有月份共同 DOM 由 renderPayrollPage(model) 單一寫入。
  safeSetText('profitTodaySales', money(todaySales));
  safeSetText('profitTodayRefund', money(todayRefund));
  safeSetText('profitTodayExpense', money(todayExpense));
  safeSetText('profitTodaySalary', money(todaySalary));
  safeSetText('profitTodayNet', money(todayNetBeforeSalary));
  safeSetText('profitTodayAfterSalary', money(todayNetAfterSalary));
}


function reportViewerContext(){
  if(typeof isBossMode==='function' && isBossMode()) return {canViewAll:true, staffId:'', staff:null};
  const reportAuthority=(typeof PAGE_TAB_AUTH!=='undefined'&&PAGE_TAB_AUTH?.report)?PAGE_TAB_AUTH.report:null;
  if(reportAuthority?.kind==='owner-control') return {canViewAll:true, staffId:'', staff:null, authority:reportAuthority};
  if(reportAuthority?.kind==='staff'){
    const sid=String(reportAuthority.id||'');
    const staff=sid?staffById(sid):null;
    const permissions=Array.isArray(reportAuthority.permissions)
      ? reportAuthority.permissions
      : (Array.isArray(staff?.permissions)?staff.permissions:[]);
    return {canViewAll:permissions.includes('view_all'),staffId:sid,staff,authority:reportAuthority};
  }
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return {canViewAll:true, staffId:'', staff:null};
  const sid=String(CURRENT_CASHIER?.id||'');
  const staff=sid ? staffById(sid) : null;
  const permissions=Array.isArray(CURRENT_CASHIER?.permissions)
    ? CURRENT_CASHIER.permissions
    : (Array.isArray(staff?.permissions) ? staff.permissions : []);
  return {canViewAll:permissions.includes('view_all'), staffId:sid, staff};
}
function canViewAllReportData(){
  return reportViewerContext().canViewAll;
}
function canReprintReportData(){
  // BOSS 模式為報表唯讀，不提供補印操作。
  if(typeof isBossMode==='function' && isBossMode()) return false;
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return true;
  const authority=reportViewerContext().authority;
  const permissions=Array.isArray(authority?.permissions) ? authority.permissions : [];
  return permissions.includes('reprint');
}
function reportOrderVisibleToViewer(order){
  const ctx=reportViewerContext();
  if(ctx.canViewAll) return true;
  if(!ctx.staffId) return false;
  return String(order?.assignedDesignerId||'')===String(ctx.staffId);
}
function reportRefundVisibleToViewer(refund, allOrders){
  const ctx=reportViewerContext();
  if(ctx.canViewAll) return true;
  if(!ctx.staffId) return false;
  const orderId=String(refund?.orderId||'');
  const original=(allOrders||[]).find(o=>String(o?.id||o?.orderNo||'')===orderId);
  return !!original && String(original.assignedDesignerId||'')===String(ctx.staffId);
}

function renderReportStaffOptions(){
  const sel=$('#reportStaff');
  if(!sel) return;
  const ctx=reportViewerContext();
  const current=sel.value||ctx.staffId||'JEAN';
  let staffList=activeStaff().filter(s=>s.permissions.includes('assign')||s.permissions.includes('checkout')||s.owner);
  if(!ctx.canViewAll){
    staffList=staffList.filter(s=>String(s.id)===String(ctx.staffId));
  }
  sel.innerHTML=staffList.map(s=>`<option value="${s.id}" ${s.id===current?'selected':''}>${s.name}</option>`).join('');
  if(!staffList.find(s=>s.id===sel.value) && staffList[0]) sel.value=staffList[0].id;
  sel.disabled=!ctx.canViewAll;
}

function showStaffSalesDetail(staffId, month){
  const ctx=reportViewerContext();
  if(!ctx.canViewAll && String(staffId)!==String(ctx.staffId)){
    alert('沒有查看其他員工業績明細的權限');
    return;
  }
  const staff=staffById(staffId);
  const list=salaryBaseOrders().filter(o=>o.assignedDesignerId===staffId && o.date.startsWith(month) && !o.refunded);
  if(!list.length){ alert((staff?.name||staffId)+' 這個月份沒有業績明細'); return; }
  const lines=list.map(o=>`${o.id}｜${o.date} ${o.time||''}｜${money(o.total||0)}｜抽成 ${money(o.commission||0)}`);
  alert(`${staff?.name||staffId} 業績明細\n\n`+lines.join('\n'));
}

function renderReport(){
  state.orders.forEach(ensureOrderPerformance);
  renderReportStaffOptions();
  const f=reportFilterValues(), month=f.startDate.slice(0,7);
  renderProfitSummary();
  const ctx=reportViewerContext();
  const rangeText=`${f.startDate}～${f.endDate}${f.start||f.end?' '+(f.start||'00:00')+'～'+(f.end||'23:59'):' 全日'}`;
  const allReportOrders=activeReportOrders();
  const allReportRefunds=activeReportRefunds();
  const allRangeOrders=allReportOrders.filter(o=>!o.refunded&&isDateTimeInReportRange(o.date,o.time,f));
  const allRangeRefunds=allReportRefunds.filter(r=>isDateTimeInReportRange(r.date,r.time,f));
  const rangeOrders=ctx.canViewAll ? allRangeOrders : allRangeOrders.filter(reportOrderVisibleToViewer);
  const rangeRefunds=ctx.canViewAll ? allRangeRefunds : allRangeRefunds.filter(r=>reportRefundVisibleToViewer(r,allReportOrders));
  $('#daySalesLabel').textContent='區間營業額';
  $('#daySales').textContent=money(allRangeOrders.reduce((s,o)=>s+o.total,0));
  $('#dayRefund').textContent=money(allRangeRefunds.reduce((s,o)=>s+o.total,0));
  $('#dayCount').textContent=allRangeOrders.length;
  $('#payCash').textContent=money(allRangeOrders.filter(o=>o.paymentMethod==='現金').reduce((s,o)=>s+o.total,0));
  $('#payTransfer').textContent=money(allRangeOrders.filter(o=>o.paymentMethod==='轉帳').reduce((s,o)=>s+o.total,0));
  $('#payLine').textContent=money(allRangeOrders.filter(o=>o.paymentMethod==='LINE Pay').reduce((s,o)=>s+o.total,0));
  const redeemOrders=allRangeOrders.filter(o=>o.paymentMethod==='集點卡兌換');
  const redeemValue=redeemOrders.reduce((s,o)=>s+redemptionSourceValue(o),0);
  $('#payRedeem').textContent=`${redeemOrders.length} 筆 / 原服務價值 ${money(redeemValue)}`;
  renderReconciliation(allRangeOrders);
  const allMonthOrders=salaryBaseOrders().filter(o=>o.date.startsWith(month)&&!o.refunded);
  const monthOrders=ctx.canViewAll ? allMonthOrders : allMonthOrders.filter(reportOrderVisibleToViewer);
  // V11.0.83：個人業績區改成依員工資料動態產生，不再只固定顯示 JEAN / ALAN。
  const monthlyBox=$('#monthlyStaffStats');
  if(monthlyBox){
    let payrollStaff=activeStaff().filter(s=>s.permissions?.includes('assign')||s.owner);
    if(!ctx.canViewAll) payrollStaff=payrollStaff.filter(s=>String(s.id)===String(ctx.staffId));
    monthlyBox.innerHTML=payrollStaff.length
      ? payrollStaff.map(s=>{
          const list=monthOrders.filter(o=>o.assignedDesignerId===s.id);
          const sales=list.reduce((sum,o)=>sum+Number(o.total||0),0);
          const commission=list.reduce((sum,o)=>sum+Number(o.commission||0),0);
          // V11.1.20：報表個人業績同步顯示開始日期當日 total，方便每日對紙本。
          const dayList=salaryBaseOrders().filter(o=>o.assignedDesignerId===s.id && o.date===f.startDate && !o.refunded && (ctx.canViewAll || String(s.id)===String(ctx.staffId)));
          const daySales=dayList.reduce((sum,o)=>sum+Number(o.total||0),0);
          const dayCommission=dayList.reduce((sum,o)=>sum+Number(o.commission||0),0);
          return `<div class="stat"><div class="k">${s.name} 本日 total｜${f.startDate}</div><div class="v">${money(daySales)} / ${money(dayCommission)} / ${dayList.length}</div><div class="space"></div><div class="k">本月業績 / 抽成 / 筆數</div><div class="v">${money(sales)} / ${money(commission)} / ${list.length}</div><div class="space"></div><button class="btn btn-soft" type="button" onclick="showStaffSalesDetail('${String(s.id).replace(/'/g,'\'')}', '${month}')">查看明細</button></div>`;
        }).join('')
      : '<div class="stat"><div class="k">員工本月業績 / 抽成</div><div class="v">$0 / $0 / 0</div></div>';
  }
  $('#reportRecordTitle').textContent=(ctx.canViewAll?'區間紀錄':'我的區間紀錄')+'｜'+(state.branchName||DEFAULT_BRANCH_NAME)+'｜'+rangeText;
  const exportBtn=$('#btnExport'); if(exportBtn) exportBtn.classList.toggle('hidden',!ctx.canViewAll);
  const reprintBtn=$('#btnReprintOpen'); if(reprintBtn) reprintBtn.classList.toggle('hidden',!canReprintReportData());
  const rows=[...allRangeOrders.map(o=>({kind:'sale',...o})),...rangeRefunds.map(r=>({kind:'refund',...r}))].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  $('#reportTable').innerHTML=rows.length?`<div class="tr header"><div>內容</div><div>金額</div><div>收款/操作</div><div>設計師</div><div>抽成</div><div>時間</div><div>狀態</div></div>${rows.map(r=>r.kind==='sale'?`<div class="tr"><div><strong>${r.id}</strong><br><span style="color:#6b7280">${r.items.map(i=>i.name).join('、')}</span></div><div>${money(r.total)}</div><div>${r.cashierName||r.paymentMethod}</div><div>${r.assignedDesignerName||'未掛業績'}</div><div>${money(r.commission||0)}</div><div>${r.time}</div><div>${r.assignedDesignerId?'已掛業績':'未掛業績'}</div></div>`:`<div class="tr"><div><strong>退票 ${r.orderId}</strong><br><span style="color:#6b7280">${r.reason}</span></div><div>${money(r.total)}</div><div>${r.by}</div><div>--</div><div>--</div><div>${r.time}</div><div>退票</div></div>`).join('')}`:`<div class="tr header"><div>這個時間段沒有紀錄</div><div></div><div></div><div></div><div></div><div></div><div></div></div>`;
}
document.addEventListener('change',function(e){
  if(e.target && ['reportStartDate','reportEndDate','reportStartTime','reportEndTime','reportStaff'].includes(e.target.id)) renderReport();
});

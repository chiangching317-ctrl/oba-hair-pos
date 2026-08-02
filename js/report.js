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
  const testResetAt = newestStamp(state.lastResetAt, getLocalResetMarker());
  return (state.orders || []).filter(o=>!testResetAt || isAfterStamp(timeStampOfOrder(o), testResetAt));
}
function activeReportRefunds(){
  const testResetAt = newestStamp(state.lastResetAt, getLocalResetMarker());
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
  // 員工 PIN 身份優先於先前殘留的 owner 狀態；只有真正管理密碼/BOSS 才可繞過獨立權限。
  if(typeof isBossMode==='function' && isBossMode()) return true;
  if(CURRENT_CASHIER?.id){
    const permissions=Array.isArray(CURRENT_CASHIER.permissions) ? CURRENT_CASHIER.permissions : [];
    return permissions.includes('reconcile_view');
  }
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return true;
  return false;
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
function renderProfitSummary(){
  const today=todayStr();
  const month=monthStr();
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

  const monthSales=orders.filter(o=>String(o.date||'').startsWith(month)).reduce((s,o)=>s+Number(o.total||0),0);
  const monthRefund=refunds.filter(r=>String(r.date||'').startsWith(month)).reduce((s,r)=>s+Number(r.total||0),0);
  const monthExpense=expenses.filter(e=>String(e.date||'').startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);
  const monthSalary=salaryOrders.filter(o=>String(o.date||'').startsWith(month) && o.assignedDesignerId).reduce((s,o)=>s+Number(o.commission||0),0);
  const monthNetBeforeSalary=monthSales-monthExpense;
  const monthNetAfterSalary=monthNetBeforeSalary-monthSalary;

  safeSetText('profitTodaySales', money(todaySales));
  safeSetText('profitTodayRefund', money(todayRefund));
  safeSetText('profitTodayExpense', money(todayExpense));
  safeSetText('profitTodaySalary', money(todaySalary));
  safeSetText('profitTodayNet', money(todayNetBeforeSalary));
  safeSetText('profitTodayAfterSalary', money(todayNetAfterSalary));
  safeSetText('profitMonthSales', money(monthSales));
  safeSetText('profitMonthRefund', money(monthRefund));
  safeSetText('profitMonthExpense', money(monthExpense));
  safeSetText('profitMonthSalary', money(monthSalary));
  safeSetText('profitMonthNet', money(monthNetBeforeSalary));
  safeSetText('profitMonthAfterSalary', money(monthNetAfterSalary));
}


function reportViewerContext(){
  if(typeof isBossMode==='function' && isBossMode()) return {canViewAll:true, staffId:'', staff:null};
  const sid=String(CURRENT_CASHIER?.id||'');
  const staff=sid ? staffById(sid) : null;
  if(sid){
    const permissions=Array.isArray(CURRENT_CASHIER?.permissions)
      ? CURRENT_CASHIER.permissions
      : (Array.isArray(staff?.permissions) ? staff.permissions : []);
    return {canViewAll:permissions.includes('view_all'), staffId:sid, staff};
  }
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return {canViewAll:true, staffId:'', staff:null};
  return {canViewAll:false, staffId:'', staff:null};
}
function canViewAllReportData(){
  return reportViewerContext().canViewAll;
}
function canReprintReportData(){
  // BOSS 模式為報表唯讀，不提供補印操作；員工 PIN 身份必須依自己的 reprint 權限。
  if(typeof isBossMode==='function' && isBossMode()) return false;
  if(CURRENT_CASHIER?.id){
    const permissions=Array.isArray(CURRENT_CASHIER.permissions) ? CURRENT_CASHIER.permissions : [];
    return permissions.includes('reprint');
  }
  if(CURRENT_LOGIN_LEVEL==='owner' || window.USER_ROLE==='owner') return true;
  return false;
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
  purgeInvalidEmptyOrders();
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
  $('#daySalesLabel').textContent=ctx.canViewAll?'區間營業額':'我的區間業績';
  $('#daySales').textContent=money(rangeOrders.reduce((s,o)=>s+o.total,0));
  $('#dayRefund').textContent=money(rangeRefunds.reduce((s,o)=>s+o.total,0));
  $('#dayCount').textContent=rangeOrders.length;
  $('#payCash').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='現金').reduce((s,o)=>s+o.total,0));
  $('#payTransfer').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='轉帳').reduce((s,o)=>s+o.total,0));
  $('#payLine').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='LINE Pay').reduce((s,o)=>s+o.total,0));
  const redeemOrders=rangeOrders.filter(o=>o.paymentMethod==='集點卡兌換');
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
  const rows=[...rangeOrders.map(o=>({kind:'sale',...o})),...rangeRefunds.map(r=>({kind:'refund',...r}))].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  $('#reportTable').innerHTML=rows.length?`<div class="tr header"><div>內容</div><div>金額</div><div>收款/操作</div><div>設計師</div><div>抽成</div><div>時間</div><div>狀態</div></div>${rows.map(r=>r.kind==='sale'?`<div class="tr"><div><strong>${r.id}</strong><br><span style="color:#6b7280">${r.items.map(i=>i.name).join('、')}</span></div><div>${money(r.total)}</div><div>${r.cashierName||r.paymentMethod}</div><div>${r.assignedDesignerName||'未掛業績'}</div><div>${money(r.commission||0)}</div><div>${r.time}</div><div>${r.assignedDesignerId?'已掛業績':'未掛業績'}</div></div>`:`<div class="tr"><div><strong>退票 ${r.orderId}</strong><br><span style="color:#6b7280">${r.reason}</span></div><div>${money(r.total)}</div><div>${r.by}</div><div>--</div><div>--</div><div>${r.time}</div><div>退票</div></div>`).join('')}`:`<div class="tr header"><div>這個時間段沒有紀錄</div><div></div><div></div><div></div><div></div><div></div><div></div></div>`;
}
document.addEventListener('change',function(e){
  if(e.target && ['reportStartDate','reportEndDate','reportStartTime','reportEndTime','reportStaff'].includes(e.target.id)) renderReport();
});

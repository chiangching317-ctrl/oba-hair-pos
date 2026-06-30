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
function getExpenseListForProfit(){
  return loadExpenses().filter(e=>e && e.date);
}
function renderProfitSummary(){
  const today=todayStr();
  const month=monthStr();
  const orders=activeReportOrders().filter(o=>!o.refunded);
  const refunds=activeReportRefunds();
  const expenses=getExpenseListForProfit();

  const todaySales=orders.filter(o=>o.date===today).reduce((s,o)=>s+Number(o.total||0),0);
  const todayRefund=refunds.filter(r=>r.date===today).reduce((s,r)=>s+Number(r.total||0),0);
  const todayExpense=expenses.filter(e=>e.date===today).reduce((s,e)=>s+Number(e.amount||0),0);
  const todayNet=todaySales-todayRefund-todayExpense;

  const monthSales=orders.filter(o=>String(o.date||'').startsWith(month)).reduce((s,o)=>s+Number(o.total||0),0);
  const monthRefund=refunds.filter(r=>String(r.date||'').startsWith(month)).reduce((s,r)=>s+Number(r.total||0),0);
  const monthExpense=expenses.filter(e=>String(e.date||'').startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);
  const monthNet=monthSales-monthRefund-monthExpense;

  safeSetText('profitTodaySales', money(todaySales));
  safeSetText('profitTodayRefund', money(todayRefund));
  safeSetText('profitTodayExpense', money(todayExpense));
  safeSetText('profitTodayNet', money(todayNet));
  safeSetText('profitMonthSales', money(monthSales));
  safeSetText('profitMonthRefund', money(monthRefund));
  safeSetText('profitMonthExpense', money(monthExpense));
  safeSetText('profitMonthNet', money(monthNet));
}

function renderReportStaffOptions(){
  const sel=$('#reportStaff');
  if(!sel) return;
  const current=sel.value||'JEAN';
  const staffList=activeStaff().filter(s=>s.permissions.includes('assign')||s.permissions.includes('checkout')||s.owner);
  sel.innerHTML=staffList.map(s=>`<option value="${s.id}" ${s.id===current?'selected':''}>${s.name}</option>`).join('');
  if(!staffList.find(s=>s.id===sel.value) && staffList[0]) sel.value=staffList[0].id;
}

function showStaffSalesDetail(staffId, month){
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
  const rangeText=`${f.startDate}～${f.endDate}${f.start||f.end?' '+(f.start||'00:00')+'～'+(f.end||'23:59'):' 全日'}`;
  const reportOrders=activeReportOrders();
  const reportRefunds=activeReportRefunds();
  const rangeOrders=reportOrders.filter(o=>!o.refunded&&isDateTimeInReportRange(o.date,o.time,f));
  const rangeRefunds=reportRefunds.filter(r=>isDateTimeInReportRange(r.date,r.time,f));
  $('#daySalesLabel').textContent='區間營業額';
  $('#daySales').textContent=money(rangeOrders.reduce((s,o)=>s+o.total,0));
  $('#dayRefund').textContent=money(rangeRefunds.reduce((s,o)=>s+o.total,0));
  $('#dayCount').textContent=rangeOrders.length;
  $('#payCash').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='現金').reduce((s,o)=>s+o.total,0));
  $('#payTransfer').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='轉帳').reduce((s,o)=>s+o.total,0));
  $('#payLine').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='LINE Pay').reduce((s,o)=>s+o.total,0));
  $('#payRedeem').textContent=money(rangeOrders.filter(o=>o.paymentMethod==='集點卡兌換').reduce((s,o)=>s+o.total,0));
  const monthOrders=salaryBaseOrders().filter(o=>o.date.startsWith(month)&&!o.refunded);
  // V11.0.83：個人業績區改成依員工資料動態產生，不再只固定顯示 JEAN / ALAN。
  const monthlyBox=$('#monthlyStaffStats');
  if(monthlyBox){
    const payrollStaff=activeStaff().filter(s=>s.permissions?.includes('assign')||s.owner);
    monthlyBox.innerHTML=payrollStaff.length
      ? payrollStaff.map(s=>{
          const list=monthOrders.filter(o=>o.assignedDesignerId===s.id);
          const sales=list.reduce((sum,o)=>sum+Number(o.total||0),0);
          const commission=list.reduce((sum,o)=>sum+Number(o.commission||0),0);
          // V11.1.20：報表個人業績同步顯示開始日期當日 total，方便每日對紙本。
          const dayList=salaryBaseOrders().filter(o=>o.assignedDesignerId===s.id && o.date===f.startDate && !o.refunded);
          const daySales=dayList.reduce((sum,o)=>sum+Number(o.total||0),0);
          const dayCommission=dayList.reduce((sum,o)=>sum+Number(o.commission||0),0);
          return `<div class="stat"><div class="k">${s.name} 本日 total｜${f.startDate}</div><div class="v">${money(daySales)} / ${money(dayCommission)} / ${dayList.length}</div><div class="space"></div><div class="k">本月業績 / 抽成 / 筆數</div><div class="v">${money(sales)} / ${money(commission)} / ${list.length}</div><div class="space"></div><button class="btn btn-soft" type="button" onclick="showStaffSalesDetail('${String(s.id).replace(/'/g,'\'')}', '${month}')">查看明細</button></div>`;
        }).join('')
      : '<div class="stat"><div class="k">員工本月業績 / 抽成</div><div class="v">$0 / $0 / 0</div></div>';
  }
  $('#reportRecordTitle').textContent='區間紀錄｜'+(state.branchName||DEFAULT_BRANCH_NAME)+'｜'+rangeText;
  const rows=[...rangeOrders.map(o=>({kind:'sale',...o})),...rangeRefunds.map(r=>({kind:'refund',...r}))].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
  $('#reportTable').innerHTML=rows.length?`<div class="tr header"><div>內容</div><div>金額</div><div>收款/操作</div><div>設計師</div><div>抽成</div><div>時間</div><div>狀態</div></div>${rows.map(r=>r.kind==='sale'?`<div class="tr"><div><strong>${r.id}</strong><br><span style="color:#6b7280">${r.items.map(i=>i.name).join('、')}</span></div><div>${money(r.total)}</div><div>${r.cashierName||r.paymentMethod}</div><div>${r.assignedDesignerName||'未掛業績'}</div><div>${money(r.commission||0)}</div><div>${r.time}</div><div>${r.assignedDesignerId?'已掛業績':'未掛業績'}</div></div>`:`<div class="tr"><div><strong>退票 ${r.orderId}</strong><br><span style="color:#6b7280">${r.reason}</span></div><div>${money(r.total)}</div><div>${r.by}</div><div>--</div><div>--</div><div>${r.time}</div><div>退票</div></div>`).join('')}`:`<div class="tr header"><div>這個時間段沒有紀錄</div><div></div><div></div><div></div><div></div><div></div><div></div></div>`;
}
document.addEventListener('change',function(e){
  if(e.target && ['reportStartDate','reportEndDate','reportStartTime','reportEndTime','reportStaff'].includes(e.target.id)) renderReport();
});

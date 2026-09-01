// OBA Hair POS - assign.js
// DEV V11.1.20-D7：刷單入業績／退票／補印／相機掃描模組

function setAssignDevTrace(message,reset=false){
  const box=document.getElementById('assignDevTrace');
  if(!box) return;
  const devChannel=String(window.OBA_RUNTIME_CHANNEL||'').toUpperCase()==='DEV';
  box.classList.toggle('hidden',!devChannel);
  if(!devChannel) return;
  const line=`${new Date().toLocaleTimeString('zh-TW',{hour12:false})}｜${message}`;
  box.textContent=reset ? line : (box.textContent ? box.textContent+'\n'+line : line);
  box.style.color=String(message).startsWith('ERROR') ? '#b91c1c' : '#245f38';
  box.scrollTop=box.scrollHeight;
}
function setAssignDevError(error){
  const message=error?.message||String(error||'未知錯誤');
  setAssignDevTrace('ERROR：'+message);
}
function startAssignTiming(){
  const now=globalThis.performance?.now?.()||Date.now();
  return {start:now,resourceStart:now};
}
function assignElapsed(timing){
  return Math.max(0,Math.round((globalThis.performance?.now?.()||Date.now())-timing.start));
}
function assignCloudTimingLines(timing){
  try{
    const entries=(globalThis.performance?.getEntriesByType?.('resource')||[])
      .filter(entry=>entry.startTime>=timing.resourceStart && String(entry.name||'').includes('supabase.co'));
    const labels=['讀 Supabase main','Supabase optimistic-lock update','寫入後 verification read'];
    return labels.map((label,index)=>{
      const entry=entries[index];
      return `TIMING：${label} ${entry ? Math.round(entry.duration)+'ms' : '瀏覽器未提供分段時間'}`;
    });
  }catch(_error){
    return ['TIMING：瀏覽器未提供 Supabase 分段時間'];
  }
}

function ensureAssignLogs(){
  if(!Array.isArray(state.assignLogs)) state.assignLogs=[];
  return state.assignLogs;
}
function addAssignLog(order, staff, status='正常'){
  const logs=ensureAssignLogs();
  const now=new Date();
  const existed=logs.find(l=>String(l.orderNo||'')===String(order.id||'') && String(l.staffId||'')===String(staff.id||'') && l.status!=='已退票' && l.status!=='作廢');
  if(existed){
    existed.amount=assignPerformanceTotal(order);
    existed.commission=Number(order.commission||0);
    existed.status=status;
    existed.updatedAt=now.toISOString();
    return existed;
  }
  const log={
    id:'ASSIGN-'+Date.now()+'-'+Math.random().toString(16).slice(2),
    orderNo:order.id,
    staffId:staff.id,
    staffName:staff.name,
    amount:assignPerformanceTotal(order),
    commission:Number(order.commission||0),
    sourceType:'刷單入業績',
    createdBy:getAssignLoginStaff()?.name || '刷單頁',
    date:todayStr(),
    time:nowTime(),
    createdAt:now.toISOString(),
    status:status,
    remark:''
  };
  logs.unshift(log);
  return log;
}
function markAssignLogsRefunded(order, reason=''){
  const logs=ensureAssignLogs();
  logs.forEach(l=>{
    if(String(l.orderNo||'')===String(order.id||'')){
      l.status='已退票';
      l.voidedAt=new Date().toISOString();
      l.voidedBy=CURRENT_CASHIER?.name || '前台操作';
      l.remark=reason || l.remark || '';
    }
  });
}
function renderTodayAssignLogs(){
  const box=$('#todayAssignLogs');
  if(!box) return;

  const today=todayStr();

  // V11.0.95：權限改用「登入者 CURRENT_CASHIER」判斷，不用刷單下拉選到誰來判斷。
  // 避免一般員工把下拉選成 JEAN 就看到全部紀錄。
  const loginStaff = getAssignLoginStaff();
  const loginStaffId = loginStaff?.id || '';
  const canViewAll = !!(
    isBossMode() ||
    loginStaff?.owner ||
    loginStaff?.permissions?.includes('view_all') ||
    loginStaff?.permissions?.includes('view_all_assign_logs')
  );

  let logs=ensureAssignLogs()
    .filter(l=>l.date===today)
    .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));

  if(!canViewAll){
    logs = logs.filter(l=>String(l.staffId||'')===String(loginStaffId||''));
  }

  const header=`<div class="assign-record-row header"><div>單號</div><div>員工</div><div>金額</div><div>抽成</div><div>刷入時間</div><div>操作人</div><div>狀態</div></div>`;

  if(!logs.length){
    const msg = canViewAll ? '今天還沒有刷入紀錄' : '今天沒有你的刷入紀錄';
    box.innerHTML=header+`<div class="assign-record-row"><div>${msg}</div><div></div><div></div><div></div><div></div><div></div><div></div></div>`;
    return;
  }

  box.innerHTML=header+logs.map(l=>`
    <div class="assign-record-row">
      <div><strong>${escapeHtmlText(l.orderNo||'')}</strong></div>
      <div>${escapeHtmlText(l.staffName||l.staffId||'')}</div>
      <div>${money(l.amount||0)}</div>
      <div>${money(l.commission||0)}</div>
      <div>${escapeHtmlText(l.time||'')}</div>
      <div>${escapeHtmlText(l.createdBy||'-')}</div>
      <div><span class="badge ${l.status==='正常'?'badge-ok':'badge-off'}">${escapeHtmlText(l.status||'正常')}</span></div>
    </div>`).join('');
}


// 刷單身份只在目前頁面生命週期有效：不設閒置逾時、不寫入 storage。
// 完整關閉／重新載入頁面會自然清除；主動切換身份時明確清除。
let CURRENT_ASSIGN_STAFF_ID='';
function getAssignPinStaffId(){
  return CURRENT_ASSIGN_STAFF_ID;
}
function setAssignPinStaffId(staffId){
  CURRENT_ASSIGN_STAFF_ID=String(staffId||'');
}
function clearAssignPinStaffId(){
  CURRENT_ASSIGN_STAFF_ID='';
}
function getAssignLoginStaff(){
  const sid = getAssignPinStaffId();
  if(sid) return staffById(sid);
  return null;
}
function needAssignPinFirst(){
  const loginStaff = getAssignLoginStaff();
  if(loginStaff?.id) return false;
  return true;
}
async function promptAssignPinOnce(message='第一次刷單請輸入自己的 6 位數 PIN'){
  const pin = await askMaskedPassword(message,'6 位數 PIN');
  if(pin === null) return null;
  const verified=await verifyPinSecure(pin,'assign');
  if(!verified.ok||verified.kind!=='staff'){
    alert(pinFailureMessage(verified,'刷業績'));
    return null;
  }
  const staff=staffById(verified.id);
  if(!staff){alert('雲端已驗證 PIN，但本機尚未同步該員工，請重新整理後再試');return null}
  setAssignPinStaffId(staff.id);
  CURRENT_CASHIER = {id:staff.id,name:staff.name,permissions:staff.permissions||[]};
  CURRENT_LOGIN_LEVEL = 'staff';
  updateCashierDisplay();
  return staff;
}
async function switchAssignStaffIdentity(){
  clearAssignPinStaffId();
  CURRENT_LOGIN_LEVEL='staff';
  CURRENT_CASHIER=null;
  const staff = await promptAssignPinOnce('請輸入要切換的員工 PIN');
  if(!staff) return;
  renderAssign();
  alert('已切換刷單身份：'+staff.name);
}
function renderAssignIdentityNote(){
  const note=$('#assignIdentityNote');
  if(!note) return;
  const staff=getAssignLoginStaff();
  note.textContent = staff?.name ? `目前刷單身份：${staff.name}。如需換人，請按「切換刷單身份」。` : '第一次刷單會要求輸入自己的 PIN。';
}

function canLoginUserAssignForOthers(){
  // 首次刷單 PIN 只建立員工身份，不給代刷他人權限。
  return !!(
    isBossMode() ||
    CURRENT_LOGIN_LEVEL === 'owner' ||
    CURRENT_LOGIN_LEVEL === 'manage'
  );
}
function enforceAssignDesignerPermission(){
  const sel=$('#assignDesigner');
  if(!sel) return;
  const loginStaff = getAssignLoginStaff();
  const canAssignOthers = canLoginUserAssignForOthers();

  if(!canAssignOthers && loginStaff?.id){
    sel.value = loginStaff.id;
    sel.disabled = true;
    sel.title = '一般員工刷單時只能刷入自己的業績';
  }else{
    sel.disabled = false;
    sel.title = '';
  }
}

function renderAssign(){
  const sel=$('#assignDesigner');
  if(!sel) return;
  const loginStaff = getAssignLoginStaff();
  const canAssignOthers = canLoginUserAssignForOthers();
  let assignable=activeStaff().filter(s=>s.permissions.includes('assign'));

  // V11.0.99：未做首次刷單 PIN 前，先不讓用選單決定身份；刷單時會要求 PIN。
  if(!canAssignOthers && loginStaff?.id){
    assignable = assignable.filter(s=>String(s.id)===String(loginStaff.id));
  }

  const currentVal=(!canAssignOthers && loginStaff?.id) ? loginStaff.id : (sel.value||assignable[0]?.id||'');
  sel.innerHTML=assignable.map(s=>`<option value="${s.id}" ${s.id===currentVal?'selected':''}>${s.name}</option>`).join('');
  if(!sel.value && assignable[0]) sel.value=assignable[0].id;

  enforceAssignDesignerPermission();
  renderAssignPreview();
  renderMyStats();
  renderTodayAssignLogs();
  renderAssignIdentityNote();
}
$('#assignDesigner').onchange=()=>{renderAssignPreview();renderMyStats()};
$('#assignOrderNo').addEventListener('input',()=>{renderAssignPreview();renderMyStats()});
$('#assignOrderNo').addEventListener('keydown',e=>{
  if(e.key!=='Enter') return;
  e.preventDefault();
  void assignCurrentOrder('manual');
});

// V11.1.69 Phase 1A：集點卡收入仍為 0；計薪業績與抽成在刷入當下以原服務價格固定保存。
function assignPerformanceTotal(order){
  return orderPerformanceSnapshot(order);
}
function renderAssignPreview(){
  const code=$('#assignOrderNo').value.trim();
  let order=findOrderByCode(code);
  if(!order && !code && LAST_ASSIGNED_ORDER_NO){order=findOrderByCode(LAST_ASSIGNED_ORDER_NO)}
  const selectedId=$('#assignDesigner').value||'JEAN';
  if(!order){
    $('#assignPreview').innerHTML='請先掃描或輸入單號';
    $('#assignShowNo').textContent='--';
    $('#assignShowTotal').textContent='$0';
    $('#assignShowCommission').textContent='$0';
    $('#myThisOrder').textContent='$0 / $0';
    return;
  }
  const commission=order.refunded ? 0 : calcCommission(order,selectedId);
  $('#assignPreview').innerHTML=`${order.items.map((i,idx)=>`<div class="bill-row"><div>${idx+1}. ${i.name}</div><div>${money(i.price)}</div></div>`).join('')}<div class="bill-row"><div>收款</div><div>${order.paymentMethod}</div></div><div class="bill-row"><div>經手人</div><div>${order.cashierName||'-'}</div></div><div class="bill-row"><div>狀態</div><div>${order.refunded?'已退票':(order.assignedDesignerId?'已掛業績':'未掛業績')}</div></div>`;
  $('#assignShowNo').textContent=order.id;
  $('#assignShowTotal').textContent=order.refunded ? '$0' : money(order.total);
  $('#assignShowCommission').textContent=money(commission);
  $('#myThisOrder').textContent=order.refunded ? '$0 / $0' : `${money(assignPerformanceTotal(order))} / ${money(commission)}`;
}
function clearAssignScanField(){
  const input=$('#assignOrderNo');
  if(!input) return;
  input.value='';
  renderAssignPreview();
  renderMyStats();
  setTimeout(()=>input.focus(),80);
}
$('#btnSwitchAssignStaff').onclick=()=>{void switchAssignStaffIdentity()};
async function assignCurrentOrder(source='manual'){
  const btn=$('#btnAssignOrder');
  const timing=startAssignTiming();
  try{
    setAssignDevTrace('TIMING：開始 assign 0ms');
    setAssignDevTrace('STEP 2：進入 assignCurrentOrder');
    const code=$('#assignOrderNo').value.trim();
    const order=findOrderByCode(code);
    if(!order){setAssignDevTrace('ERROR：找不到訂單 '+code);alert('找不到單號：'+code+'。如果這張單是在另一台平板/電腦開的，手機目前還沒有同步資料。');setTimeout(()=>$('#assignOrderNo').focus(),80);return false}
    setAssignDevTrace('STEP 3：找到訂單 '+order.id);
    if(order.refunded){setAssignDevTrace('ERROR：訂單已退票');alert('這張單已退票，不能入業績');clearAssignScanField();return false}
    if(order.assignedDesignerId){
      setAssignDevTrace('ERROR：訂單已掛業績 '+(order.assignedDesignerName||order.assignedDesignerId));
      alert('這張單已經刷過業績：'+(order.assignedDesignerName||order.assignedDesignerId)+'，不能重複刷。');
      clearAssignScanField();
      return false;
    }
    if(needAssignPinFirst()){
      const verifiedStaff=await promptAssignPinOnce();
      if(!verifiedStaff) return false;
      renderAssign();
    }
    enforceAssignDesignerPermission();
    const staffId=getAssignPinStaffId()||getAssignLoginStaff()?.id||$('#assignDesigner').value||'';
    const staff=staffById(staffId);
    setAssignDevTrace('STEP 4：身份 '+(staff?.name||staffId||'無'));
    if(!staff||!staff.active||!staff.permissions?.includes('assign')){
      setAssignDevTrace('ERROR：身份失效或 assign 權限不足');
      alert('刷業績身份已失效或沒有 assign 權限，請切換刷單身份後重試');
      return false;
    }
    setAssignDevTrace('STEP 5：權限 assign PASS');

  const assignedAt=new Date().toISOString();
  const assignment={
    assignedDesignerId:staff.id,
    assignedDesignerName:staff.name,
    performanceTotal:assignPerformanceTotal(order),
    commission:calcCommission(order,staff.id),
    assignedAt,
    assignedSource:source
  };
  const now=new Date();
  const log={
    id:'ASSIGN-'+Date.now()+'-'+Math.random().toString(16).slice(2),
    orderNo:order.id,
    staffId:staff.id,
    staffName:staff.name,
    amount:assignment.performanceTotal,
    commission:Number(assignment.commission||0),
    sourceType:source==='camera'?'相機刷單入業績':'刷單入業績',
    createdBy:getAssignLoginStaff()?.name || '刷單頁',
    date:todayStr(),
    time:nowTime(),
    createdAt:now.toISOString(),
    status:'正常',
    remark:''
  };

    if(btn){btn.disabled=true;btn.textContent='雲端確認中…'}
    setAssignDevTrace('STEP 6：開始 saveAssignedOrderVerified');
    const result=await saveAssignedOrderVerified(order.id,assignment,log);
    setAssignDevTrace(`TIMING：verified save 總計 ${assignElapsed(timing)}ms`);
    assignCloudTimingLines(timing).forEach(line=>setAssignDevTrace(line));
    if(btn){btn.disabled=false;btn.textContent='掛入業績'}
    if(!result?.ok){
      setAssignDevTrace('ERROR：'+(result?.message||'雲端未確認成功'));
      alert('❌ 掛入失敗\n'+(result?.message||'雲端未確認成功')+'\n\n系統沒有顯示成功，也不會把這張單當成已完成。');
      await pullCloudState();
      renderAssign();
      renderReport();
      return false;
    }
    setAssignDevTrace('STEP 7：Supabase update／查回驗證回傳成功');
    const verifiedOrder=findOrderByCode(order.id);
    if(!verifiedOrder||String(verifiedOrder.assignedDesignerId||'')!==String(staff.id)){
      throw new Error('雲端回傳成功，但本機查回訂單身份不一致');
    }
    setAssignDevTrace('STEP 8：訂單查回驗證成功 '+verifiedOrder.id+' → '+staff.name);

    LAST_ASSIGNED_ORDER_NO=order.id;
    const reportStaff=$('#reportStaff');
    if(reportStaff) reportStaff.value=staff.id;
    // 同一刷單工作階段保留已驗證身份；只有切換身份／登出／重新載入失效時才清除。
    CURRENT_LOGIN_LEVEL='staff';
    updateCashierDisplay();
    const assignInput=$('#assignOrderNo');
    if(assignInput) assignInput.value='';
    const renderAssignStarted=globalThis.performance?.now?.()||Date.now();
    renderAssign();
    setAssignDevTrace(`TIMING：renderAssign ${Math.max(0,Math.round((globalThis.performance?.now?.()||Date.now())-renderAssignStarted))}ms`);
    const renderReportStarted=globalThis.performance?.now?.()||Date.now();
    renderReport();
    setAssignDevTrace(`TIMING：renderReport ${Math.max(0,Math.round((globalThis.performance?.now?.()||Date.now())-renderReportStarted))}ms`);
    setAssignDevTrace('TIMING：pullCloudState 0ms（成功路徑使用 verification 查回 state，未重複 pull）');
    if(assignInput) setTimeout(()=>assignInput.focus(),80);
    setAssignDevTrace('STEP 9：完成');
    setAssignDevTrace(`TIMING：完成 ${assignElapsed(timing)}ms`);
    alert('✅ 已確認掛入業績，雲端資料已驗證：'+staff.name);
    return true;
  }catch(error){
    console.error('刷業績流程錯誤',error);
    if(btn){btn.disabled=false;btn.textContent='掛入業績'}
    setAssignDevError(error);
    alert('❌ 刷業績發生錯誤：'+(error?.message||error));
    return false;
  }
}
let lastAssignActivationAt=0;
function activateAssignOrder(event){
  const now=Date.now();
  if(now-lastAssignActivationAt<700) return;
  lastAssignActivationAt=now;
  if(event?.type==='touchend') event.preventDefault();
  setAssignDevTrace('STEP 1：確認入業績按鈕收到 '+(event?.type||'click'),true);
  void assignCurrentOrder('manual');
}
const assignOrderButton=$('#btnAssignOrder');
if(assignOrderButton){
  assignOrderButton.addEventListener('click',activateAssignOrder);
  assignOrderButton.addEventListener('touchend',activateAssignOrder,{passive:false});
  setAssignDevTrace('READY：V11.1.54 assign.js 已載入，click／touchend 已綁定',true);
}else{
  setAssignDevTrace('ERROR：找不到 #btnAssignOrder');
}

function renderMyStats(){
  state.orders.forEach(ensureOrderPerformance);
  enforceAssignDesignerPermission();
  const id=$('#assignDesigner').value||getAssignLoginStaff()?.id||'JEAN', today=todayStr(), month=monthStr();
  const visibleOrders=activeReportOrders();
  const salaryOrders=salaryBaseOrders();
  const todayOrders=visibleOrders.filter(o=>o.assignedDesignerId===id&&o.date===today&&!o.refunded);
  const monthOrders=salaryOrders.filter(o=>o.assignedDesignerId===id&&o.date.startsWith(month)&&!o.refunded);

  // V11.1.20：刷單頁顯示「單據日期」個人業績 total。
  // 只讀取 orders 重新加總，不修改任何單據/員工/品項/密碼資料。
  const code=$('#assignOrderNo')?.value?.trim() || '';
  let previewOrder=findOrderByCode(code);
  if(!previewOrder && !code && LAST_ASSIGNED_ORDER_NO) previewOrder=findOrderByCode(LAST_ASSIGNED_ORDER_NO);
  const targetDate=previewOrder?.date || today;
  const orderDateOrders=visibleOrders.filter(o=>o.assignedDesignerId===id&&o.date===targetDate&&!o.refunded);
  const orderDateTotal=orderDateOrders.reduce((s,o)=>s+assignPerformanceTotal(o),0);
  const orderDateCommission=orderDateOrders.reduce((s,o)=>s+Number(o.commission||0),0);

  $('#myTodayStats').textContent=`${money(todayOrders.reduce((s,o)=>s+assignPerformanceTotal(o),0))} / ${money(todayOrders.reduce((s,o)=>s+Number(o.commission||0),0))} / ${todayOrders.length}`;
  $('#myMonthStats').textContent=`${money(monthOrders.reduce((s,o)=>s+assignPerformanceTotal(o),0))} / ${money(monthOrders.reduce((s,o)=>s+Number(o.commission||0),0))} / ${monthOrders.length}`;
  const orderDateBox=$('#myOrderDateStats');
  if(orderDateBox) orderDateBox.textContent=`${targetDate}｜${money(orderDateTotal)} / ${money(orderDateCommission)} / ${orderDateOrders.length}`;
  $('#myTodayOrderList').innerHTML=todayOrders.length?todayOrders.map(o=>`<div class="small-item">${o.id}｜${money(assignPerformanceTotal(o))}｜${o.time}</div>`).join(''):'今天還沒有單';
  renderTodayAssignLogs();
}

function canExecuteAssignedOrderVoid(){
  return !isBossMode() && window.OBA_ACCESS_SESSION?.kind==='owner-control';
}
function updateAssignedVoidButton(order=null){
  const button=$('#btnDoAssignedVoid');
  if(!button) return;
  const show=!!(order && String(order.assignedDesignerId||'').trim() && !order.refunded && canExecuteAssignedOrderVoid());
  button.classList.toggle('hidden',!show);
  button.disabled=!show;
}
function openRefund(code=''){
  if(guardBossAction()) return;
  $('#refundOrderNo').value=code;
  $('#refundReason').value='';
  $('#refundReasonOther').value='';
  $('#refundReasonOther').classList.add('hidden');
  renderRefundPreview();
  $('#refundDialog').showModal();
}
$('#btnRefundQuick').onclick=()=>openRefund(''); $('#btnAssignRefund').onclick=()=>openRefund($('#assignOrderNo').value.trim()); $('#btnCloseRefund').onclick=()=>$('#refundDialog').close();

function openReprintDialog(){
  if(guardBossAction()) return;
  if(typeof isBossMode==='function' && isBossMode()){
    alert('BOSS 模式為報表唯讀，不能補印單據');
    return;
  }
  const canReprint=!!(
    CURRENT_LOGIN_LEVEL==='owner' ||
    window.USER_ROLE==='owner' ||
    (Array.isArray(CURRENT_CASHIER?.permissions) && CURRENT_CASHIER.permissions.includes('reprint'))
  );
  if(!canReprint){ alert('沒有補印單據的權限'); return; }
  const d=$('#reprintDate');
  const no=$('#reprintOrderNo');
  if(d && !d.value) d.value=todayStr();
  if(no) no.value='';
  renderReprintList();
  $('#reprintDialog').showModal();
}
function reprintOrder(orderId){
  const order=findOrderByCode(orderId);
  if(!order){alert('找不到這張單，請確認單號');return;}
  openReceipt(order);
}
function escapeHtmlText(value){
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function renderReprintList(){
  const list=$('#reprintList');
  if(!list) return;
  const no=($('#reprintOrderNo')?.value||'').trim();
  const date=($('#reprintDate')?.value||todayStr()).trim();
  let orders=[];
  if(no){
    const found=findOrderByCode(no);
    orders=found?[found]:[];
  }else{
    const allOrders = Array.isArray(state.orders) ? state.orders : [];
    orders=allOrders
      .filter(o=>o && o.date===date)
      .sort((a,b)=>(String(b.createdAt||b.time||'')).localeCompare(String(a.createdAt||a.time||'')));
  }
  if(!orders.length){
    list.innerHTML='<div class="note">這個日期找不到可補印的單據。可以換日期，或輸入單號搜尋。</div>';
    return;
  }
  list.innerHTML=orders.map(o=>{
    const safeId=escapeHtmlText(o.id || o.orderNo || '');
    const itemText=Array.isArray(o.items) && o.items.length ? o.items.map(i=>escapeHtmlText(i.name)).join('、') : '無品項';
    const status=o.refunded?'已退票':(o.assignedDesignerName?('已掛業績：'+escapeHtmlText(o.assignedDesignerName)):'未掛業績');
    const pay=o.paymentMethod ? `｜${escapeHtmlText(o.paymentMethod)}` : '';
    const jsId=String(o.id || o.orderNo || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<button class="bill-row" type="button" onclick="reprintOrder('${jsId}')" style="width:100%;text-align:left;background:#fff;border:1px solid #eadfd6;border-radius:14px;margin:0 0 8px;padding:12px;cursor:pointer;align-items:center"><div><strong>${safeId}</strong><br><span style="color:#6b7280">${escapeHtmlText(o.date)} ${escapeHtmlText(o.time||'')}｜${itemText}${pay}｜${status}</span></div><div style="font-weight:900;white-space:nowrap">${money(o.total)}<br><span style="font-size:12px;color:#6b7280">點此補印</span></div></button>`;
  }).join('');
}

$('#refundReason').onchange=()=>$('#refundReasonOther').classList.toggle('hidden',$('#refundReason').value!=='其他');
$('#refundOrderNo').addEventListener('input',renderRefundPreview);
function renderRefundPreview(){
  const code=$('#refundOrderNo').value.trim();
  const order=findOrderByCode(code);
  updateAssignedVoidButton(order);
  if(!order){$('#refundPreview').innerHTML='請掃描或輸入單號';return}
  const assigned=String(order.assignedDesignerId||'').trim();
  const status=order.refunded?'已退票':(assigned?'已掛業績，需總控高權限作廢':'可退票');
  $('#refundPreview').innerHTML=`${order.items.map((i,idx)=>`<div class="bill-row"><div>${idx+1}. ${i.name}</div><div>${money(i.price)}</div></div>`).join('')}<div class="bill-row"><div>收款</div><div>${order.paymentMethod}</div></div><div class="bill-row"><div>收款操作員</div><div>${order.cashierName||'-'}</div></div><div class="bill-row"><div>業績歸屬</div><div>${order.assignedDesignerName||order.assignedDesignerId||'未掛業績'}</div></div><div class="bill-row"><div>狀態</div><div>${status}</div></div>`;
}
async function executeRefundWithPin(){
  const refundDialog=$('#refundDialog');
  const reopenRefundDialog=()=>{
    try{if(refundDialog && !refundDialog.open) refundDialog.showModal()}catch(error){console.error('恢復退票視窗失敗',error)}
  };
  try{
    if(guardBossAction()) return false;
    const code=$('#refundOrderNo').value.trim(), selected=$('#refundReason').value.trim(), other=$('#refundReasonOther').value.trim(), reason=selected==='其他'?other:selected;
    const order=findOrderByCode(code);
    if(!order){alert('找不到單號：'+code+'。如果這張單是在另一台平板/電腦開的，手機目前還沒有同步資料。');return false}
    if(order.refunded){alert('這張單已退票');return false}
    if(!reason){alert('請選擇退票原因');return false}

    // Safari 不可靠地支援在已開啟的 modal dialog 上再疊一個 modal；先關閉退票視窗再要求 PIN。
    if(refundDialog?.open) refundDialog.close();
    // 退票授權必須放在真正 mutation 前；不信任 CURRENT_CASHIER／USER_ROLE／按鈕可見性。
    const pin=await askMaskedPassword('退票屬於敏感操作，請輸入操作者自己的 PIN','員工 PIN');
    if(pin===null){reopenRefundDialog();return false}
    const verifiedOperator=await verifyPinSecure(pin,'refund');
    if(!verifiedOperator.ok||verifiedOperator.kind!=='staff'){
      alert(pinFailureMessage(verifiedOperator,'退票'));
      reopenRefundDialog();
      return false;
    }
    const operator=staffById(verifiedOperator.id);
    if(!operator){
      alert('雲端已驗證 PIN，但本機尚未同步該員工，未執行退票');
      reopenRefundDialog();
      return false;
    }
    // PIN 驗證期間 state 可能被雲端同步替換；按 orderId 從最新 state 重新取回，不比較物件 reference。
    const verifiedOrder=findOrderByCode(code);
    if(!verifiedOrder || verifiedOrder.refunded){
      alert('訂單狀態已變更，未執行退票，請重新查單');
      reopenRefundDialog();
      return false;
    }
    if(String(verifiedOrder.assignedDesignerId||'').trim()){
      alert('此單已入業績，不允許退票');
      reopenRefundDialog();
      return false;
    }
    const result=await saveRefundOrderVerified(verifiedOrder.id||verifiedOrder.orderNo,reason,{id:operator.id,name:operator.name,kind:verifiedOperator.kind});
    if(!result.ok){
      alert(result.message||'退票未完成');
      reopenRefundDialog();
      return false;
    }
    if(LAST_ASSIGNED_ORDER_NO===String(verifiedOrder.id||verifiedOrder.orderNo||'')) LAST_ASSIGNED_ORDER_NO='';
    renderRefundPreview();
    renderAssign();
    renderReport();
    alert('已完成退票，業績與抽成已從報表扣回');
    return true;
  }catch(error){
    console.error('退票 PIN／權限流程錯誤',error);
    alert('退票安全驗證發生錯誤，未執行退票：'+(error?.message||error));
    reopenRefundDialog();
    return false;
  }
}
let lastRefundActivationAt=0;
async function activateSecureRefund(event){
  const now=Date.now();
  if(now-lastRefundActivationAt<700) return;
  lastRefundActivationAt=now;
  if(event?.type==='touchend') event.preventDefault();
  const button=$('#btnDoRefund');
  if(button){button.disabled=true;button.textContent='等待 PIN 驗證…'}
  try{await executeRefundWithPin()}
  finally{if(button){button.disabled=false;button.textContent='確認退票'}}
}
const secureRefundButton=$('#btnDoRefund');
if(secureRefundButton){
  secureRefundButton.addEventListener('click',activateSecureRefund);
  secureRefundButton.addEventListener('touchend',activateSecureRefund,{passive:false});
}else{
  console.error('V11.1.58：找不到 #btnDoRefund，退票功能保持停用');
}

async function executeAssignedOrderVoidWithOwnerControl(){
  const refundDialog=$('#refundDialog');
  const reopenRefundDialog=()=>{
    try{if(refundDialog && !refundDialog.open) refundDialog.showModal()}catch(error){console.error('恢復退票視窗失敗',error)}
  };
  try{
    if(guardBossAction()) return false;
    if(!canExecuteAssignedOrderVoid()){
      alert('已掛業績作廢僅限總控執行');
      return false;
    }
    const code=$('#refundOrderNo').value.trim(), selected=$('#refundReason').value.trim(), other=$('#refundReasonOther').value.trim(), reason=selected==='其他'?other:selected;
    const order=findOrderByCode(code);
    if(!order){alert('找不到單號：'+code+'。請先同步後再查單。');return false}
    if(order.refunded){alert('這張單已退票或作廢');return false}
    if(!String(order.assignedDesignerId||'').trim()){alert('這張單尚未掛業績，請使用一般退票');return false}
    if(!reason){alert('請選擇作廢原因');return false}

    if(refundDialog?.open) refundDialog.close();
    const pin=await askMaskedPassword('已掛業績作廢會回沖業績與抽成，請再次輸入總控 PIN','總控 PIN');
    if(pin===null){reopenRefundDialog();return false}
    const verified=await verifyPinSecure(pin,'report');
    if(!verified.ok||verified.kind!=='owner-control'){
      alert(pinFailureMessage(verified,'已掛業績作廢'));
      reopenRefundDialog();
      return false;
    }

    const latestOrder=findOrderByCode(code);
    if(!latestOrder || latestOrder.refunded || !String(latestOrder.assignedDesignerId||'').trim()){
      alert('訂單狀態已變更，未執行作廢，請重新查單');
      reopenRefundDialog();
      return false;
    }
    const result=await saveAssignedOrderVoidVerified(latestOrder.id||latestOrder.orderNo,reason,{id:verified.id,name:verified.name||'總控',kind:verified.kind});
    if(!result.ok){
      alert(result.message||'已掛業績作廢未完成');
      reopenRefundDialog();
      return false;
    }
    if(LAST_ASSIGNED_ORDER_NO===String(latestOrder.id||latestOrder.orderNo||'')) LAST_ASSIGNED_ORDER_NO='';
    renderRefundPreview();
    renderAssign();
    renderReport();
    alert('已完成高權限作廢，原單保留查帳，營業額、付款、業績、抽成與薪資已排除');
    return true;
  }catch(error){
    console.error('已掛業績作廢流程錯誤',error);
    alert('已掛業績作廢發生錯誤，未執行作廢：'+(error?.message||error));
    reopenRefundDialog();
    return false;
  }
}
let lastAssignedVoidActivationAt=0;
async function activateAssignedOrderVoid(event){
  const now=Date.now();
  if(now-lastAssignedVoidActivationAt<700) return;
  lastAssignedVoidActivationAt=now;
  if(event?.type==='touchend') event.preventDefault();
  const button=$('#btnDoAssignedVoid');
  if(button){button.disabled=true;button.textContent='等待總控驗證…'}
  try{await executeAssignedOrderVoidWithOwnerControl()}
  finally{if(button){button.textContent='高權限作廢已掛業績單';renderRefundPreview()}}
}
const assignedVoidButton=$('#btnDoAssignedVoid');
if(assignedVoidButton){
  assignedVoidButton.addEventListener('click',activateAssignedOrderVoid);
  assignedVoidButton.addEventListener('touchend',activateAssignedOrderVoid,{passive:false});
}

let scanStream=null, scanTimer=null, barcodeDetector=null, zxingReader=null, zxingControls=null;
let cameraScanPurpose='assign';
let cameraAssignInProgress=false;
function askManualAssignOrderNo(message){
  return new Promise(resolve=>{
    const dialog=$('#assignManualDialog'),input=$('#assignManualOrderNo'),note=$('#assignManualMessage');
    const ok=$('#btnAssignManualOk'),cancel=$('#btnAssignManualCancel');
    if(!dialog||!input||!note||!ok||!cancel){
      setAssignDevTrace('ERROR：手動單號輸入介面尚未就緒');
      alert('手動單號輸入介面尚未就緒，未執行刷單。');
      resolve(null);
      return;
    }
    note.textContent=String(message||'請輸入完整單號。');
    input.value='';
    let settled=false;
    const cleanup=value=>{
      if(settled)return;
      settled=true;
      ok.onclick=null;cancel.onclick=null;input.onkeydown=null;dialog.oncancel=null;
      if(dialog.open)dialog.close();
      resolve(value);
    };
    ok.onclick=()=>cleanup(input.value);
    cancel.onclick=()=>cleanup(null);
    input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();cleanup(input.value)}else if(event.key==='Escape'){event.preventDefault();cleanup(null)}};
    dialog.oncancel=event=>{event.preventDefault();cleanup(null)};
    dialog.showModal();
    setTimeout(()=>input.focus(),60);
  });
}
async function startManualAssignFallback(message){
  const raw=await askManualAssignOrderNo(`${message}\n\n請輸入完整單號，例如 OBA-20260804-001。`);
  if(raw===null) return false;
  const code=normalizeOrderNoText(raw);
  if(!code){alert('沒有輸入單號，未執行刷單');return false}
  const input=$('#assignOrderNo');
  input.value=code;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return await assignCurrentOrder('manual');
}
function fillScannedCode(raw,purpose=cameraScanPurpose){
  const code = String(raw||'').trim();
  const scanPurpose=purpose==='refund'?'refund':'assign';
  if(!code || (scanPurpose==='assign'&&cameraAssignInProgress)) return false;
  const finalCode = normalizeOrderNoText(code);
  const order=findOrderByCode(finalCode);
  if(!order) return false;
  if(scanPurpose==='refund'){
    const refundInput=$('#refundOrderNo');
    if(!refundInput) return false;
    refundInput.value=finalCode;
    refundInput.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  }
  cameraAssignInProgress=true;
  $('#assignOrderNo').value = finalCode;
  $('#assignOrderNo').dispatchEvent(new Event('input', {bubbles:true}));
  setTimeout(async()=>{
    try{
      await assignCurrentOrder('camera');
    }finally{
      cameraAssignInProgress=false;
    }
  },180);
  return true;
}
async function startCameraScan(purpose='assign'){
  cameraScanPurpose=purpose==='refund'?'refund':'assign';
  const dialog=$('#cameraScanDialog'), video=$('#scanVideo'), status=$('#scanStatus');
  const title=$('#cameraScanTitle');
  const refundDialog=$('#refundDialog');
  if(title) title.textContent=cameraScanPurpose==='refund'?'相機掃描原單條碼':'相機刷單';
  if(cameraScanPurpose==='refund'&&refundDialog?.open) refundDialog.close();
  try{
    if(!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      if(cameraScanPurpose==='refund'){
        stopCameraScan();
        alert('目前瀏覽器無法開啟相機，未執行退票。請直接手動輸入原單單號。');
        return;
      }
      await startManualAssignFallback('目前是 HTTP 區網網址，iPhone 瀏覽器基於安全限制無法開啟網頁相機。系統已切換成手動刷單模式。');
      return;
    }
    dialog.showModal();
    status.textContent='相機啟動中，請允許相機權限...';

    // V10.3.2：真正即時掃碼，不再改成拍照模式。
    // 優先使用 ZXing 連續掃描，iPhone Safari / Android Chrome 都比較穩。
    if(window.ZXing && ZXing.BrowserMultiFormatReader){
      zxingReader = new ZXing.BrowserMultiFormatReader();
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      status.textContent='請把收據條碼放在鏡頭中央，系統會自動讀取。';
      if(typeof zxingReader.decodeFromConstraints === 'function'){
        zxingControls = await zxingReader.decodeFromConstraints(constraints, video, (result, err)=>{
          if(result && result.text){
            const text = String(result.text||'').trim();
            if(fillScannedCode(text)){
              stopCameraScan();
            }
          }
        });
      }else{
        zxingControls = await zxingReader.decodeFromVideoDevice(null, video, (result, err)=>{
          if(result && result.text){
            const text = String(result.text||'').trim();
            if(fillScannedCode(text)){
              stopCameraScan();
            }
          }
        });
      }
      return;
    }

    // 備援：支援 BarcodeDetector 的瀏覽器使用原生辨識。
    if('BarcodeDetector' in window){
      barcodeDetector = new BarcodeDetector({formats:['code_128','code_39','ean_13','ean_8','qr_code']});
      scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
      video.srcObject = scanStream;
      await video.play();
      status.textContent='請把收據條碼放在鏡頭中央，系統會自動讀取。';
      scanTimer = setInterval(async()=>{
        try{
          if(!barcodeDetector || !video || video.readyState < 2) return;
          const codes = await barcodeDetector.detect(video);
          if(codes && codes.length){
            const raw = String(codes[0].rawValue||'').trim();
            if(raw && fillScannedCode(raw)) stopCameraScan();
          }
        }catch(e){ console.log(e); }
      }, 300);
      return;
    }

    stopCameraScan();
    alert('即時掃碼套件尚未載入，請確認網路後重新整理；也可以先手動輸入單號。');
  }catch(e){
    console.log(e);
    stopCameraScan();
    alert('相機無法啟動。請確認 Safari/Chrome 已允許相機權限，或改用手動輸入單號。');
  }
}
function stopCameraScan(){
  const completedPurpose=cameraScanPurpose;
  cameraScanPurpose='assign';
  if(scanTimer){clearInterval(scanTimer);scanTimer=null;}
  if(zxingControls && typeof zxingControls.stop==='function'){
    try{zxingControls.stop();}catch(e){console.log(e)}
  }
  zxingControls=null;
  if(zxingReader && typeof zxingReader.reset==='function'){
    try{zxingReader.reset();}catch(e){console.log(e)}
  }
  if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
  const video=$('#scanVideo'); if(video){video.pause(); video.srcObject=null;}
  const dialog=$('#cameraScanDialog'); if(dialog && dialog.open) dialog.close();
  if(completedPurpose==='refund'){
    const refundDialog=$('#refundDialog');
    if(refundDialog&&!refundDialog.open) refundDialog.showModal();
    renderRefundPreview();
  }
}
document.addEventListener('click',function(e){
  if(e.target && e.target.id==='btnCameraScan') startCameraScan();
  if(e.target && e.target.id==='btnRefundCameraScan') startCameraScan('refund');
  if(e.target && e.target.id==='btnCloseCameraScan') stopCameraScan();
});

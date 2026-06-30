// OBA Hair POS - assign.js
// DEV V11.1.20-D7：刷單入業績／退票／補印／相機掃描模組

function ensureAssignLogs(){
  if(!Array.isArray(state.assignLogs)) state.assignLogs=[];
  return state.assignLogs;
}
function addAssignLog(order, staff, status='正常'){
  const logs=ensureAssignLogs();
  const now=new Date();
  const existed=logs.find(l=>String(l.orderNo||'')===String(order.id||'') && String(l.staffId||'')===String(staff.id||'') && l.status!=='已退票' && l.status!=='作廢');
  if(existed){
    existed.amount=Number(order.total||0);
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
    amount:Number(order.total||0),
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


function getAssignPinSessionKey(){
  return 'oba_assign_pin_staff_id_v11099';
}
function getAssignPinStaffId(){
  return sessionStorage.getItem(getAssignPinSessionKey()) || '';
}
function setAssignPinStaffId(staffId){
  if(staffId) sessionStorage.setItem(getAssignPinSessionKey(), staffId);
}
function clearAssignPinStaffId(){
  sessionStorage.removeItem(getAssignPinSessionKey());
}
function getAssignLoginStaff(){
  const sid = getAssignPinStaffId();
  if(sid) return staffById(sid);
  return CURRENT_CASHIER || null;
}
function needAssignPinFirst(){
  const loginStaff = getAssignLoginStaff();
  if(loginStaff?.id) return false;
  return true;
}
function promptAssignPinOnce(message='第一次刷單請輸入自己的 6 位數 PIN'){
  const pin = prompt(message);
  if(pin === null) return null;
  const p = String(pin || '').trim();
  const staff = activeStaff().find(s => s.permissions?.includes('assign') && String(s.pin || '') === p);
  if(!staff){
    alert('PIN 錯誤，請輸入自己的員工 PIN');
    return null;
  }
  setAssignPinStaffId(staff.id);
  CURRENT_CASHIER = {id:staff.id,name:staff.name,permissions:staff.permissions||[]};
  CURRENT_LOGIN_LEVEL = 'staff';
  updateCashierDisplay();
  return staff;
}
function switchAssignStaffIdentity(){
  clearAssignPinStaffId();
  CURRENT_LOGIN_LEVEL='staff';
  CURRENT_CASHIER=null;
  const staff = promptAssignPinOnce('請輸入要切換的員工 PIN');
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
$('#assignDesigner').onchange=()=>{renderAssignPreview();renderMyStats()}; $('#assignOrderNo').addEventListener('input',()=>{renderAssignPreview();renderMyStats()});
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
  $('#myThisOrder').textContent=order.refunded ? '$0 / $0' : `${money(order.total)} / ${money(commission)}`;
}
function clearAssignScanField(){
  const input=$('#assignOrderNo');
  if(!input) return;
  input.value='';
  renderAssignPreview();
  renderMyStats();
  setTimeout(()=>input.focus(),80);
}
$('#btnSwitchAssignStaff').onclick=()=>{switchAssignStaffIdentity()};
$('#btnAssignOrder').onclick=()=>{
  if(needAssignPinFirst()){
    const staff = promptAssignPinOnce();
    if(!staff) return;
    renderAssign();
  }
  enforceAssignDesignerPermission();
  const code=$('#assignOrderNo').value.trim();
  const staffId=$('#assignDesigner').value||getAssignLoginStaff()?.id||'';
  const order=findOrderByCode(code);
  if(!order){alert('找不到單號：'+code+'。如果這張單是在另一台平板/電腦開的，手機目前還沒有同步資料。');setTimeout(()=>$('#assignOrderNo').focus(),80);return}
  if(order.refunded){alert('這張單已退票，不能入業績');clearAssignScanField();return}
  // V11.0.82：薪水標準保護。同一張單已掛業績後，不可重複刷入，避免薪資/抽成被覆蓋。
  if(order.assignedDesignerId){
    alert('這張單已經刷過業績：'+(order.assignedDesignerName||order.assignedDesignerId)+'，不能重複刷。');
    clearAssignScanField();
    return;
  }
  const staff=staffById(staffId);
  if(!staff){alert('找不到員工資料，請先到員工資料確認此員工仍在職');return}
  order.assignedDesignerId=staff.id;
  order.assignedDesignerName=staff.name;
  order.commission=calcCommission(order,staff.id);
  order.assignedAt=new Date().toISOString();
  addAssignLog(order,staff,'正常');
  LAST_ASSIGNED_ORDER_NO=order.id;
  const reportStaff=$('#reportStaff');
  if(reportStaff) reportStaff.value=staff.id;
  saveState(true);
  renderAssign();
  renderReport();
  clearAssignScanField();
  alert('已成功掛入業績，報表已更新到 '+staff.name);
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
  const orderDateTotal=orderDateOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const orderDateCommission=orderDateOrders.reduce((s,o)=>s+Number(o.commission||0),0);

  $('#myTodayStats').textContent=`${money(todayOrders.reduce((s,o)=>s+Number(o.total||0),0))} / ${money(todayOrders.reduce((s,o)=>s+Number(o.commission||0),0))} / ${todayOrders.length}`;
  $('#myMonthStats').textContent=`${money(monthOrders.reduce((s,o)=>s+Number(o.total||0),0))} / ${money(monthOrders.reduce((s,o)=>s+Number(o.commission||0),0))} / ${monthOrders.length}`;
  const orderDateBox=$('#myOrderDateStats');
  if(orderDateBox) orderDateBox.textContent=`${targetDate}｜${money(orderDateTotal)} / ${money(orderDateCommission)} / ${orderDateOrders.length}`;
  $('#myTodayOrderList').innerHTML=todayOrders.length?todayOrders.map(o=>`<div class="small-item">${o.id}｜${money(o.total)}｜${o.time}</div>`).join(''):'今天還沒有單';
  renderTodayAssignLogs();
}

function openRefund(code=''){ if(guardBossAction()) return; $('#refundOrderNo').value=code; $('#refundReason').value=''; $('#refundReasonOther').value=''; $('#refundReasonOther').classList.add('hidden'); renderRefundPreview(); $('#refundDialog').showModal() }
$('#btnRefundQuick').onclick=()=>openRefund(''); $('#btnAssignRefund').onclick=()=>openRefund($('#assignOrderNo').value.trim()); $('#btnCloseRefund').onclick=()=>$('#refundDialog').close();

function openReprintDialog(){
  if(guardBossAction()) return;
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
function renderRefundPreview(){const code=$('#refundOrderNo').value.trim();const order=findOrderByCode(code); if(!order){$('#refundPreview').innerHTML='請掃描或輸入單號';return} $('#refundPreview').innerHTML=`${order.items.map((i,idx)=>`<div class="bill-row"><div>${idx+1}. ${i.name}</div><div>${money(i.price)}</div></div>`).join('')}<div class="bill-row"><div>收款</div><div>${order.paymentMethod}</div></div><div class="bill-row"><div>收款操作員</div><div>${order.cashierName||'-'}</div></div><div class="bill-row"><div>狀態</div><div>${order.refunded?'已退票':'可退票'}</div></div>`}
$('#btnDoRefund').onclick=()=>{
  if(guardBossAction()) return;
  const code=$('#refundOrderNo').value.trim(), selected=$('#refundReason').value.trim(), other=$('#refundReasonOther').value.trim(), reason=selected==='其他'?other:selected;
  const order=findOrderByCode(code);
  if(!order){alert('找不到單號：'+code+'。如果這張單是在另一台平板/電腦開的，手機目前還沒有同步資料。');return}
  if(order.refunded){alert('這張單已退票');return}
  if(!reason){alert('請選擇退票原因');return}
  order.refunded=true;
  order.refundedAt=new Date().toISOString();
  order.refundReason=reason;
  markAssignLogsRefunded(order,reason);
  state.refunds.unshift({orderId:order.id,date:todayStr(),time:nowTime(),total:Number(order.total||0),reason:reason,by:CURRENT_CASHIER?.name||'前台操作',createdAt:new Date().toISOString()});
  if(LAST_ASSIGNED_ORDER_NO===order.id) LAST_ASSIGNED_ORDER_NO='';
  saveState(true);
  renderRefundPreview();
  renderAssign();
  renderReport();
  $('#refundDialog').close();
  alert('已完成退票，業績與抽成已從報表扣回');
}

let scanStream=null, scanTimer=null, barcodeDetector=null, zxingReader=null, zxingControls=null;
function fillScannedCode(raw){
  const code = String(raw||'').trim();
  if(!code) return false;
  const finalCode = normalizeOrderNoText(code);
  $('#assignOrderNo').value = finalCode;
  $('#assignOrderNo').dispatchEvent(new Event('input', {bubbles:true}));
  setTimeout(()=>$('#assignOrderNo').focus(),80);
  return true;
}
async function startCameraScan(){
  const dialog=$('#cameraScanDialog'), video=$('#scanVideo'), status=$('#scanStatus');
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      alert('這支手機瀏覽器不能開啟即時相機，請改用 Safari / Chrome，或手動輸入單號。');
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
}
document.addEventListener('click',function(e){
  if(e.target && e.target.id==='btnCameraScan') startCameraScan();
  if(e.target && e.target.id==='btnCloseCameraScan') stopCameraScan();
});

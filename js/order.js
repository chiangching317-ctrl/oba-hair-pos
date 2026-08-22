// V11.1.27 第14刀：訂單工具模組拆分
// 由 index.html 搬出；只搬程式，不改邏輯。
function monthlyOrderSequenceOf(value,monthKey){
  const match=String(value||'').trim().toUpperCase().match(/^OBA-(\d{8})-(\d+)$/);
  if(!match||match[1].slice(0,6)!==String(monthKey||'')) return 0;
  const sequence=Number(match[2]);
  return Number.isSafeInteger(sequence)&&sequence>0?sequence:0;
}
function monthlyOrderUsage(targetState,monthKey){
  const used=new Set((Array.isArray(targetState?.usedOrderNos)?targetState.usedOrderNos:[]).map(String).filter(Boolean));
  (Array.isArray(targetState?.orders)?targetState.orders:[]).forEach(order=>{
    const id=String(order?.id||order?.orderNo||'');
    if(id) used.add(id);
  });
  let maxUsedSequence=0;
  used.forEach(orderNo=>{maxUsedSequence=Math.max(maxUsedSequence,monthlyOrderSequenceOf(orderNo,monthKey))});
  return {used,maxUsedSequence};
}
function safeNextMonthlyOrderSequence(targetState,monthKey){
  const counters=targetState?.monthlyOrderCounter&&typeof targetState.monthlyOrderCounter==='object'?targetState.monthlyOrderCounter:{};
  const counter=Math.max(1,Number(counters[monthKey]||1));
  const usage=monthlyOrderUsage(targetState,monthKey);
  return {sequence:Math.max(counter,usage.maxUsedSequence+1),used:usage.used};
}
function reserveMonthlyOrderNo(targetState,orderDate=todayStr()){
  const rawDate=String(orderDate||'').replace(/-/g,'');
  const dateKey=/^\d{8}$/.test(rawDate)?rawDate:currentDateKey();
  const monthKey=dateKey.slice(0,6);
  const next=safeNextMonthlyOrderSequence(targetState,monthKey);
  let sequence=next.sequence;
  let orderNo=`OBA-${dateKey}-${String(sequence).padStart(3,'0')}`;
  while(next.used.has(orderNo)){
    sequence+=1;
    orderNo=`OBA-${dateKey}-${String(sequence).padStart(3,'0')}`;
  }
  next.used.add(orderNo);
  targetState.monthlyOrderCounter[monthKey]=sequence+1;
  targetState.usedOrderNos=[...next.used];
  return {orderNo,sequence,nextCounter:sequence+1,monthKey,dateKey};
}
function getNextMonthlyOrderNo(){
  const monthKey=currentMonthKey();
  const dateKey=currentDateKey();
  const next=safeNextMonthlyOrderSequence(state,monthKey);
  return `OBA-${dateKey}-${String(next.sequence).padStart(3,'0')}`;
}
function consumeMonthlyOrderNo(){
  const monthKey=currentMonthKey();
  if(!state.monthlyOrderCounter) state.monthlyOrderCounter={};
  if(!state.monthlyOrderCounter[monthKey]) state.monthlyOrderCounter[monthKey]=1;
  state.monthlyOrderCounter[monthKey]+=1;
}
function currentOrderNo(){return getNextMonthlyOrderNo()}
function reserveNextMonthlyOrderNo(orderDate=todayStr()){
  return reserveMonthlyOrderNo(state,orderDate).orderNo;
}
function normalizeOrderNoText(value){
  const raw = String(value||'').trim().toUpperCase();
  if(!raw) return '';
  const text = raw.replace(/\s+/g,'');
  const digits = (text.match(/\d+/g)||[]).join('');

  // V11.0.84：補印查單修正。正式單號是 OBA-YYYYMMDD-001，
  // 舊版會把數字全部合併成 OBA-20260520001，導致補印 find 不到。
  if(digits.length >= 11){
    const datePart = digits.slice(0,8);
    const seqPart = digits.slice(8).padStart(3,'0');
    return `OBA-${datePart}-${seqPart}`;
  }
  if(digits.length === 8){
    return `OBA-${digits}`;
  }
  return text;
}
function orderNoCandidates(value){
  const raw = String(value||'').trim().toUpperCase();
  const text = raw.replace(/\s+/g,'');
  const normalized = normalizeOrderNoText(raw);
  const digits = (text.match(/\d+/g)||[]).join('');
  const compact = text.replace(/[^A-Z0-9]/g,'');
  const list = [raw, text, normalized, compact, normalized.replace(/[^A-Z0-9]/g,'')];

  if(digits){
    list.push(digits);
    if(digits.length >= 11){
      const datePart = digits.slice(0,8);
      const seqRaw = digits.slice(8);
      const seq3 = seqRaw.padStart(3,'0');
      list.push(`OBA-${datePart}-${seq3}`);
      list.push(`OBA${datePart}${seq3}`);
      list.push(`${datePart}-${seq3}`);
      list.push(`${datePart}${seq3}`);
    }else{
      const n = parseInt(digits,10);
      if(!Number.isNaN(n)){
        list.push('OBA-' + String(n).padStart(8,'0'));
        list.push('OBA' + String(n).padStart(8,'0'));
        list.push(String(n).padStart(8,'0'));
        list.push('OBA-' + String(n).padStart(6,'0'));
        list.push('OBA' + String(n).padStart(6,'0'));
        list.push(String(n).padStart(6,'0'));
        list.push(String(n));
      }
    }
  }
  return [...new Set(list.filter(Boolean))];
}
function orderIdentityValues(order){
  if(!order) return [];
  return [order.id, order.orderNo, order.orderId, order.no, order.code, order.receiptNo];
}
function findOrderByCode(value){
  const candidates = orderNoCandidates(value);
  const orders = Array.isArray(state.orders) ? state.orders : [];
  return orders.find(o => {
    const orderCandidates = orderIdentityValues(o).flatMap(v=>orderNoCandidates(v));
    return candidates.some(c => orderCandidates.includes(c));
  });
}

function isValidOrderForBusiness(order){
  if(!order) return false;
  const items = Array.isArray(order.items) ? order.items : [];
  if(order.paymentMethod === '集點卡兌換') return items.length > 0;
  return items.length > 0 && Number(order.total || 0) > 0;
}
function getBusinessOrders(){
  return (Array.isArray(state.orders) ? state.orders : []).filter(isValidOrderForBusiness);
}
function purgeInvalidEmptyOrders(){
  // Production Candidate：開啟／render POS 不代表授權清理歷史訂單。
  // 保留舊函式名稱供相容檢查，但永遠只做唯讀診斷，不修改 state。
  const orders=Array.isArray(state?.orders)?state.orders:[];
  const invalidCount=orders.filter(order=>!isValidOrderForBusiness(order)).length;
  if(invalidCount)console.warn('ORDER_AUDIT_ONLY：發現不符合目前業務格式的歷史訂單；未自動刪除',{invalidCount});
  return false;
}
function activeItems(){return state.items.filter(i=>i.active)}
function activeStaff(){return state.staff.filter(s=>s.active)}
function staffById(id){return state.staff.find(s=>s.id===id)}
function isRedeemOrder(order){return order?.paymentMethod==='集點卡兌換'||order?.redeemMeta?.redeemType===true}
function orderItemCommissionBase(order,item,index){
  if(!isRedeemOrder(order)) return Number(item?.price||0);
  const itemSource=Number(item?.sourcePrice||item?.originalPrice||0);
  if(itemSource>0) return itemSource;
  const items=Array.isArray(order?.items)?order.items:[];
  if(items.length===1&&index===0) return Number(order?.redeemMeta?.sourcePrice||0);
  return Number(item?.price||0);
}
function orderPerformanceSnapshot(order){
  if(!order) return 0;
  if(Object.prototype.hasOwnProperty.call(order,'performanceTotal')&&Number.isFinite(Number(order.performanceTotal))) return Number(order.performanceTotal);
  if(isRedeemOrder(order)){
    const metaValue=Number(order.redeemMeta?.sourcePrice||0);
    if(metaValue>0) return metaValue;
    return (order.items||[]).reduce((sum,item)=>sum+Number(item?.sourcePrice||item?.originalPrice||item?.price||0),0);
  }
  return Number(order.total||0);
}
function calcCommission(order,staffId){const staff=staffById(staffId);if(!staff)return 0;return (order.items||[]).reduce((sum,item,index)=>{const rate=staff.rules?.[item.name] ?? staff.rules?.[item.category] ?? staff.rules?.default ?? 0.5;return sum+Math.round(orderItemCommissionBase(order,item,index)*Number(rate||0));},0)}
function ensureOrderPerformance(order){
  if(!order || !order.assignedDesignerId) return order;
  const staff=staffById(order.assignedDesignerId);
  if(staff && !order.assignedDesignerName) order.assignedDesignerName=staff.name;
  const commission=calcCommission(order,order.assignedDesignerId);
  if(!Object.prototype.hasOwnProperty.call(order,'commission') || !Number.isFinite(Number(order.commission))) order.commission=commission;
  return order;
}
function getYearsText(joinDate){if(!joinDate)return '未設定';const start=new Date(joinDate), now=new Date();const months=(now.getFullYear()-start.getFullYear())*12+(now.getMonth()-start.getMonth());return `${Math.floor(months/12)}年${months%12}個月`}

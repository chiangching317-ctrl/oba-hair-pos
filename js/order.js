// V11.1.27 第14刀：訂單工具模組拆分
// 由 index.html 搬出；只搬程式，不改邏輯。
// V11.1.29：單號防重用。
// 已經開過的單號，即使單據刪除、作廢或被同步回捲，也不可再次使用。
function ensureUsedOrderNos(){
  if(!Array.isArray(state.usedOrderNos)) state.usedOrderNos=[];
  if(Array.isArray(state.orders)){
    state.orders.forEach(o=>{
      orderIdentityValues(o).forEach(v=>{
        const no=normalizeOrderNoText(v);
        if(no && no.startsWith('OBA-') && !state.usedOrderNos.includes(no)){
          state.usedOrderNos.push(no);
        }
      });
    });
  }
}
function maxUsedSeqForMonth(monthKey){
  ensureUsedOrderNos();
  let max=0;
  const orders = Array.isArray(state.orders) ? state.orders : [];
  orders.forEach(o=>{
    orderIdentityValues(o).forEach(v=>{
      const no=normalizeOrderNoText(v);
      const m=no.match(/^OBA-(\d{8})-(\d{3,})$/);
      if(m && m[1].slice(0,6)===monthKey){
        max=Math.max(max, parseInt(m[2],10)||0);
      }
    });
  });
  state.usedOrderNos.forEach(v=>{
    const no=normalizeOrderNoText(v);
    const m=no.match(/^OBA-(\d{8})-(\d{3,})$/);
    if(m && m[1].slice(0,6)===monthKey){
      max=Math.max(max, parseInt(m[2],10)||0);
    }
  });
  return max;
}
function getNextMonthlyOrderNo(){
  const monthKey=currentMonthKey();
  const dateKey=currentDateKey();
  if(!state.monthlyOrderCounter) state.monthlyOrderCounter={};
  const minNext = maxUsedSeqForMonth(monthKey) + 1;
  if(!state.monthlyOrderCounter[monthKey] || state.monthlyOrderCounter[monthKey] < minNext){
    state.monthlyOrderCounter[monthKey]=minNext;
  }
  let no=state.monthlyOrderCounter[monthKey];
  let orderNo=`OBA-${dateKey}-${String(no).padStart(3,'0')}`;
  ensureUsedOrderNos();
  while(state.usedOrderNos.includes(orderNo) || findOrderByCode(orderNo)){
    no+=1;
    orderNo=`OBA-${dateKey}-${String(no).padStart(3,'0')}`;
  }
  state.monthlyOrderCounter[monthKey]=no;
  return orderNo;
}
function consumeMonthlyOrderNo(orderNo){
  const monthKey=currentMonthKey();
  if(!state.monthlyOrderCounter) state.monthlyOrderCounter={};
  ensureUsedOrderNos();
  const usedNo=normalizeOrderNoText(orderNo || getNextMonthlyOrderNo());
  if(usedNo && !state.usedOrderNos.includes(usedNo)) state.usedOrderNos.push(usedNo);
  const m=usedNo.match(/^OBA-(\d{8})-(\d{3,})$/);
  const usedSeq=m ? (parseInt(m[2],10)||0) : (state.monthlyOrderCounter[monthKey]||0);
  state.monthlyOrderCounter[monthKey]=Math.max(state.monthlyOrderCounter[monthKey]||1, usedSeq+1);
}
function currentOrderNo(){return getNextMonthlyOrderNo()}
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
  if(!Array.isArray(state.orders)) state.orders=[];
  const before = state.orders.length;
  state.orders = state.orders.filter(isValidOrderForBusiness);
  return before !== state.orders.length;
}
function activeItems(){return state.items.filter(i=>i.active)}
function activeStaff(){return state.staff.filter(s=>s.active)}
function staffById(id){return state.staff.find(s=>s.id===id)}
function calcCommission(order,staffId){const staff=staffById(staffId);if(!staff)return 0;return order.items.reduce((sum,item)=>{const rate=staff.rules?.[item.name] ?? staff.rules?.[item.category] ?? staff.rules?.default ?? 0.5;return sum+Math.round(Number(item.price||0)*Number(rate||0));},0)}
function ensureOrderPerformance(order){
  if(!order || !order.assignedDesignerId) return order;
  const staff=staffById(order.assignedDesignerId);
  if(staff && !order.assignedDesignerName) order.assignedDesignerName=staff.name;
  const commission=calcCommission(order,order.assignedDesignerId);
  if(!Number.isFinite(Number(order.commission)) || Number(order.commission)===0) order.commission=commission;
  return order;
}
function getYearsText(joinDate){if(!joinDate)return '未設定';const start=new Date(joinDate), now=new Date();const months=(now.getFullYear()-start.getFullYear())*12+(now.getMonth()-start.getMonth());return `${Math.floor(months/12)}年${months%12}個月`}

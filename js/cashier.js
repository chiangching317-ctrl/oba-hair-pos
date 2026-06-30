// OBA Hair POS - Cashier module
// DEV V11.1.20-D5：收款出單模組
// 從 index.html 拆出：品項顯示、購物車、付款確認、建立訂單。

function renderCashier(){
  $('#todayText').textContent=todayStr();
  $('#nextOrderNo').textContent=currentOrderNo();
  const grid=$('#cashierItemGrid');
  grid.innerHTML='';
  const items=activeItems();
  const grouped={};
  const singles=[];
  items.forEach(item=>{
    const cat=String(item.category||'').trim();
    if(cat){
      if(!grouped[cat]) grouped[cat]=[];
      grouped[cat].push(item);
    }else{
      singles.push(item);
    }
  });
  Object.keys(grouped).forEach(cat=>{
    const btn=document.createElement('button');
    btn.className='chip';
    btn.innerHTML=`<div class="name">${cat}</div><div class="price">點一下選金額</div>`;
    btn.onclick=()=>openItemPicker(cat);
    grid.appendChild(btn);
  });
  singles.forEach(item=>{
    const btn=document.createElement('button');
    btn.className='chip';
    btn.innerHTML=`<div class="name">${item.name}</div><div class="price">${money(item.price)}</div>`;
    btn.onclick=()=>{state.cart.push({id:item.id,name:item.name,price:Number(item.price),category:item.category||''});saveState();renderCart()};
    grid.appendChild(btn);
  });
  renderCart();
}
function openItemPicker(category){
  const list=activeItems().filter(i=>String(i.category||'').trim()===category);
  $('#itemPickTitle').textContent=category;
  const grid=$('#itemPickGrid');
  grid.innerHTML=list.map(i=>`<button class="chip" data-id="${i.id}"><div class="name">${i.name}</div><div class="price">${money(i.price)}</div></button>`).join('');
  grid.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=()=>{const item=activeItems().find(x=>x.id===btn.dataset.id);if(!item)return;state.cart.push({id:item.id,name:item.name,price:Number(item.price),category:item.category||''});saveState();renderCart();$('#itemPickDialog').close()});
  $('#itemPickDialog').showModal();
}
$('#btnCloseItemPick').onclick=()=>$('#itemPickDialog').close();

function renderCart(){
  const bill = $('#cashierBill');

  if(state.cart.length===0){
    bill.innerHTML = '<div class="note">尚未加入任何項目</div>';
  }else{
    bill.innerHTML = state.cart.map((i,idx)=>`
      <div class="bill-row">
        <div>
          <button type="button" class="btn btn-danger" onclick="removeCartItem(${idx})" style="margin-right:8px;padding:4px 10px;border-radius:10px;font-size:13px">取消</button>
          ${idx+1}. ${i.name}
        </div>
        <div>${money(i.price)}</div>
      </div>
    `).join('');
  }

  $('#cashierCount').textContent = state.cart.length;
  $('#cashierTotal').textContent = money(state.cart.reduce((s,i)=>s+i.price,0));
  $('#cashierStatus').textContent = state.cart.length ? '待收款' : '未結帳';
}

function removeCartItem(idx){
  state.cart.splice(idx,1);
  saveState();
  renderCart();
}
document.querySelectorAll('[data-pay]').forEach(btn=>btn.onclick=async ()=>{
  if(state.cart.length===0){alert('請先加入項目');return}
  const checkoutItems = clone(state.cart).filter(i=>i && String(i.name||'').trim());
  const checkoutTotal = checkoutItems.reduce((s,i)=>s+Number(i.price||0),0);
  if(checkoutItems.length===0 || checkoutTotal<=0){alert('本單沒有有效品項，不能出單');return}
  CURRENT_CASHIER=null;
  updateCashierDisplay();
  if(!(await requireCashier()))return;
  const method=btn.dataset.pay;
  const lockedOrderNo=currentOrderNo();
  CHECKOUT_SNAPSHOT={
    orderNo:lockedOrderNo,
    items:clone(checkoutItems),
    total:checkoutTotal,
    paymentMethod:method,
    cashierId:CURRENT_CASHIER?.id||'',
    cashierName:CURRENT_CASHIER?.name||''
  };
  state.pendingPay=method;
  state.pendingCheckoutCart=clone(checkoutItems); // V11.0.85：雙重鎖住本單快照，避免確認前 cart 被同步洗掉變無品項單
  localStorage.setItem(KEY, JSON.stringify(state));
  $('#paySummary').textContent=`單號：${lockedOrderNo}｜總金額：${money(checkoutTotal)}｜收款方式：${method}｜經手人：${CURRENT_CASHIER?.name||'-'}`;
  $('#payDialog').showModal()
})
$('#btnCancelPay').onclick=()=>{
  CHECKOUT_SNAPSHOT=null;
  state.pendingPay='';
  state.pendingCheckoutCart=null;
  localStorage.setItem(KEY, JSON.stringify(state));
  $('#payDialog').close();
};
$('#btnConfirmPay').onclick=()=>{
  if(guardBossAction()) return;
  const snap = CHECKOUT_SNAPSHOT || {};
  const checkoutItems = Array.isArray(snap.items) && snap.items.length ? clone(snap.items) : (Array.isArray(state.pendingCheckoutCart) && state.pendingCheckoutCart.length ? clone(state.pendingCheckoutCart) : clone(state.cart));
  const checkoutTotal = Number(snap.total || checkoutItems.reduce((s,i)=>s+Number(i.price||0),0));
  const hasValidItems = checkoutItems.length>0 && checkoutItems.every(i=>i && String(i.name||'').trim());
  if(!hasValidItems || checkoutTotal<=0){
    alert('本單品項資料已遺失，系統已阻止出單。請重新選品項後再收款。');
    CHECKOUT_SNAPSHOT=null;
    state.pendingPay='';
    state.pendingCheckoutCart=null;
    $('#payDialog').close();
    renderCashier();
    return;
  }
  const order={id:snap.orderNo||currentOrderNo(),date:todayStr(),time:nowTime(),branchId:state.branchId||DEFAULT_BRANCH_ID,branchName:state.branchName||DEFAULT_BRANCH_NAME,items:checkoutItems,total:checkoutTotal,paymentMethod:snap.paymentMethod||state.pendingPay,cashierId:snap.cashierId||CURRENT_CASHIER?.id||'',cashierName:snap.cashierName||CURRENT_CASHIER?.name||'',assignedDesignerId:'',assignedDesignerName:'',commission:0,assignedAt:'',refunded:false,createdAt:new Date().toISOString()};
  state.orders.unshift(order);
  consumeMonthlyOrderNo();
  state.cart=[];
  state.pendingPay='';
  state.pendingCheckoutCart=null;
  CHECKOUT_SNAPSHOT=null;
  CURRENT_CASHIER=null;
  saveState(true);
  renderCashier();renderAssign();renderReport();updateCashierDisplay();
  $('#payDialog').close();
  openReceipt(order)
}

function updateItemSaveStatus(){
  const status = $('#itemSaveStatus');
  const btn = $('#btnSaveItems');
  if(!status || !btn) return;
  if(ITEM_DIRTY){
    status.textContent='尚未儲存';
    status.classList.remove('saved');
    status.classList.add('dirty');
    btn.textContent='儲存品項資料';
  }else{
    status.textContent='已儲存';
    status.classList.remove('dirty');
    status.classList.add('saved');
    btn.textContent='儲存品項資料';
  }
}
function markItemsDirty(){
  ITEM_DIRTY=true;
  updateItemSaveStatus();
}
function applyPresetPermissions(s){if(s.systemRole==='管理者'){s.permissions=['checkout','assign','refund','report','manage','item','password','view_all']} else if(s.systemRole==='一般員工'){s.permissions=['checkout','assign','refund']} else if(s.systemRole==='僅查看者'){s.permissions=['report','view_all']}}
function rulePercent(s,name){
  if(!s.rules) s.rules={default:0.5};
  const v = s.rules[name] ?? s.rules.default ?? 0.5;
  return Math.round(Number(v||0)*100);
}

function updateStaffRule(staffId, ruleName, value){
  const staff = state.staff.find(s=>s.id===staffId);
  if(!staff) return;

  if(!staff.rules) staff.rules={default:0.5};

  let num = Number(value||0);
  if(isNaN(num)) num = 0;
  if(num < 0) num = 0;
  if(num > 100) num = 100;

  staff.rules[ruleName] = Number((num / 100).toFixed(2));

  markStaffDirty();

  console.log('抽成比例暫存', staffId, ruleName, staff.rules[ruleName]);
}
function renderCommissionInputs(s,names){
  if(!s.rules) s.rules={default:0.5};
  const unique=[...new Set(names.filter(Boolean))];
  return `<div class="space"></div><div class="label">抽成比例設定（可個別更改，輸入 50 代表 50%）</div><div class="grid4"><div><div class="label">預設抽成 %</div><input class="input" type="number" min="0" max="100" value="${rulePercent(s,'default')}" onchange="updateStaffRule('${s.id}','default',this.value)"></div>${unique.map(name=>`<div><div class="label">${name} %</div><input class="input" type="number" min="0" max="100" value="${rulePercent(s,name)}" onchange="updateStaffRule('${s.id}','${name.replace(/'/g,"\\'")}',this.value)"></div>`).join('')}</div>`;
}
function renderManage(){
  const names=activeItems().map(i=>i.name);
  $('#staffCards').innerHTML=state.staff.map(s=>{
    if(!s.permissions) s.permissions=[];
    if(!s.rules) s.rules={default:0.5};
    return `<div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between"><div><div class="section-title" style="font-size:18px;margin-bottom:4px">${s.name}</div></div><div>${s.active?'<span class="badge badge-ok">啟用中</span>':'<span class="badge badge-off">停用</span>'}</div></div>
      <div class="space"></div>
      <div class="grid4">
        <div><div class="label">姓名</div><input class="input" value="${s.name||''}" onchange="updateStaffField('${s.id}','name',this.value)"></div>
        <div><div class="label">暱稱</div><input class="input" value="${s.nickname||''}" onchange="updateStaffField('${s.id}','nickname',this.value)"></div>
        <div><div class="label">電話</div><input class="input" value="${s.phone||''}" onchange="updateStaffField('${s.id}','phone',this.value)"></div>
        <div><div class="label">住址</div><input class="input" value="${s.address||''}" onchange="updateStaffField('${s.id}','address',this.value)"></div>
      </div>
      <div class="space"></div>
      <div class="grid4">
        <div><div class="label">到職日</div><input class="input" type="date" value="${s.joinDate||''}" onchange="updateStaffField('${s.id}','joinDate',this.value)"></div>
        <div><div class="label">年資</div><div class="pill">${getYearsText(s.joinDate)}</div></div>
        <div><div class="label">PIN</div><input class="input" inputmode="numeric" value="" placeholder="已隱藏；輸入新 PIN 才會覆蓋" onchange="updateStaffField('${s.id}','pin',this.value);this.value=''"></div>
        <div><div class="label">是否在職</div><select class="select" onchange="updateStaffActive('${s.id}',this.value)"><option value="true" ${s.active?'selected':''}>在職</option><option value="false" ${!s.active?'selected':''}>離職</option></select></div>
      </div>
      <div class="space"></div>
      <div class="grid2">
        <div><div class="label">職務類型</div><select class="select" onchange="updateStaffField('${s.id}','role',this.value)"><option value="店長" ${s.role==='店長'?'selected':''}>門市管理</option><option value="老闆" ${s.role==='老闆'?'selected':''}>查看管理</option><option value="設計師" ${s.role==='設計師'?'selected':''}>服務人員</option><option value="助理" ${s.role==='助理'?'selected':''}>助理</option><option value="收銀員" ${s.role==='收銀員'?'selected':''}>櫃台</option></select></div>
        <div><div class="label">使用權限</div><select class="select" onchange="updateSystemRole('${s.id}',this.value)"><option value="擁有者" ${s.systemRole==='擁有者'?'selected':''}>最高權限</option><option value="管理者" ${s.systemRole==='管理者'?'selected':''}>管理權限</option><option value="一般員工" ${s.systemRole==='一般員工'?'selected':''}>基本權限</option><option value="僅查看者" ${s.systemRole==='僅查看者'?'selected':''}>檢視權限</option></select></div>
      </div>
      ${renderCommissionInputs(s,names)}
      <div class="space"></div>
      <div><div class="label">權限勾選</div><div class="permission-grid">${['checkout|可收款出單','assign|可刷單入業績','refund|可退票','report|可看報表','manage|可進員工資料','item|可改品項','password|可改密碼','view_all|可看全部營業額'].map(p=>{const[k,l]=p.split('|');return `<label><input type="checkbox" ${s.permissions.includes(k)?'checked':''} onchange="togglePermission('${s.id}','${k}',this.checked)"> ${l}</label>`}).join('')}</div></div>
      <div class="space"></div>
      <div class="row"><button class="btn btn-soft" onclick="updateSystemRoleByRole('${s.id}')">依身份自動套權限</button><button class="btn btn-ok" onclick="saveStaffChanges()">儲存修改</button><button class="btn btn-danger" onclick="deleteStaff('${s.id}')" ${s.owner?'disabled':''}>刪除此員工</button></div>
    </div>`;
  }).join('');
  $('#itemManageList').innerHTML=state.items.map(i=>`<div class="card" style="margin-bottom:10px"><div class="grid4"><input class="input" value="${i.category||''}" placeholder="分類" onchange="updateItemField('${i.id}','category',this.value)"><input class="input" value="${i.name}" placeholder="品項名稱" onchange="updateItemField('${i.id}','name',this.value)"><input class="input" type="number" value="${i.price}" placeholder="價格" onchange="updateItemField('${i.id}','price',this.value)"><select class="select" onchange="updateItemField('${i.id}','active',this.value)"><option value="true" ${i.active?'selected':''}>啟用</option><option value="false" ${!i.active?'selected':''}>停用</option></select></div><div class="space"></div><div class="grid2"><div><div class="label">集點卡兌換</div><select class="select" onchange="updateItemField('${i.id}','redeemable',this.value)"><option value="false" ${!i.redeemable?'selected':''}>不可兌換</option><option value="true" ${i.redeemable?'selected':''}>可兌換</option></select></div><div><div class="label">刪除品項</div><div class="row"><button class="btn btn-danger" onclick="deleteItem('${i.id}')">刪除此品項</button><button class="btn btn-ok" onclick="saveItemsChanges()">儲存修改</button></div></div></div></div>`).join('');
  updateItemSaveStatus();
}


// V11.0.44：員工資料編輯中立即標記，避免15秒雲端pull重畫造成欄位跳走
const staffCardsEl = document.getElementById('staffCards');
if(staffCardsEl){
  staffCardsEl.addEventListener('input', function(){ markStaffDirty(); });
  staffCardsEl.addEventListener('focusin', function(){ STAFF_DIRTY=true; });
}

window.updateStaffRule=(staffId,name,value)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId); if(!s)return; if(!s.rules)s.rules={default:0.5}; const n=Number(value||0); s.rules[name]=Math.max(0,Math.min(100,n))/100; markStaffDirty(); renderAssign(); renderReport();}
window.saveStaffChanges=()=>{if(guardBossAction()) return; STAFF_DIRTY=false; saveState(true); renderAssign(); renderReport(); renderManageKeepScroll(); alert('員工資料已儲存')}
window.saveItemsChanges=()=>{if(guardBossAction()) return; saveState(); ITEM_DIRTY=false; renderCashier(); renderAssign(); renderReport(); renderManageKeepScroll(); alert('品項資料已儲存')}
window.updateStaffField=(staffId,field,value)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId);if(!s)return; if(field==='pin'){ const v=String(value||'').trim(); if(!v) return; if(!/^\d{4,8}$/.test(v)){ alert('PIN 請輸入 4 到 8 位數字'); return; } s.pin=v; } else { s[field]=value; } markStaffDirty(); renderAssign(); updateCashierDisplay()}
window.updateStaffActive=(staffId,value)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId);if(!s)return; if(s.owner&&value==='false'){alert('此資料不可停用');return} s.active=value==='true'; markStaffDirty(); renderAssign();}
window.updateSystemRole=(staffId,value)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId);if(!s)return; s.systemRole=value; markStaffDirty();}
window.updateSystemRoleByRole=(staffId)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId);if(!s)return; if(s.role==='老闆'||s.role==='店長')s.systemRole='管理者'; else s.systemRole='一般員工'; applyPresetPermissions(s); markStaffDirty(); renderManageKeepScroll()}
window.togglePermission=(staffId,key,checked)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===staffId);if(!s)return; if(!Array.isArray(s.permissions))s.permissions=[]; const has=s.permissions.includes(key); if(checked&&!has)s.permissions.push(key); if(!checked&&has)s.permissions=s.permissions.filter(x=>x!==key); markStaffDirty(); renderAssign(); renderReport();}
window.deleteStaff=(id)=>{if(guardBossAction()) return; const s=state.staff.find(x=>x.id===id);if(!s)return; if(s.owner){alert('此資料不可刪除');return} if(!confirm(`確定刪除 ${s.name} 嗎？`))return; state.staff=state.staff.filter(x=>x.id!==id); markStaffDirty(); renderAssign(); renderManage(); alert('已從畫面移除，請按儲存員工資料')}
document.getElementById('btnAddStaff').onclick=()=>{if(guardBossAction()) return; const id='staff_'+Date.now(); state.staff.push({id,name:'新員工',nickname:'新員工',phone:'',address:'',joinDate:todayStr(),role:'設計師',systemRole:'一般員工',active:true,owner:false,pin:'',rules:{default:0.5},permissions:['assign']}); markStaffDirty(); renderAssign(); renderManage(); alert('已新增員工，請補完整資料並輸入新 PIN 後按儲存員工資料')}
window.updateItemField=(id,field,val)=>{if(guardBossAction()) return; const i=state.items.find(x=>x.id===id);if(!i)return; if(field==='price')i[field]=Number(val||0); else if(field==='active' || field==='redeemable')i[field]=val==='true'; else i[field]=val; ITEM_DIRTY=true; renderCashier(); updateItemSaveStatus();}
document.getElementById('btnAddItem').onclick=()=>{if(guardBossAction()) return; const category=$('#newItemCategory').value.trim(), name=$('#newItemName').value.trim(), price=Number($('#newItemPrice').value||0); if(!category||!name||!price){alert('請輸入分類、品項名稱與價格');return} const newItem={id:'item'+Date.now(),category,name,price,active:true,quick:false}; state.items.unshift(newItem); $('#newItemCategory').value=''; $('#newItemName').value=''; $('#newItemPrice').value=''; ITEM_DIRTY=true; renderCashier(); renderManage(); setActiveTab('manage'); const list=$('#itemManageList'); if(list) list.scrollIntoView({behavior:'smooth',block:'start'}); alert('已新增品項，會歸在「'+category+'」分類；請按儲存品項資料')}
window.deleteItem=(id)=>{if(guardBossAction()) return; const item=state.items.find(x=>x.id===id);if(!item)return;if(!confirm('確定刪除「'+item.name+'」嗎？'))return;state.items=state.items.filter(x=>x.id!==id);ITEM_DIRTY=true;renderCashier();renderManageKeepScroll();alert('已刪除，請按儲存品項資料')}

document.addEventListener('click', function(e){
  if(e.target && e.target.id==='btnSaveStaff'){
    if(guardBossAction()) return;
    STAFF_DIRTY=false;
    saveState(true);
    renderAssign();
    renderReport();
    renderManageKeepScroll();
    alert('員工資料已儲存');
  }
  if(e.target && e.target.id==='btnSaveItems'){
    if(guardBossAction()) return;
    saveState();
    ITEM_DIRTY=false;
    renderCashier();
    renderAssign();
    renderReport();
    renderManageKeepScroll();
    alert('品項資料已儲存');
  }
});

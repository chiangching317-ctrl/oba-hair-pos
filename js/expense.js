let expenseEditingId='';
function loadExpenses(){
  try{
    const raw=localStorage.getItem(EXPENSE_KEY);
    const list=raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){
    return [];
  }
}
function saveExpenses(list){
  localStorage.setItem(EXPENSE_KEY, JSON.stringify(Array.isArray(list)?list:[]));
}
function setExpenseStatus(text, mode='saved'){
  const status=$('#expenseSaveStatus');
  if(!status) return;
  status.textContent=text;
  status.className='save-status '+(mode==='dirty'?'dirty':'saved');
}
function setExpenseEditingMode(id=''){
  expenseEditingId=String(id||'');
  const saveBtn=$('#btnSaveExpense');
  const cancelBtn=$('#btnCancelExpenseEdit');
  const clearBtn=$('#btnClearExpenseForm');
  if(saveBtn) saveBtn.textContent = expenseEditingId ? '儲存修改' : '儲存支出';
  if(cancelBtn) cancelBtn.classList.toggle('hidden', !expenseEditingId);
  if(clearBtn) clearBtn.textContent = expenseEditingId ? '清空重填' : '清空欄位';
}

function clearExpenseForm(){
  const dateEl=$('#expenseDate'), categoryEl=$('#expenseCategory'), amountEl=$('#expenseAmount'), noteEl=$('#expenseNote');
  if(dateEl) dateEl.value=todayStr();
  if(categoryEl) categoryEl.value='材料';
  if(amountEl) amountEl.value='';
  if(noteEl) noteEl.value='';
  setExpenseEditingMode('');
  setExpenseStatus('等待輸入','saved');
}

function cancelExpenseEdit(){
  clearExpenseForm();
  setExpenseStatus('已取消編輯','saved');
}

function expenseMonthOf(date){
  return String(date||'').slice(0,7);
}
function renderExpenses(){
  bindExpenseEvents();
  const dateEl=$('#expenseDate');
  if(dateEl && !dateEl.value) dateEl.value=todayStr();
  const list=loadExpenses().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const today=todayStr();
  const month=monthStr();
  const todayList=list.filter(e=>e.date===today);
  const monthList=list.filter(e=>expenseMonthOf(e.date)===month);
  const todayTotal=todayList.reduce((s,e)=>s+Number(e.amount||0),0);
  const monthTotal=monthList.reduce((s,e)=>s+Number(e.amount||0),0);
  const t1=$('#expenseTodayTotal'), t2=$('#expenseMonthTotal'), t3=$('#expenseMonthCount');
  if(t1) t1.textContent=money(todayTotal);
  if(t2) t2.textContent=money(monthTotal);
  if(t3) t3.textContent=monthList.length;
  const table=$('#expenseTable');
  if(!table) return;
  if(!list.length){
    table.innerHTML='<div class="tr"><div>目前還沒有支出紀錄</div></div>';
    return;
  }
  table.innerHTML='<div class="tr header"><div>日期</div><div>分類</div><div>金額</div><div>備註</div><div>操作</div></div>'+list.map(e=>`
    <div class="tr">
      <div>${escapeHtml(e.date)}</div>
      <div>${escapeHtml(e.category)}</div>
      <div>${money(e.amount)}</div>
      <div>${escapeHtml(e.note||'-')}</div>
      <div class="row">
        <button class="btn btn-soft btnEditExpense" data-id="${escapeHtml(e.id)}" type="button">編輯</button>
        <button class="btn btn-danger btnDeleteExpense" data-id="${escapeHtml(e.id)}" type="button">刪除</button>
      </div>
    </div>`).join('');
}

function startExpenseEdit(id){
  if(guardBossAction()) return;
  const list=loadExpenses();
  const item=list.find(e=>String(e.id)===String(id));
  if(!item){ alert('找不到這筆支出'); return; }
  const dateEl=$('#expenseDate'), categoryEl=$('#expenseCategory'), amountEl=$('#expenseAmount'), noteEl=$('#expenseNote');
  if(dateEl) dateEl.value=item.date||todayStr();
  if(categoryEl) categoryEl.value=item.category||'材料';
  if(amountEl) amountEl.value=Number(item.amount||0);
  if(noteEl) noteEl.value=item.note||'';
  setExpenseEditingMode(item.id);
  setExpenseStatus('正在編輯這筆支出','dirty');
  const panel=$('#tab-expense');
  if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
  setTimeout(()=>amountEl?.focus(),120);
}

function saveExpenseEntry(){
  if(guardBossAction()) return;
  const date=($('#expenseDate')?.value || todayStr()).trim();
  const category=($('#expenseCategory')?.value || '').trim();
  const rawAmount=String($('#expenseAmount')?.value || '').trim();
  const amount=Number(rawAmount);
  const note=($('#expenseNote')?.value || '').trim();

  if(!date){ alert('請選擇支出日期'); $('#expenseDate')?.focus(); setExpenseStatus('日期未填','dirty'); return; }
  if(!category){ alert('請選擇支出分類'); $('#expenseCategory')?.focus(); setExpenseStatus('分類未選','dirty'); return; }
  if(!rawAmount || !Number.isFinite(amount) || amount<=0){ alert('請輸入正確的支出金額'); $('#expenseAmount')?.focus(); setExpenseStatus('金額未完成','dirty'); return; }

  const list=loadExpenses();
  if(expenseEditingId){
    const idx=list.findIndex(e=>String(e.id)===String(expenseEditingId));
    if(idx<0){
      alert('找不到原本那筆支出，請重新整理後再試');
      setExpenseStatus('修改失敗','dirty');
      return;
    }
    list[idx]={
      ...list[idx],
      date,
      category,
      amount:Math.round(amount),
      note,
      updatedAt:new Date().toISOString()
    };
    saveExpenses(list);
    clearExpenseForm();
    setExpenseStatus('支出修改已儲存','saved');
    renderExpenses();
    return;
  }

  list.unshift({
    id:'EXP-'+Date.now(),
    date,
    category,
    amount:Math.round(amount),
    note,
    createdAt:new Date().toISOString()
  });
  saveExpenses(list);
  clearExpenseForm();
  setExpenseStatus('支出已儲存','saved');
  renderExpenses();
}
function addExpense(){
  // 保留舊函式名稱，避免舊按鈕或舊事件找不到。
  saveExpenseEntry();
}
function deleteExpense(id){
  if(guardBossAction()) return;
  const list=loadExpenses();
  const item=list.find(e=>String(e.id)===String(id));
  const label=item ? `${item.date || ''} ${item.category || ''} ${money(item.amount || 0)}` : '這筆支出';
  if(!confirm(`確定刪除 ${label} 嗎？`)) return;
  const next=list.filter(e=>String(e.id)!==String(id));
  saveExpenses(next);
  if(String(expenseEditingId)===String(id)) clearExpenseForm();
  setExpenseStatus('支出已刪除','saved');
  renderExpenses();
}

function bindExpenseEvents(){
  const saveBtn=$('#btnSaveExpense') || $('#btnAddExpense');
  const clearBtn=$('#btnClearExpenseForm');
  const cancelBtn=$('#btnCancelExpenseEdit');
  const refreshBtn=$('#btnExpenseRefresh');
  const table=$('#expenseTable');
  const inputs=['#expenseDate','#expenseCategory','#expenseAmount','#expenseNote'];

  if(saveBtn && !saveBtn.dataset.bound){
    saveBtn.dataset.bound='yes';
    saveBtn.onclick=saveExpenseEntry;
  }
  if(clearBtn && !clearBtn.dataset.bound){
    clearBtn.dataset.bound='yes';
    clearBtn.onclick=clearExpenseForm;
  }
  if(cancelBtn && !cancelBtn.dataset.bound){
    cancelBtn.dataset.bound='yes';
    cancelBtn.onclick=cancelExpenseEdit;
  }
  if(refreshBtn && !refreshBtn.dataset.bound){
    refreshBtn.dataset.bound='yes';
    refreshBtn.onclick=renderExpenses;
  }
  if(table && !table.dataset.bound){
    table.dataset.bound='yes';
    table.addEventListener('click', e=>{
      const editBtn=e.target.closest('.btnEditExpense');
      const deleteBtn=e.target.closest('.btnDeleteExpense');
      if(editBtn) startExpenseEdit(editBtn.dataset.id);
      if(deleteBtn) deleteExpense(deleteBtn.dataset.id);
    });
  }
  inputs.forEach(sel=>{
    const el=$(sel);
    if(el && !el.dataset.expenseDirtyBound){
      el.dataset.expenseDirtyBound='yes';
      el.addEventListener('input', ()=>setExpenseStatus(expenseEditingId?'修改尚未儲存':'尚未儲存','dirty'));
      el.addEventListener('change', ()=>setExpenseStatus(expenseEditingId?'修改尚未儲存':'尚未儲存','dirty'));
      if(sel==='#expenseAmount'){
        el.addEventListener('keydown', e=>{ if(e.key==='Enter') saveExpenseEntry(); });
      }
    }
  });
  setExpenseEditingMode(expenseEditingId);
}

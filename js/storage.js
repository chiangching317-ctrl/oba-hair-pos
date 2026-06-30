/* OBA Hair POS - 第三刀：storage / Supabase sync */
let cloudClient=null;
let cloudReady=false;
let cloudSaving=false;
let cloudResetting=false; // V11.0.45：清空歸零時暫停 pull，避免雲端舊資料蓋回 nextNo
function getCloudClient(){
  if(cloudClient) return cloudClient;
  if(!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) return null;
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return cloudClient;
}
function getLocalResetMarker(){return localStorage.getItem(RESET_MARKER_KEY)||''}
function setLocalResetMarker(value){if(value)localStorage.setItem(RESET_MARKER_KEY,value)}
function newestStamp(a,b){return String(a||'') > String(b||'') ? String(a||'') : String(b||'')}

function isEmptyOrBrokenCloudData(data){
  if(!data) return true;
  const staffEmpty = !Array.isArray(data.staff) || data.staff.length===0;
  const itemsEmpty = !Array.isArray(data.items) || data.items.length===0;
  return staffEmpty || itemsEmpty;
}

function normalizeCloudState(data){
  const merged = ensureBranchFields(Object.assign(clone(defaultState), data || {}));
  if(!merged.staff.find(s=>s.owner)) merged.staff[0].owner=true;
  return merged;
}
async function pullCloudState(){
  if(cloudResetting){
    console.log('正在執行清空歸零，暫停雲端 pull，避免舊資料蓋回業績');
    return false;
  }
  const client=getCloudClient();
  if(!client) return false;
  try{
    // V11.0.47：抓多筆 main row，避免 Supabase 曾經有 duplicated main row 時拉到舊 orders。
    const { data, error } = await client
      .from(CLOUD_TABLE)
      .select('id,data,updated_at')
      .eq('id', CLOUD_ROW_ID)
      .order('updated_at', { ascending:false })
      .limit(20);

    if(error){ console.log('雲端讀取失敗', error); return false; }

    if(data && data.length>0){
      const rows = data.filter(r=>r && r.data);
      if(rows.length){
        // 若有清空紀錄，以 lastResetAt 最新的乾淨 row 為主；否則用 updated_at 最新 row。
        rows.sort((a,b)=>{
          const ar = String(a.data?.lastResetAt || '');
          const br = String(b.data?.lastResetAt || '');
          if(ar || br) return br.localeCompare(ar);
          return String(b.updated_at||'').localeCompare(String(a.updated_at||''));
        });
        const chosen = rows[0];

        // V11.0.69：線上測試保護。雲端若是空資料，不准覆蓋畫面，改成用目前本機/預設資料補回雲端。
        if(isEmptyOrBrokenCloudData(chosen.data)){
          console.log('雲端資料是空的或不完整，已阻止覆蓋本機資料，改上傳目前資料到雲端');
          await saveState(true);
          return true;
        }

        const localResetAt = newestStamp(state?.lastResetAt, getLocalResetMarker());
        const cloudResetAt = String(chosen.data?.lastResetAt || '');
        const localIsClean = Array.isArray(state.orders) && state.orders.length===0 && Array.isArray(state.refunds) && state.refunds.length===0;
        const cloudHasOldOrders = Array.isArray(chosen.data?.orders) && chosen.data.orders.length>0;
        if(localResetAt && localIsClean && cloudHasOldOrders && cloudResetAt < localResetAt){
          console.log('已擋下舊雲端 orders：本機已歸零，雲端 row 較舊，不覆蓋', {localResetAt, cloudResetAt, cloudOrders:chosen.data.orders.length});
          return false;
        }
        // V11.0.87：開單中保護。若正在選品項或確認收款，雲端 15 秒 pull 不可把本單 cart 洗掉。
        const keepCheckout = (typeof isCheckoutInProgress === 'function') && isCheckoutInProgress();
        const localCartSnapshot = keepCheckout ? clone(state.cart || []) : null;
        const localPendingPaySnapshot = keepCheckout ? (state.pendingPay || '') : '';
        const localPendingCheckoutSnapshot = keepCheckout ? clone(state.pendingCheckoutCart || null) : null;
        state = normalizeCloudState(chosen.data);
        if(keepCheckout){
          state.cart = Array.isArray(localCartSnapshot) ? localCartSnapshot : [];
          state.pendingPay = localPendingPaySnapshot;
          state.pendingCheckoutCart = localPendingCheckoutSnapshot;
          localStorage.setItem(KEY, JSON.stringify(state));
        }
        const effectiveResetAt = newestStamp(state.lastResetAt, getLocalResetMarker());
        if(effectiveResetAt){
          state.lastResetAt = effectiveResetAt;
          setLocalResetMarker(effectiveResetAt);
          state.orders = (state.orders||[]).filter(o=>isAfterStamp(timeStampOfOrder(o), effectiveResetAt));
          state.refunds = (state.refunds||[]).filter(r=>isAfterStamp(timeStampOfOrder(r), effectiveResetAt));
          state.cart = [];
          state.pendingPay = '';
        }
        localStorage.setItem(KEY, JSON.stringify(state));
        console.log('雲端資料已載入（已避開舊 main row）', chosen.updated_at, 'rows=', rows.length);
        return true;
      }
    }

    await saveState(true);
    return true;
  }catch(err){
    console.log('雲端讀取錯誤', err);
    return false;
  }
}
async function saveState(forceCloud=false){
  localStorage.setItem(KEY,JSON.stringify(state));
  console.log('本機已存檔');

  const client=getCloudClient();
  if(!client) return;
  if(cloudSaving && !forceCloud) return;
  cloudSaving=true;
  try{
    const payload = {
      id:CLOUD_ROW_ID,
      data:state,
      updated_at:new Date().toISOString()
    };

    // V11.0.42：先 update id=main。若資料表曾經沒有 UNIQUE，這會把所有 main row 一起覆蓋成最新狀態。
    const updateResult = await client
      .from(CLOUD_TABLE)
      .update({ data:payload.data, updated_at:payload.updated_at })
      .eq('id', CLOUD_ROW_ID)
      .select('id,updated_at');

    if(updateResult.error){
      console.log('雲端 update 失敗', updateResult.error);
    }

    if(!updateResult.data || updateResult.data.length===0){
      console.log('找不到 main row，建立新的 main row');
      const insertResult = await client
        .from(CLOUD_TABLE)
        .insert(payload)
        .select('id,updated_at');

      if(insertResult.error){
        console.log('雲端 insert 失敗', insertResult.error);
      }else{
        cloudReady=true;
        console.log('雲端同步成功（insert main）', insertResult.data);
      }
    }else{
      cloudReady=true;
      console.log('雲端同步成功（update main）', updateResult.data);
    }
  }catch(err){
    console.log('同步錯誤', err);
  }finally{
    cloudSaving=false;
  }
}
async function replaceCloudMainRowForReset(resetState){
  const client=getCloudClient();
  if(!client) return false;
  const cleanState = normalizeCloudState(clone(resetState));
  const payload = {
    id:CLOUD_ROW_ID,
    data:cleanState,
    updated_at:new Date().toISOString()
  };

  cloudResetting=true;
  cloudSaving=true;
  try{
    // V11.0.45：清空全部資料時，不只 update；先刪掉所有 id=main 的舊列，避免 duplicated main row 之後又把 nextNo 拉回舊值。
    const deleteResult = await client
      .from(CLOUD_TABLE)
      .delete()
      .eq('id', CLOUD_ROW_ID)
      .select('id,updated_at');

    if(deleteResult.error){
      console.log('雲端 reset delete 失敗，改用 update 覆蓋所有 main row', deleteResult.error);
      const updateResult = await client
        .from(CLOUD_TABLE)
        .update({ data:payload.data, updated_at:payload.updated_at })
        .eq('id', CLOUD_ROW_ID)
        .select('id,updated_at');

      if(updateResult.error){
        console.log('雲端 reset update 也失敗', updateResult.error);
        return false;
      }

      if(!updateResult.data || updateResult.data.length===0){
        const insertFallback = await client
          .from(CLOUD_TABLE)
          .insert(payload)
          .select('id,updated_at');
        if(insertFallback.error){
          console.log('雲端 reset insert fallback 失敗', insertFallback.error);
          return false;
        }
      }
    }else{
      console.log('雲端 reset 已刪除舊 main row 數量', deleteResult.data?.length || 0);
      const insertResult = await client
        .from(CLOUD_TABLE)
        .insert(payload)
        .select('id,data,updated_at');

      if(insertResult.error){
        console.log('雲端 reset insert 失敗，改用 upsert', insertResult.error);
        const upsertResult = await client
          .from(CLOUD_TABLE)
          .upsert(payload, { onConflict:'id' })
          .select('id,data,updated_at');
        if(upsertResult.error){
          console.log('雲端 reset upsert 失敗', upsertResult.error);
          return false;
        }
      }
    }

    // V11.0.47：驗證所有 main row 都已經被清成 orders=0、refunds=0，避免 duplicated main row 又拉回舊業績。
    const verify = await client
      .from(CLOUD_TABLE)
      .select('id,data,updated_at')
      .eq('id', CLOUD_ROW_ID)
      .order('updated_at', { ascending:false })
      .limit(20);

    if(verify.error){
      console.log('雲端 reset 驗證失敗', verify.error);
      return false;
    }

    const rows = verify.data || [];
    const badRows = rows.filter(row=>{
      const d=row.data||{};
      const ordersOk=Array.isArray(d.orders) && d.orders.length===0;
      const refundsOk=Array.isArray(d.refunds) && d.refunds.length===0;
      const cartOk=Array.isArray(d.cart) && d.cart.length===0;
      const resetOk=String(d.lastResetAt||'')===String(cleanState.lastResetAt||'');
      return !(ordersOk && refundsOk && cartOk && resetOk);
    });
    if(rows.length===0 || badRows.length>0){
      console.log('雲端 reset 驗證未通過：仍有舊 main row 或資料未清乾淨', {rows, badRows});
      return false;
    }

    cloudReady=true;
    console.log('雲端 reset 完成：orders=0，refunds=0，cart=0，業績歸零，main rows=', rows.length);
    return true;
  }catch(err){
    console.log('雲端 reset 錯誤', err);
    return false;
  }finally{
    cloudSaving=false;
    cloudResetting=false;
  }
}
function refreshAllScreens(){
  updateCashierDisplay();
  renderCashier();
  renderAssign();
  renderReport();
  renderTimeclock();
  renderExpenses();
  renderManage();
  applyBossMode();
}
async function startCloudSync(){
  const ok = await pullCloudState();
  if(ok){
    if(purgeInvalidEmptyOrders()) saveState(true);
    refreshAllScreens();
  }else{
    console.log('目前使用本機資料，並嘗試補上雲端，避免線上空白');
    await saveState(true);
    refreshAllScreens();
  }
  setInterval(async()=>{
    if(ITEM_DIRTY || STAFF_DIRTY || isManageEditing() || ((typeof isCheckoutInProgress === 'function') && isCheckoutInProgress())){ console.log('資料正在編輯或開單中，暫停雲端覆蓋'); return; }
    const ok = await pullCloudState();
    if(ok) refreshAllScreens();
  }, 15000);
}

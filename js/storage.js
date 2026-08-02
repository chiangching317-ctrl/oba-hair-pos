/* OBA Hair POS - 第三刀：storage / Supabase sync */
let cloudClient=null;
let cloudReady=false;
let cloudSaving=false;
let cloudResetting=false; // V11.0.45：清空歸零時暫停 pull，避免雲端舊資料蓋回 nextNo
let cloudStateVerified=false; // 僅在成功讀到完整 main row 後，才允許整包回寫雲端。
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
    cloudStateVerified=false;
    return false;
  }
  const client=getCloudClient();
  if(!client){ cloudStateVerified=false; return false; }
  try{
    // V11.0.47：抓多筆 main row，避免 Supabase 曾經有 duplicated main row 時拉到舊 orders。
    const { data, error } = await client
      .from(CLOUD_TABLE)
      .select('id,data,updated_at')
      .eq('id', CLOUD_ROW_ID)
      .order('updated_at', { ascending:false })
      .limit(20);

    if(error){ cloudStateVerified=false; console.log('雲端讀取失敗，已停止雲端回寫', error); return false; }

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

        // Fail-safe：雲端 main row 不完整時絕不以本機 state 回寫，避免新裝置覆蓋正式資料。
        if(isEmptyOrBrokenCloudData(chosen.data)){
          cloudStateVerified=false;
          console.log('雲端資料是空的或不完整，已停止雲端回寫，保留目前本機資料');
          return false;
        }

        const localResetAt = newestStamp(state?.lastResetAt, getLocalResetMarker());
        const cloudResetAt = String(chosen.data?.lastResetAt || '');
        const localIsClean = Array.isArray(state.orders) && state.orders.length===0 && Array.isArray(state.refunds) && state.refunds.length===0;
        const cloudHasOldOrders = Array.isArray(chosen.data?.orders) && chosen.data.orders.length>0;
        if(localResetAt && localIsClean && cloudHasOldOrders && cloudResetAt < localResetAt){
          cloudStateVerified=false;
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
        cloudStateVerified=true;
        console.log('雲端資料已載入（已避開舊 main row）', chosen.updated_at, 'rows=', rows.length);
        return true;
      }
    }

    cloudStateVerified=false;
    console.log('雲端找不到有效 main row，已停止雲端回寫，保留目前本機資料');
    return false;
  }catch(err){
    cloudStateVerified=false;
    console.log('雲端讀取錯誤，已停止雲端回寫', err);
    return false;
  }
}
async function saveState(forceCloud=false){
  localStorage.setItem(KEY,JSON.stringify(state));
  console.log('本機已存檔');

  const client=getCloudClient();
  if(!client) return;
  if(!cloudStateVerified){
    console.log('尚未驗證雲端 main row，已停止整包雲端回寫');
    return false;
  }
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

// V11.1.35：刷單入業績專用安全存檔（併發保護版）。
// 1) 使用與 pullCloudState 相同的主資料選擇規則。
// 2) 寫入時帶入讀取到的 updated_at 作為條件；若期間被其他裝置更新，
//    本次寫入會失敗並重新讀取重試，避免整包蓋掉別台剛完成的資料。
// 3) 寫入後再次用相同規則讀取並驗證指定單據，確認成功才回報完成。
function chooseAuthoritativeCloudRow(inputRows){
  const rows=(inputRows||[]).filter(r=>r&&r.data);
  rows.sort((a,b)=>{
    const ar=String(a.data?.lastResetAt||'');
    const br=String(b.data?.lastResetAt||'');
    if(ar||br) return br.localeCompare(ar);
    return String(b.updated_at||'').localeCompare(String(a.updated_at||''));
  });
  return rows[0]||null;
}

async function saveAssignedOrderVerified(orderId, assignment, assignLog){
  const id=String(orderId||'').trim();
  if(!id) return {ok:false, message:'缺少單號'};

  const localOrder=(state.orders||[]).find(o=>String(o.id||o.orderNo||'')===id);
  if(!localOrder) return {ok:false, message:'本機找不到這張單'};

  const client=getCloudClient();
  if(!client){
    return {ok:false, message:'目前未連上雲端，為避免假成功，這次不掛入業績'};
  }
  if(cloudSaving) return {ok:false, message:'系統正在同步，請稍候再試'};

  cloudSaving=true;
  try{
    const maxAttempts=3;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const latest=await client
        .from(CLOUD_TABLE)
        .select('id,data,updated_at')
        .eq('id',CLOUD_ROW_ID)
        .order('updated_at',{ascending:false})
        .limit(20);
      if(latest.error) return {ok:false, message:'讀取雲端失敗：'+latest.error.message};

      const chosen=chooseAuthoritativeCloudRow(latest.data||[]);
      if(!chosen) return {ok:false, message:'雲端找不到正式資料'};

      const merged=normalizeCloudState(clone(chosen.data));
      const cloudOrder=(merged.orders||[]).find(o=>String(o.id||o.orderNo||'')===id);
      if(!cloudOrder) return {ok:false, message:'雲端找不到這張單，請先同步後再刷'};
      if(cloudOrder.refunded) return {ok:false, message:'這張單已退票，不能入業績'};
      if(cloudOrder.assignedDesignerId){
        const sameStaff=String(cloudOrder.assignedDesignerId||'')===String(assignment?.assignedDesignerId||'');
        if(sameStaff){
          state=merged;
          localStorage.setItem(KEY,JSON.stringify(state));
          cloudReady=true;
          return {ok:true, alreadyVerified:true};
        }
        return {ok:false, message:'這張單已經刷過業績：'+(cloudOrder.assignedDesignerName||cloudOrder.assignedDesignerId)};
      }

      Object.assign(cloudOrder, assignment||{});
      if(!Array.isArray(merged.assignLogs)) merged.assignLogs=[];
      if(assignLog){
        const existed=merged.assignLogs.find(l=>String(l.orderNo||'')===id && l.status!=='已退票' && l.status!=='作廢');
        if(!existed) merged.assignLogs.unshift(clone(assignLog));
      }

      const stamp=new Date().toISOString();
      // 樂觀鎖：只有 chosen.updated_at 尚未被其他裝置改動時才更新該 row。
      const updateResult=await client
        .from(CLOUD_TABLE)
        .update({data:merged,updated_at:stamp})
        .eq('id',CLOUD_ROW_ID)
        .eq('updated_at',chosen.updated_at)
        .select('id,updated_at');
      if(updateResult.error) return {ok:false, message:'雲端寫入失敗：'+updateResult.error.message};

      if(!updateResult.data||!updateResult.data.length){
        if(attempt<maxAttempts){
          await new Promise(resolve=>setTimeout(resolve,180*attempt));
          continue;
        }
        return {ok:false, message:'資料剛被其他裝置更新，為避免覆蓋，這次沒有掛入。請再掃一次'};
      }

      const verify=await client
        .from(CLOUD_TABLE)
        .select('id,data,updated_at')
        .eq('id',CLOUD_ROW_ID)
        .order('updated_at',{ascending:false})
        .limit(20);
      if(verify.error) return {ok:false, message:'寫入後驗證失敗：'+verify.error.message};

      const verifiedRow=chooseAuthoritativeCloudRow(verify.data||[]);
      const verifiedState=verifiedRow?.data ? normalizeCloudState(verifiedRow.data) : null;
      const verifiedOrder=verifiedState?.orders?.find(o=>String(o.id||o.orderNo||'')===id);
      if(!verifiedOrder || String(verifiedOrder.assignedDesignerId||'')!==String(assignment?.assignedDesignerId||'')){
        return {ok:false, message:'雲端驗證未通過，系統沒有把這張單當成完成，請重新刷一次'};
      }

      state=verifiedState;
      localStorage.setItem(KEY,JSON.stringify(state));
      cloudReady=true;
      return {ok:true};
    }
    return {ok:false, message:'雲端忙碌，這次沒有掛入，請稍後再試'};
  }catch(err){
    console.log('刷單安全存檔錯誤',err);
    return {ok:false, message:'刷單存檔發生錯誤：'+(err?.message||err)};
  }finally{
    cloudSaving=false;
  }
}


// V11.1.29 P0：管理頁局部存檔保護。
// 員工/品項儲存不可用本機舊 state 整包覆蓋雲端 orders/refunds/counters。
// 流程：先讀雲端最新 main → 只套用指定欄位 → 再寫回雲端與本機。
async function saveStatePatch(patchFields){
  localStorage.setItem(KEY, JSON.stringify(state));
  const client=getCloudClient();
  if(!client){
    console.log('無雲端 client，局部存檔只寫本機', Object.keys(patchFields||{}));
    return false;
  }
  if(cloudSaving) return false;
  cloudSaving=true;
  try{
    const { data, error } = await client
      .from(CLOUD_TABLE)
      .select('id,data,updated_at')
      .eq('id', CLOUD_ROW_ID)
      .order('updated_at', { ascending:false })
      .limit(1);

    if(error){
      console.log('局部存檔讀取雲端失敗，已停止，避免覆蓋正式訂單', error);
      alert('雲端讀取失敗，為避免覆蓋訂單，這次沒有儲存。請稍後再試。');
      return false;
    }

    const cloudData = (data && data[0] && data[0].data) ? data[0].data : {};
    if(isEmptyOrBrokenCloudData(cloudData)){
      console.log('局部存檔讀到空白或不完整 main row，已停止，避免覆蓋正式資料');
      alert('雲端資料不完整，為避免覆蓋正式資料，這次沒有儲存。請稍後再試。');
      return false;
    }
    const merged = normalizeCloudState(Object.assign(clone(defaultState), cloudData));

    Object.keys(patchFields||{}).forEach(key=>{
      merged[key] = clone(patchFields[key]);
    });

    // 保險：局部存檔時，正式訂單一定以雲端最新資料為主，不吃本機舊 orders。
    merged.orders = Array.isArray(cloudData.orders) ? clone(cloudData.orders) : [];
    merged.refunds = Array.isArray(cloudData.refunds) ? clone(cloudData.refunds) : [];
    if(cloudData.nextNo !== undefined) merged.nextNo = cloudData.nextNo;
    if(cloudData.counters !== undefined) merged.counters = clone(cloudData.counters);
    if(cloudData.lastResetAt !== undefined) merged.lastResetAt = cloudData.lastResetAt;
    if(cloudData.salaryResetAt !== undefined) merged.salaryResetAt = cloudData.salaryResetAt;

    const payload = { data: merged, updated_at: new Date().toISOString() };
    const updateResult = await client
      .from(CLOUD_TABLE)
      .update(payload)
      .eq('id', CLOUD_ROW_ID)
      .select('id,data,updated_at');

    if(updateResult.error){
      console.log('局部存檔 update 失敗', updateResult.error);
      alert('雲端儲存失敗，這次沒有覆蓋訂單。請稍後再試。');
      return false;
    }

    state = normalizeCloudState(merged);
    localStorage.setItem(KEY, JSON.stringify(state));
    cloudReady=true;
    cloudStateVerified=true;
    console.log('局部存檔成功，已保留雲端 orders/refunds', {orders: state.orders?.length||0, refunds: state.refunds?.length||0, fields:Object.keys(patchFields||{})});
    return true;
  }catch(err){
    console.log('局部存檔錯誤，已停止，避免覆蓋正式訂單', err);
    alert('局部儲存發生錯誤，為避免覆蓋訂單，這次沒有儲存。');
    return false;
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
    console.log('雲端資料尚未驗證，保留目前本機資料且不回寫雲端');
    refreshAllScreens();
  }
  setInterval(async()=>{
    if(ITEM_DIRTY || STAFF_DIRTY || isManageEditing() || ((typeof isCheckoutInProgress === 'function') && isCheckoutInProgress())){ console.log('資料正在編輯或開單中，暫停雲端覆蓋'); return; }
    const ok = await pullCloudState();
    if(ok) refreshAllScreens();
  }, 15000);
}

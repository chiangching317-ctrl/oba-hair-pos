/* OBA Hair POS - 第三刀：storage / Supabase sync */
let cloudClient=null;
let cloudReady=false;
let cloudSaving=false;
let cloudResetting=false; // V11.0.45：清空歸零時暫停 pull，避免雲端舊資料蓋回 nextNo
let devEnvironmentBlocked=false;
let devBootstrapReady=false;
let credentialWriteGuardReady=false;
const DEV_ISOLATION_MIGRATION_KEY='oba_hair_DEV_isolation_cleanup_v11138';
const DEV_PULL_FAIL_LOG_KEY='oba_hair_DEV_pull_fail_logs_v1';
function recordDevPullFail(reason,error=null){
  const entry={
    event:'PULL_FAIL',
    status:'OFFLINE',
    reason,
    timestamp:new Date().toISOString(),
    error:error ? (error.message||String(error)) : ''
  };
  window.OBA_LAST_CLOUD_ERROR={
    source:reason==='SUPABASE_READ_ERROR'?'STATE_PULL_RLS':'AUTHORIZATION_DATA_LOAD',
    reason,
    code:error?.code||'',
    message:error?.message||String(error||''),
    details:error?.details||'',
    hint:error?.hint||''
  };
  console.warn('PULL_FAIL',entry);
  try{
    const raw=localStorage.getItem(DEV_PULL_FAIL_LOG_KEY);
    const parsed=raw ? JSON.parse(raw) : [];
    const logs=Array.isArray(parsed) ? parsed : [];
    logs.unshift(entry);
    localStorage.setItem(DEV_PULL_FAIL_LOG_KEY,JSON.stringify(logs.slice(0,50)));
  }catch(logError){
    console.warn('PULL_FAIL 紀錄寫入失敗',logError);
  }
}
function resetCloudClientForAccessSession(){cloudClient=null}
function getCloudClient(allowAnonymous=false){
  if(cloudClient) return cloudClient;
  if(!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) return null;
  if(typeof DEV_ENVIRONMENT!=='undefined' && DEV_ENVIRONMENT){
    const expected=String(typeof DEV_EXPECTED_PROJECT_REF!=='undefined' ? DEV_EXPECTED_PROJECT_REF : '');
    if(!expected || !String(SUPABASE_URL).includes(expected)){
      devEnvironmentBlocked=true;
      console.error('DEV 安全封鎖：Supabase 不是指定 DEV 專案', SUPABASE_URL);
      return null;
    }
  }
  const token=window.OBA_ACCESS_SESSION?.token||'';
  if(!allowAnonymous&&!token) return null;
  const options=token?{global:{headers:{'x-oba-session':token}}}:undefined;
  cloudClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, options);
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
function hasUsableCloudAuthData(data){
  return !!data&&Number(data.credentialStorageVersion||0)>=1;
}
function stripPlaintextCredentials(data){
  if(!data) return data;
  delete data.managementPassword;
  if(Array.isArray(data.staff)) data.staff.forEach(staff=>{if(staff&&typeof staff==='object') delete staff.pin});
  return data;
}
function purgeClientCredentialMaterial(){
  stripPlaintextCredentials(state);
  try{localStorage.setItem(KEY,JSON.stringify(state))}catch(error){console.warn('本機 credential 清理失敗',error)}
}
purgeClientCredentialMaterial();

function normalizeCloudState(data){
  const merged = ensureBranchFields(Object.assign(clone(defaultState), data || {}));
  if(merged.staff.length&&!merged.staff.find(s=>s.owner)) merged.staff[0].owner=true;
  return stripPlaintextCredentials(merged);
}
async function pullCloudState(){
  const localStateBeforePull=state;
  const localStateRawBeforePull=localStorage.getItem(KEY);
  const hadCloudResetAtBeforePull=Object.prototype.hasOwnProperty.call(window,'OBA_DEV_CLOUD_LAST_RESET_AT');
  const cloudResetAtBeforePull=window.OBA_DEV_CLOUD_LAST_RESET_AT;
  if(cloudResetting){
    console.log('正在執行清空歸零，暫停雲端 pull，避免舊資料蓋回業績');
    return false;
  }
  const client=getCloudClient();
  if(!client){
    recordDevPullFail('CLOUD_CLIENT_UNAVAILABLE');
    return false;
  }
  try{
    // V11.0.47：抓多筆 main row，避免 Supabase 曾經有 duplicated main row 時拉到舊 orders。
    const { data, error } = await client
      .from(CLOUD_TABLE)
      .select('id,data,updated_at')
      .eq('id', CLOUD_ROW_ID)
      .order('updated_at', { ascending:false })
      .limit(20);

    if(error){
      recordDevPullFail('SUPABASE_READ_ERROR',error);
      return false;
    }

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
        const cloudResetAt = String(chosen.data?.lastResetAt || '');

        // V11.1.38 DEV 根治：DEV 雲端若空白、不完整或沒有任何可用 PIN/管理密碼，
        // 絕不拿本機/defaultState 回填。否則可能把正式站殘留資料或空白 PIN 灌入 DEV。
        if(isEmptyOrBrokenCloudData(chosen.data)){
          console.error('DEV 雲端資料不完整，已停止載入與回填');
          recordDevPullFail('MAIN_ROW_INVALID');
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
        window.OBA_DEV_CLOUD_LAST_RESET_AT=cloudResetAt;
        state.lastResetAt=cloudResetAt;
        if(cloudResetAt){
          state.orders = (state.orders||[]).filter(o=>isAfterStamp(timeStampOfOrder(o), cloudResetAt));
          state.refunds = (state.refunds||[]).filter(r=>isAfterStamp(timeStampOfOrder(r), cloudResetAt));
          state.cart = [];
          state.pendingPay = '';
        }
        localStorage.setItem(KEY, JSON.stringify(state));
        console.log('雲端資料已載入（已避開舊 main row）', chosen.updated_at, 'rows=', rows.length);
        return true;
      }
    }

    console.error('DEV 雲端找不到有效 main row，已停止自動回填');
    recordDevPullFail('MAIN_ROW_NOT_FOUND');
    return false;
  }catch(err){
    state=localStateBeforePull;
    try{
      if(localStateRawBeforePull===null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY,localStateRawBeforePull);
    }catch(restoreError){
      console.warn('DEV pull 失敗後本機快取還原失敗',restoreError);
    }
    if(hadCloudResetAtBeforePull) window.OBA_DEV_CLOUD_LAST_RESET_AT=cloudResetAtBeforePull;
    else delete window.OBA_DEV_CLOUD_LAST_RESET_AT;
    recordDevPullFail('SUPABASE_READ_EXCEPTION',err);
    return false;
  }
}
async function saveState(forceCloud=false){
  stripPlaintextCredentials(state);
  localStorage.setItem(KEY,JSON.stringify(state));
  console.log('本機已存檔');

  const client=getCloudClient();
  if(!client) return;
  if(!credentialWriteGuardReady){console.error('DEV credential 防回寫護欄尚未確認，已阻止雲端 saveState');return}
  if(cloudSaving && !forceCloud) return;
  cloudSaving=true;
  try{
    const payload = {
      id:CLOUD_ROW_ID,
      data:stripPlaintextCredentials(clone(state)),
      updated_at:new Date().toISOString()
    };

    // V11.0.42：先 update id=main。若資料表曾經沒有 UNIQUE，這會把所有 main row 一起覆蓋成最新狀態。
    const updateResult = await client
      .from(CLOUD_TABLE)
      .update({ data:payload.data, updated_at:payload.updated_at })
      .eq('id', CLOUD_ROW_ID)
      .select('id,updated_at');

    if(updateResult.error){
      console.error('雲端 update 失敗，已停止；不會自動建立或重建 main row', updateResult.error);
      return false;
    }

    if(!updateResult.data || updateResult.data.length===0){
      console.error('找不到 main row，已 fail-closed；不會自動建立、補寫或用本機 state 重建');
      return false;
    }else{
      cloudReady=true;
      console.log('雲端同步成功（update main）', updateResult.data);
      return true;
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

// V11.1.50：收款專用驗證存檔。訂單與月流水號必須同一次 optimistic update 寫入，
// 並在查回驗證成功後才允許前端完成交易。
async function saveCheckoutOrderVerified(orderDraft){
  const draft=clone(orderDraft||{});
  const checkoutId=String(draft.checkoutId||'').trim();
  if(!checkoutId) return {ok:false,message:'交易識別碼遺失，已停止收款'};
  if(!Array.isArray(draft.items)||!draft.items.length||Number(draft.total||0)<=0){
    return {ok:false,message:'訂單內容不完整，已停止收款'};
  }
  const client=getCloudClient();
  if(!client) return {ok:false,message:'目前未連上 DEV 雲端，購物車已保留，請恢復網路後重試'};
  if(!credentialWriteGuardReady) return {ok:false,message:'DEV credential 防回寫護欄尚未就緒，已停止收款'};
  if(cloudSaving) return {ok:false,message:'系統正在同步，購物車已保留，請稍候再試'};

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
      if(latest.error) return {ok:false,message:'讀取 DEV 雲端失敗：'+latest.error.message};

      const chosen=chooseAuthoritativeCloudRow(latest.data||[]);
      if(!chosen) return {ok:false,message:'DEV 雲端找不到 main，已停止收款'};
      const merged=normalizeCloudState(clone(chosen.data));
      if(!Array.isArray(merged.orders)) merged.orders=[];

      // 若前一次其實已寫入、但回傳驗證中斷，以 checkoutId 找回同一交易，避免重複出單。
      const existing=merged.orders.find(o=>String(o.checkoutId||'')===checkoutId);
      if(existing){
        state=merged;
        localStorage.setItem(KEY,JSON.stringify(state));
        cloudReady=true;
        return {ok:true,order:clone(existing),alreadyVerified:true};
      }

      const dateKey=String(draft.date||'').replace(/-/g,'');
      const monthKey=dateKey.slice(0,6);
      if(!/^\d{8}$/.test(dateKey)||!/^\d{6}$/.test(monthKey)){
        return {ok:false,message:'訂單日期格式錯誤，已停止收款'};
      }
      const reservation=reserveMonthlyOrderNo(merged,draft.date);
      const sequence=reservation.sequence;
      const orderNo=reservation.orderNo;

      const order=Object.assign({},draft,{id:orderNo});
      merged.orders.unshift(order);
      merged.cart=[];
      merged.pendingPay='';
      merged.pendingCheckoutCart=null;
      merged.pendingCheckoutId=null;

      const stamp=new Date().toISOString();
      const updateResult=await client
        .from(CLOUD_TABLE)
        .update({data:merged,updated_at:stamp})
        .eq('id',CLOUD_ROW_ID)
        .eq('updated_at',chosen.updated_at)
        .select('id,updated_at');
      if(updateResult.error) return {ok:false,message:'DEV 雲端寫入失敗：'+updateResult.error.message};
      if(!updateResult.data||!updateResult.data.length){
        if(attempt<maxAttempts){
          await new Promise(resolve=>setTimeout(resolve,180*attempt));
          continue;
        }
        return {ok:false,message:'資料剛被其他裝置更新，購物車已保留，請重新按一次確認收款'};
      }

      const verify=await client
        .from(CLOUD_TABLE)
        .select('id,data,updated_at')
        .eq('id',CLOUD_ROW_ID)
        .order('updated_at',{ascending:false})
        .limit(20);
      if(verify.error) return {ok:false,message:'寫入後驗證失敗：'+verify.error.message};
      const verifiedRow=chooseAuthoritativeCloudRow(verify.data||[]);
      const verifiedState=verifiedRow?.data ? normalizeCloudState(verifiedRow.data) : null;
      const verifiedOrder=verifiedState?.orders?.find(o=>String(o.checkoutId||'')===checkoutId&&String(o.id||'')===orderNo);
      const verifiedCounter=Number(verifiedState?.monthlyOrderCounter?.[monthKey]||0);
      if(!verifiedOrder||verifiedCounter!==reservation.nextCounter||!verifiedState.usedOrderNos?.includes(orderNo)){
        return {ok:false,message:'DEV 雲端驗證未通過，系統沒有完成交易；購物車已保留'};
      }

      state=verifiedState;
      localStorage.setItem(KEY,JSON.stringify(state));
      cloudReady=true;
      return {ok:true,order:clone(verifiedOrder)};
    }
    return {ok:false,message:'DEV 雲端忙碌，購物車已保留，請稍後重試'};
  }catch(err){
    console.log('收款驗證存檔錯誤',err);
    return {ok:false,message:'收款存檔發生錯誤：'+(err?.message||err)};
  }finally{
    cloudSaving=false;
  }
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
  if(!credentialWriteGuardReady) return {ok:false,message:'DEV credential 防回寫護欄尚未就緒，這次沒有掛入'};
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
  if(!credentialWriteGuardReady){console.error('DEV credential 防回寫護欄尚未確認，已阻止局部雲端存檔');return false}
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

function refreshAllScreens(){
  updateCashierDisplay();
  renderCashier();
  renderAssign();
  renderReport();
  renderTimeclock();
  renderExpenses();
  if(typeof refreshPayrollPageAfterStatePull==='function')refreshPayrollPageAfterStatePull();
  renderManage();
  applyBossMode();
}
async function runDevIsolationCleanupOnce(){
  // V11.1.49：舊版一次性 migration 已停用。DEV 啟動只能讀取共用雲端資料，
  // 不得再依賴單一裝置 localStorage marker 自動清空或重建 Supabase main。
  console.log('DEV 啟動自動清空已停用；如需清空測試資料，僅能由管理者手動操作');
  return true;
}
async function bootstrapDevCloudState(){
  devBootstrapReady=false;
  credentialWriteGuardReady=false;
  const client=getCloudClient();
  if(!client || devEnvironmentBlocked) return false;
  const ok=await pullCloudState();
  if(!ok) return false;
  const credentialSecurity=await credentialSecurityStatusSecure();
  const missing=Array.isArray(credentialSecurity?.missingActiveStaff)?credentialSecurity.missingActiveStaff:[];
  if(!credentialSecurity?.guardInstalled || !credentialSecurity?.ownerConfigured || !credentialSecurity?.bossConfigured){
    console.error('DEV PIN 安全護欄未就緒，已停止啟動',{reason:credentialSecurity?.reason||'',missingActiveStaff:missing.map(item=>item?.id||'')});
    recordDevPullFail('CREDENTIAL_GUARD_NOT_READY');
    return false;
  }
  credentialWriteGuardReady=true;
  if(missing.length){
    const missingIds=missing.map(item=>String(item?.id||'')).filter(Boolean);
    console.error('PIN credential 不完整，已停止啟動；未修改任何員工資料',{missingActiveStaff:missingIds});
    recordDevPullFail('ACTIVE_STAFF_CREDENTIAL_MISSING');
    credentialWriteGuardReady=false;
    return false;
  }
  const isolationOk=await runDevIsolationCleanupOnce();
  if(!isolationOk) return false;
  devBootstrapReady=true;
  return true;
}
async function startCloudSync(skipInitialPull=false){
  if(!devBootstrapReady){
    console.warn('DEV 尚未完成安全啟動，不開始背景同步');
    return;
  }
  if(!skipInitialPull){
    const ok=await pullCloudState();
    if(ok) refreshAllScreens();
  }
  setInterval(async()=>{
    if(!devBootstrapReady || devEnvironmentBlocked) return;
    if(ITEM_DIRTY || STAFF_DIRTY || isManageEditing() || ((typeof isCheckoutInProgress === 'function') && isCheckoutInProgress())){ console.log('資料正在編輯或開單中，暫停雲端覆蓋'); return; }
    const ok=await pullCloudState();
    if(ok) refreshAllScreens();
  },15000);
}

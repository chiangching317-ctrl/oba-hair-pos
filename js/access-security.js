// V11.1.68: secure POS entry. The opaque token and identity live in memory only.
window.OBA_ACCESS_SESSION = null;
let resolvePosEntryReady;
window.OBA_POS_ENTRY_READY=new Promise(resolve=>{resolvePosEntryReady=resolve});
function hasPosAccessSession(){const s=window.OBA_ACCESS_SESSION;return !!(s&&s.token&&s.kind)}
function clearPosAccessSession(){
  window.OBA_ACCESS_SESSION=null;
  if(typeof KEY!=='undefined')try{localStorage.removeItem(KEY)}catch(_error){}
  if(typeof resetCloudClientForAccessSession==='function')resetCloudClientForAccessSession();
}
function logoutPosSession(){
  clearPosAccessSession();
  try{localStorage.removeItem(KEY)}catch(_error){}
  window.USER_ROLE='staff';
  if(typeof CURRENT_LOGIN_LEVEL!=='undefined')CURRENT_LOGIN_LEVEL='staff';
  if(typeof CURRENT_CASHIER!=='undefined')CURRENT_CASHIER=null;
  window.location.reload();
}
async function openPosAccessSession(pin){
  const value=String(pin||'').trim();
  if(!/^\d{6}$/.test(value))return {ok:false,reason:'invalid_format'};
  const client=getCloudClient(true);
  if(!client)return {ok:false,reason:'cloud_unavailable'};
  try{
    const {data,error}=await client.rpc('oba_open_pos_session_v2',{p_pin:value});
    if(error)return {ok:false,source:'OPEN_POS_SESSION_V2',reason:'rpc_error',code:error.code||'',message:error.message||'',details:error.details||'',hint:error.hint||''};
    const result=Array.isArray(data)?(data[0]||{}):(data||{});
    if(!result.ok)return {...result,source:'OPEN_POS_SESSION_V2'};
    if(!result.token)return {ok:false,source:'SESSION_CREATE',reason:'missing_session_token',code:'SESSION_TOKEN_MISSING',message:'RPC success response did not contain a session token.',details:'',hint:''};
    window.OBA_ACCESS_SESSION={token:String(result.token),kind:String(result.kind||''),id:String(result.id||''),name:String(result.name||''),permissions:Array.isArray(result.permissions)?result.permissions:[],expiresAt:String(result.expiresAt||'')};
    resetCloudClientForAccessSession();
    return {...result,token:undefined};
  }catch(error){return {ok:false,source:'OPEN_POS_SESSION_V2',reason:'network_error',code:error?.code||'',message:error?.message||String(error),details:'',hint:''}}
}
function rpcWithEntryTimeout(pin,timeoutMs=15000){
  return Promise.race([
    openPosAccessSession(pin),
    new Promise(resolve=>setTimeout(()=>resolve({ok:false,source:'TIMEOUT',reason:'timeout',code:'ENTRY_TIMEOUT',message:`No response within ${timeoutMs}ms.`,details:'',hint:''}),timeoutMs))
  ]);
}
function entryHasPermission(permission){
  const s=window.OBA_ACCESS_SESSION;if(!s)return false;
  if(s.kind==='owner-control')return true;
  if(s.kind==='boss')return permission==='report'||permission==='view_all';
  return (s.permissions||[]).includes(permission);
}
function applyEntryRolePermissions(){
  const s=window.OBA_ACCESS_SESSION;if(!s)return false;
  document.body.dataset.entryRole=s.kind;
  const payrollAuthorityWorkspace=document.getElementById('payrollAuthorityWorkspace');
  if(payrollAuthorityWorkspace)payrollAuthorityWorkspace.classList.toggle('hidden',!['boss','owner-control'].includes(s.kind));
  const expenseWriteWorkspace=document.getElementById('expenseWriteWorkspace');
  if(expenseWriteWorkspace)expenseWriteWorkspace.classList.toggle('hidden',s.kind==='boss');
  const settlementActions=document.getElementById('payrollSettlementActionWorkspace');
  if(settlementActions)settlementActions.classList.toggle('hidden',s.kind==='boss');
  const roleNote=document.getElementById('payrollAuthorityRoleNote');
  if(roleNote)roleNote.textContent=s.kind==='boss'
    ? 'BOSS 與總控使用同一份雲端權威資料及同一套畫面；目前為 BOSS 完全唯讀模式。'
    : 'BOSS 與總控使用同一份雲端權威資料及同一套畫面；總控原有操作區保留在下方。';
  document.querySelectorAll('.tab').forEach(tab=>{
    const name=tab.dataset.tab;let allowed=true;
    if(s.kind==='boss')allowed=name==='report'||name==='expense';
    else if(s.kind==='staff'){
      const permission={cashier:'checkout',assign:'assign',report:'report',expense:'expense',manage:'manage'}[name];
      allowed=name==='timeclock'||!permission||entryHasPermission(permission);
    }
    tab.classList.toggle('entry-denied',!allowed);tab.disabled=!allowed;
  });
  const current=document.querySelector('.tab.active');
  if(current?.disabled){
    const first=[...document.querySelectorAll('.tab')].find(tab=>!tab.disabled);
    if(first&&typeof setActiveTab==='function')setActiveTab(first.dataset.tab);
  }
  return true;
}
function entryFailureText(result){
  if(result?.reason==='rate_limited')return '錯誤次數過多，請稍後再試。';
  if(result?.reason==='rpc_error'&&result?.code==='PGRST202')return '安全入口 RPC 尚未載入，系統保持鎖定（PGRST202）。';
  if(result?.reason==='rpc_error')return `安全入口 RPC 執行失敗，系統保持鎖定（${String(result?.code||'RPC_ERROR').replace(/[^A-Z0-9_-]/gi,'')}）。`;
  if(result?.reason==='timeout')return '安全入口驗證逾時，系統保持鎖定。請檢查網路後重試。';
  if(['cloud_unavailable','network_error'].includes(result?.reason))return '無法連線驗證服務，系統保持鎖定。';
  return 'PIN 錯誤、員工已停用或無有效入口身分。';
}
function safeEntryDiagnosticValue(value){
  return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1200);
}
function showPersistentEntryError(source,result={}){
  const panel=document.getElementById('accessErrorDetails');
  if(!panel)return;
  const lines=[
    `SOURCE: ${safeEntryDiagnosticValue(source||result.source||'UNKNOWN')}`,
    `CODE: ${safeEntryDiagnosticValue(result.code||result.reason||'UNKNOWN')}`,
    `MESSAGE: ${safeEntryDiagnosticValue(result.message||entryFailureText(result))}`,
    `DETAILS: ${safeEntryDiagnosticValue(result.details||'-')}`,
    `HINT: ${safeEntryDiagnosticValue(result.hint||'-')}`
  ];
  panel.textContent=lines.join('\n');
  panel.classList.remove('hidden');
}
function bindSecureEntryControls(){
  const input=document.getElementById('accessPin');
  const button=document.getElementById('btnAccessLogin');
  const status=document.getElementById('accessLoadStatus');
  if(!input||!button){return false}
  let busy=false;
  const submit=async()=>{
    if(busy)return;
    busy=true;button.disabled=true;
    if(status)status.textContent='已收到登入操作，正在安全驗證…';
    try{
      const result=await rpcWithEntryTimeout(input.value);
      input.value='';
      if(!result?.ok){
        if(status)status.textContent=entryFailureText(result||{reason:'network_error'});
        showPersistentEntryError(result?.source||'OPEN_POS_SESSION_V2',result||{reason:'network_error'});
        return;
      }
      if(status)status.textContent='身分驗證成功，正在載入授權資料…';
      resolvePosEntryReady(true);
    }catch(error){
      if(status)status.textContent='安全入口發生未預期錯誤，系統保持鎖定（ENTRY_EXCEPTION）。';
      showPersistentEntryError('JAVASCRIPT_EXCEPTION',{code:'ENTRY_EXCEPTION',message:error?.message||String(error),details:error?.stack||'',hint:''});
    }finally{
      if(!hasPosAccessSession()){
        busy=false;button.disabled=false;input.focus();
      }
    }
  };
  button.addEventListener('click',submit);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submit()}});
  return true;
}
bindSecureEntryControls();
document.getElementById('btnPosLogout')?.addEventListener('click',logoutPosSession);
window.addEventListener('pagehide',clearPosAccessSession);

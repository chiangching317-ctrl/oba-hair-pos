(function initializeRuntimeVersionGuard(){
  'use strict';

  const clientVersion=String(window.OBA_RUNTIME_VERSION||'');
  const expectedProjectRef=String(window.OBA_RUNTIME_PROJECT_REF||'');
  const clientChannel=String(window.OBA_RUNTIME_CHANNEL||'');
  const clientMode=String(window.OBA_RUNTIME_MODE||'NORMAL');
  const versionUrl=new URL('runtime-version.json',document.baseURI).href;
  const nativeFetch=window.fetch.bind(window);
  const state={
    clientVersion,
    expectedProjectRef,
    clientChannel,
    clientMode,
    serverVersion:'',
    verified:false,
    locked:true,
    reason:'checking',
    checkedAt:'',
    checkPromise:null
  };
  window.OBA_RUNTIME_GUARD=state;

  function messageFor(reason){
    if(reason==='version_mismatch')return '系統已更新，請重新整理後再繼續操作。';
    if(reason==='invalid_manifest')return '系統版本資料異常，為安全已停止操作。請重新整理後再試。';
    if(reason==='unsupported_protocol')return '請透過 OBA Hair POS 的 HTTP 網址開啟系統；目前頁面已安全鎖定。';
    return '無法確認目前系統版本，為安全已停止操作。請檢查連線後重新整理。';
  }

  function ensureGate(){
    let gate=document.getElementById('runtimeVersionGate');
    if(gate)return gate;
    gate=document.createElement('div');
    gate.id='runtimeVersionGate';
    gate.setAttribute('role','alertdialog');
    gate.setAttribute('aria-modal','true');
    gate.setAttribute('aria-live','assertive');
    gate.innerHTML='<div class="runtime-version-card"><h2>OBA Hair POS 安全鎖定</h2><p id="runtimeVersionMessage">正在確認系統版本…</p><button id="btnRuntimeReload" type="button">重新整理</button></div>';
    (document.body||document.documentElement).appendChild(gate);
    gate.querySelector('#btnRuntimeReload')?.addEventListener('click',()=>window.location.reload());
    return gate;
  }

  function renderGate(){
    const gate=ensureGate();
    const message=gate.querySelector('#runtimeVersionMessage');
    if(message)message.textContent=state.locked?messageFor(state.reason):'';
    gate.hidden=!state.locked;
    document.documentElement.classList.toggle('runtime-version-locked',state.locked);
  }

  function lock(reason,serverVersion=''){
    state.locked=true;
    state.verified=false;
    state.reason=String(reason||'check_failed');
    state.serverVersion=String(serverVersion||state.serverVersion||'');
    renderGate();
    return false;
  }

  function unlock(manifest){
    state.serverVersion=String(manifest.version||'');
    state.checkedAt=new Date().toISOString();
    state.reason='';
    state.verified=true;
    state.locked=false;
    renderGate();
    renderReadOnlyBanner();
    return true;
  }

  function runtimeReady(){return state.verified===true&&state.locked===false;}
  window.isObaRuntimeVersionCurrent=runtimeReady;
  window.requireObaRuntimeVersion=function requireObaRuntimeVersion(){
    if(runtimeReady())return true;
    renderGate();
    return false;
  };
  function runtimeWriteEnabled(){return runtimeReady()&&clientMode!=='READ_ONLY_ROLLBACK';}
  window.isObaRuntimeWriteEnabled=runtimeWriteEnabled;
  window.requireObaRuntimeWrite=function requireObaRuntimeWrite(){
    if(runtimeWriteEnabled())return true;
    if(runtimeReady()&&clientMode==='READ_ONLY_ROLLBACK')alert('目前為緊急唯讀回復模式，所有資料修改均已停用。');
    else renderGate();
    return false;
  };

  function renderReadOnlyBanner(){
    let banner=document.getElementById('runtimeReadOnlyBanner');
    if(clientMode!=='READ_ONLY_ROLLBACK'){
      banner?.remove();
      return;
    }
    if(!banner){
      banner=document.createElement('div');
      banner.id='runtimeReadOnlyBanner';
      banner.setAttribute('role','status');
      banner.style.cssText='position:fixed;left:0;right:0;top:0;z-index:2147483646;padding:10px;background:#7f1d1d;color:#fff;text-align:center;font-weight:800';
      banner.textContent='緊急唯讀回復模式：可登入與查詢，所有資料修改均已停用。';
      (document.body||document.documentElement).appendChild(banner);
    }
  }

  async function checkVersion(){
    if(state.locked&&state.reason&&state.reason!=='checking')return false;
    if(state.checkPromise)return state.checkPromise;
    state.checkPromise=(async()=>{
      if(window.OBA_RUNTIME_CONFIG_VALID!==true)return lock('invalid_manifest');
      if(!/^https?:$/.test(window.location.protocol))return lock('unsupported_protocol');
      try{
        const separator=versionUrl.includes('?')?'&':'?';
        const response=await nativeFetch(`${versionUrl}${separator}t=${Date.now()}`,{
          method:'GET',
          cache:'no-store',
          credentials:'same-origin',
          headers:{'Accept':'application/json'}
        });
        if(!response.ok)return lock('check_failed');
        const manifest=await response.json();
        if(!manifest||typeof manifest!=='object'||!manifest.version||!manifest.projectRef||!manifest.channel||!manifest.mode)return lock('invalid_manifest');
        if(String(manifest.version)!==clientVersion||String(manifest.projectRef)!==expectedProjectRef||String(manifest.channel)!==clientChannel||String(manifest.mode)!==clientMode){
          return lock('version_mismatch',manifest.version);
        }
        return unlock(manifest);
      }catch(_error){
        return lock('check_failed');
      }finally{
        state.checkPromise=null;
      }
    })();
    return state.checkPromise;
  }
  window.checkObaRuntimeVersion=checkVersion;

  window.fetch=function guardedFetch(input,init){
    const requested=typeof input==='string'?input:(input&&input.url)||'';
    let isVersionRequest=false;
    try{isVersionRequest=new URL(requested,document.baseURI).pathname===new URL(versionUrl).pathname;}catch(_error){}
    if(!isVersionRequest&&!runtimeReady()){
      renderGate();
      return Promise.reject(new Error('OBA_RUNTIME_VERSION_LOCKED'));
    }
    if(!isVersionRequest&&clientMode==='READ_ONLY_ROLLBACK'){
      const method=String(init?.method||input?.method||'GET').toUpperCase();
      let path='';
      try{path=new URL(requested,document.baseURI).pathname;}catch(_error){}
      const readOnlyRpc=[
        '/rest/v1/rpc/oba_open_pos_session_v2',
        '/rest/v1/rpc/oba_credential_status_v1',
        '/rest/v1/rpc/oba_credential_security_status_v1',
        '/rest/v1/rpc/oba_payroll_overview_readonly_v1',
        '/rest/v1/rpc/oba_payroll_history_v1'
      ].some(suffix=>path.endsWith(suffix));
      if(!['GET','HEAD','OPTIONS'].includes(method)&&!(method==='POST'&&readOnlyRpc)){
        return Promise.reject(new Error('OBA_RUNTIME_READ_ONLY_ROLLBACK'));
      }
    }
    return nativeFetch(input,init);
  };

  function blockInteraction(event){
    if(runtimeReady())return;
    const reloadButton=event.target?.closest?.('#btnRuntimeReload');
    if(reloadButton)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    renderGate();
  }
  ['click','submit','touchstart','keydown'].forEach(type=>document.addEventListener(type,blockInteraction,true));

  function wrapWriteFunction(name){
    const original=window[name];
    if(typeof original!=='function'||original.__obaRuntimeGuarded)return;
    const guarded=function(...args){
      if(!window.requireObaRuntimeWrite())return false;
      return original.apply(this,args);
    };
    Object.defineProperty(guarded,'__obaRuntimeGuarded',{value:true});
    window[name]=guarded;
  }
  function installWriteGuards(){
    [
      'saveState','saveStatePatch','saveCheckoutOrderVerified','saveAssignedOrderVerified','saveRefundOrderVerified','saveAssignedOrderVoidVerified',
      'assignCurrentOrder','executeRefundWithPin','clockIn','clockOut','submitRedeem',
      'saveExpenseEntry','deleteExpense','addCustomExpenseCategory','saveJeanManagementShareRate',
      'savePayrollTrialInput','syncPayrollLocalToCloud','previewFormalPayroll','closeFormalPayroll','reopenFormalPayroll',
      'saveStaffChanges','saveItemsChanges','updateStaffField','togglePermission','updateSystemRole',
      'closeSalaryPeriod','authorizeCashierDevice','revokeCashierDevice'
    ].forEach(wrapWriteFunction);
  }

  document.addEventListener('DOMContentLoaded',()=>{
    renderGate();
    installWriteGuards();
  });
  window.addEventListener('load',installWriteGuards);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&runtimeReady())checkVersion();
  });
  window.addEventListener('focus',()=>{if(runtimeReady())checkVersion();});
  window.setInterval(()=>{if(runtimeReady())checkVersion();},300000);

  checkVersion();
})();

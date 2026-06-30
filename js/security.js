// V11.0.26 基礎保護：降低一般使用者查看/複製程式碼機率（非絕對防高手）

// V11.1.15：本機(file:// / localhost / 127.0.0.1)開放 F12；正式站/線上網址才鎖 F12
(function(){
  const isLocalDev =
    location.protocol === 'file:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if(isLocalDev) return;
  if(window.__OBA_F12_PROTECT__) return;
  window.__OBA_F12_PROTECT__ = true;
  const blockMsg = 'OBA Hair 店內系統：此操作已鎖定';
  document.addEventListener('contextmenu', function(e){
    e.preventDefault();
    alert(blockMsg);
  }, true);
  document.addEventListener('keydown', function(e){
    const k = (e.key || '').toLowerCase();
    const blocked =
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['i','j','c'].includes(k)) ||
      (e.ctrlKey && ['u','s','p'].includes(k));
    if(blocked){
      e.preventDefault();
      e.stopPropagation();
      alert(blockMsg);
      return false;
    }
  }, true);
  document.addEventListener('dragstart', function(e){ e.preventDefault(); }, true);
  document.addEventListener('selectstart', function(e){
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if(['input','textarea'].includes(tag)) return;
    e.preventDefault();
  }, true);
})();


// V11.0.68：密碼遮罩顯示切換，放在 DOM 載入後，避免整頁按鈕失效。

document.addEventListener('DOMContentLoaded', ()=>{
  function bindPwdToggle(btnId,inputId){
    const btn=document.getElementById(btnId);
    const input=document.getElementById(inputId);
    if(!btn || !input) return;
    btn.onclick=()=>{
      const show=input.type==='password';
      input.type=show?'text':'password';
      btn.textContent=show?'🙈':'👁';
    };
  }
  bindPwdToggle('toggleMaskedPwd','maskedPasswordInput');
  bindPwdToggle('togglePwdOld','pwdOld');
  bindPwdToggle('togglePwdNew','pwdNew');
});

// OBA Hair POS DEV - server-side PIN verification helpers.
// PIN values are sent only in POST bodies to SECURITY DEFINER RPCs. They are
// never written to state, localStorage, sessionStorage, URLs or logs here.
function normalizePinRpcResult(data){
  if(Array.isArray(data)) return data[0]||{};
  return data&&typeof data==='object'?data:{};
}
async function callPinSecurityRpc(name,args){
  const client=getCloudClient();
  if(!client) return {ok:false,reason:'cloud_unavailable'};
  try{
    const {data,error}=await client.rpc(name,args||{});
    if(error){
      console.error('PIN security RPC failed',{name,code:error.code||'',message:error.message||''});
      return {ok:false,reason:'rpc_error',message:error.message||''};
    }
    return normalizePinRpcResult(data);
  }catch(error){
    console.error('PIN security RPC exception',{name,message:error?.message||String(error)});
    return {ok:false,reason:'network_error',message:error?.message||String(error)};
  }
}
async function verifyPinSecure(pin,purpose,staffId=null){
  const value=String(pin||'').trim();
  if(!/^\d{6}$/.test(value)) return {ok:false,reason:'invalid_format'};
  return callPinSecurityRpc('oba_verify_pin_v1',{
    p_pin:value,
    p_purpose:String(purpose||''),
    p_staff_id:staffId===null?null:String(staffId)
  });
}
async function credentialStatusSecure(){
  return callPinSecurityRpc('oba_credential_status_v1',{});
}
async function credentialSecurityStatusSecure(){
  return callPinSecurityRpc('oba_credential_security_status_v1',{});
}
async function setStaffPinSecure(actorPin,staffId,newPin){
  return callPinSecurityRpc('oba_set_staff_pin_v1',{
    p_actor_pin:String(actorPin||'').trim(),
    p_staff_id:String(staffId||''),
    p_new_pin:String(newPin||'').trim()
  });
}
async function changeOwnerPinSecure(currentPin,newPin){
  return callPinSecurityRpc('oba_change_owner_pin_v1',{
    p_current_pin:String(currentPin||'').trim(),
    p_new_pin:String(newPin||'').trim()
  });
}
async function setBossPinSecure(ownerPin,bossPin){
  return callPinSecurityRpc('oba_set_boss_pin_v1',{
    p_owner_pin:String(ownerPin||'').trim(),
    p_boss_pin:String(bossPin||'').trim()
  });
}
function pinFailureMessage(result,permissionLabel='此操作'){
  const reason=String(result?.reason||'');
  if(reason==='rate_limited') return 'PIN 錯誤次數過多，請稍後再試';
  if(reason==='permission_denied') return `PIN 正確，但沒有${permissionLabel}權限`;
  if(reason==='cloud_unavailable'||reason==='network_error'||reason==='rpc_error'||reason==='state_unavailable') return '無法連線雲端驗證 PIN，未執行操作';
  return `PIN 錯誤、員工已停用或沒有${permissionLabel}權限`;
}

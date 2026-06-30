// ===== V11.1.14 正式版：員工打卡 =====
function ensureTimeClockLogs(){
  if(!Array.isArray(state.timeClockLogs)) state.timeClockLogs=[];
  return state.timeClockLogs;
}
function timeclockStaffList(){
  return activeStaff().filter(s=>s && s.active);
}
function timeclockRecordFor(staffId,date=todayStr()){
  return ensureTimeClockLogs().find(r=>String(r.staffId)===String(staffId) && String(r.date)===String(date));
}
function timeDiffText(start,end){
  if(!start || !end) return '--';
  const [sh,sm]=String(start).split(':').map(Number);
  const [eh,em]=String(end).split(':').map(Number);
  if(!Number.isFinite(sh)||!Number.isFinite(sm)||!Number.isFinite(eh)||!Number.isFinite(em)) return '--';
  let mins=(eh*60+em)-(sh*60+sm);
  if(mins<0) mins+=24*60;
  const h=Math.floor(mins/60), m=mins%60;
  return `${h}小時${String(m).padStart(2,'0')}分`;
}
function verifyTimeclockPin(staffId){
  const staff=staffById(staffId);
  const pin=String($('#timeclockPin')?.value||'').trim();
  if(!staff){ alert('請選擇員工'); return null; }
  if(!pin){ alert('請輸入員工 PIN'); $('#timeclockPin')?.focus(); return null; }
  const ok = String(staff.pin||'').trim()===pin || String(state.managementPassword||'').trim()===pin;
  if(!ok){ alert('PIN 錯誤'); $('#timeclockPin').value=''; $('#timeclockPin')?.focus(); return null; }
  return staff;
}
function renderTimeclock(){
  bindTimeclockEvents();
  ensureTimeClockLogs();
  const staffSel=$('#timeclockStaff');
  const staffList=timeclockStaffList();
  if(staffSel){
    const old=staffSel.value;
    staffSel.innerHTML=staffList.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name||s.id)}</option>`).join('');
    if(old && staffList.some(s=>String(s.id)===String(old))) staffSel.value=old;
  }
  updateTimeclockStatus();
  renderTimeclockTable();
}
function updateTimeclockStatus(){
  const staffId=$('#timeclockStaff')?.value || '';
  const staff=staffById(staffId);
  const rec=staffId ? timeclockRecordFor(staffId) : null;
  const status=$('#timeclockStatus');
  const inEl=$('#timeclockTodayIn'), outEl=$('#timeclockTodayOut'), hoursEl=$('#timeclockTodayHours');
  if(!staff){
    if(status) status.textContent='請先選擇員工';
    if(inEl) inEl.textContent='--';
    if(outEl) outEl.textContent='--';
    if(hoursEl) hoursEl.textContent='--';
    return;
  }
  const inTime=rec?.clockIn || '--';
  const outTime=rec?.clockOut || '--';
  if(inEl) inEl.textContent=inTime;
  if(outEl) outEl.textContent=outTime;
  if(hoursEl) hoursEl.textContent=rec?.clockIn && rec?.clockOut ? timeDiffText(rec.clockIn,rec.clockOut) : '--';
  if(status){
    if(!rec || !rec.clockIn) status.textContent=`${staff.name} 今天尚未上班打卡`;
    else if(!rec.clockOut) status.textContent=`${staff.name} 已上班：${rec.clockIn}，尚未下班打卡`;
    else status.textContent=`${staff.name} 今日已完成：${rec.clockIn} ～ ${rec.clockOut}`;
  }
}
function renderTimeclockTable(){
  const table=$('#timeclockTable');
  if(!table) return;
  const today=todayStr();
  const logs=ensureTimeClockLogs().filter(r=>String(r.date)===today).sort((a,b)=>String(a.staffName||'').localeCompare(String(b.staffName||''),'zh-Hant'));
  if(!logs.length){
    table.innerHTML='<div class="tr"><div>今天還沒有打卡紀錄</div></div>';
    return;
  }
  table.innerHTML='<div class="tr header"><div>員工</div><div>上班</div><div>下班</div><div>工時</div><div>狀態</div></div>'+logs.map(r=>{
    const done=!!(r.clockIn && r.clockOut);
    return `<div class="tr"><div>${escapeHtml(r.staffName||r.staffId)}</div><div>${escapeHtml(r.clockIn||'--')}</div><div>${escapeHtml(r.clockOut||'--')}</div><div>${r.clockIn&&r.clockOut?timeDiffText(r.clockIn,r.clockOut):'--'}</div><div>${done?'已完成':'上班中'}</div></div>`;
  }).join('');
}
function clockIn(){
  if(guardBossAction()) return;
  const staffId=$('#timeclockStaff')?.value || '';
  const staff=verifyTimeclockPin(staffId);
  if(!staff) return;
  const today=todayStr();
  const logs=ensureTimeClockLogs();
  let rec=timeclockRecordFor(staff.id,today);
  if(rec && rec.clockIn){ alert(`${staff.name} 今天已經上班打卡：${rec.clockIn}`); return; }
  if(!rec){
    rec={id:'TC-'+Date.now(),staffId:staff.id,staffName:staff.name,date:today,clockIn:'',clockOut:'',createdAt:new Date().toISOString()};
    logs.unshift(rec);
  }
  rec.clockIn=nowTime();
  rec.inAt=new Date().toISOString();
  rec.updatedAt=new Date().toISOString();
  $('#timeclockPin').value='';
  saveState(true);
  renderTimeclock();
  alert(`${staff.name} 上班打卡完成：${rec.clockIn}`);
}
function clockOut(){
  if(guardBossAction()) return;
  const staffId=$('#timeclockStaff')?.value || '';
  const staff=verifyTimeclockPin(staffId);
  if(!staff) return;
  const rec=timeclockRecordFor(staff.id,todayStr());
  if(!rec || !rec.clockIn){ alert(`${staff.name} 今天還沒有上班打卡`); return; }
  if(rec.clockOut){ alert(`${staff.name} 今天已經下班打卡：${rec.clockOut}`); return; }
  rec.clockOut=nowTime();
  rec.outAt=new Date().toISOString();
  rec.updatedAt=new Date().toISOString();
  $('#timeclockPin').value='';
  saveState(true);
  renderTimeclock();
  alert(`${staff.name} 下班打卡完成：${rec.clockOut}`);
}
function bindTimeclockEvents(){
  const inBtn=$('#btnClockIn'), outBtn=$('#btnClockOut'), refreshBtn=$('#btnTimeclockRefresh'), staffSel=$('#timeclockStaff'), pinEl=$('#timeclockPin');
  if(inBtn && !inBtn.dataset.bound){ inBtn.dataset.bound='yes'; inBtn.onclick=clockIn; }
  if(outBtn && !outBtn.dataset.bound){ outBtn.dataset.bound='yes'; outBtn.onclick=clockOut; }
  if(refreshBtn && !refreshBtn.dataset.bound){ refreshBtn.dataset.bound='yes'; refreshBtn.onclick=renderTimeclock; }
  if(staffSel && !staffSel.dataset.bound){ staffSel.dataset.bound='yes'; staffSel.onchange=updateTimeclockStatus; }
  if(pinEl && !pinEl.dataset.bound){ pinEl.dataset.bound='yes'; pinEl.addEventListener('keydown',e=>{ if(e.key==='Enter') clockIn(); }); }
}

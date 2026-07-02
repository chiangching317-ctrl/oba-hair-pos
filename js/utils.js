// OBA Hair POS - utils.js
// 第二刀：共用工具函式。
// 注意：本檔只放不直接改資料、不直接操作雲端的安全工具。

const $=s=>document.querySelector(s);
function clone(o){return JSON.parse(JSON.stringify(o))}
function money(n){return '$'+Number(n||0).toLocaleString('zh-TW')}
// V11.1.28：日期時間統一使用台灣時間，避免裝置/瀏覽器時區造成開單日期與時間錯誤。
const OBA_TIME_ZONE='Asia/Taipei';
function taipeiNowParts(date=new Date()){
  const parts = new Intl.DateTimeFormat('en-CA',{
    timeZone:OBA_TIME_ZONE,
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',
    hour12:false
  }).formatToParts(date).reduce((o,p)=>{o[p.type]=p.value;return o},{});
  return {
    year:parts.year,
    month:parts.month,
    day:parts.day,
    hour:parts.hour==='24'?'00':parts.hour,
    minute:parts.minute,
    second:parts.second
  };
}
function todayStr(){const p=taipeiNowParts();return `${p.year}-${p.month}-${p.day}`}
function monthStr(){const p=taipeiNowParts();return `${p.year}-${p.month}`}
function nowTime(){const p=taipeiNowParts();return `${p.hour}:${p.minute}`}
function currentMonthKey(){const p=taipeiNowParts();return `${p.year}${p.month}`}
function currentDateKey(){const p=taipeiNowParts();return `${p.year}${p.month}${p.day}`}
function taipeiNowIso(){
  const p=taipeiNowParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

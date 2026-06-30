// OBA Hair POS - utils.js
// 第二刀：共用工具函式。
// 注意：本檔只放不直接改資料、不直接操作雲端的安全工具。

const $=s=>document.querySelector(s);
function clone(o){return JSON.parse(JSON.stringify(o))}
function money(n){return '$'+Number(n||0).toLocaleString('zh-TW')}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function monthStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function nowTime(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function currentMonthKey(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}
function currentDateKey(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

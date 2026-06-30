// OBA POS DEV V11.1.20-D4
// 第四刀：列印模組 print.js
// 內容：收據預覽、QR Code、RawBT、ESC/POS、圖片備援、列印後回首頁。

function renderReceiptQr(orderId){
  const box = $('#receiptQr');
  if(!box) return;
  box.innerHTML='';
  try{
    if(window.QRCode){
      new QRCode(box,{text:String(orderId||''),width:86,height:86,correctLevel:QRCode.CorrectLevel.M});
    }else{
      box.innerHTML='<div class="note">QR Code 套件尚未載入</div>';
      alert('QR Code 套件尚未載入，請確認網路後重新整理');
    }
  }catch(e){
    console.log(e);
    box.innerHTML='<div class="note">QR Code 產生失敗</div>';
    alert('QR Code 產生失敗');
  }
}
function openReceipt(order){
  const redeemInfo = order.paymentMethod==='集點卡兌換' && order.redeemMeta
    ? `<div class="r"><span>客人</span><span>${order.redeemMeta.customer||'-'} / ${order.redeemMeta.uid4||'-'}</span></div>`
    : '';
  const typeText = order.paymentMethod==='集點卡兌換' ? '集點卡0元票' : order.paymentMethod;
  $('#printArea').innerHTML=`<h3>OBA HAIR</h3><div class="center">${order.id}</div><div class="center">${order.date} ${order.time}｜${typeText}</div><div class="center">${order.branchName||DEFAULT_BRANCH_NAME}｜經手 ${order.cashierName||'-'}</div>${redeemInfo}<div class="line"></div>${order.items.map(i=>`<div class="r"><span>${i.name}</span><span>${money(i.price)}</span></div>`).join('')}<div class="line"></div><div class="r"><strong>總金額</strong><strong>${money(order.total)}</strong></div><div id="receiptQr" class="qr-box"></div><div class="barcode-note">${order.id}</div><div class="center" style="margin-top:2px">謝謝光臨</div>`;$('#receiptImageActions')?.classList.add('hidden'); $('#receiptImageHint') && ($('#receiptImageHint').textContent='按「一鍵列印 RawBT」會直接叫出 RawBT 送印，不用下載、不用相簿、不用分享。'); const printBtn=$('#btnPrint'); if(printBtn){printBtn.disabled=false; printBtn.textContent='一鍵列印 RawBT';} LAST_RECEIPT_IMAGE_FILE=null; $('#receiptDialog').showModal();setTimeout(()=>renderReceiptQr(order.id),250)}
let LAST_RECEIPT_IMAGE_FILE=null;
async function makeReceiptImage(){
  try{
    const id=$('#printArea .barcode-note')?.textContent?.trim();
    if(id) renderReceiptQr(id);
    if(!window.html2canvas){
      alert('圖片產生套件尚未載入，請確認網路後重新整理');
      return;
    }
    $('#btnPrint').disabled=true;
    $('#btnPrint').textContent='圖片產生中...';
    const area=$('#printArea');
    const canvas=await html2canvas(area,{backgroundColor:'#ffffff',scale:3,useCORS:true,logging:false});
    canvas.toBlob(async blob=>{
      if(!blob){alert('圖片產生失敗');return;}
      const filename=(id||'OBA_receipt')+'.png';
      const url=URL.createObjectURL(blob);
      const link=$('#receiptImageDownload');
      link.href=url;
      link.download=filename;
      link.textContent='下載圖片：'+filename;
      $('#receiptImageActions').classList.remove('hidden');
      $('#receiptImageHint').textContent='圖片已產生。平板請按「下載圖片」或「分享圖片」，再用 POS Printer App 列印。';
      LAST_RECEIPT_IMAGE_FILE=new File([blob],filename,{type:'image/png'});
      $('#btnPrint').disabled=false;
      $('#btnPrint').textContent='一鍵列印 RawBT';
    },'image/png');
  }catch(e){
    console.log(e);
    alert('圖片產生失敗，請重新整理後再試');
    $('#btnPrint').disabled=false;
    $('#btnPrint').textContent='一鍵列印 RawBT';
  }
}

function bytesToBase64(bytes){
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode.apply(null, bytes.slice(i,i+chunk));
  }
  return btoa(binary);
}
function canvasToEscPosRaster(canvas){
  const targetWidth=576; // 80mm 熱感紙常用寬度
  const ratio=targetWidth/canvas.width;
  const targetHeight=Math.max(1,Math.round(canvas.height*ratio));
  const c=document.createElement('canvas');
  c.width=targetWidth;
  c.height=targetHeight;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(canvas,0,0,targetWidth,targetHeight);
  const img=ctx.getImageData(0,0,targetWidth,targetHeight).data;
  const widthBytes=Math.ceil(targetWidth/8);
  const data=[];
  // 初始化 + 對齊置中
  data.push(0x1B,0x40,0x1B,0x61,0x01);
  // GS v 0 raster bit image
  data.push(0x1D,0x76,0x30,0x00,widthBytes&0xff,(widthBytes>>8)&0xff,targetHeight&0xff,(targetHeight>>8)&0xff);
  for(let y=0;y<targetHeight;y++){
    for(let xb=0;xb<widthBytes;xb++){
      let b=0;
      for(let bit=0;bit<8;bit++){
        const x=xb*8+bit;
        if(x>=targetWidth) continue;
        const idx=(y*targetWidth+x)*4;
        const r=img[idx], g=img[idx+1], bl=img[idx+2], a=img[idx+3];
        const gray=(r*0.299+g*0.587+bl*0.114);
        if(a>20 && gray<185) b |= (0x80>>bit);
      }
      data.push(b);
    }
  }
  // 走紙 + 切紙（沒有切刀也不影響）
  data.push(0x0A,0x0A,0x0A,0x1D,0x56,0x42,0x00);
  return new Uint8Array(data);
}
function finishReceiptAfterPrint(){
  try{
    const receiptDialog = $('#receiptDialog');
    if(receiptDialog && receiptDialog.open) receiptDialog.close();
    CURRENT_CASHIER=null;
    updateCashierDisplay();
    setActiveTab('cashier');
    renderCashier();
  }catch(e){
    console.log('列印後回首頁失敗', e);
  }
}

async function printReceiptByRawBT(){
  try{
    const id=$('#printArea .barcode-note')?.textContent?.trim();
    if(id) renderReceiptQr(id);
    if(!window.html2canvas){
      alert('圖片產生套件尚未載入，請確認網路後重新整理');
      return;
    }
    const btn=$('#btnPrint');
    btn.disabled=true;
    btn.textContent='送出列印中...';
    const canvas=await html2canvas($('#printArea'),{backgroundColor:'#ffffff',scale:3,useCORS:true,logging:false});
    const bytes=canvasToEscPosRaster(canvas);
    const b64=bytesToBase64(bytes);
    $('#receiptImageHint').textContent='已送到 RawBT。若 RawBT 跳出確認畫面，直接按 PRINT。';
    window.location.href='rawbt:base64,'+b64;
    setTimeout(()=>{btn.disabled=false;btn.textContent='一鍵列印 RawBT';finishReceiptAfterPrint();},1200);
  }catch(e){
    console.log(e);
    alert('RawBT 一鍵列印失敗，請確認 RawBT 已安裝並已連上印表機');
    const btn=$('#btnPrint');
    if(btn){btn.disabled=false;btn.textContent='一鍵列印 RawBT';}
  }
}
$('#btnPrint').onclick=()=>printReceiptByRawBT();
$('#btnImageBackup').onclick=()=>makeReceiptImage();
$('#btnShareReceiptImage').onclick=async()=>{
  try{
    if(!LAST_RECEIPT_IMAGE_FILE){alert('請先產生單據圖片');return;}
    if(navigator.canShare && navigator.canShare({files:[LAST_RECEIPT_IMAGE_FILE]})){
      await navigator.share({files:[LAST_RECEIPT_IMAGE_FILE],title:'OBA單據圖片'});
    }else{
      alert('這台平板不支援直接分享圖片，請按「下載圖片」後再到 POS Printer App 開啟列印。');
    }
  }catch(e){console.log(e);}
};
$('#btnCloseReceipt').onclick=()=>{finishReceiptAfterPrint();};




function showProductToast(fileName){
  const toast=document.getElementById('productToast');
  if(!toast) return;
  const fileEl=toast.querySelector('.toastFile');
  if(fileEl) fileEl.textContent=fileName ? `已送出：${fileName}（請確認下載紀錄）` : '檔案已下載';
  toast.classList.add('show');
  clearTimeout(window.__ebaToastTimer);
  window.__ebaToastTimer=setTimeout(()=>toast.classList.remove('show'),2600);
}
if(typeof document !== 'undefined' && window.XLSX && XLSX.writeFile && !XLSX.__ebaWrappedWriteFile){
  const __ebaWriteFile=XLSX.writeFile.bind(XLSX);
  XLSX.writeFile=function(workbook, fileName){
    const result=__ebaWriteFile(workbook, fileName);
    showProductToast(fileName);
    return result;
  };
  XLSX.__ebaWrappedWriteFile=true;
}

const OUT_HEADERS = ['SHOP ID','報價單編號','峰潮下單日期','華茂下單日期','出貨廠商','出貨廠商ID','商家名稱','設備','銷售價(含稅)','試算未稅','數量','請款總金額','採購價(含稅)','採購價(未稅)','請款單號','發票號碼','發票日期','請款日期','備註'];
const HM_HEADERS = ['預計撥款日','請款單號','發票號碼','發票日期','說明','金額','已請款','已撥款','對帳單','備註'];
const SALES = {'EPSON發票機':[5990,5705],'WIFI發票機(M303)':[10500,10000],'掃碼槍':[2100,2000],'錢箱':[3150,3000],'P8802':[6405,6100],'發票紙捲':[0,0]};
const COST = {'EPSON發票機':[4074,3880],'WIFI發票機(M303)':[7350,7000],'掃碼槍':[1575,1500],'錢箱':[1470,1400],'發票紙捲':[0,0]};
const HM_ITEM_LABEL = {'EPSON發票機':'T823發票機(USB)','WIFI發票機(M303)':'M303發票機(WIFI)','掃碼槍':'掃碼槍','錢箱':'錢箱','EPSON T82III 隔板':'EPSON T82III 隔板'};
const PARTNER_ITEM_LABEL = {'拍檔POS主機':'拍檔POS主機','拍檔POS客顯螢幕':'拍檔POS客顯螢幕'};
const HUAMAO_ITEMS = new Set(['EPSON發票機','WIFI發票機(M303)','掃碼槍','錢箱','EPSON T82III 隔板']);
const PARTNER_ITEMS = new Set(['拍檔POS主機','拍檔POS客顯螢幕']);
const DIRECT_VENDOR_ITEMS = new Set([...HUAMAO_ITEMS,...PARTNER_ITEMS]);
const CORE_ITEMS = new Set(['EPSON發票機','WIFI發票機(M303)','掃碼槍','錢箱','EPSON T82III 隔板']);
let logLines=[], logFrame=0, fullLog=false;
function flushLog(){
  logFrame=0;
  if(typeof document==='undefined') return;
  const box=document.getElementById('log');
  if(!box) return;
  const limit=500, omitted=!fullLog&&logLines.length>limit;
  box.textContent=(omitted?'畫面顯示最近 500 筆。可按「顯示全部」查看較早的紀錄。\n':'')+
    (fullLog?logLines:logLines.slice(-limit)).join('\n');
}
function log(message){
  logLines.push(message);
  if(typeof document==='undefined') return;
  if(typeof requestAnimationFrame!=='function') flushLog();
  else if(!logFrame) logFrame=requestAnimationFrame(flushLog);
}
function resetLog(title){logLines=[];log(title);}
let hmSalesFileList=[];
function fileKey(file){return `${file.name}__${file.size}__${file.lastModified}`;}
function renderSalesFileList(){
  const box=document.getElementById('hmSalesList');
  if(!box) return;
  if(!hmSalesFileList.length){box.innerHTML='<div class="small">尚未加入銷貨單 PDF</div>';return;}
  box.innerHTML=hmSalesFileList.map((f,i)=>`<div class="fileItem"><span>${i+1}. ${escapeHtml(f.name)}</span><button type="button" class="miniBtn" data-remove-sales="${i}">移除</button></div>`).join('');
  box.querySelectorAll('[data-remove-sales]').forEach(btn=>{
    btn.addEventListener('click',()=>{hmSalesFileList.splice(Number(btn.dataset.removeSales),1);renderSalesFileList();});
  });
}
function addSalesFiles(files){
  const existing=new Set(hmSalesFileList.map(fileKey));
  for(const file of Array.from(files||[])){
    if(file && !existing.has(fileKey(file))){hmSalesFileList.push(file);existing.add(fileKey(file));}
  }
  renderSalesFileList();
}
function norm(s){return clean(s).replace(/\s+/g,'').toLowerCase();}
function clean(s){return String(s??'').replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/\u3000/g,' ').trim();}
const sheetHeaderIndex=new WeakMap();
function findVal(row, aliases){
  const indexed=sheetHeaderIndex.get(row);
  if(indexed){
    for(const alias of aliases){
      const key=indexed.get(norm(alias));
      if(key!==undefined)return row[key];
    }
    return '';
  }
  for(const a of aliases){const na=norm(a);for(const k of Object.keys(row)){if(norm(k)===na)return row[k];}}
  return '';
}
async function readFile(file){
  validateFile(file,['xlsx','xls']);
  const data=await readArrayBuffer(file);
  return parseExcelBuffer(data,file.name);
}

function parseExcelBuffer(data,name){
  if(typeof XLSX==='undefined'||typeof XLSX.read!=='function'){
    throw Error('首頁內建的 Excel 元件無法初始化。請更新 index.html 並重新整理。');
  }
  checkFileSignature(data,name);
  try {
    const wb=XLSX.read(new Uint8Array(data),{type:'array',cellDates:false});
    if(!wb.SheetNames?.length) throw Error('Excel 沒有可讀取的工作表。');
    return wb;
  }catch(error){throw Error('「'+name+'」無法讀取：'+error.message);}
}
function getGoogleSheetInfo(url){
  const u=clean(url);
  if(!u) return null;
  const idMatch=u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if(!idMatch) throw new Error('Google Sheet 連結格式不正確，請貼上 docs.google.com/spreadsheets 的完整連結。');
  const gidMatch=u.match(/[?&#]gid=(\d+)/);
  return {id:idMatch[1], gid:gidMatch?gidMatch[1]:'0'};
}
async function readGoogleSheetAsWorkbook(url){
  const info=getGoogleSheetInfo(url);
  if(!info) throw new Error('請貼上 Google Sheet 連結。');
  const csvUrl=`https://docs.google.com/spreadsheets/d/${info.id}/gviz/tq?tqx=out:csv&gid=${info.gid}`;
  let res;
  try{res=await fetch(csvUrl,{signal:AbortSignal.timeout(20000),credentials:'omit'});}
  catch{throw Error('無法連線讀取 Google Sheet，請下載 Excel 後匯入。');}
  if(!res.ok) throw new Error(`Google Sheet 讀取失敗（HTTP ${res.status}）。請確認文件存取權限，或下載 Excel 後匯入。`);
  const text=await res.text();
  if(/<html|<!doctype/i.test(text) || /ServiceLogin|accounts\.google/i.test(text)) throw new Error('Google Sheet 沒有開放讀取，請下載 Excel 後匯入。');
  const wb=XLSX.read(text,{type:'string',raw:true});
  // CSV 只有目前網址 gid 的那一個分頁，重新命名成工具會找的分頁名稱
  if(wb.SheetNames && wb.SheetNames[0]){
    const first=wb.SheetNames[0];
    wb.Sheets['下單設備資料']=wb.Sheets[first];
    if(first!=='下單設備資料') wb.SheetNames=[ '下單設備資料', ...wb.SheetNames.filter(n=>n!==first) ];
  }
  return wb;
}
function readArrayBuffer(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=e=>resolve(e.target.result);r.onerror=()=>reject(new Error('檔案讀取失敗，請確認檔案仍可存取。'));r.onabort=()=>reject(new Error('檔案讀取已中止。'));r.readAsArrayBuffer(file);});}
if(window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';}
function pickRegex(text, patterns){for(const re of patterns){const m=text.match(re); if(m) return clean(m[1]);} return '';}
function parseMoneyText(v){
  const s=clean(v).replace(/(?:NT\$|TWD|NTD|元|\$|,|\s)/gi,'');
  if(!s) return 0;
  const value=/^\([0-9]+(?:\.\d+)?\)$/.test(s) ? -Number(s.slice(1,-1)) : Number(s);
  if(!Number.isFinite(value)) throw new Error(`金額格式無法辨識：${clean(v)}`);
  return value;
}

function normalizeMerchantName(s){return norm(String(s||'').replace(/股份有限公司|有限公司|商行|公司|企業社|工作室/g,''));}
function extractSalesRecordFromText(text, fileName, pageNo){
  const invoiceNo=pickRegex(text,[/發票號碼\s*[:：]\s*([A-Z]{2}\d{8})/i,/發票號碼\s+([A-Z]{2}\d{8})/i]);
  const invoiceDate=pickRegex(text,[/發票日期\s*[:：]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,/發票日期\s+(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/]);
  const salesNo=pickRegex(text,[/銷貨單號\s*[:：]?\s*(\d{8,})/,/銷貨單號\s+(\d{8,})/]);
  const deliveryCompany=pickRegex(text,[/【設備收件資訊】[\s\S]*?公司名稱\s*[:：]\s*([^\s]+(?:商行|公司|股份有限公司|有限公司|企業社|工作室)?)/,/公司名稱\s*[:：]\s*([^\s]+(?:商行|公司|股份有限公司|有限公司|企業社|工作室)?)/]);
  const customerName=pickRegex(text,[/客戶名稱\s*[:：]\s*(?:\d+\s*)?([^\s]+(?:股份有限公司|有限公司|商行|公司|企業社|工作室)?)/]);
  const totalText=pickRegex(text,[/總計\s*[:：]?\s*([\d,]+(?:\.\d+)?)/,/未收款\s*[:：]?\s*([\d,]+(?:\.\d+)?)/]);
  return {檔名:fileName, 頁碼:pageNo, 公司名稱:deliveryCompany||customerName||'', 客戶名稱:customerName||'', 發票號碼:invoiceNo, 發票日期:invoiceDate, 銷貨單號:salesNo, 總計:parseMoneyText(totalText)||'', 摘要:text.slice(0,300)};
}
async function parseSalesPdfFile(file){
  return readPdfRecords(file,(text,name,page)=>{
    if(!/銷貨\s*(單|憑單)|出貨\s*單/.test(text))return [];
    return extractSalesRecordFromText(text,name,page);
  },r=>r.發票號碼||r.銷貨單號||r.公司名稱);
}

async function parseSalesPdfFiles(files){
  const arr=[...(files||[])];
  const out=[];
  for(const f of arr){
    try{
      const recs=await parseSalesPdfFile(f);
      if(!recs.length){
        throw new Error('沒有可核對的銷貨單資料，請檢查是否選錯檔案；掃描型 PDF 需先執行 OCR。');
      }else{
        for(const rec of recs){
          out.push(rec);
          log(`銷貨單解析：${f.name} 第${rec.頁碼}頁｜${rec.公司名稱||rec.客戶名稱||'未抓到公司'}｜發票 ${rec.發票號碼||'未抓到'}｜日期 ${rec.發票日期||'未抓到'}｜總計 ${rec.總計||'未抓到'}`);
        }
      }
    }catch(err){log(`銷貨單解析失敗：${f.name}｜${err.message||err}`);}
  }
  if(arr.length&&!out.length)throw Error('選取的銷貨單皆無法解析，本次未匯出。請查看處理紀錄，確認檔案為含文字層的銷貨單 PDF。');
  return out;
}
function salesRecordScore(merchant, record, amount=0, strict=false){
  const name=normalizeMerchantName(merchant);
  if(!name)return 0;
  const names=[record.公司名稱,record.客戶名稱].map(normalizeMerchantName).filter(Boolean);
  const full=names.includes(name);
  const partial=names.some(n=>(!strict||Math.min(n.length,name.length)>=2)&&(n.includes(name)||name.includes(n)));
  if(!full&&!partial)return 0;
  const expected=num(amount), total=num(record.總計);
  const delta=expected>0&&total>0?Math.abs(expected-total):null;
  if(strict&&(delta!==null&&delta>5||!full&&delta===null))return 0;
  return (full?(strict?200:100):80)+(delta===null?0:delta===0?40:delta<=5?25:-10);
}
function matchSalesRecord(merchant, salesRecords, amount=0, usedSet=null,strict=false){
  let best=null, score=0, tied=false;
  for(const record of salesRecords||[]){
    if(usedSet?.has(salesRecordKey(record)))continue;
    const rank=salesRecordScore(merchant,record,amount,strict);
    if(rank>score){best=record;score=rank;tied=false;}
    else if(rank===score&&rank>=80)tied=true;
  }
  return score>=80&&!tied?best:null;
}
function salesRecordKey(r){
  if(!r)return '';
  if(r.銷貨單號)return 'sale:'+r.銷貨單號;
  if(r.發票號碼)return 'invoice:'+r.發票號碼.toUpperCase();
  return `${r.檔名}#${r.頁碼}`;
}
function uniqueHeaders(rawHeaders){
  const seen=Object.create(null);
  return rawHeaders.map(h=>{
    const base=clean(h);
    if(!base) return '';
    const key=norm(base);
    const count=seen[key]||0;
    seen[key]=count+1;
    return count===0 ? base : `${base}_${count}`;
  });
}
function sheetRows(wb, sheetName, headerOnly=false){
  const ws=wb.Sheets[sheetName];
  if(!ws || !ws['!ref']) return {headers:[],rows:[],headerIdx:0};
  const end=XLSX.utils.decode_range(ws['!ref']).e;
  if(!headerOnly&&(end.r+1)*(end.c+1)>2000000) throw new Error(`${sheetName} 的資料範圍過大，請清除多餘格式或分批處理。`);
  // Anchor at A1: !ref may begin at B5. Preserve true column and row positions.
  const sampleEnd={r:Math.min(19,end.r),c:end.c};
  const options={header:1,raw:false,defval:'',blankrows:true};
  const aoa=XLSX.utils.sheet_to_json(ws,{...options,range:{s:{r:0,c:0},e:headerOnly?sampleEnd:end}});
  if(!aoa.length) return {headers:[],rows:[],headerIdx:0};
  const aliases=new Set(['商家名稱','SHOP ID','報價單編號','報價單號','設備1','請款單號','摘要說明','發票號碼','發票日期','銷貨日期','銷貨單號','客戶名稱','未收款','總計','應收','金額','說明','預計撥款日'].map(norm));
  let headerIdx=0,best=-1;
  for(let i=0;i<Math.min(20,aoa.length);i++){
    const cells=aoa[i].filter(x=>clean(x));
    const score=cells.reduce((sum,x)=>sum+(aliases.has(norm(x))?100:0),0)+Math.min(cells.length,50);
    if(score>best){best=score;headerIdx=i;}
  }
  const headers=uniqueHeaders(aoa[headerIdx].map(clean));
  if(headerOnly)return {headers,rows:[],headerIdx};
  const keys=new Map();
  for(const h of headers)if(h&&!keys.has(norm(h)))keys.set(norm(h),h);
  const rows=[];
  if(ws['!merges']?.some(m=>m.e.r>headerIdx)) log(`提醒：${sheetName} 包含資料區合併儲存格；僅讀取左上角，不自動複製商家或數量。`);
  for(let i=headerIdx+1;i<aoa.length;i++){
    const obj=Object.create(null);let any=false;
    headers.forEach((h,idx)=>{if(h){obj[h]=aoa[i][idx]??'';if(clean(aoa[i][idx]))any=true;}});
    obj.__aoa=aoa[i];obj.__rowNum=i+1;
    if(any){sheetHeaderIndex.set(obj,keys);rows.push(obj);}
  }
  return {headers,rows,headerIdx};
}

const requestHeaderGroups=[
  ['請款單號','請款單編號','設備請款單號','vk請款單'],
  ['憑證文件號碼','發票號碼','請款憑證'],
  ['金額','請款金額','含稅金額','金額(含稅)','金額(未稅)','未稅金額'],
  ['摘要說明','摘要','備註','說明','請款描述'],
  ['憑證日期','發票日期','建檔日期','請款日期'],
];
function hasHeader(headers,aliases){return aliases.some(alias=>headers.has(norm(alias)));}
function chooseInvoiceSheet(wb, supplement=false){
  let best=null;
  const names=wb.SheetNames.includes('VK請款單')?['VK請款單',...wb.SheetNames.filter(n=>n!=='VK請款單')]:wb.SheetNames;
  for(const name of names){
    if(/SAP匯入|下單設備資料/.test(name))continue;
    const parsed=sheetRows(wb,name,true);
    if(!parsed.headers.length)continue;
    const headers=new Set(parsed.headers.map(norm));
    const hits=requestHeaderGroups.map(group=>hasHeader(headers,group));
    if((!hits[0]&&!(supplement&&hits[1]))||!hits.slice(1).some(Boolean))continue;
    const score=hits.filter(Boolean).length;
    if(!best || score>best.score)best={name,score};
    if(name==='VK請款單')break;
  }
  if(!best)throw Error('找不到「請款單匯出.xlsx」的必要欄位：請款單號'+(supplement?'或發票號碼':'')+'，以及憑證、金額、摘要或日期欄位。');
  const parsed=sheetRows(wb,best.name);
  const noFields=supplement ? [...requestHeaderGroups[0],...requestHeaderGroups[1]] : requestHeaderGroups[0];
  if(!parsed.rows.some(row=>cleanRequestNo(findVal(row,noFields))||supplement&&findVal(row,requestHeaderGroups[1]))) {
    throw Error('「'+best.name+'」有表頭，但沒有可用的請款或發票資料。');
  }
  return {...best,...parsed};
}
function standardItem(raw){let s=clean(raw).replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/^華茂出貨/,'').replace(/\s/g,'').replace(/台$/,'');
  // v13.6：補齊 POS 設備即時庫存常見名稱對應
  // POS「發票機」= 廠商下單 T823發票機(USB)
  // POS「WIFI發票機」= 廠商下單 M303發票機(WIFI)
  const code=s.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.includes('P8802') || code.includes('PP8802') || /^8802/.test(code)) return 'P8802';
  if(/拍檔.*POS.*客顯|POS.*客顯.*螢幕|PMC-?1500(?!\d)/i.test(s)) return '拍檔POS客顯螢幕';
  if(/拍檔.*POS.*主機|A4-1-E(?=[/()\s]|$)|PartnerA4[/-]J6412/i.test(s)) return '拍檔POS主機';
  if(/T82III.*隔板|EPSON.*T82III.*隔板/i.test(s)) return 'EPSON T82III 隔板';
  if(/M303|WIFI發票機|WiFi發票機|wifi發票機|Wi\-?Fi發票機/i.test(s)) return 'WIFI發票機(M303)';
  if(/^發票機$|^一般發票機$|T82|T823|EPSON發票機/i.test(s)) return 'EPSON發票機';
  if(/掃碼/.test(s)) return '掃碼槍';
  if(/錢箱/.test(s)) return '錢箱';
  if(/發票紙/.test(s)) return '發票紙捲';
  return s;
}
function num(v){
  const n=Number(String(v??'').replace(/,/g,'').trim());
  return Number.isFinite(n)?n:0;
}
function excelDateToText(v){
  const s=clean(v);
  if(!s) return '';
  const n=Number(s);
  if(Number.isFinite(n) && n>30000 && n<60000){
    const d=XLSX.SSF.parse_date_code(n);
    if(d) return `${d.y}/${String(d.m).padStart(2,'0')}/${String(d.d).padStart(2,'0')}`;
  }
  return s;
}
function isBlankRequestNo(v){const s=norm(v);return !s||['x','xx','-','—','/','無','無請款','不用請款','不需請款','n/a','na'].includes(s);}
function cleanRequestNo(v){return isBlankRequestNo(v)?'':clean(v);}
function normalizeRequestNo(v){return cleanRequestNo(v).toUpperCase().replace(/\s+/g,'');}
function parsePosDevices(row){
  const devices=[];
  const named=Object.keys(row).some(k=>/^(設備|商品|品項)\d+$/.test(norm(k)));
  if(named){
    for(let i=1;i<=15;i++){
      const dev=clean(findVal(row,[`設備${i}`,`商品${i}`,`品項${i}`]));
      if(!dev)continue;
      const qty=deviceQuantity(findVal(row,[`設備${i}數量`,`商品${i}數量`,`品項${i}數量`,i===1?'數量':`數量_${i-1}`]),row.__rowNum);
      if(qty>0 && !/^[-+]?\d+(?:\.\d+)?$/.test(dev))devices.push({item:standardItem(dev),qty,raw:dev,slot:i,source:`設備${i}`});
    }
  }else{
    const arr=row.__aoa||[];
    for(const [a,b] of [[10,11],[12,13],[14,15],[16,17],[18,19]]){
      const dev=clean(arr[a]);if(!dev)continue;
      const qty=deviceQuantity(arr[b],row.__rowNum);
      if(qty>0 && !/^[-+]?\d+(?:\.\d+)?$/.test(dev))devices.push({item:standardItem(dev),qty,raw:dev,source:`${a+1}/${b+1}欄`});
    }
    if(!devices.length){
      const dev=clean(findVal(row,['設備','商品','品項','設備名稱','商品名稱','單一設備']));
      if(dev){const qty=deviceQuantity(findVal(row,['數量','商品數量','設備數量','峰潮數量']),row.__rowNum);if(qty>0)devices.push({item:standardItem(dev),qty,raw:dev,source:'單欄備援'});}
    }
  }
  return devices;
}

function parseInvoicePosDevices(row){
  const devices=[];
  for(let i=1;i<=5;i++){
    const dev=clean(findVal(row,[`設備${i}`]));
    if(!dev) continue;
    // 純數字是數量，不應被當成設備名稱輸出。
    if(/^[-+]?\d+(?:\.\d+)?$/.test(dev.replace(/,/g,''))) continue;
    const qtyHeader=i===1?'數量':`數量_${i-1}`;
    const qty=deviceQuantity(findVal(row,[`設備${i}數量`,qtyHeader]),row.__rowNum);
    const item=standardItem(dev);
    // slot 是原始 POS 設備欄位位置；即使品項名稱相同，也視為兩筆獨立資料。
    if(item && qty>0) devices.push({item,qty,raw:dev,slot:i,source:`設備${i}/${qtyHeader}`});
  }
  return devices;
}
function getPosSheet(wb){
  const targetSheetName = wb.SheetNames.find(n => norm(n) === norm('下單設備資料')) || wb.SheetNames.find(n => norm(n).includes(norm('下單設備資料')));
  if(!targetSheetName) throw new Error('找不到「下單設備資料」分頁，請確認 POS設備即時庫存檔案是否正確。');
  return targetSheetName;
}
function validatePosColumns(parsed, namedOnly=false){
  const headers=new Set(parsed.headers.map(norm));
  const identified=hasHeader(headers,['商家名稱','商家','店家名稱','客戶名稱']);
  const named=hasHeader(headers,['設備1']);
  const devices=namedOnly ? named : parsed.headers.some(h=>/^(設備|商品|品項)([1-9]\d*)?$/.test(norm(h))) ||
    [10,12,14,16,18].some(i=>parsed.headers[i]&&parsed.headers[i+1]);
  if(!identified||!devices)throw Error('「下單設備資料」缺少'+(!identified?'商家名稱':'設備欄位')+'，請選擇 POS設備即時庫存.xlsx。');
}
function buildPosIndex(wb){
const all=[]; const sheetSummaries=[];
const targetSheetName = wb.SheetNames.find(n => norm(n) === norm('下單設備資料')) || wb.SheetNames.find(n => norm(n).includes(norm('下單設備資料')));
if(!targetSheetName){
  throw new Error('找不到「下單設備資料」分頁，請確認 POS 檔案。');
}
const sheetNamesToRead = targetSheetName ? [targetSheetName] : [];
for(const name of sheetNamesToRead){
  const sr=sheetRows(wb,name);
  validatePosColumns(sr);
  sheetSummaries.push(`${name}: ${sr.rows.length}列，欄位=${sr.headers.join(', ')}`);
  for(const row of sr.rows){
    const rec={
      rowNum: row.__rowNum,
      shopId: clean(findVal(row,['SHOP ID','shop id','Shop ID','shopid'])),
      merchant: clean(findVal(row,['商家名稱','商家','店家名稱','客戶名稱'])),
      quote: clean(findVal(row,['報價單編號','報價單號','報價單'])),
      requestNo: cleanRequestNo(findVal(row,['設備請款單號','請款單號','請款單編號'])),
      fcDate: excelDateToText(findVal(row,['峰潮下單日期','峰潮下單日','峰潮訂購日期'])),
      hmDate: excelDateToText(findVal(row,['華茂下單日期','華茂下單日','華茂訂購日期'])),
      sheet:name
    };
    const devs=parseInvoicePosDevices(row);
    rec.devices=devs;
    if(rec.shopId||rec.merchant||rec.quote||rec.requestNo||rec.fcDate||rec.hmDate||devs.length) all.push(rec);
  }
}
function isPrimary(rec){return norm(rec.sheet).includes(norm('下單設備資料'));}
function scoreRec(rec, merchant, shopId){
  let score=0; const m=norm(merchant), sid=norm(shopId);
  if(sid && rec.shopId && norm(rec.shopId)===sid) score+=100;
  if(rec.merchant && norm(rec.merchant)===m) score+=80;
  if(isPrimary(rec)) score+=20;
  if(rec.devices && rec.devices.length) score+=10;
  if(rec.quote) score+=3;
  if(rec.hmDate) score+=2;
  if(rec.fcDate) score+=1;
  return score;
}
function findRecord(merchant, shopId=''){
  const candidates=all
    .map((r,idx)=>({r,idx,score:scoreRec(r,merchant,shopId)}))
    .filter(x=>x.score>=80);
  if(!candidates.length) return null;
  candidates.sort((a,b)=> b.score-a.score || a.idx-b.idx);
  return candidates[0].r;
}
function find(merchant){
  const r=findRecord(merchant);
  return r ? {shopId:r.shopId||'',quote:r.quote||'',fcDate:r.fcDate||'',hmDate:r.hmDate||'',requestNo:r.requestNo||'',_rec:r} : {shopId:'',quote:'',fcDate:'',hmDate:'',requestNo:'',_rec:null};
}
function findPaperQty(merchant, shopId, preferredRec=null){
  const r=preferredRec || findRecord(merchant,shopId);
  if(!r) return {qty:0, matched:[]};
  let total=0; let matched=[];
  for(const d of (r.devices||[])){
    if(d.item==='發票紙捲' && d.qty>0){ total += Number(d.qty)||0; matched.push(`${r.sheet}:${d.qty}（${d.source||''}）`); }
  }
  return {qty:total, matched};
}
const paperCount=all.reduce((sum,r)=>sum+(r.devices||[]).filter(d=>d.item==='發票紙捲').length,0);
return {find, findRecord, findPaperQty, count:all.length, paperCount, sheetSummaries, records:all};}
function parseInvoiceRows(rows){const parsed=[];let fail=[];for(const row of rows){const memo=clean(findVal(row,['摘要說明','備註','摘要'])); if(!memo){fail.push('缺摘要說明'); continue;}
  const merchant = memo.includes('至') ? clean(memo.split('至').pop().replace(/["“”]/g,'')) : '';
  let itemText = memo;
  if(itemText.includes('出貨')) itemText=itemText.split('出貨').pop();
  if(itemText.includes('至')) itemText=itemText.split('至')[0];
  itemText=itemText.replace(/台至.*/,'');
  const parts=itemText.split('+');
  let items=[]; let printerQty=0;
  for(let p of parts){p=clean(p).replace(/台$/,''); const m=p.match(/(.+?)\*(\d+)/); if(!m) continue; const item=standardItem(m[1]); const qty=parseInt(m[2],10)||0; if(CORE_ITEMS.has(item)){items.push({item,qty}); if(item==='EPSON發票機'||item==='WIFI發票機(M303)') printerQty+=qty;}}
  if(printerQty>0) items.push({item:'發票紙捲',qty:printerQty*2, fallback:true});
  if(items.length===0){fail.push(memo); continue;}
  parsed.push({row,merchant,memo,items,printerQty});
}
return {parsed,fail};}
function salesPriceForItem(item){
  const key=standardItem(item);
  if(key==='P8802') return [6405,6100];
  return SALES[key]||['',''];
}
function makeStats(output){const map={}; for(const r of output){const key=r['商家名稱']+'|'+r['設備']; if(!map[key]) map[key]={'商家名稱':r['商家名稱'],'設備':r['設備'],'數量':0}; map[key]['數量'] += Number(r['數量'])||0;} return Object.values(map);}
function aggregateVendorItems(devices){
  const agg={};
  for(const d of (devices||[])){
    if(!HUAMAO_ITEMS.has(d.item)) continue;
    const qty=Number(d.qty)||0;
    if(qty<=0) continue;
    agg[d.item]=(agg[d.item]||0)+qty;
  }
  return agg;
}
function hmDescription(agg, merchant){
  const order=['EPSON發票機','WIFI發票機(M303)','掃碼槍','錢箱','EPSON T82III 隔板'];
  const parts=[];
  for(const item of order){
    if(agg[item]>0) parts.push(`${HM_ITEM_LABEL[item]||item}*${agg[item]}`);
  }
  if(!parts.length) return '';
  return `華茂出貨${parts.join('+')}台至${merchant}`;
}
function hmAmount(agg){
  let total=0;
  for(const [item,qty] of Object.entries(agg)) total += ((COST[item]||[0,0])[0]||0) * qty;
  return total;
}
function formatToday(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
async function generateHuamao(){
  resetLog('開始生成華茂款項匯入資訊...');
  document.getElementById('hmStatus').innerHTML='';
  const posF=document.getElementById('hmPosFile').files[0];
  const salesFiles=[...hmSalesFileList];
  const startRow=positiveRow(document.getElementById('startRow').value || '2');
  const endVal=clean(document.getElementById('endRow').value);
  const endRow=endVal ? positiveRow(endVal) : Infinity;
  if(!posF){alert('請先上傳 POS設備即時庫存.xlsx');return;}
  if(endVal && endRow < startRow){alert('結束列數不可小於開始列數');return;}
  try{
    log(`讀取檔案：${posF.name}`);
    const sr=await readLegacyImport(posF,'legacyPos');
    const salesRecords=await parseSalesPdfFiles(salesFiles);
    if(salesRecords.length) log(`銷貨單辨識筆數：${salesRecords.length}`);
    const sheetName=sr.sheet;
    log(`選用 POS 分頁：${sheetName}`);
    log(`資料列數：${sr.rows.length}，表頭在第 ${sr.headerIdx+1} 列`);
    log(`處理範圍：第 ${startRow} 列 ~ ${endVal ? endRow : '最後一列'}`);
    const rows=sr.rows.filter(r=>r.__rowNum>=startRow && r.__rowNum<=endRow);
    if(!rows.length)throw new Error('指定區間沒有資料，請確認實際 Excel 列數。');
    const output=[]; const process=[];
    const usedSales=new Set();
    let skipped=0;
    for(const row of rows){
      const rowNum=row.__rowNum;
      const merchant=clean(findVal(row,['商家名稱','商家','店家名稱','客戶名稱']));
      const shopId=clean(findVal(row,['SHOP ID','shop id','Shop ID','shopid']));
      const requestNo=cleanRequestNo(findVal(row,['設備請款單號','請款單號','請款單編號']));
      const devices=parsePosDevices(row);
      const agg=aggregateVendorItems(devices);
      const desc=hmDescription(agg, merchant);
      const unknownCost=Object.keys(agg).filter(item=>!Object.hasOwn(COST,item));
      const amount=unknownCost.length?'':hmAmount(agg);
      const sales=matchSalesRecord(merchant, salesRecords, amount, usedSales,true);
      const invoiceNo=sales?.發票號碼 || '';
      const invoiceDate=sales?.發票日期 || '';
      const salesNo=sales?.銷貨單號 || '';
      
      const note=[invoiceDate?`發票日期：${invoiceDate}`:'',salesNo?`銷貨單號：${salesNo}`:''].filter(Boolean).join('｜');
      let result='成功';
      if(!merchant){result='略過：缺商家名稱'; skipped++;}
      else if(!Object.keys(agg).length){result='略過：沒有華茂出貨設備'; skipped++;}
      else if(!requestNo){result='成功但缺請款單號';}
      if((result.startsWith('成功')) && salesRecords.length && !sales){result += '｜未對到銷貨單';}
      if(result.startsWith('成功')){
        if(sales) usedSales.add(salesRecordKey(sales));
        if(unknownCost.length) result+='｜採購價未設定，金額留白待確認';
        output.push({'預計撥款日':'','請款單號':requestNo,'發票號碼':invoiceNo,'發票日期':invoiceDate,'說明':desc,'金額':amount,'已請款':'','已撥款':'','對帳單':'','備註':note});
      }
      process.push({'列數':rowNum,'SHOP ID':shopId,'商家名稱':merchant,'請款單號':requestNo,'設備':Object.entries(agg).map(([k,v])=>`${k}*${v}`).join('+'),'金額':amount, '發票號碼':invoiceNo, '發票日期':invoiceDate, '銷貨單號':salesNo, '結果':result});
    }
    log(`掃描列數：${rows.length}`);
    log(`輸出筆數：${output.length}`);
    log(`略過筆數：${skipped}`);
    if(process.length) log('處理預覽前 5 筆：\n'+process.slice(0,5).map(x=>`${x['列數']}｜${x['商家名稱']}｜${x['設備']}｜${x['結果']}`).join('\n'));
    if(!output.length)throw new Error('指定區間沒有可匯出的華茂設備資料，未更新接續列數。');
    const lastProcessedRow=rows.reduce((m,r)=>Math.max(m,r.__rowNum),0);
    
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(output,{header:HM_HEADERS}),'華茂款項匯入資訊');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(process),'處理清單');
    if(salesRecords.length){
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(salesRecords),'銷貨單辨識結果');
      const unmatched=salesRecords.filter(r=>!usedSales.has(salesRecordKey(r))).map(r=>({...r, 狀態:'未對到 POS 商家/金額'}));
      if(unmatched.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(unmatched),'未對到銷貨單');
    }
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(logLines.map(x=>[x])),'處理紀錄');
    XLSX.writeFile(wb,`華茂款項匯入資訊_v14_1_${formatToday()}.xlsx`);
    if(lastProcessedRow) saveLastRow(lastProcessedRow);
    const warnings=process.filter(r=>r['結果']!=='成功').length;
    document.getElementById('hmStatus').innerHTML=`<div class="${warnings?'warn':'ok'}">${uiIcon(warnings?'triangle-alert':'circle-check')} 生成完成：掃描 ${rows.length} 列，輸出 ${output.length} 筆，略過 ${skipped} 筆；${warnings} 筆含提醒，請核對「處理清單」。</div>`;
  }catch(err){console.error(err);log('錯誤：'+(err.stack||err.message));document.getElementById('hmStatus').innerHTML='<div class="warn">'+escapeHtml(err.message||err)+'</div>';}
}
function buildInvoiceRequestIndex(rows){const map=new Map();for(const row of rows){const requestNo=cleanRequestNo(findVal(row,['請款單號','請款單編號']));if(!requestNo)continue;const one=parseInvoiceRows([row]).parsed[0]||null;if(map.has(normalizeRequestNo(requestNo))) throw new Error(`請款單號 ${requestNo} 重複，請先確認重複來源，避免覆寫金額。`);map.set(normalizeRequestNo(requestNo),{row,requestNo,items:one?one.items:[],merchant:one?one.merchant:'',memo:clean(findVal(row,['摘要說明','備註','摘要']))});}return map;}
// Step 2：保留 POS 各設備欄位的獨立品項。即使同名設備分開填寫，也不可合併數量（例如發票紙捲 2 捲贈送、5 捲購買）。
function orderedPosItems(devices,invoiceItems=[]){
  const source=(devices||[]).map((d,index)=>({item:d.item,qty:Number(d.qty)||0,index}));
  const out=[];
  const used=new Set();
  // 維持原本「請款摘要中的設備優先」順序，但每次只配對一個 POS 設備欄位，避免同品項被加總。
  for(const it of invoiceItems||[]){
    const match=source.find(d=>!used.has(d.index)&&d.item===it.item);
    if(match){out.push({item:match.item,qty:match.qty});used.add(match.index);}
  }
  // 其餘設備依 POS 原始欄位順序逐筆輸出；同名品項仍各自保留一列。
  for(const d of source){
    if(!used.has(d.index)) out.push({item:d.item,qty:d.qty});
  }
  return out;
}
async function convert(){resetLog('開始生成請款單轉換結果...');document.getElementById('status').innerHTML='';const invF=document.getElementById('invoiceFile').files[0];const posF=document.getElementById('posFile').files[0];if(!invF||!posF){alert('請先上傳兩個檔案');return;}const sText=clean(document.getElementById('invoiceStartRow')?.value);const eText=clean(document.getElementById('invoiceEndRow')?.value);if(eText&&!sText)throw new Error('請同時填寫開始列，或將兩欄留空。');const startRow=sText?positiveRow(sText):0;const endRow=eText?positiveRow(eText):(startRow||0);if(startRow&&endRow<startRow){alert('結束列不可小於開始列');return;}
try{const [inv,recordsFromPos]=await Promise.all([readLegacyImport(invF,'legacyInvoice'),readLegacyImport(posF,'legacyIndex')]);const invoiceIndex=buildInvoiceRequestIndex(inv.rows);const pos={records:recordsFromPos};let records;if(startRow){records=pos.records.filter(r=>r.rowNum>=startRow&&r.rowNum<=endRow);log(`依 POS 列數處理：${startRow}～${endRow}`);}else{records=pos.records.filter(r=>normalizeRequestNo(r.requestNo)&&invoiceIndex.has(normalizeRequestNo(r.requestNo)));log('未指定列數：依請款單號精準對應 POS 列');}if(!records.length)throw new Error('沒有符合條件的 POS 資料；請確認列數、工作表及請款單號。');const seenRequests=new Set();for(const rec of records){const key=normalizeRequestNo(rec.requestNo);if(key&&invoiceIndex.has(key)){if(seenRequests.has(key))throw new Error(`POS 區間內請款單號 ${key} 對應多列，請確認總金額分配後分批處理，避免重複請款總金額。`);seenRequests.add(key);}}const output=[];let noInvoice=0,skipped=0;for(const rec of records){const entry=invoiceIndex.get(normalizeRequestNo(rec.requestNo))||null;if(!entry)noInvoice++;const items=orderedPosItems(rec.devices,entry?.items||[]);if(!items.length){skipped++;log(`第 ${rec.rowNum} 列沒有設備，已略過`);continue;}log(`POS 第 ${rec.rowNum} 列設備：${items.map(it=>`${it.item}*${it.qty}`).join('、')}`);const row=entry?.row||{};const invoiceNo=entry?.requestNo||rec.requestNo||'';const voucher=entry?clean(findVal(row,['憑證文件號碼','發票號碼'])):'';const voucherDate=entry?excelDateToText(findVal(row,['憑證日期','發票日期'])):'';const requestDate=entry?clean(findVal(row,['建檔日期','請款日期','繳款日期'])):'';const total=entry?clean(findVal(row,['金額','請款金額','含稅金額'])):'';let first=true;for(const it of items){const sale=salesPriceForItem(it.item);const cost=COST[standardItem(it.item)]||['',''];const vendor=vendorForItem(it.item);const isHuamao=vendor==='華茂';const isPartner=vendor==='拍檔';output.push({'SHOP ID':rec.shopId,'報價單編號':rec.quote,'峰潮下單日期':(isHuamao||isPartner)?'':rec.fcDate,'華茂下單日期':isHuamao?rec.hmDate:'','出貨廠商':isHuamao?'VAA0000037':'','出貨廠商ID':isHuamao?'華茂資訊':(isPartner?'拍檔':''),'商家名稱':rec.merchant,'設備':it.item,'銷售價(含稅)':sale[0],'試算未稅':sale[1],'數量':it.qty,'請款總金額':first?total:'','採購價(含稅)':cost[0],'採購價(未稅)':cost[1],'請款單號':invoiceNo,'發票號碼':voucher,'發票日期':voucherDate,'請款日期':requestDate,'備註':entry?entry.memo:`POS 第 ${rec.rowNum} 列｜無請款單資料`});first=false;}}
if(!output.length)throw new Error('沒有可匯出的設備，請確認設備欄位及數量。');const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(output,{header:OUT_HEADERS}),'轉換結果');XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(makeStats(output)),'數量統計');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(logLines.map(x=>[x])),'處理紀錄');XLSX.writeFile(wb,`請款單轉換結果_${formatToday()}.xlsx`);document.getElementById('status').innerHTML=`<div class="ok">轉換完成：掃描 ${records.length} 個 POS 列、輸出 ${output.length} 筆設備資料；其中 ${noInvoice} 列沒有請款單資料，仍已正常匯出。</div>`;}catch(err){console.error(err);log('錯誤：'+(err.stack||err.message));document.getElementById('status').innerHTML='<div class="warn">'+escapeHtml(err.message||err)+'</div>';}}

function normalizeInvoiceNo(v){return clean(v).toUpperCase().replace(/[^A-Z0-9]/g,'');}
function normalizeSalesNo(v){return clean(v).replace(/[^0-9A-Za-z]/g,'');}
function allRowText(row){return Object.keys(row).filter(k=>!k.startsWith('__')).map(k=>clean(row[k])).filter(Boolean).join(' ');}
function pickInvoiceFromText(text){const m=String(text||'').match(/[A-Z]{2}\s*\d{8}/i); return m?normalizeInvoiceNo(m[0]):'';}
function rowAmount(row){
  const aliases=['未收款','總計','含稅金額','應收金額','發票金額','金額','請款金額','本期應收','合計'];
  for(const a of aliases){const v=findVal(row,[a]);if(clean(v)!=='') return parseMoneyText(v);}
  return '';
}
function rowInvoiceNo(row){
  const v=findVal(row,['發票號碼','憑證文件號碼','統一發票號碼','Invoice No','InvoiceNo','發票字軌號碼']);
  return normalizeInvoiceNo(v) || pickInvoiceFromText(allRowText(row));
}
function rowSalesNo(row){
  const direct=normalizeSalesNo(findVal(row,['銷貨單號','銷貨單編號','單據號碼','對帳單號','單號','Sales No']));
  if(direct) return direct;
  const text=allRowText(row);
  const m=String(text||'').match(/銷貨單號\s*[:：]?\s*(\d{8,})|銷貨憑單\s*[:：]?\s*(\d{8,})/);
  return m ? normalizeSalesNo(m[1]||m[2]) : '';
}
function rowDate(row){return excelDateToText(findVal(row,['發票日期','憑證日期','銷貨日期','日期','開立日期','單據日期']));}
function rowMerchant(row){return clean(findVal(row,['商家名稱','公司名稱','客戶名稱','客戶','店家名稱','買受人','收件公司']));}
function rowDesc(row){return clean(findVal(row,['說明','摘要說明','摘要','備註','品名規格','品名','項目','商品名稱'])) || allRowText(row).slice(0,120);}

function extractArRecordsFromText(text, fileName, pageNo){
  const out=[];
  const t=String(text||'').replace(/\s+/g,' ');
  const re=/銷貨憑單\s*[:：]\s*(\d{8,})\s*發票號碼\s*[:：]\s*([A-Z]{2}\d{8})([\s\S]*?)(?=銷貨憑單\s*[:：]|本期合計金額|本期應收帳款|$)/gi;
  let m;
  while((m=re.exec(t))){
    const before=t.slice(Math.max(0,m.index-80),m.index);
    const dateMatch=before.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})(?!.*\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
    const seg=m[3]||'';
    let amount='', net='', tax='';
    const compact=seg.replace(/,/g,'');
    const grouped=compact.match(/淨額\s*[:：]\s*稅額\s*[:：]\s*小計\s*[:：]\s*([0-9]+(?:\.\d+)?)\s+([0-9]+(?:\.\d+)?)\s+([0-9]+(?:\.\d+)?)/);
    if(grouped){
      const nums=grouped.slice(1).map(Number).filter(n=>Number.isFinite(n));
      [net,tax,amount]=nums;
    }else{
      const sub=seg.match(/小計\s*[:：]\s*([\d,]+(?:\.\d+)?)/);
      const nnet=seg.match(/淨額\s*[:：]\s*([\d,]+(?:\.\d+)?)/);
      const ntax=seg.match(/稅額\s*[:：]\s*([\d,]+(?:\.\d+)?)/);
      amount=sub?parseMoneyText(sub[1]):'';
      net=nnet?parseMoneyText(nnet[1]):'';
      tax=ntax?parseMoneyText(ntax[1]):'';
    }
    const itemText=(seg.split(/銷貨憑單\s*[:：]|本期合計金額|本期應收帳款/)[0]||'').slice(0,180).trim();
    out.push({'來源':'華茂應收帳款明細','工作表':fileName,'列數':`PDF第${pageNo}頁`,'發票號碼':normalizeInvoiceNo(m[2]),'發票日期':dateMatch?dateMatch[1]:'','銷貨單號':normalizeSalesNo(m[1]),'客戶/商家':'順立智慧股份有限公司','說明':itemText,'金額':amount,'未稅金額':net,'稅額':tax,'_text':seg});
  }
  return out;
}
async function parseArPdfFile(file){
  const out=await readPdfRecords(file,(text,name,p)=>extractArRecordsFromText(text,name,p));
  if(!out.length) throw new Error('應收帳款 PDF 沒有辨識到資料，請使用文字型 PDF 或 Excel；本次未匯出。');
  return out;
}

async function arFileRecords(file){
  const lower=(file.name||'').toLowerCase();
  if(lower.endsWith('.pdf')) return await parseArPdfFile(file);
  return readLegacyImport(file,'legacyAr');
}

function financialImport(wb,label){
  const opposite=label==='華茂款項匯入資訊'?'華茂應收帳款明細':'華茂款項匯入資訊';
  const candidates=wb.SheetNames.filter(name=>norm(name)!==norm(opposite));
  const narrowed={...wb,SheetNames:candidates.filter(name=>{
    const h=new Set(sheetRows(wb,name,true).headers.map(norm));
    return hasHeader(h,[...requestHeaderGroups[1],'統一發票號碼','發票字軌號碼','Invoice No','InvoiceNo','銷貨單號','銷貨單編號','單據號碼','對帳單號','單號','Sales No','商家名稱','公司名稱','客戶名稱','客戶','店家名稱','買受人','收件公司']) &&
      hasHeader(h,[...requestHeaderGroups[2],'未收款','總計','應收金額','發票金額','本期應收','合計']);
  })};
  if(!narrowed.SheetNames.length)throw Error('「'+label+'」需包含發票／銷貨單號或商家欄位，以及金額欄位。');
  const rows=workbookRecords(narrowed,label);
  if(!rows.length)throw Error('「'+label+'」有表頭，但沒有可核對的明細。');
  return rows;
}
function projectLegacy(wb,mode){
  if(mode==='legacyInvoice')return chooseInvoiceSheet(wb);
  if(mode==='legacyIndex')return buildPosIndex(wb).records;
  if(mode==='legacyHm')return financialImport(wb,'華茂款項匯入資訊');
  if(mode==='legacyAr')return financialImport(wb,'華茂應收帳款明細');
  const sheet=getPosSheet(wb), result=sheetRows(wb,sheet);
  validatePosColumns(result);
  return {...result,sheet};
}
async function readLegacyImport(file,mode){
  if(typeof ImportIO!=='undefined')return ImportIO.excel(file,mode);
  return projectLegacy(await readFile(file),mode);
}

function workbookRecords(wb, sourceLabel){
  const out=[];
  for(const name of financialSheetNames(wb,sourceLabel)){
    const sr=sheetRows(wb,name);
    for(const row of sr.rows){
      const invoice=rowInvoiceNo(row);
      const amount=rowAmount(row);
      const merchant=rowMerchant(row);
      const desc=rowDesc(row);
      const salesNo=rowSalesNo(row);
      const date=rowDate(row);
      const text=allRowText(row);
      // 空列或完全不像資料列就略過；保留缺發票但有金額/商家的列供人工檢查
      if(!invoice && !amount && !merchant && !salesNo) continue;
      const expectedPayDate=excelDateToText(findVal(row,['預計撥款日','預計付款日','撥款日']));
      out.push({'來源':sourceLabel,'工作表':name,'列數':row.__rowNum||'', '發票號碼':invoice,'發票日期':date,'銷貨單號':salesNo,'客戶/商家':merchant,'說明':desc,'金額':amount, '預計撥款日':expectedPayDate, '_text':text});
    }
  }
  return out;
}
function recordPublic(r,status='',note='',expectedPayDate=''){
  return {'來源':r['來源'],'工作表':r['工作表'],'列數':r['列數'],'發票號碼':r['發票號碼'],'發票日期':r['發票日期'],'銷貨單號':r['銷貨單號'],'客戶/商家':r['客戶/商家'],'說明':r['說明'],'金額':r['金額'],'預計撥款日':expectedPayDate || r['預計撥款日'] || '','比對狀態':status,'備註':note};
}
async function compareHuamaoAr(){
  resetLog('開始比對華茂應收帳款明細...');
  document.getElementById('arStatus').innerHTML='';
  const importF=document.getElementById('hmImportFile').files[0];
  const arF=document.getElementById('hmArFile').files[0];
  const expectedPayDateInput=clean(document.getElementById('arExpectedPayDate')?.value || '');
  if(!importF||!arF){alert('請先上傳「華茂款項匯入資訊」與「華茂應收帳款明細」兩個檔案');return;}
  try{
    log(`讀取華茂款項匯入資訊：${importF.name}`);
    log(`讀取華茂應收帳款明細：${arF.name}`);
    const importRows=await readLegacyImport(importF,'legacyHm');
    const arRows=await arFileRecords(arF);
    if(!arRows.length)throw new Error('應收帳款來源沒有可比對資料，請確認表頭與檔案。');
    log(`款項匯入資訊可比對筆數：${importRows.length}`);
    log(`應收帳款對帳單可比對筆數：${arRows.length}`);
    const importInvoiceSet=new Set(importRows.map(r=>r['發票號碼']).filter(Boolean));
    const arInvoiceSet=new Set(arRows.map(r=>r['發票號碼']).filter(Boolean));
    const importByInvoice=buildRecordIndexes(importRows).byInvoice;
    assertUniqueInvoices(importRows);assertUniqueInvoices(arRows);
    const requested=[]; const unpaid=[]; const missingInvoice=[]; const amountDiff=[];
    for(const r of arRows){
      if(!r['發票號碼']){missingInvoice.push(recordPublic(r,'待人工確認','對帳單此列未抓到發票號碼', expectedPayDateInput)); continue;}
      const imp=importByInvoice[r['發票號碼']];
      if(imp){
        const arAmt=r['金額']; const impAmt=imp['金額'];
        if(!knownAmount(arAmt) || !knownAmount(impAmt)){
          amountDiff.push(recordPublic(r,'金額待確認','至少一方缺少可辨識金額，不判定已請款',expectedPayDateInput || imp['預計撥款日'] || ''));
        }else if(Number(arAmt)!==Number(impAmt)){
          const payDate=expectedPayDateInput || imp['預計撥款日'] || '';
          const pub=recordPublic(r,'金額不同',`款項匯入金額 ${impAmt}，對帳單金額 ${arAmt}`, payDate);
          pub['款項匯入金額']=impAmt; pub['對帳單金額']=arAmt;
          amountDiff.push(pub);
        }else requested.push(recordPublic(r,'已在款項匯入資訊','', expectedPayDateInput || imp['預計撥款日'] || ''));
      }else unpaid.push(recordPublic(r,'尚未請款','對帳單有此發票，但款項匯入資訊未找到', expectedPayDateInput));
    }
    const importNotFound=importRows.filter(r=>r['發票號碼'] && !arInvoiceSet.has(r['發票號碼'])).map(r=>recordPublic(r,'款項匯入有，但對帳單未找到','請確認是否對帳單區間不同或發票號碼有誤', expectedPayDateInput || r['預計撥款日'] || ''));
    const summary=[
      {'項目':'款項匯入資訊筆數','數量':importRows.length},
      {'項目':'應收帳款對帳單筆數','數量':arRows.length},
      {'項目':'已請款/已在款項匯入資訊','數量':requested.length},
      {'項目':'尚未請款','數量':unpaid.length},
      {'項目':'金額不同','數量':amountDiff.length},
      {'項目':'對帳單缺發票號碼待確認','數量':missingInvoice.length},
      {'項目':'款項匯入有但對帳單未找到','數量':importNotFound.length},
      {'項目':'本次指定預計撥款日','數量':expectedPayDateInput || '未指定'}
    ];
    updateSummary(arRows.length,requested.length,unpaid.length,amountDiff.length,missingInvoice.length+importNotFound.length);
    log(`已請款：${requested.length}`);
    log(`尚未請款：${unpaid.length}`);
    log(`金額不同：${amountDiff.length}`);
    log(`缺發票號碼待確認：${missingInvoice.length}`);
    log(`款項匯入有但對帳單未找到：${importNotFound.length}`);
    if(unpaid.length) log('尚未請款前 5 筆：\n'+unpaid.slice(0,5).map(r=>`${r['發票號碼']}｜${r['客戶/商家']}｜${r['金額']}｜${r['說明']}`).join('\n'));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(unpaid),'尚未請款');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(requested),'已請款');
    if(amountDiff.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(amountDiff),'金額不同');
    if(arRows.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(arRows.map(r=>recordPublic(r,'','',expectedPayDateInput))),'應收帳款辨識明細');
    if(missingInvoice.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(missingInvoice),'缺發票號碼待確認');
    if(importNotFound.length) XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(importNotFound),'匯入但對帳單未找到');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'比對摘要');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(logLines.map(x=>[x])),'處理紀錄');
    XLSX.writeFile(wb,`華茂請款中心結果_v14_1_${formatToday()}.xlsx`);
    document.getElementById('arStatus').innerHTML=`<div class="ok">比對完成：尚未請款 ${unpaid.length} 筆，已請款 ${requested.length} 筆，金額不同 ${amountDiff.length} 筆，缺發票號碼待確認 ${missingInvoice.length} 筆。</div>`;
  }catch(err){console.error(err);log('錯誤：'+(err.stack||err.message));document.getElementById('arStatus').innerHTML='<div class="warn">比對失敗：'+escapeHtml(err.message||err)+'</div>';}
}


function vendorForItem(item){
  const v=standardItem(item);
  if(HUAMAO_ITEMS.has(v)) return '華茂';
  if(PARTNER_ITEMS.has(v)) return '拍檔';
  return '';
}
function vendorItemName(item){
  const vendor=vendorForItem(item);
  if(vendor==='華茂') return HM_ITEM_LABEL[item] || item;
  if(vendor==='拍檔') return PARTNER_ITEM_LABEL[item] || item;
  return item;
}
function vendorItemUnit(item){
  if(item==='掃碼槍') return '支';
  if(item==='錢箱') return '個';
  if(item==='EPSON T82III 隔板') return '個';
  return '台';
}
function vendorBodyItem(item, qty){
  return `${qty}${vendorItemUnit(item)}${vendorItemName(item)}`;
}
function vendorLineItem(item, qty){
  return `${vendorItemName(item)}* ${qty}`;
}
function getVendorDevices(row){
  const devices=parsePosDevices(row).filter(d=>DIRECT_VENDOR_ITEMS.has(d.item) && (Number(d.qty)||0)>0);
  const agg={};
  for(const d of devices){
    const vendor=vendorForItem(d.item);
    const key=`${vendor}|||${d.item}`;
    agg[key]=(agg[key]||0)+(Number(d.qty)||0);
  }
  return Object.entries(agg).map(([key,qty])=>{const [vendor,item]=key.split('|||');return {vendor,item,qty};});
}
function getVendorContactInfo(row){
  return {
    merchant: clean(findVal(row,['商家名稱','商家','店家名稱','客戶名稱'])),
    contact: clean(findVal(row,['收件人姓名','收件人','聯絡人','聯絡人員','收件者'])),
    phone: clean(findVal(row,['收件人手機','收件人電話','電話','聯絡電話','手機'])),
    address: clean(findVal(row,['收件地址','地址','收件人地址','寄送地址']))
  };
}
function vendorGroupKey(info,vendor){
  return [vendor,info.merchant, info.contact, info.phone, info.address].map(norm).join('|');
}
function buildVendorMessageFromGroup(group){
  const info=group.info;
  const vendor=group.vendor;
  const devices=Object.entries(group.agg).map(([item,qty])=>({item,qty}));
  const order=['EPSON發票機','WIFI發票機(M303)','掃碼槍','錢箱','EPSON T82III 隔板','拍檔POS主機','拍檔POS客顯螢幕'];
  devices.sort((a,b)=>order.indexOf(a.item)-order.indexOf(b.item));
  const hasPrinter=vendor==='華茂' && devices.some(d=>d.item==='EPSON發票機' || d.item==='WIFI發票機(M303)');
  const lineItems=devices.map(d=>vendorLineItem(d.item,d.qty)).join('、');
  const bodyItems=devices.map(d=>vendorBodyItem(d.item,d.qty)).join('\n');
  const lineMessage=`我要下單
商品：${lineItems}

【設備收件資訊】
聯絡人：${info.contact}
公司名稱：${info.merchant}
電話：${info.phone}
地址：${info.address}`;
  const subject=`【順立智慧 x ${vendor}】 ${devices.map(d=>`${vendorItemName(d.item)}*${d.qty}`).join('+')}-${info.merchant}`;
  const settingNote=hasPrinter ? `\n\n發票機設定在請協助：該設定的問題設定好，再出貨給商家` : '';
  const greeting=vendor==='華茂' ? 'Hi Elita~' : 'Hi~';
  const emailBody=`${greeting}

再麻煩協助出貨：
${bodyItems}

【設備收件資訊】
聯絡人：${info.contact}
公司名稱：${info.merchant}
電話：${info.phone}
地址：${info.address}${settingNote}`;
  return {lineMessage, subject, emailBody, merchant:info.merchant, vendor, devices, rows:group.rows};
}
function escapeHtml(str){
  return String(str??'').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function uiIcon(name) {
  return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="vendor/pulso-icons.svg?v=15.14#${name}"></use></svg>`;
}
// Central contact directory for supplier orders. All values are static deployment settings.
const VENDOR_ORDER_CONTACTS = {
  華茂: {to:[['','elita.lin@bestpride.com.tw']], cc:[['','sales@bestpride.com.tw'],['','support@cyberbiz.io']]},
  拍檔: {to:[['Jed Lee','jed.lee@partner.com.tw'],['Karen Chang','karen.chang@partner.com.tw']],
    cc:[['','support@cyberbiz.io'],['Hannah Kuo','hannah.kuo@cyberbiz.io']]}
};
function vendorRecipients(vendor) {
  return Object.hasOwn(VENDOR_ORDER_CONTACTS,vendor)?VENDOR_ORDER_CONTACTS[vendor]:{to:[],cc:[]};
}
function validRecipients(input) {
  if(!String(input||'').trim())return '';
  const addresses=String(input).split(/[,;]/).map(address=>address.trim());
  if(String(input).length>512||addresses.some(address=>address.length>254||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(address)))
    throw Error('請輸入有效的廠商信箱，多個信箱以逗號分隔。');
  return [...new Set(addresses)].join(',');
}
function vendorCommunication(vendor,messages) {
  if(!messages.length)return {subject:'',body:'',line:''};
  const subject=messages.length===1?messages[0].subject:`【順立智慧 x ${vendor}】設備採購 ${messages.length} 筆`;
  const body=messages.length===1?messages[0].emailBody:messages.map(m=>[m.subject,m.emailBody].join('\n\n')).join('\n\n────────\n\n');
  return {subject,body,line:messages.map(m=>m.lineMessage).join('\n\n')};
}
function gmailComposeUrl(recipient,subject,body,copyTo='') {
  const url=new URL('https://mail.google.com/mail/u/0/');
  const to=validRecipients(recipient);
  const cc=validRecipients(copyTo);
  if(to)url.searchParams.set('to',to);
  if(cc)url.searchParams.set('cc',cc);
  url.searchParams.set('su',subject);
  url.searchParams.set('body',body);
  url.searchParams.set('tf','cm');
  if(url.href.length>8000)throw Error('信件內容較長，請複製主旨與內文，再手動開啟 Gmail 貼上。');
  return url.href;
}
let vendorResultRows=[], vendorResultPage=0;
function pagerHtml(scope,page,size,total){
  const pages=Math.ceil(total/size);
  if(pages<2)return '';
  return `<nav class="case-preview-pager" aria-label="結果分頁">
    <button type="button" class="miniBtn" data-${scope}-page="${page-1}" ${page===0?'disabled':''}>上一頁</button>
    <span>${page+1}／${pages} 頁・共 ${total} 筆</span>
    <button type="button" class="miniBtn" data-${scope}-page="${page+1}" ${page+1>=pages?'disabled':''}>下一頁</button></nav>`;
}
function renderVendorGroups(results,page=0){
  const box=document.getElementById('vendorGroupResults');
  if(!box) return;
  vendorResultRows=results;vendorResultPage=page;
  if(!results.length){
    box.innerHTML='<div class="vendorEmpty">沒有產生下單訊息，請確認指定區間內是否有華茂或拍檔直出商品。</div>';
    return;
  }
  const size=12,pager=pagerHtml('vendor',page,size,results.length);
  box.innerHTML=pager+results.slice(page*size,(page+1)*size).map((r,index)=>{const i=page*size+index;return `
    <div class="vendorCard">
      <div class="vendorCardHeader">
        <div>
          <h3>${i+1}. ${escapeHtml(r.merchant)}｜${escapeHtml(r.vendor)}</h3>
          <div class="vendorMeta">列數：${escapeHtml(r.rows.join('、'))}｜商品：${escapeHtml(r.devices.map(d=>`${vendorItemName(d.item)}*${d.qty}`).join('、'))}</div>
        </div>
      </div>
      <div class="vendorOutputs">
        <div>
          <label class="small">LINE 群組格式</label>
          <textarea class="textOutput" readonly id="vendorLine_${i}">${escapeHtml(r.lineMessage)}</textarea>
          <div class="vendorActions"><button type="button" class="miniBtn" data-copy-vendor="vendorLine_${i}">${uiIcon('copy')} 複製 LINE</button></div>
        </div>
        <div>
          <label class="small">Email 主旨</label>
          <textarea class="textOutput subject" readonly id="vendorSubject_${i}">${escapeHtml(r.subject)}</textarea>
          <label class="small" style="display:block;margin-top:10px">Email 內文（不含簽名檔）</label>
          <textarea class="textOutput" readonly id="vendorBody_${i}">${escapeHtml(r.emailBody)}</textarea>
          <div class="vendorActions"><button type="button" class="miniBtn" data-copy-vendor="vendorSubject_${i}">複製主旨</button><button type="button" class="miniBtn" data-copy-vendor="vendorBody_${i}">複製內文</button></div>
        </div>
      </div>
    </div>`;}).join('');
}
async function generateVendorMessages(){
  const status=document.getElementById('vendorMsgStatus');
  if(status) status.innerHTML='';
  renderVendorGroups([]);
  try{
    const posF=(document.getElementById('vendorPosFile')?.files?.[0]) || (document.getElementById('hmPosFile')?.files?.[0]);
    const startRow=positiveRow(document.getElementById('vendorStartRow')?.value);
    const endInput=clean(document.getElementById('vendorEndRow')?.value);
    const endRow=endInput ? positiveRow(endInput) : startRow;
    if(!posF){alert('請先上傳 POS設備即時庫存.xlsx');return;}
    if(!startRow){alert('請輸入開始列');return;}
    if(endRow < startRow){alert('結束列不可小於開始列');return;}
    resetLog('開始生成廠商下單訊息...');
    log(`讀取 POS：${posF.name}`);
    log(`指定區間：${startRow} ~ ${endRow}`);
    const sr=await readLegacyImport(posF,'legacyPos');
    const targetRows=sr.rows.filter(r=>Number(r.__rowNum)>=startRow && Number(r.__rowNum)<=endRow);
    if(!targetRows.length) throw new Error(`指定區間 ${startRow} ~ ${endRow} 沒有資料，請確認列數是否正確。`);
    const groups={};
    const skipped=[];
    for(const row of targetRows){
      const info=getVendorContactInfo(row);
      const devices=getVendorDevices(row);
      const rowNum=row.__rowNum;
      if(!info.merchant){skipped.push(`第${rowNum}列：缺商家名稱`); continue;}
      if(!devices.length){skipped.push(`第${rowNum}列：沒有華茂或拍檔直出商品`); continue;}
      const byVendor={};
      for(const d of devices){
        if(!byVendor[d.vendor]) byVendor[d.vendor]=[];
        byVendor[d.vendor].push(d);
      }
      for(const [vendor,vendorDevices] of Object.entries(byVendor)){
        const key=vendorGroupKey(info,vendor);
        if(!groups[key]) groups[key]={info, vendor, agg:{}, rows:[]};
        groups[key].rows.push(rowNum);
        for(const d of vendorDevices) groups[key].agg[d.item]=(groups[key].agg[d.item]||0)+(Number(d.qty)||0);
      }
    }
    const results=Object.values(groups).map(buildVendorMessageFromGroup);
    renderVendorGroups(results);
    if(results.length) saveVendorLastRow(Math.max(...targetRows.map(r=>r.__rowNum)));
    log(`已產生 ${results.length} 組下單訊息`);
    if(skipped.length) log('略過資料：\n'+skipped.slice(0,20).join('\n')+(skipped.length>20?`\n...共 ${skipped.length} 筆`:''));
    for(const r of results){ log(`已生成：${r.vendor}｜${r.merchant}｜列 ${r.rows.join(',')}｜${r.devices.map(d=>`${vendorItemName(d.item)}*${d.qty}`).join('+')}`); }
    if(status) status.innerHTML=`<div class="ok">已產生 ${results.length} 組下單訊息；${skipped.length ? `略過 ${skipped.length} 列。` : '無略過資料。'}</div>`;
  }catch(err){
    console.error(err);
    log('錯誤：'+(err.stack||err.message));
    if(status) status.innerHTML=`<div class="warn">生成失敗：${escapeHtml(err.message||err)}</div>`;
  }
}
async function copyTextFrom(id){
  const el=document.getElementById(id);
  const text=el ? el.value : '';
  if(!text){alert('目前沒有可複製的內容');return;}
  try{
    await navigator.clipboard.writeText(text);
    showProductToast('已複製到剪貼簿');
  }catch(e){
    el.focus(); el.select(); if(!document.execCommand('copy')){alert('複製失敗，已選取文字，請按 Ctrl+C。');return;}
    showProductToast('已複製到剪貼簿');
  }
}


let lastArQueryRows=[];
function queryTypeOf(v){
  const x=clean(v).toUpperCase();
  if(/^[A-Z]{2}\d{8}$/.test(x.replace(/[^A-Z0-9]/g,''))) return '發票號碼';
  if(/^\d{8,}$/.test(x.replace(/[^0-9]/g,''))) return '銷貨單號';
  return '關鍵字';
}
function parseQueryTerms(text){
  return String(text||'').split(/[\n,，、\s]+/).map(clean).filter(Boolean);
}
function buildRecordIndexes(rows){
  const byInvoice=Object.create(null); const bySalesNo=Object.create(null);
  for(const r of rows||[]){
    const inv=normalizeInvoiceNo(r['發票號碼']);
    const sales=normalizeSalesNo(r['銷貨單號']);
    if(inv && !byInvoice[inv]) byInvoice[inv]=r;
    if(sales && bySalesNo[sales])throw new Error(`銷貨單號 ${sales} 出現多筆，請先確認明細，避免誤判狀態。`);
    if(sales) bySalesNo[sales]=r;
  }
  return {byInvoice,bySalesNo};
}
let arResultRows=[], arResultPage=0, arSummaryShown=false;
function displayArQueryResults(rows,page=0){
  const box=document.getElementById('arQueryResult');
  if(!box) return;
  arResultRows=rows;arResultPage=page;
  if(!rows.length){box.innerHTML='<div class="small">沒有查詢結果。</div>';return;}
  const size=50,pager=pagerHtml('ar',page,size,rows.length);
  const cls=s=>s.includes('已請款')?'statusPaid':(s.includes('尚未')?'statusUnpaid':'statusMissing');
  box.innerHTML=pager+`<table class="miniTable"><thead><tr><th>查詢值</th><th>狀態</th><th>發票號碼</th><th>銷貨單號</th><th>預計撥款日</th><th>金額</th><th>備註</th></tr></thead><tbody>${rows.slice(page*size,(page+1)*size).map(r=>`<tr><td>${escapeHtml(r['查詢值']??'')}</td><td class="${cls(r['狀態']||'')}">${escapeHtml(r['狀態']??'')}</td><td>${escapeHtml(r['發票號碼']??'')}</td><td>${escapeHtml(r['銷貨單號']??'')}</td><td>${escapeHtml(r['預計撥款日']??'')}</td><td>${escapeHtml(r['金額']??'')}</td><td>${escapeHtml(r['備註']??'')}</td></tr>`).join('')}</tbody></table>`;
}
async function queryHuamaoStatus(){
  const importF=document.getElementById('hmImportFile').files[0];
  const arF=document.getElementById('hmArFile').files[0];
  const q=document.getElementById('arQueryText')?.value || '';
  const terms=parseQueryTerms(q);
  if(!importF){alert('請先上傳「華茂款項匯入資訊.xlsx」');return;}
  if(!terms.length){alert('請輸入發票號碼或銷貨單號');return;}
  lastArQueryRows=[];displayArQueryResults([]);
  resetLog('開始查詢請款狀態...');
  try{
    const importRows=await readLegacyImport(importF,'legacyHm');
    const arRows=arF ? await arFileRecords(arF) : [];
    assertUniqueInvoices(importRows);assertUniqueInvoices(arRows);
    const impIdx=buildRecordIndexes(importRows);
    const arIdx=buildRecordIndexes(arRows);
    const expectedPayDateInput=clean(document.getElementById('arExpectedPayDate')?.value || '');
    const results=[];
    for(const raw of terms){
      const type=queryTypeOf(raw);
      const inv=normalizeInvoiceNo(raw);
      const sales=normalizeSalesNo(raw);
      let imp=null, ar=null;
      if(type==='發票號碼'){
        ar=arIdx.byInvoice[inv]||null;
        imp=impIdx.byInvoice[inv]||null;
      }else if(type==='銷貨單號'){
        ar=arIdx.bySalesNo[sales]||null;
        imp=impIdx.bySalesNo[sales]||null;
        if(!imp && ar && ar['發票號碼']) imp=impIdx.byInvoice[normalizeInvoiceNo(ar['發票號碼'])]||null;
      }else{
        const ars=arRows.filter(r=>allRowText(r).includes(raw));const imps=importRows.filter(r=>allRowText(r).includes(raw));
        if(ars.length>1||imps.length>1)throw new Error(`關鍵字 ${raw} 對到多筆，請改用精確發票號碼或銷貨單號。`);
        ar=ars[0]||null;imp=imps[0]||null;
      }
      let status='', note='', source=imp||ar||{};
      if(imp){
        status='已請款';
        note='已在華茂款項匯入資訊找到';
        if(ar){
          note+='，應收帳款明細也有此筆';
          if(!knownAmount(imp['金額'])||!knownAmount(ar['金額'])){status='金額待確認';note+='；至少一方缺少金額';}
          else if(Number(imp['金額'])!==Number(ar['金額'])){status='金額不同';note+=`；匯入 ${imp['金額']}／對帳 ${ar['金額']}`;}
        }
        source={...ar,...imp, 發票號碼:imp['發票號碼']||ar?.['發票號碼']||'', 銷貨單號:imp['銷貨單號']||ar?.['銷貨單號']||''};
      }else if(ar){
        status='尚未請款';
        note='應收帳款明細有此筆，但華茂款項匯入資訊未找到';
        source=ar;
      }else{
        status='查無資料';
        note= arF ? '款項匯入資訊與應收帳款明細都未找到' : '款項匯入資訊未找到；若要判斷尚未請款，請同時上傳應收帳款明細';
      }
      results.push({
        '查詢值':raw,
        '查詢類型':type,
        '狀態':status,
        '發票號碼':source['發票號碼']||'',
        '銷貨單號':source['銷貨單號']||'',
        '預計撥款日':expectedPayDateInput || source['預計撥款日'] || '',
        '金額':source['金額']??'',
        '客戶/商家':source['客戶/商家']||'',
        '說明':source['說明']||'',
        '備註':note
      });
    }
    lastArQueryRows=results;
    displayArQueryResults(results);
    log(`查詢完成：${results.length} 筆`);
    const paid=results.filter(r=>r['狀態']==='已請款').length;
    const unpaid=results.filter(r=>r['狀態']==='尚未請款').length;
    const missing=results.filter(r=>r['狀態']==='查無資料').length;
    updateSummary(results.length,paid,unpaid,results.filter(r=>r['狀態'].startsWith('金額')).length,missing);
    log(`已請款 ${paid}｜尚未請款 ${unpaid}｜查無資料 ${missing}`);
  }catch(err){console.error(err);log('錯誤：'+(err.stack||err.message));alert('查詢失敗：'+(err.message||err));}
}
function exportArQueryResults(){
  if(!lastArQueryRows.length){alert('請先查詢資料');return;}
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(lastArQueryRows),'查詢請款狀態');
  XLSX.writeFile(wb,`華茂請款狀態查詢_v14_1_${formatToday()}.xlsx`);
}

const HM_LAST_ROW_KEY='equipmentBillingAssistant.lastHuamaoRow';
function getSavedLastRow(){
  try{const v=Number(localStorage.getItem(HM_LAST_ROW_KEY)||''); return Number.isFinite(v)&&v>0?v:0;}catch(e){return 0;}
}
function saveLastRow(rowNum){
  try{if(Number.isFinite(rowNum)&&rowNum>0)localStorage.setItem(HM_LAST_ROW_KEY,String(rowNum));}catch(e){}
  updateLastRowInfo();
}
function updateLastRowInfo(){
  const el=document.getElementById('lastRowInfo'); if(!el) return;
  const last=getSavedLastRow();
  el.textContent=last ? `上次處理到第 ${last} 列，可按「接續上次」從第 ${last+1} 列開始。` : '尚未記錄上次處理列數';
}
function setStartRowToFirst(){document.getElementById('startRow').value='1';}
function setStartRowToNext(){
  const last=getSavedLastRow();
  document.getElementById('startRow').value=String(last?last+1:1);
}
if(typeof document!=='undefined'){
document.getElementById('startFromFirst').addEventListener('click',setStartRowToFirst);
document.getElementById('startFromLast').addEventListener('click',setStartRowToNext);
updateLastRowInfo();
document.getElementById('hmBtn').addEventListener('click',()=>runAction(generateHuamao));
document.getElementById('arCompareBtn').addEventListener('click',()=>runAction(compareHuamaoAr));
document.getElementById('arQueryBtn').addEventListener('click',()=>runAction(queryHuamaoStatus));
document.getElementById('arQueryExportBtn').addEventListener('click',()=>runAction(exportArQueryResults));
document.getElementById('hmSalesFiles').addEventListener('change',e=>{
  const valid=[],errors=[];
  for(const file of e.target.files){
    try{validateFile(file,['pdf']);valid.push(file);}catch(err){errors.push(file.name+'：'+err.message);}
  }
  addSalesFiles(valid);e.target.value='';
  document.getElementById('hmStatus').textContent=errors.join('；');
});
document.getElementById('clearSalesFiles').addEventListener('click',()=>{hmSalesFileList=[];renderSalesFileList();});
renderSalesFileList();
}

const VENDOR_LAST_ROW_KEY='equipmentBillingAssistant.lastVendorMessageRow';
function getSavedVendorLastRow(){
  try{const v=Number(localStorage.getItem(VENDOR_LAST_ROW_KEY)||''); return Number.isFinite(v)&&v>0?v:0;}catch(e){return 0;}
}
function saveVendorLastRow(rowNum){
  try{if(Number.isFinite(rowNum)&&rowNum>0)localStorage.setItem(VENDOR_LAST_ROW_KEY,String(rowNum));}catch(e){}
  updateVendorLastRowInfo();
}
function updateVendorLastRowInfo(){
  const el=document.getElementById('vendorLastRowInfo'); if(!el) return;
  const last=getSavedVendorLastRow();
  el.textContent=last ? `上次下單訊息處理到第 ${last} 列，可按「接續上次下單」從第 ${last+1} 列開始。` : '尚未記錄上次下單訊息處理列數';
}
function setVendorStartFromLast(){
  const last=getSavedVendorLastRow();
  document.getElementById('vendorStartRow').value=String(last?last+1:1);
  document.getElementById('vendorEndRow').value='';
}
function setVendorNextBatch(){
  const s=num(document.getElementById('vendorStartRow')?.value)||1;
  const eInput=clean(document.getElementById('vendorEndRow')?.value);
  const e=eInput?num(eInput):s;
  const size=Math.max(1, e-s+1);
  document.getElementById('vendorStartRow').value=String(e+1);
  document.getElementById('vendorEndRow').value=String(e+size);
}

if(typeof document!=='undefined'){
document.getElementById('useStartRowForVendor')?.addEventListener('click',()=>{document.getElementById('vendorStartRow').value=document.getElementById('startRow').value||'1';document.getElementById('vendorEndRow').value=document.getElementById('endRow').value||'';});
document.getElementById('vendorFromLast')?.addEventListener('click',setVendorStartFromLast);
document.getElementById('vendorNextBatch')?.addEventListener('click',setVendorNextBatch);
updateVendorLastRowInfo();
document.getElementById('generateVendorMsgBtn')?.addEventListener('click',()=>runAction(generateVendorMessages));

document.getElementById('convertBtn').addEventListener('click',()=>runAction(convert));
document.getElementById('vendorGroupResults')?.addEventListener('click',e=>{
  const btn=e.target.closest?.('button');
  if(!btn)return;
  if(btn.dataset.copyVendor)copyTextFrom(btn.dataset.copyVendor);
  if(btn.dataset.vendorPage!==undefined){
    const page=Number(btn.dataset.vendorPage);
    if(page!==vendorResultPage&&page>=0&&page*12<vendorResultRows.length)renderVendorGroups(vendorResultRows,page);
  }
});
document.getElementById('arQueryResult')?.addEventListener('click',e=>{
  const btn=e.target.closest?.('button[data-ar-page]');
  if(!btn)return;
  const page=Number(btn.dataset.arPage);
  if(page!==arResultPage&&page>=0&&page*50<arResultRows.length)displayArQueryResults(arResultRows,page);
});
document.getElementById('logToggle')?.addEventListener('click',e=>{
  fullLog=!fullLog;e.currentTarget.textContent=fullLog?'只顯示最近 500 筆':'顯示全部';
  e.currentTarget.setAttribute('aria-expanded',String(fullLog));
  flushLog();
});

}

// Centralized safeguards; keep legacy output headers, vendor rules, prices and storage keys.
function validateFile(file,extensions){
  if(!file || !extensions.includes((file.name||'').split('.').pop().toLowerCase()))throw new Error('檔案類型不正確，請選擇 '+extensions.join(' / '));
  if(file.size>30*1024*1024)throw new Error('單檔超過 30 MB，請先分割檔案。');
  if(!file.size)throw new Error('檔案是空的。');
}
function checkFileSignature(data,name){
  const bytes=new Uint8Array(data);
  const ext=name.split('.').pop().toLowerCase();
  const starts=(...signature)=>signature.every((value,i)=>bytes[i]===value);
  let valid=false;
  if(ext==='pdf'){
    for(let i=0;i<Math.min(1024,bytes.length-4);i++){
      if(bytes[i]===37&&bytes[i+1]===80&&bytes[i+2]===68&&bytes[i+3]===70&&bytes[i+4]===45){valid=true;break;}
    }
  }else if(ext==='xlsx'){
    // Inspect only central-directory names. A renamed ZIP or ODS is not an XLSX workbook.
    if(starts(80,75,3,4)&&bytes.length>=22){
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      let end=bytes.length-22;
      const min=Math.max(0,end-65535);
      while(end>=min && (view.getUint32(end,true)!==0x06054b50||end+22+view.getUint16(end+20,true)!==bytes.length))end--;
      if(end>=min){
        let pos=view.getUint32(end+16,true), workbook=false, contentTypes=false;
        const entries=view.getUint16(end+10,true);
        for(let i=0;i<entries&&pos+46<=end;i++){
          if(view.getUint32(pos,true)!==0x02014b50)break;
          const n=view.getUint16(pos+28,true);
          if(pos+46+n>end)break;
          const path=n<=64?String.fromCharCode(...bytes.subarray(pos+46,pos+46+n)):'';
          if(path==='xl/workbook.xml')workbook=true;
          if(path==='[Content_Types].xml')contentTypes=true;
          if(workbook&&contentTypes){valid=true;break;}
          pos+=46+n+view.getUint16(pos+30,true)+view.getUint16(pos+32,true);
        }
      }
    }
  }else if(ext==='xls'){
    const biff=bytes[0]===9&&[0,2,4,8].includes(bytes[1])&&[4,6,8,16].includes(bytes[2])&&bytes[3]===0;
    const xml=String.fromCharCode(...bytes.subarray(0,4096)).replace(/\x00/g,'');
    valid=starts(208,207,17,224,161,177,26,225)||biff||/urn:schemas-microsoft-com:office:spreadsheet/i.test(xml);
  }
  if(!valid)throw Error('「'+name+'」的內容不是有效的 '+ext.toUpperCase()+'。請重新匯出原始檔，僅更改副檔名無法轉換格式。');
}
function positiveRow(value){
  const n=Number(clean(value));
  if(!Number.isSafeInteger(n)||n<1)throw new Error('列數必須是大於 0 的整數。');
  return n;
}
function deviceQuantity(value,row){
  if(clean(value)==='')return 1; // preserve original blank-cell default
  const n=Number(clean(value).replace(/,/g,''));
  if(!Number.isSafeInteger(n)||n<0)throw new Error(`第 ${row||'?'} 列設備數量無效：${clean(value)}；請填寫非負整數。`);
  return n;
}
function knownAmount(v){return clean(v)!=='' && Number.isFinite(Number(v));}
function financialSheetNames(wb,label){
  const canonical=wb.SheetNames.find(n=>norm(n)===norm(label));
  if(canonical)return [canonical];
  const diagnostics=new Set(['處理清單','處理紀錄','銷貨單辨識結果','未對到銷貨單','比對摘要','數量統計']);
  const names=wb.SheetNames.filter(n=>!diagnostics.has(clean(n)));
  for(const n of names){const meta=wb.Workbook?.Sheets?.find(s=>s.name===n);if(meta?.Hidden)log(`提醒：包含隱藏工作表 ${n}，依原流程納入比對，請確認。`);}
  return names;
}
function assertUniqueInvoices(rows){
  const seen=new Map();
  for(const r of rows){const key=r['發票號碼'];if(!key)continue;
    if(seen.has(key))throw new Error(`發票 ${key} 出現多筆（${seen.get(key)}、${r['工作表']}:${r['列數']}）；請先確認重複、分項或分期資料，本次不自動覆寫或加總。`);
    seen.set(key,`${r['工作表']}:${r['列數']}`);
  }
}
async function readPdfRecords(file,extract,accept=()=>true){
  validateFile(file,['pdf']);
  const data=await readArrayBuffer(file);
  checkFileSignature(data,file.name);
  if(typeof ImportIO!=='undefined')await ImportIO.pdf();
  if(!window.pdfjsLib)throw new Error('PDF 元件未載入，請確認 vendor 資料夾完整。');
  const task=pdfjsLib.getDocument({data,isEvalSupported:false,useSystemFonts:true,CMapReaderFactory:LocalCMapReaderFactory,StandardFontDataFactory:LocalStandardFontDataFactory});
  try{
    const pdf=await task.promise;
    if(pdf.numPages>500)throw new Error('PDF 超過 500 頁，請分批處理。');
    const rows=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      try{const content=await page.getTextContent();const found=extract(content.items.map(it=>it.str).join(' '),file.name,p,content.items);rows.push(...(Array.isArray(found)?found:[found]).filter(accept));}
      finally{page.cleanup();}
    }
    return rows;
  }catch(err){
    if(typeof SiteAssets!=='undefined'&&/fake worker|API version.*Worker version/i.test(err.message||'')){
      throw SiteAssets.failure('vendor/pdf.worker.min.js','PDF 背景元件');
    }
    throw err;
  }finally{await task.destroy();}
}
let actionBusy=false;
async function runAction(action){
  if(actionBusy)return;
  actionBusy=true;
  const buttons=[...document.querySelectorAll('#legacyWorkflows button,#legacyWorkflows input,#legacyWorkflows textarea:not([readonly])')];
  const states=buttons.map(b=>b.disabled);
  buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
  try{await action();}catch(err){log('錯誤：'+(err.message||err));alert(err.message||String(err));}
  finally{buttons.forEach((b,i)=>{b.disabled=states[i];b.removeAttribute('aria-busy');});actionBusy=false;}
}
function updateSummary(total,paid=0,unpaid=0,diff=0,missing=0){
  arSummaryShown=total!=='—';
  document.querySelectorAll('.dashGrid .num').forEach((el,i)=>{el.textContent=String([total,paid,unpaid,diff,missing][i])+' 筆';});
}
if(typeof document!=='undefined'){
  const clearArResults=()=>{
    if(!lastArQueryRows.length&&!arResultRows.length&&!arSummaryShown)return;
    lastArQueryRows=[];displayArQueryResults([]);updateSummary('—','—','—','—','—');
  };
  for(const id of ['hmImportFile','hmArFile','arExpectedPayDate'])document.getElementById(id)?.addEventListener('change',clearArResults);
  document.getElementById('arQueryText')?.addEventListener('input',clearArResults);
}

// Local binary assets avoid CDN / CORS requests for Traditional Chinese PDFs.
function pdfAsset(kind,name){
  const value=window.PDF_LOCAL_RESOURCES?.[kind]?.[name];
  if(!value)throw new Error(`PDF 字型資源缺少：${name}，請確認 vendor/pdf-resources.js 完整。`);
  return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}
class LocalCMapReaderFactory{async fetch({name}){return {cMapData:pdfAsset('cmaps',name+'.bcmap'),compressionType:1};}}
class LocalStandardFontDataFactory{async fetch({filename}){return pdfAsset('fonts',filename);}}

function initTableGrip(grip,table) {
  const key='posEquipment.tableHeight.'+table.id;
  const clamp=n=>Math.min(760,Math.max(160,Math.round(n)));
  const setHeight=(n,persist=false)=>{
    const height=clamp(n);
    table.style.setProperty('--erp-table-height',height+'px');
    if(persist)try{localStorage.setItem(key,String(height));}catch{}
  };
  try{
    const stored=Number(localStorage.getItem(key));
    if(stored>=160&&stored<=760)setHeight(stored);
  }catch{}
  let drag=null, frame=0, suppressClick=false;
  grip.addEventListener('pointerdown',event=>{
    if(event.button!==0||drag)return;
    suppressClick=false;
    grip.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,y:event.clientY,height:table.offsetHeight,next:table.offsetHeight,moved:false};
  });
  grip.addEventListener('pointermove',event=>{
    if(drag?.id!==event.pointerId)return;
    const delta=event.clientY-drag.y;
    if(!drag.moved&&Math.abs(delta)<3)return;
    drag.moved=true;
    drag.next=drag.height+delta;
    if(!frame)frame=requestAnimationFrame(()=>{
      frame=0;
      if(drag)setHeight(drag.next);
    });
  });
  const finish=event=>{
    if(drag?.id!==event.pointerId)return;
    if(frame){cancelAnimationFrame(frame);frame=0;}
    suppressClick=drag.moved;
    if(drag.moved)setHeight(drag.next,true);
    drag=null;
  };
  grip.addEventListener('pointerup',finish);
  grip.addEventListener('pointercancel',finish);
  grip.addEventListener('lostpointercapture',finish);
  grip.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='Home'){
      table.style.removeProperty('--erp-table-height');
      try{localStorage.removeItem(key);}catch{}
    } else setHeight(table.offsetHeight+(event.key==='ArrowDown'?32:-32),true);
  });
  // A tap or keyboard activation cycles sizes without requiring a drag.
  grip.addEventListener('click',event=>{
    if(suppressClick&&event.detail){suppressClick=false;return;}
    const h=table.offsetHeight;
    setHeight(h<320?360:h<510?560:240,true);
  });
}

function showErpView() {
  const hash=window.location.hash.slice(1);
  const direct=['hm','invoice','vendorMsg'];
  const info=['logPanel','rules','helpPanel'];
  const pages=['caseWorkspace','legacyWorkflows','ar','systemInfo'];
  const view=direct.includes(hash)?'legacyWorkflows':info.includes(hash)?'systemInfo':pages.includes(hash)?hash:'caseWorkspace';
  const show=(id,on)=>{const node=document.getElementById(id);if(node)node.hidden=!on;};
  for(const id of ['caseWorkspace','systemInfo'])show(id,view===id);
  const infoPage=info.includes(hash)?hash:'logPanel';
  for(const id of info)show(id,view==='systemInfo'&&infoPage===id);
  show('legacyWorkflows',view==='legacyWorkflows'||view==='ar');
  show('arDashboard',view==='ar');
  show('ar',view==='ar');
  for(const id of direct)show(id,view==='legacyWorkflows');
  for(const link of document.querySelectorAll('[data-erp-view],[data-info-page]')){
    if(!link.dataset?.erpView&&!link.dataset?.infoPage)continue;
    if(link.dataset.erpView===view||link.dataset.infoPage===infoPage)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  if(hash==='caseSapDatabase'){
    const sources=document.getElementById(hash)?.closest('details');
    if(sources)sources.open=true;
  }
}

if(typeof document!=='undefined'&&typeof window!=='undefined'&&window.location){
  showErpView();
  window.addEventListener('hashchange',showErpView);
  for(const [gripId,tableId] of [['caseTableGrip','caseTableViewport'],['arTableGrip','arQueryResult']]){
    const table=document.getElementById(tableId);
    if(table?.style)initTableGrip(document.getElementById(gripId),table);
  }
}

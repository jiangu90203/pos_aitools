const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=fs.existsSync(path.join(__dirname,'../site/index.html'))?path.resolve(__dirname,'../site'):path.resolve(__dirname,'..');const elements=new Map(),store=new Map(),alerts=[],downloads=[];
const element=id=>{if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',value:'',files:[],disabled:false,querySelector:()=>null,querySelectorAll:()=>[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},removeAttribute(){},classList:{add(){},remove(){}}});return elements.get(id);};
class FileReader{readAsArrayBuffer(file){queueMicrotask(()=>{try{const b=file.bytes;this.onload({target:{result:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}});}catch(e){this.onerror(e);}});}}
const summary=Array.from({length:5},()=>({textContent:''}));const c={console,setTimeout,clearTimeout,TextDecoder,Uint8Array,ArrayBuffer,atob,FileReader,AbortSignal,Blob,URL,navigator:{},alert:s=>alerts.push(s),localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},document:{getElementById:element,querySelectorAll:sel=>sel.includes('dashGrid')?summary:[...elements.values()]},fetch:async()=>{throw Error('network unavailable')}};c.window=c;vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(root,'vendor/xlsx.full.min.js'),'utf8'),c);
c.pdfjsLib=require(path.join(root,'vendor/pdf.min.js'));
vm.runInContext(fs.readFileSync(path.join(root,'vendor/pdf-resources.js'),'utf8'),c);
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),c);
vm.runInContext(fs.readFileSync(path.join(root,'import-io.js'),'utf8'),c);
c.pdfjsLib.GlobalWorkerOptions.workerSrc=path.join(root,'vendor/pdf.worker.min.js');
const run=s=>vm.runInContext(s,c);const X=c.XLSX;
c.XLSX.writeFile=(wb,name)=>{const bytes=X.write(wb,{bookType:'xlsx',type:'buffer'});downloads.push({name,bytes,wb:X.read(bytes,{type:'buffer'})});};
const rows=(wb,name)=>X.utils.sheet_to_json(wb.Sheets[name],{defval:''});
function file(wb,name='test.xlsx'){const bytes=X.write(wb,{bookType:'xlsx',type:'buffer'});return {name,bytes,size:bytes.length,lastModified:1};}
function book(data,name){const w=X.utils.book_new();X.utils.book_append_sheet(w,X.utils.aoa_to_sheet(data),name);return w;}
function select(id,f){element(id).files=f?[f]:[];}function value(id,s){element(id).value=s;}
const header=['SHOP ID','報價單編號','商家名稱','峰潮下單日期','華茂下單日期','請款單號','收件人','電話','地址','','設備1','數量','設備2','數量','設備3','數量','設備4','數量','設備5','數量'];
const pos=file(book([header,['00012','Q1','測試公司','2026/11/01','2026/11/02','RQ1','王先生','0912345678','台北','','發票機',1,'發票紙',2,'發票紙',5,'拍檔POS主機',1],['00013','Q2','零數量公司','','','RQ2','李','0922','桃園','','掃碼槍',0],['00012','Q3','測試公司','','','RQ3','王先生','0912345678','台北','','拍檔POS主機',2]],'下單設備資料'),'pos.xlsx');
const invoice=file(book([['請款單號','摘要說明','憑證文件號碼','憑證日期','金額','建檔日期'],['RQ1','華茂出貨T823*1台至測試公司','AB12345678','2026/11/17',5990,'2026/11/17']],'請款單匯出'),'invoice.xlsx');
const imp=file(book([['發票號碼','金額','預計撥款日','銷貨單號'],['AB12345678',4074,'2026/11/30','20261117001'],['CD12345678',0,'','20261117002'],['EF12345678','','','20261117003']],'華茂款項匯入資訊'));
const ar=file(book([['發票號碼','金額','銷貨單號'],['AB12345678',4074,'20261117001'],['CD12345678',100,'20261117002'],['EF12345678',200,'20261117003'],['GH12345678',50,'20261117004']],'華茂應收帳款明細'));
const pdfFile=name=>{const bytes=fs.readFileSync(path.join(__dirname,'fixtures',name+'.pdf'));return {name:name+'.pdf',size:bytes.length,bytes};};
const results=[],metrics={};
async function test(name,fn){const n=downloads.length;try{await fn();results.push({name,status:'PASS',exports:downloads.length-n});}catch(e){results.push({name,status:'FAIL',error:e.stack});}}
(async()=>{
await test('Step1 真正Excel讀檔→華茂金額→XLSX序列化重讀',async()=>{select('hmPosFile',pos);value('startRow','2');value('endRow','4');await c.generateHuamao();const d=downloads.at(-1);assert.ok(d.name.includes('華茂款項'));const r=rows(d.wb,'華茂款項匯入資訊');assert.equal(r.length,1);assert.equal(r[0]['金額'],4074);assert.equal(store.get('equipmentBillingAssistant.lastHuamaoRow'),'4');});
await test('Step2 真正Excel讀檔→逐slot匯出→價格/廠商/前導零',async()=>{select('invoiceFile',invoice);select('posFile',pos);value('invoiceStartRow','2');value('invoiceEndRow','4');await c.convert();const r=rows(downloads.at(-1).wb,'轉換結果');assert.equal(r.length,5);assert.equal(r[0]['SHOP ID'],'00012');assert.equal(r[0]['銷售價(含稅)'],5990);assert.equal(r[0]['峰潮下單日期'],'');assert.equal(r.filter(x=>x['請款總金額']!=='').length,1);assert.deepEqual(Array.from(r.filter(x=>x['設備']==='發票紙捲'),x=>x['數量']),[2,5]);const p=r.find(x=>x['設備']==='拍檔POS主機');assert.equal(p['出貨廠商ID'],'拍檔');assert.equal(p['峰潮下單日期'],'');});
await test('Step2 留空列數依請款單號精準配對',async()=>{value('invoiceStartRow','');value('invoiceEndRow','');await c.convert();assert.equal(rows(downloads.at(-1).wb,'轉換結果').length,4);});
await test('Step3 真正Excel→華茂與拍檔分流、同收件資訊合併',async()=>{select('vendorPosFile',pos);value('vendorStartRow','2');value('vendorEndRow','99');await c.generateVendorMessages();assert.ok(element('vendorGroupResults').innerHTML.includes('拍檔POS主機*3'));assert.ok(element('vendorGroupResults').innerHTML.includes('0912345678'));assert.equal(store.get('equipmentBillingAssistant.lastVendorMessageRow'),'4');});
await test('Step4 對帳→已請款/未請款/0元差異/空金額待確認',async()=>{select('hmImportFile',imp);select('hmArFile',ar);await c.compareHuamaoAr();const w=downloads.at(-1).wb;assert.equal(rows(w,'已請款').length,1);assert.equal(rows(w,'尚未請款').length,1);assert.equal(rows(w,'金額不同').length,2);assert.equal(summary[3].textContent,'2 筆');});
await test('Step4 查詢與對帳金額差異一致、依銷貨單查詢',async()=>{value('arQueryText','AB12345678\nCD12345678\n20261117003\nGH12345678');await c.queryHuamaoStatus();const rs=run('lastArQueryRows');assert.deepEqual(Array.from(rs,r=>r['狀態']),['已請款','金額不同','金額待確認','尚未請款']);c.exportArQueryResults();assert.equal(rows(downloads.at(-1).wb,'查詢請款狀態').length,4);});
await test('重複發票使對帳中止且不下載',async()=>{const dup=file(book([['發票號碼','金額'],['AB12345678',4074],['AB12345678',4074]],'華茂款項匯入資訊'));select('hmImportFile',dup);const n=downloads.length;await c.compareHuamaoAr();assert.equal(downloads.length,n);assert.ok(element('arStatus').innerHTML.includes('失敗'));});
await test('失敗查詢清除舊結果，不能匯出前次資料',async()=>{value('arQueryText','AB12345678');await c.queryHuamaoStatus();assert.equal(run('lastArQueryRows.length'),0);const n=downloads.length;c.exportArQueryResults();assert.equal(downloads.length,n);});
await test('寫檔失敗不更新華茂接續列數',async()=>{store.set('equipmentBillingAssistant.lastHuamaoRow','2');const f=c.XLSX.writeFile;c.XLSX.writeFile=()=>{throw Error('simulated write failure')};await c.generateHuamao();assert.equal(store.get('equipmentBillingAssistant.lastHuamaoRow'),'2');c.XLSX.writeFile=f;});
await test('無輸出設備不更新華茂接續列數、不下載',async()=>{const n=downloads.length;value('startRow','3');value('endRow','3');await c.generateHuamao();assert.equal(downloads.length,n);assert.equal(store.get('equipmentBillingAssistant.lastHuamaoRow'),'2');value('startRow','2');value('endRow','4');});
await test('執行鎖阻止雙擊並於例外後復原',async()=>{let calls=0;let release;const job=()=>{calls++;return new Promise(r=>release=r)};const p=c.runAction(job);assert.equal(element('hmBtn').disabled,true);await c.runAction(job);assert.equal(calls,1);release();await p;assert.equal(element('hmBtn').disabled,false);await c.runAction(async()=>{throw Error('expected')});assert.equal(element('hmBtn').disabled,false);});
await test('無效列數、檔案大小及副檔名防呆',async()=>{for(const v of ['0','-1','1.5','abc'])assert.throws(()=>c.positiveRow(v));assert.throws(()=>c.validateFile({name:'x.xlsx',size:31*1024*1024},['xlsx']));assert.throws(()=>c.validateFile({name:'x.exe',size:1},['xlsx']));});
await test(' dormant Google Sheet非2xx及登入HTML錯誤',async()=>{c.fetch=async()=>({ok:false,status:403});await assert.rejects(c.readGoogleSheetAsWorkbook('https://docs.google.com/spreadsheets/d/abc/edit'),/HTTP 403/);c.fetch=async()=>({ok:true,text:async()=>'<html>login</html>'});await assert.rejects(c.readGoogleSheetAsWorkbook('https://docs.google.com/spreadsheets/d/abc/edit'),/沒有開放/);});
await test('Google Sheet CSV 保留繁中與前導零，網路錯誤提供 Excel 備援',async()=>{
  c.fetch=async()=>({ok:true,text:async()=> 'SHOP ID,商家名稱,電話,設備1,數量\n00012,測試公司,0912345678,拍檔POS主機,2'});
  const wb=await c.readGoogleSheetAsWorkbook('https://docs.google.com/spreadsheets/d/abc/edit');
  const row=rows(wb,'下單設備資料')[0];
  assert.equal(row['SHOP ID'],'00012');assert.equal(row['商家名稱'],'測試公司');assert.equal(row['電話'],'0912345678');
  c.fetch=async()=>{throw Error('CORS unavailable');};
  await assert.rejects(c.readGoogleSheetAsWorkbook('https://docs.google.com/spreadsheets/d/abc/edit'),/下載 Excel/);
});
await test('真實中文字PDF→銷貨單欄位與發票配對',async()=>{const r=await c.parseSalesPdfFile(pdfFile('sales'));assert.equal(r.length,1);assert.equal(r[0]['發票號碼'],'AB12345678');assert.equal(r[0]['公司名稱'],'測試公司');assert.equal(r[0]['總計'],4074);c.salesFixture=pdfFile('sales');run('hmSalesFileList=[salesFixture]');await c.generateHuamao();const rs=rows(downloads.at(-1).wb,'華茂款項匯入資訊');assert.equal(rs[0]['發票號碼'],'AB12345678');run('hmSalesFileList=[]');});
await test('真實中文字PDF→應收帳款→實際Excel對帳匯出',async()=>{const r=await c.parseArPdfFile(pdfFile('ar'));assert.equal(r[0]['金額'],4074);select('hmArFile',pdfFile('ar'));select('hmImportFile',imp);await c.compareHuamaoAr();assert.equal(rows(downloads.at(-1).wb,'已請款').length,1);});
await test('損毀PDF不悄悄成功並釋放解析任務',async()=>{const f={name:'broken.pdf',bytes:Buffer.from('bad pdf'),size:7};await assert.rejects(c.parseArPdfFile(f));await assert.rejects(c.parseSalesPdfFiles([f]),/本次未匯出/);});
await test('缺價隔板金額留白，避免默認0元',async()=>{const f=file(book([header,['00001','Q0','測試公司','','','RX','','','','','EPSON T82III 隔板',1]],'下單設備資料'));select('hmPosFile',f);value('startRow','2');value('endRow','2');await c.generateHuamao();const w=downloads.at(-1).wb;assert.equal(rows(w,'華茂款項匯入資訊')[0]['金額'],'');assert.ok(rows(w,'處理清單')[0]['結果'].includes('採購價未設定'));});
await test('同請款單多POS列中止，避免重複總金額',async()=>{const duplicate=file(book([header,['00001','','測試公司','','','RQ1','','','','','掃碼槍',1],['00002','','測試二','','','RQ1','','','','','錢箱',1]],'下單設備資料'));select('posFile',duplicate);value('invoiceStartRow','2');value('invoiceEndRow','3');const n=downloads.length;await c.convert();assert.equal(downloads.length,n);assert.ok(element('log').textContent.includes('避免重複請款總金額'));});
await test('非華茂列不消耗同公司PDF，後續華茂列仍配對',async()=>{const f=file(book([header,['00001','','測試公司','','','RX','','','','','拍檔POS主機',1],['00001','','測試公司','','','RY','','','','','EPSON發票機',1]],'下單設備資料'));select('hmPosFile',f);value('startRow','2');value('endRow','3');c.salesFixture=pdfFile('sales');run('hmSalesFileList=[salesFixture]');await c.generateHuamao();assert.equal(rows(downloads.at(-1).wb,'華茂款項匯入資訊')[0]['發票號碼'],'AB12345678');run('hmSalesFileList=[]');});
await test('15000列真實Excel序列化、讀取及索引完整',async()=>{const data=[header];for(let i=0;i<15000;i++)data.push([String(i).padStart(6,'0'),'Q'+i,'合成公司'+i,'','','R'+i,'王','0900000000','測試','','掃碼槍',1]);const start=performance.now();const w=await c.readFile(file(book(data,'下單設備資料')));const idx=c.buildPosIndex(w);assert.equal(idx.records.length,15000);assert.equal(idx.records[14999].rowNum,15001);metrics.xlsx15000ElapsedMs=Math.round(performance.now()-start);});
await test('廠商下單與應收查詢可翻頁，未顯示資料仍完整匯出',async()=>{
  const largePos=file(book([header,...Array.from({length:15},(_,i)=>[
    'T'+i,'Q'+i,'測試公司'+i,'','','RQ'+i,'收件人','0900000000','測試地址','','拍檔POS主機',1])],'下單設備資料'));
  select('vendorPosFile',largePos);value('vendorStartRow','2');value('vendorEndRow','16');
  await c.generateVendorMessages();
  const vendor=element('vendorGroupResults');
  assert.equal([...vendor.innerHTML.matchAll(/class="vendorCard"/g)].length,12);
  vendor.listeners.click({target:{closest:()=>({dataset:{vendorPage:'1'}})}});
  assert.equal([...vendor.innerHTML.matchAll(/class="vendorCard"/g)].length,3);
  assert.match(vendor.innerHTML,/vendorLine_14/);
  select('hmImportFile',imp);select('hmArFile',ar);
  value('arQueryText',Array.from({length:53},(_,i)=>'ZZ'+String(i).padStart(8,'0')).join('\n'));
  await c.queryHuamaoStatus();
  const query=element('arQueryResult');
  assert.equal([...query.innerHTML.matchAll(/<tr>/g)].length,51);
  query.listeners.click({target:{closest:()=>({dataset:{arPage:'1'}})}});
  assert.equal([...query.innerHTML.matchAll(/<tr>/g)].length,4);
  c.exportArQueryResults();
  assert.equal(rows(downloads.at(-1).wb,'查詢請款狀態').length,53);
});
if(process.env.HM_FIXTURE && process.env.SALES_FIXTURE)await test('實際華茂款項匯入資訊與華茂銷貨單通過匯入驗證',async()=>{
  const original=(filename,name)=>{const bytes=fs.readFileSync(filename);return {name,bytes,size:bytes.length};};
  const records=await c.readLegacyImport(original(process.env.HM_FIXTURE,'華茂款項匯入資訊.xlsx'),'legacyHm');
  assert.ok(records.length);
  const sales=await c.parseSalesPdfFile(original(process.env.SALES_FIXTURE,'華茂銷貨單.pdf'));
  assert.ok(sales.length);
  assert.equal(sales[0]['發票號碼'],'HT14617830');
});
const output={passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,downloadCount:downloads.length,metrics,results};if(process.env.SAVE_TEST_RESULTS==='1')fs.writeFileSync(path.join(root,'docs/integration-results.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));if(output.failed)process.exitCode=1;
})();

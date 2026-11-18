const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {Worker:Thread}=require('node:worker_threads');
const {test}=require('node:test');
const root=fs.existsSync(path.join(__dirname,'../site'))?path.resolve(__dirname,'../site'):path.resolve(__dirname,'..');
const source=['vendor/xlsx.full.min.js','assets.js','app.js','case-data.js','import-io.js'];
function setup(extras={}){
  const c=vm.createContext({console,TextDecoder,URL,setTimeout,clearTimeout,
    location:new URL('https://test.invalid/pos_aitools/'),...extras});
  c.window=c;
  for(const name of source)vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),c,{filename:name});
  return {c,X:c.XLSX,io:vm.runInContext('ImportIO',c),run:s=>vm.runInContext(s,c)};
}
const {X,io,run}=setup();
function bytes(name,rows,type='xlsx'){
  const wb=X.utils.book_new();
  X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),name);
  return X.write(wb,{type:'array',bookType:type});
}
const posHeader=['商家名稱','報價單編號','設備1','數量'];
test('內容簽章區分 Excel、舊 XLS、純文字及改名 PDF',()=>{
  const rows=[posHeader,['測試公司','Q01','拍檔POS主機',1]];
  for(const kind of ['xlsx','xls']){
    const data=bytes('下單設備資料',rows,kind==='xls'?'biff8':'xlsx');
    assert.equal(io.project(data,'來源.'+kind,'pos')[0].devices[0].qty,1);
  }
  const text=new TextEncoder().encode('公司,金額\n測試,10');
  assert.throws(()=>io.project(text.buffer,'改名.xlsx','pos'),/內容不是有效的 XLSX/);
  assert.throws(()=>io.project(text.buffer,'改名.xls','pos'),/內容不是有效的 XLS/);
  assert.throws(()=>run("checkFileSignature(new Uint8Array([31,139,0]),'改名.pdf')"),/內容不是有效的 PDF/);
  assert.throws(()=>run("validateFile({name:'備份.exe',size:1},['xlsx','xls'])"),/檔案類型不正確/);
  assert.throws(()=>run("validateFile({name:'空白.xlsx',size:0},['xlsx'])"),/檔案是空的/);
});
test('POS 欄位缺漏、只有表頭及角色相近的工作簿會明確告知錯誤',()=>{
  assert.throws(()=>io.project(bytes('下單設備資料',[['商家名稱','設備1'],['測試','拍檔POS主機']]),'pos.xlsx','pos'),/對應的數量欄/);
  assert.throws(()=>io.project(bytes('下單設備資料',[posHeader]),'pos.xlsx','pos'),/沒有可匯入的明細/);
  const source=bytes('下單設備資料',[posHeader,['測試','Q01','拍檔POS主機',1]]);
  assert.throws(()=>io.project(source,'pos.xlsx','quote'),/報價單/);
  assert.throws(()=>io.project(source,'pos.xlsx','request','拍檔'),/必要欄位/);
  assert.throws(()=>io.project(source,'pos.xlsx','legacyInvoice'),/必要欄位/);
  assert.throws(()=>io.project(source,'pos.xlsx','sap'),/找不到/);
  assert.throws(()=>io.project(source,'pos.xlsx','legacyHm'),/金額欄位/);
  assert.throws(()=>io.project(source,'pos.xlsx','legacyAr'),/金額欄位/);
});
test('可補匯入只有發票號碼的採購資料，舊版請款轉換仍需請款單號',()=>{
  const data=bytes('明細',[['發票號碼','發票日期','未稅金額','含稅金額'],['AA00000001','2026-11-18',100,105]]);
  assert.equal(io.project(data,'採購資料.xlsx','request','拍檔')[0].gross,'105');
  assert.throws(()=>io.project(data,'採購資料.xlsx','legacyInvoice'),/必要欄位/);
});
test('華茂應收與款項匯入的指定工作表不可對調',()=>{
  for(const [sheet,success,invalid] of [
    ['華茂應收帳款明細','legacyAr','legacyHm'],['華茂款項匯入資訊','legacyHm','legacyAr']
  ]){
    const file=bytes(sheet,[['發票號碼','金額'],['AA00000001',100]]);
    assert.equal(io.project(file,'來源.xlsx',success).length,1);
    assert.throws(()=>io.project(file,'來源.xlsx',invalid),/需包含/);
  }
});
test('工作檔 JSON 內容與原 v15.0 格式相容',()=>{
  const encode=value=>new TextEncoder().encode(value).buffer;
  const work={data:run('Cases.create()'),selected:[]};
  assert.equal(io.project(encode(JSON.stringify(work)),'工作檔.json','work').data.version,1);
  assert.throws(()=>io.project(encode('[]'),'其他.json','work'),/本工具下載/);
  assert.throws(()=>io.project(encode('{'),'空白.json','work'),/JSON 格式/);
});
test('大型 Excel 背景工作實際轉移輸入與投影結果，並回傳結構錯誤',async()=>{
  let calls=0, terminated=0;
  class BrowserWorker {
    constructor(filename){
      calls++;
      this.thread=new Thread(`
        const {parentPort,workerData}=require('node:worker_threads');
        const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
        const c=vm.createContext({console,TextDecoder,URL,setTimeout,clearTimeout,location:new URL(workerData.filename)});
        c.self=c;
        c.postMessage=data=>parentPort.postMessage(data);
        c.importScripts=(...files)=>files.forEach(url=>{
          const request=new URL(url,c.location.href);
          if(!request.pathname.startsWith('/pos_aitools/') || request.searchParams.get('v')!=='15.3')throw Error('wrong worker release path');
          const name=request.pathname.slice('/pos_aitools/'.length);
          vm.runInContext(fs.readFileSync(path.join(workerData.root,name),'utf8'),c,{filename:name});
        });
        parentPort.on('message',data=>c.onmessage({data}));
        c.importScripts(workerData.filename);
      `,{eval:true,workerData:{root,filename}});
      this.thread.on('message',data=>this.onmessage({data}));
      this.thread.on('error',err=>this.onerror(err));
    }
    postMessage(data,transfer){this.thread.postMessage(data,transfer);assert.equal(data.buffer.byteLength,0);}
    terminate(){terminated++;this.thread.terminate();}
  }
  class FileReader {readAsArrayBuffer(file){queueMicrotask(()=>this.onload({target:{result:file.data}}));}}
  const browser=setup({Worker:BrowserWorker,FileReader}).io;
  const rows=[posHeader,...Array.from({length:3000},(_,i)=>['公司'+i,'Q'+i,'拍檔POS主機',1])];
  const file={name:'大型 POS.xlsx',data:bytes('下單設備資料',rows)};
  file.size=file.data.byteLength;
  assert.ok(file.size>131072);
  const workerRows=await browser.excel(file,'pos');
  assert.equal(workerRows.length,3000);
  assert.equal(workerRows[2999].quote,'Q2999');
  const wrong={name:'報價.xlsx',data:bytes('下單設備資料',rows)};
  wrong.size=wrong.data.byteLength;
  await assert.rejects(browser.excel(wrong,'quote'),/報價單/);
  assert.equal(calls,2);
  assert.equal(terminated,2);
});

test('PDF 依賴首次使用才載入，並行呼叫共用載入程序', async () => {
  const {c}=setup();
  const loads=[];
  c.document={
    baseURI:'https://test.invalid/pos_aitools/',
    createElement:()=>({remove(){}}),
    head:{append(script){
      loads.push(script.src);
      queueMicrotask(()=>{
        if(new URL(script.src).pathname.endsWith('pdf.min.js'))c.pdfjsLib={getDocument(){},GlobalWorkerOptions:{}};
        if(new URL(script.src).pathname.endsWith('pdf-resources.js'))c.PDF_LOCAL_RESOURCES={cmaps:{},fonts:{}};
        script.onload();
      });
    }}
  };
  const lazy=vm.runInContext('ImportIO',c);
  assert.deepEqual(loads,[]);
  await Promise.all([lazy.pdf(),lazy.pdf()]);
  await lazy.pdf();
  assert.deepEqual(loads,['vendor/pdf.min.js','vendor/pdf-resources.js'].map(p=>'https://test.invalid/pos_aitools/'+p+'?v=15.3'));
  assert.equal(c.pdfjsLib.GlobalWorkerOptions.workerSrc,'https://test.invalid/pos_aitools/vendor/pdf.worker.min.js?v=15.3');
});

test('背景 Excel 缺檔時，不傳走原始輸入，主頁能完成大型匯入',async()=>{
  let posted=0, terminated=0;
  class MissingWorker {
    constructor(url){
      assert.equal(url,'https://test.invalid/pos_aitools/import-worker.js?v=15.3');
      queueMicrotask(()=>this.onmessage({data:{bootstrapError:'vendor/xlsx.full.min.js 載入失敗'}}));
    }
    postMessage(){posted++;}
    terminate(){terminated++;}
  }
  class FileReader {readAsArrayBuffer(file){queueMicrotask(()=>this.onload({target:{result:file.data}}));}}
  const page=setup({Worker:MissingWorker,FileReader});
  const rows=[posHeader,...Array.from({length:3000},(_,i)=>['測試公司','Q'+i,'拍檔POS主機',1])];
  const data=bytes('下單設備資料',rows);
  const out=await page.io.excel({name:'測試.xlsx',size:data.byteLength,data},'pos');
  assert.equal(out.length,3000);
  assert.equal(out[2999].quote,'Q2999');
  assert.equal(posted,0);
  assert.equal(terminated,1);
  assert.match(page.run('logLines.join(" ")'),/vendor\/xlsx\.full\.min\.js.+改由頁面處理/);
});

test('PDF 應顯示完整缺檔路徑，檔案修復後同一頁可再載入',async()=>{
  const {c,io}=setup();
  let fail=true, counts={};
  c.document={
    baseURI:'https://test.invalid/pos_aitools/',
    createElement:()=>({remove(){}}),
    head:{append(tag){
      const path=new URL(tag.src).pathname;
      counts[path]=(counts[path]||0)+1;
      queueMicrotask(()=>{
        if(path.endsWith('pdf-resources.js')){
          if(fail){tag.onerror();return;}
          c.PDF_LOCAL_RESOURCES={cmaps:{},fonts:{}};
        }else c.pdfjsLib={getDocument(){},GlobalWorkerOptions:{}};
        tag.onload();
      });
    }}
  };
  await assert.rejects(io.pdf(),/PDF 中文資源載入失敗（\/pos_aitools\/vendor\/pdf-resources\.js）/);
  fail=false;
  await io.pdf();
  assert.equal(counts['/pos_aitools/vendor/pdf.min.js'],1);
  assert.equal(counts['/pos_aitools/vendor/pdf-resources.js'],2);
});

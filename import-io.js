/* Shared import contracts for the browser and the spreadsheet worker. */
const ImportIO = (() => {
  const excelModes={
    pos: (wb,name)=>Cases.posRows(wb,name),
    quote: (wb,name)=>Cases.quotationRows(wb,name),
    sap: (wb,name)=>Cases.sapTemplate(wb,name),
    request: (wb,name,vendor)=>Cases.requestRows(wb,vendor,name),
    attachment: ()=>true,
    legacyPos: wb=>projectLegacy(wb,'legacyPos'),
    legacyIndex: wb=>projectLegacy(wb,'legacyIndex'),
    legacyInvoice: wb=>projectLegacy(wb,'legacyInvoice'),
    legacyHm: wb=>projectLegacy(wb,'legacyHm'),
    legacyAr: wb=>projectLegacy(wb,'legacyAr'),
  };
  function project(buffer,name,mode,vendor){
    if(mode==='work'){
      let work;
      try{work=JSON.parse(new TextDecoder().decode(buffer));}
      catch{throw Error('案件工作檔 JSON 格式無法讀取。');}
      if(!work?.data)throw Error('請選擇本工具下載的案件工作檔 JSON。');
      Cases.restore(work.data);
      return work;
    }
    if(!Object.hasOwn(excelModes,mode))throw Error('未知的匯入類別。');
    const result=excelModes[mode](parseExcelBuffer(buffer,name),name,vendor);
    if(Array.isArray(result)&&!result.length)throw Error('「'+name+'」有表頭，但沒有可匯入的明細。');
    return result;
  }
  function tryWorker(buffer,name,mode,vendor){
    if(typeof Worker!=='function'||typeof location==='undefined'||!['http:','https:'].includes(location.protocol)||buffer.byteLength<128*1024){
      return Promise.resolve(null);
    }
    return new Promise((resolve,reject)=>{
      let worker;
      const path=SiteAssets.url('import-worker.js');
      try{worker=new Worker(path);}
      catch{
        log('無法啟動背景解析（import-worker.js），改由頁面處理。');
        resolve(null);return;
      }
      let sent=false;
      const stop=()=>{clearTimeout(timer);worker.terminate();};
      const fallback=detail=>{
        stop();
        log('背景解析未就緒（'+detail+'），改由頁面處理。');
        resolve(null);
      };
      let timer=setTimeout(()=>fallback('import-worker.js 載入逾時'),8000);
      worker.onerror=event=>{
        event.preventDefault?.();
        if(!sent){fallback('import-worker.js 載入失敗');return;}
        stop();
        reject(Error('無法完成「'+name+'」的背景解析，請重新匯出檔案後再試。'));
      };
      worker.onmessage=({data})=>{
        if(data.bootstrapError&&!sent){fallback(data.bootstrapError);return;}
        if(data.ready&&!sent){
          try{worker.postMessage({buffer,name,mode,vendor},[buffer]);sent=true;}
          catch{fallback('背景資料傳送失敗');return;}
          clearTimeout(timer);
          timer=setTimeout(()=>{
            stop();
            reject(Error('「'+name+'」解析時間過長，請分割檔案後再試。'));
          },120000);
          return;
        }
        stop();
        if(data.error)reject(Error(data.error));
        else{
          for(const notice of data.notices||[])log(notice);
          resolve({value:data.value});
        }
      };
    });
  }
  async function excel(file,mode,vendor){
    validateFile(file,mode==='work'?['json']:['xlsx','xls']);
    const buffer=await readArrayBuffer(file);
    const sourceDigest=mode==='pos'&&globalThis.crypto?.subtle?
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join(''):'';
    const background=await tryWorker(buffer,file.name,mode,vendor);
    const value=background?background.value:project(buffer,file.name,mode,vendor);
    if(sourceDigest)for(const row of value)row.sourceDigest=sourceDigest;
    return value;
  }
  const pdfEngineReady=()=>typeof window.pdfjsLib?.getDocument==='function' && window.pdfjsLib.GlobalWorkerOptions;
  const pdfDataReady=()=>window.PDF_LOCAL_RESOURCES?.cmaps && window.PDF_LOCAL_RESOURCES?.fonts;
  let pdfPending;
  function pdf(){
    if(pdfEngineReady()&&pdfDataReady())return pdfPending||Promise.resolve();
    if(!pdfPending){
      pdfPending=Promise.all([
        SiteAssets.loadScript('vendor/pdf.min.js','PDF 讀取元件',pdfEngineReady),
        SiteAssets.loadScript('vendor/pdf-resources.js','PDF 中文資源',pdfDataReady)
      ]).then(()=>{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc=SiteAssets.url('vendor/pdf.worker.min.js');
      }).catch(err=>{pdfPending=null;throw err;});
    }
    return pdfPending;
  }
  return {excel,project,pdf};
})();

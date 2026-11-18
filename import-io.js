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
      try{worker=new Worker('import-worker.js');}
      catch{resolve(null);return;}
      let sent=false;
      const stop=()=>{clearTimeout(timer);worker.terminate();};
      const timer=setTimeout(()=>{
        stop();
        if(sent)reject(Error('「'+name+'」解析時間過長，請分割檔案後再試。'));
        else resolve(null);
      },120000);
      worker.onerror=event=>{
        event.preventDefault?.();
        stop();
        if(!sent)resolve(null);
        else reject(Error('無法完成「'+name+'」的背景解析，請重新匯出檔案後再試。'));
      };
      worker.onmessage=({data})=>{
        if(data.ready&&!sent){
          try{worker.postMessage({buffer,name,mode,vendor},[buffer]);sent=true;}
          catch{stop();resolve(null);}
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
    const background=await tryWorker(buffer,file.name,mode,vendor);
    return background?background.value:project(buffer,file.name,mode,vendor);
  }
  let pdfPending;
  function pdf(){
    if(window.pdfjsLib&&window.PDF_LOCAL_RESOURCES)return pdfPending||Promise.resolve();
    if(!pdfPending){
      const load=(name,ready)=>ready?Promise.resolve():new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src=name;
        script.onload=()=>resolve();
        script.onerror=()=>{script.remove();reject(Error('PDF 元件載入失敗：'+name));};
        document.head.append(script);
      });
      pdfPending=Promise.all([load('vendor/pdf.min.js',window.pdfjsLib),
        load('vendor/pdf-resources.js',window.PDF_LOCAL_RESOURCES)]).then(()=>{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';
      }).catch(err=>{pdfPending=null;throw err;});
    }
    return pdfPending;
  }
  return {excel,project,pdf};
})();

/* Only projected rows cross back to the UI; the workbook stays in this worker. */
self.window=self;
try{
  const entry=new URL(location.href);
  const loader=new URL('assets.js',entry);
  loader.search=entry.search;
  importScripts(loader.href);
  if(entry.searchParams.get('v')!==SiteAssets.release)throw Error('背景程式版本不一致');
  for(const path of ['vendor/xlsx.full.min.js','app.js','case-data.js','import-io.js']){
    try{importScripts(SiteAssets.url(path));}
    catch{throw SiteAssets.failure(path,'背景解析相依檔');}
  }
  if(XLSX.version!=='0.20.3'||typeof XLSX.read!=='function')throw Error('背景 Excel 元件無法初始化');
  self.onmessage=({data})=>{
    try{
      if(data.orderSettings)OrderSettings.load(data.orderSettings);
      const value=ImportIO.project(data.buffer,data.name,data.mode,data.vendor);
      self.postMessage({value,notices:logLines});
    }catch(err){self.postMessage({error:err.message||String(err)});}
  };
  self.postMessage({ready:true});
}catch(err){
  self.postMessage({bootstrapError:err.message||String(err)});
}

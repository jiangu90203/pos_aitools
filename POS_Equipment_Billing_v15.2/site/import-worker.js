/* Only projected rows cross back to the UI; the workbook stays in this worker. */
self.window=self;
importScripts('vendor/xlsx.full.min.js','app.js','case-data.js','import-io.js');
self.onmessage=({data})=>{
  try{
    const value=ImportIO.project(data.buffer,data.name,data.mode,data.vendor);
    self.postMessage({value,notices:logLines});
  }
  catch(err){self.postMessage({error:err.message||String(err)});}
};
self.postMessage({ready:true});

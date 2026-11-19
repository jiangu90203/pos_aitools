/* Case workspace UI. Imported values are escaped before rendering. */
(() => {
  const byId = id => document.getElementById(id);
  const root = byId('caseWorkspace');
  if (!root) return;
  const e = escapeHtml;
  const money = n => n == null ? '—' : Number(n).toLocaleString('zh-TW', {maximumFractionDigits: 2});
  const selected = new Set();
  let state = Cases.create();
  let current = '', staged = null, filterPage = 0, busy = false, dirty = false, stageToken = 0;
  let posImport = null, vendorPreview = null;
  let batchItems=[], pendingDocuments=[], batchView='', batchPage=0, batchAffected=new Set();
  let queuedFiles=[];
  let showOrders=false, detailOpener=null;
  const pageSize = 30, previewSize = 20, orderSize = 12;
  let quoteUrl='', orderFrame=0, orderDirty=true, ordersByVendor=new Map();
  let caseIndex = new Map(), indexedCases, billsByCase = new Map(), visibleCases = [], filterFrame = 0;
  let stageByCase = new Map();
  const order = () => caseIndex.get(current)?.record;
  function indexCases() {
    if(indexedCases===state.cases)return;
    indexedCases=state.cases;
    caseIndex=new Map(state.cases.map(c=>[c.id,{
      record:c,
      search:[c.pos.quote,c.pos.shopId,c.pos.merchant].map(norm),
      vendors:Cases.vendors.filter(v=>Cases.hasVendor(c,v))
    }]));
  }
  function indexBills() {
    billsByCase=new Map();
    stageByCase=new Map();
    for(const inv of state.invoices){
      for(const link of inv.links){
        if(!billsByCase.has(link.caseId))billsByCase.set(link.caseId,[]);
        billsByCase.get(link.caseId).push({inv,link});
      }
    }
  }
  const focused = () => state.cases.filter(c => selected.has(c.id));
  const field = (name, label, value = '', type = 'text', attrs = '') =>
    `<label>${e(label)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${attrs}></label>`;
  const option = (v, label, val) => `<option value="${e(v)}"${v === val ? ' selected' : ''}>${e(label)}</option>`;
  const tri = (name, title, value) => `<label>${title}<select name="${name}">${option('', '待確認', value == null ? '' : String(value))}${option('true','是',String(value))}${option('false','否',String(value))}</select></label>`;
  const asTri = value => value === '' ? null : value === 'true';
  const dateInput = value => { try { return Cases.date(value); } catch { return ''; } };
  const labelFor = c => [c.pos.quote || '無報價單號', c.pos.merchant || '待補公司', '第 ' + c.pos.row + ' 列'].join(' ｜ ');
  const status = (message, error = false) => {
    byId('caseStatus').textContent = message;
    byId('caseStatus').classList.toggle('is-error', error);
    const detail = byId('caseDetailFeedback');
    if (detail) {
      detail.textContent = message;
      detail.classList.toggle('case-warning', error);
    }
  };
  const changed = () => {
    dirty = true;
    byId('caseSaveState').textContent = '有未下載的案件更新';
  };
  const saved = () => {
    dirty = false;
    byId('caseSaveState').textContent = '案件工作檔已就緒';
  };
  window.addEventListener('beforeunload', event => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  async function action(fn) {
    if (busy) return;
    busy = true;
    byId('caseBusy').hidden = false;
    try { await fn(); } catch (err) { status(err.message || '操作失敗，請檢查資料。', true); }
    finally { busy = false; byId('caseBusy').hidden = true; }
  }
  function billFlags(c,vendor) {
    if(c.pos.issues.length||c.review)return ['待核對設備'];
    let stages=stageByCase.get(c.id);
    if(!stages){
      stages=new Map();
      stageByCase.set(c.id,stages);
    }
    return caseIndex.get(c.id).vendors.flatMap(v=>{
      if(vendor&&vendor!==v)return [];
      if(stages.has(v))return stages.get(v);
      const entries=(billsByCase.get(c.id)||[]).filter(x=>x.inv.vendor===v);
      const flags=entries.length?entries.map(({inv,link})=>Cases.billStatus(c,inv,link,entries)):['待補'+v+'發票'];
      stages.set(v,flags);
      return flags;
    });
  }
  function documentFlag(c,vendor) {
    if(batchAffected.has(vendor+':'+c.id))return 'review';
    const docs=VendorDocs.documents(c).filter(d=>!vendor||d.vendor===vendor);
    if(docs.some(d=>d.parsed.warnings.length))return 'review';
    const suppliers=caseIndex.get(c.id).vendors.filter(v=>!vendor||vendor===v);
    if(!suppliers.length)return '';
    return suppliers.every(v=>VendorDocs.kinds.every(k=>docs.some(d=>d.vendor===v&&d.kind===k)))?'complete':'missing';
  }
  const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
  function renderBatch(){
    batchAffected=new Set();
    const counts={linked:0,unmatched:0,duplicate:0,failed:0};
    const issues=batchItems.filter(item=>item.type==='linked'&&item.reason);
    for(const item of batchItems){
      counts[item.type]++;
      if(item.type==='unmatched'&&item.doc)for(const id of item.matches||[]){
        batchAffected.add(item.doc.vendor+':'+id);
        batchAffected.add(':'+id);
      }
    }
    const node=byId('caseBatchResults');
    node.hidden=!batchItems.length;
    if(node.hidden){node.innerHTML='';return;}
    const items=batchView==='issues'?issues:batchItems.filter(item=>item.type===batchView);
    const last=Math.max(0,Math.ceil(items.length/orderSize)-1);
    batchPage=Math.max(0,Math.min(batchPage,last));
    const slice=items.slice(batchPage*orderSize,(batchPage+1)*orderSize);
    node.innerHTML=`<div class="erp-batch-summary">
      <strong role="status">成功配對 ${counts.linked} 筆｜未找到對應案件 ${counts.unmatched} 筆｜文件重複 ${counts.duplicate} 筆｜解析失敗 ${counts.failed} 筆</strong>
      ${batchItems.some(item=>item.file)?`<button type="button" class="case-btn primary" data-case-action="download-vendor-batch">${uiIcon('download')} 下載本批歸檔 ZIP</button>`:''}
      ${Object.entries({unmatched:'查看未配對',duplicate:'查看重複文件',failed:'查看解析失敗',issues:'查看配對提醒（'+issues.length+'）'}).map(([key,label])=>
        (counts[key]||key==='issues'&&issues.length)?`<button type="button" class="case-btn" aria-pressed="${batchView===key}" data-batch-view="${key}">${label}</button>`:'').join('')}
    </div>
    ${slice.length?`<ul class="erp-batch-list">${slice.map(item=>`<li><div><strong>${e(item.name)}</strong>
      ${item.pages?.length?`<span>第 ${item.pages.join('、')} 頁</span>`:''}
      <span>${e(item.doc?[item.doc.vendor,item.doc.kind,item.doc.id].filter(Boolean).join(' · '):'')}</span>
      <span class="case-warning">${e(item.reason)}</span></div></li>`).join('')}</ul>`:''}
    ${last?`<div class="case-pagination">
      <button type="button" class="case-btn" data-batch-page="-1" ${batchPage?'':'disabled'}>上一頁</button>
      <span>${batchPage+1} ／ ${last+1} 頁</span>
      <button type="button" class="case-btn" data-batch-page="1" ${batchPage===last?'disabled':''}>下一頁</button></div>`:''}`;
  }
  function renderQueue() {
    byId('caseBatchQueue').hidden=!queuedFiles.length;
    byId('caseBatchQueueStatus').textContent=queuedFiles.length?
      `已選 ${queuedFiles.length} 份 PDF，匯入 POS 或載入工作檔後會自動核對。`:'';
  }
  async function importBatch(files) {
    const workbooks=files.filter(file=>/\.xlsx?$/i.test(file.name));
    if(workbooks.length>1)throw Error('每批可選一份 POS Excel 與多份 PDF。請重新選擇檔案。');
    const [workbook]=workbooks;
    const documents=files.filter(file=>file!==workbook);
    if(workbook&&(documents.length||queuedFiles.length)){
      const rows=await ImportIO.excel(workbook,'pos');
      clearPosFile();
      if(staged?.type==='pos'){staged=null;renderPreview();}
      const batch=[...queuedFiles,...documents];
      queuedFiles=[];
      renderQueue();
      await runBatch(batch,undefined,undefined,rows);
      return;
    }
    if(workbook||posImport||!state.cases.length){
      if(workbook)await importExcel(workbook,'pos',true);
      queuedFiles.push(...documents);
      renderQueue();
      if(!posImport)status('請加入一份 POS Excel 或載入工作檔，系統會接續核對已選 PDF。');
      return;
    }
    await runBatch(documents);
  }
  async function runQueuedFiles() {
    if(!state.cases.length||!queuedFiles.length&&!pendingDocuments.length)return;
    const files=queuedFiles;
    queuedFiles=[];
    renderQueue();
    await runBatch(files);
  }
  async function runBatch(files,vendor,kind,positions) {
    if(!files.length&&!pendingDocuments.length)return;
    batchItems=[...pendingDocuments];
    batchView=''; batchPage=0;
    for(const [i,file] of files.entries()){
      status(`讀取文件 ${i+1} ／ ${files.length}`);
      await yieldUI();
      try{
        const records=await VendorDocs.readRecords(file,vendor,kind);
        for(const record of records){
          batchItems.push({name:file.name,pages:record.pages,doc:record.doc,file,
            type:record.error?'failed':'',reason:record.error?.message||''});
        }
      }catch(err){
        batchItems.push({name:file.name,file,type:'failed',reason:err.message||'無法讀取 PDF。'});
      }
    }
    const items=batchItems.filter(item=>item.doc);
    const projected=positions?{...state,cases:state.cases.slice()}:state;
    if(positions)Cases.commitPos(projected,Cases.previewPos(state,positions),new Map());
    const plan=VendorDocs.planBatch(projected,items.map(item=>item.doc));
    if(positions){
      const targets=new Set(plan.filter(p=>p.type==='ready').map(p=>p.caseId));
      const additions=projected.cases.slice(state.cases.length).filter(c=>targets.has(c.id));
      if(additions.length){state.cases=[...state.cases,...additions];indexCases();changed();}
    }
    let saved=0, sliceStart=performance.now();
    const archives=new Map();
    for(const [i,item] of items.entries()){
      Object.assign(item,plan[i]);
      if(item.type!=='ready')continue;
      try{
        if(!archives.has(item.file)){
          archives.set(item.file,await VendorDocs.archive(item.file).catch(()=> ''));
        }
        const archiveKey=archives.get(item.file);
        VendorDocs.saveDecision(state,caseIndex.get(item.caseId).record,item,archiveKey);
        if(!archiveKey)item.reason=[item.reason,'瀏覽器無法保存原始 PDF。請保留原始檔案。'].filter(Boolean).join(' ');
        item.type='linked';
        saved++;
      }catch(err){
        item.type='unmatched';
        item.reason=err.message;
      }
      if(performance.now()-sliceStart>12){await yieldUI();sliceStart=performance.now();}
    }
    pendingDocuments=batchItems.filter(item=>item.type==='unmatched'&&item.doc?.key);
    if(saved)changed();
    renderBatch();
    render();
    status('文件比對已完成。');
  }
  async function downloadVendorBatch() {
    const archive=XLSX.CFB.utils.cfb_new(), added=new Map(), casesByVendor=new Map(), filenames=new Map();
    const summary=[['狀態','公司名稱','POS 來源列','供應商','出貨單號','訂單單號','發票號碼','原始檔案','頁碼','說明']];
    const labels={linked:'成功歸檔',duplicate:'重複',unmatched:'待核對',failed:'解析失敗'};
    const safe=s=>String(s||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,90);
    const add=(name,data)=>{
      // SheetJS writes ASCII path bytes. Reserve matching lengths for the UTF-8 paths.
      const path=new TextEncoder().encode(name);
      const placeholder=('entry'+filenames.size).padEnd(path.length,'_');
      filenames.set(placeholder,path);
      XLSX.CFB.utils.cfb_add(archive,placeholder,new Uint8Array(data));
    };
    for(const item of batchItems){
      const doc=item.doc, record=['linked','duplicate'].includes(item.type)?
        caseIndex.get(item.caseId)?.record:null;
      if(record&&doc){
        if(!casesByVendor.has(doc.vendor))casesByVendor.set(doc.vendor,new Set());
        casesByVendor.get(doc.vendor).add(record);
      }
      summary.push([labels[item.type],record?.pos.merchant||doc?.shipCompany||'',record?.pos.row??'',
        doc?.vendor,doc?.shipNo,doc?.orderNo,doc?.invoiceNo,item.name,VendorDocs.pageLabel(item.pages),item.reason]);
      if(!item.file||!/\.pdf$/i.test(item.name))continue;
      const folder=record?
        [safe(doc?.vendor),record.pos.row+'_'+safe(record.pos.merchant)+'_'+safe(record.pos.quote)].join('/'):
        '待核對';
      if(!added.has(folder))added.set(folder,new Set());
      const group=added.get(folder);
      if(group.has(item.file))continue;
      group.add(item.file);
      add(folder+'/'+String(group.size).padStart(2,'0')+'_'+safe(item.name.replace(/\.pdf$/i,''))+'.pdf',
        await readArrayBuffer(item.file));
    }
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(summary),'配對紀錄');
    add('配對紀錄.xlsx',XLSX.write(book,{type:'array',bookType:'xlsx'}));
    for(const [vendor,records] of casesByVendor){
      const orders=[...records].sort((a,b)=>a.pos.row-b.pos.row);
      const wb=vendor==='拍檔'?Cases.billWorkbook(state,orders):Cases.huamaoWorkbook(state,orders);
      add(vendor+'/'+(vendor==='拍檔'?'拍檔請款彙整':'華茂款項匯入資訊')+'.xlsx',XLSX.write(wb,{type:'array',bookType:'xlsx'}));
    }
    const bytes=new Uint8Array(XLSX.CFB.write(archive,{fileType:'zip',type:'array'}));
    const view=new DataView(bytes.buffer);
    const end=bytes.length-22;
    if(view.getUint32(end,true)!==0x06054b50)throw Error('無法完成 ZIP 歸檔。');
    const count=view.getUint16(end+10,true);
    let offset=view.getUint32(end+16,true);
    const decoder=new TextDecoder();
    for(let i=0;i<count;i++){
      const local=view.getUint32(offset+42,true);
      const length=view.getUint16(offset+28,true);
      const path=filenames.get(decoder.decode(bytes.subarray(offset+46,offset+46+length)));
      if(!path||path.length!==length)throw Error('無法儲存 ZIP 中的原始檔名。');
      bytes.set(path,local+30);
      bytes.set(path,offset+46);
      view.setUint16(local+6,view.getUint16(local+6,true)|0x0800,true);
      view.setUint16(offset+8,view.getUint16(offset+8,true)|0x0800,true);
      offset+=46+length+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
    }
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='供應商請款歸檔_'+formatToday()+'.zip';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('已要求下載本批歸檔 ZIP。');
  }
  function lookup() {
    const query = norm(byId('caseSearch').value);
    const vendor = byId('caseVendor').value;
    const mode = byId('caseStateFilter').value;
    const documents = byId('caseDocumentFilter').value;
    const first = Number(byId('caseFirstRow').value) || 0;
    const last = Number(byId('caseLastRow').value) || Infinity;
    return state.cases.filter(c => {
      if (c.pos.row < first || c.pos.row > last) return false;
      const meta=caseIndex.get(c.id);
      if(query&&!meta.search.some(v=>v.includes(query)))return false;
      if(vendor&&!meta.vendors.includes(vendor))return false;
      if(documents&&documentFlag(c,vendor)!==documents)return false;
      if(mode==='selected')return selected.has(c.id);
      if(mode){
        const flags=billFlags(c,vendor);
        if(mode==='ready')return flags.includes('可填請款');
        if(mode==='claimed')return flags.includes('已回填請款');
        if(mode==='check')return flags.some(flag=>!['可填請款','已回填請款'].includes(flag));
      }
      return true;
    });
  }
  function renderList() {
    const result = lookup();
    filterPage = Math.max(0, Math.min(filterPage, Math.ceil(result.length / pageSize) - 1));
    const rows=visibleCases=result.slice(filterPage*pageSize,(filterPage+1)*pageSize);
    lookupCount=result.length;
    renderSelection(lookupCount);
    byId('casePage').textContent = result.length ? `${filterPage + 1} / ${Math.ceil(result.length / pageSize)} 頁` : '—';
    byId('casePrev').disabled = filterPage <= 0;
    byId('caseNext').disabled = (filterPage + 1) * pageSize >= result.length;
    byId('caseRows').innerHTML = rows.length ? rows.map(c => {
      const p = c.pos;
      const meta=caseIndex.get(c.id);
      const tags=meta.vendors.join('／')||'其他';
      const vendor=byId('caseVendor').value;
      const flags=[...new Set(billFlags(c,vendor))].join('／')||'—';
      const docFlag=documentFlag(c,vendor);
      return `<tr data-case-row="${e(c.id)}"${c.id === current ? ' class="case-active"' : ''}>
        <td><input type="checkbox" data-select="${e(c.id)}" aria-label="勾選 ${e(labelFor(c))}" ${selected.has(c.id) ? 'checked' : ''}></td>
        <td>${p.row}</td><td>${e(p.quote || '—')}</td><td>${e(p.merchant || '—')}</td>
        <td>${e(tags)}</td><td>${e(flags)}</td>
        <td><span class="erp-badge ${docFlag}">${({complete:'齊全',missing:'缺文件',review:'待確認'})[docFlag]||'—'}</span></td>
        <td><button type="button" class="case-btn" data-open="${e(c.id)}">${uiIcon('eye')} 查看</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="case-empty">沒有符合條件的案件。可調整篩選或匯入 POS 設備即時庫存。</td></tr>';
  }
  function renderSelection(count) {
    if(count===undefined)scheduleOrderPreview();
    if(count===undefined&&byId('caseStateFilter').value==='selected'){renderList();return;}
    byId('caseCount').textContent=`共 ${state.cases.length} 案｜符合 ${count??lookupCount} 案｜已勾選 ${selected.size} 案`;
    byId('caseSelectedCount').textContent='已勾選 '+selected.size+' 案';
    byId('caseBatchActions').hidden=!selected.size;
    if(!selected.size)showOrders=false;
    byId('caseOrderSection').hidden=!showOrders;
    byId('caseOrderToggle').setAttribute?.('aria-expanded',String(showOrders));
    const pageCheck=byId('caseSelectPage');
    pageCheck.checked=visibleCases.length>0&&visibleCases.every(c=>selected.has(c.id));
    pageCheck.indeterminate=!pageCheck.checked&&visibleCases.some(c=>selected.has(c.id));
    pageCheck.disabled=!visibleCases.length;
    // Individual selections keep the focused checkbox and the current table intact.
    if(count===undefined)for(const input of byId('caseRows').querySelectorAll('[data-select]'))input.checked=selected.has(input.dataset.select);
  }
  let lookupCount=0;
  function scheduleFilter(){
    filterPage=0;
    if(filterFrame)return;
    if(typeof requestAnimationFrame!=='function'){renderList();return;}
    filterFrame=requestAnimationFrame(()=>{filterFrame=0;renderList();});
  }
  function updateActiveRow(){
    for(const row of byId('caseRows').querySelectorAll('[data-case-row]')){
      row.classList.toggle('case-active',row.dataset.caseRow===current);
    }
  }
  function comparePos(entry, choice) {
    const reference = entry.candidates.find(c => 'case:' + c.id === choice) || entry.candidates[0];
    const before = reference?.pos || entry.earlier, after = entry.pos;
    const fields = [
      ['報價單號', 'quote'], ['SHOP ID', 'shopId'], ['商家名稱', 'merchant'],
      ['收件人', 'contact'], ['電話', 'phone'], ['地址', 'address'],
      ['設備請款單號', 'request'], ['裝機請款單號', 'installRequest'],
      ['華茂下單日期', 'hmDate'], ['峰潮下單日期', 'peakDate'], ['拍檔下單日期', 'partnerDate'], ['備註', 'notes']
    ].map(([label, key]) => [label, before[key], after[key]]);
    const equipment = p => p.devices.map(d => '設備'+d.slot+' '+d.raw+' × '+(d.qty ?? '待確認')).join('、');
    fields.push(['設備與數量', equipment(before), equipment(after)],
      ['數量格式待核對', before.issues.join('、'), after.issues.join('、')]);
    const same = [], different = [];
    for(const [label, oldValue, newValue] of fields){
      if(!oldValue && !newValue) continue;
      if(oldValue===newValue) same.push(label);
      else different.push(`<li><strong>${label}</strong> ${e(oldValue || '空白')} → ${e(newValue || '空白')}</li>`);
    }
    const rowLabel = reference ? '工作區原第 ' : '本次範圍前一筆相符資料，第 ';
    return `<p class="case-meta">比對來源：${rowLabel}${before.row} 列</p>
      <p><strong>相同</strong>　${same.join('、') || '無相同的非空白欄位'}</p>
      <div class="case-differences"><strong>不同</strong>
        ${different.length ? '<ul>'+different.join('')+'</ul>' : '<p>欄位內容相同，請確認是否為重複登錄。</p>'}
      </div>`;
  }
  function renderPreview() {
    const node = byId('casePreview');
    node.hidden = !staged;
    if (!staged) { node.innerHTML = ''; return; }
    const {name,type,rows,page,choices,items,counts}=staged;
    const start=page*previewSize,end=Math.min(start+previewSize,items.length);
    let contents='';
    if(type==='pos'){
      contents=`<p class="case-meta">本次範圍：Excel 第 ${staged.from} 至 ${staged.to} 列</p>
        <p>新增 ${counts.new} 筆，重複 ${counts.same} 筆，需決定 ${counts.conflict} 筆。${counts.same?' 已辨識為同一筆來源資料的列將略過。':''}</p>
        ${items.length?`<div class="case-actions">
        <button type="button" class="case-btn" data-case-action="pos-add-all">全部視為新增另一批次</button>
        <button type="button" class="case-btn" data-case-action="pos-skip-all">全部暫不匯入</button></div>`:''}
        <p id="casePosDecisions" role="status">${posDecisions()}</p>`;
      for(const index of items.slice(start,end)){
        const entry=rows[index];
        const value=choices.get(index)||'add';
        contents+=`<div class="case-conflict"><strong>${e(entry.pos.quote)} ${e(entry.pos.merchant)}・新檔第 ${entry.pos.row} 列</strong>
          <div data-candidate="${index}">${comparePos(entry,value)}</div>
          <label>處理方式<select data-choice="${index}">
            ${option('skip','暫不匯入',value)}${option('add','新增另一批次',value)}
            ${entry.candidates.map(c=>option('case:'+c.id,'更新原第 '+c.pos.row+' 列',value)).join('')}
          </select></label></div>`;
      }
    }else if(type==='request'){
      contents=`<p>共 ${rows.length} 筆，已勾選 <span id="casePickedRequests">${choices.size}</span> 筆。請核對後套用到目前案件。</p>
        <div class="case-preview-scroll">${items.slice(start,end).map(i=>{
          const r=rows[i];
          return `<label class="case-tick"><input type="checkbox" data-request-choice="${i}" ${choices.has(i)?'checked':''}>
          <span>${e([r.no,r.pr,r.quote,r.date,'未稅 '+(r.net||'—'),'含稅 '+(r.gross||'—'),r.memo].filter(Boolean).join(' ｜ '))}</span></label>`;
        }).join('')}</div>`;
    }else{
      contents=`<p>找到 ${rows.length} 列。${type==='sap'?'套用後採用這份 VK 底表。':'套用後新增報價來源。同案多張銷售發票將留待核對。'}</p>`;
    }
    if(items.length>previewSize)contents+=`<div class="case-preview-pager">
      <button type="button" class="case-btn" data-case-action="preview-prev" ${page===0?'disabled':''}>預覽上一頁</button>
      <span>${start+1}–${end} ／ ${items.length} 筆</span>
      <button type="button" class="case-btn" data-case-action="preview-next" ${end===items.length?'disabled':''}>預覽下一頁</button>
      </div>`;
    node.innerHTML = `<strong>${e(name)}</strong>${contents}<div class="case-actions">
      <button type="button" class="case-btn primary" data-case-action="commit">${uiIcon('check')} ${type==='pos'?'確認匯入':'套用匯入'}</button>
      <button type="button" class="case-btn" data-case-action="cancel">取消</button></div>`;
  }
  function posDecisions() {
    const {counts,items,rows,choices}=staged;
    let added=counts.new, skipped=counts.same, updated=0, issues=0;
    for(const i of items){
      const value=choices.get(i)||'add';
      if(value==='add')added++;
      else if(value==='skip')skipped++;
      else updated++;
    }
    for(const [i,row] of rows.entries()){
      if(row.type!=='same'&&choices.get(i)!=='skip'&&row.pos.issues.length)issues++;
    }
    return `預計新增 ${added} 筆｜略過 ${skipped} 筆｜更新 ${updated} 筆｜數量異常 ${issues} 筆`;
  }
  function setPosChoices(value,button) {
    if(staged?.type!=='pos')return;
    for(const index of staged.items)staged.choices.set(index,value);
    renderPreview();
    byId('casePreview').querySelector('[data-case-action="'+button+'"]')?.focus();
  }
  function quotationForm(p) {
    return `<section class="case-section"><h4>內部系統報價單 PDF</h4>
      <p class="case-meta">請核對客戶資訊及已儲存的逐項銷售單價。</p>
      <form id="caseQuotationForm">
        <div class="case-fields">
          ${field('buyer','客戶名稱',p.merchant,'text','required')}${field('no','報價單號',p.quote,'text','required maxlength="80"')}
          ${field('issuer','報價公司','順立智慧股份有限公司','text','required')}
          ${field('date','報價日期',formatToday().replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),'date','required')}
          ${field('expires','有效期限','','date')}${field('buyerTaxId','客戶統一編號')}
          ${field('contact','客戶聯絡人',p.contact)}${field('phone','客戶聯絡電話',p.phone,'tel')}
          ${field('address','客戶地址',p.address)}${field('email','客戶電子郵件','','email')}
          ${field('issuerContact','報價窗口')}
          <label>報價備註<textarea name="notes" rows="3"></textarea></label>
        </div>
        <button class="case-btn primary" type="submit">產生 PDF 預覽</button>
      </form>
      <div id="caseQuoteResult" class="case-quote-result" hidden>
        <div class="case-actions">
          <a class="case-btn" id="caseQuoteOpen" target="_blank" rel="noopener">開啟 PDF</a>
          <a class="case-btn primary" id="caseQuoteDownload">下載 PDF</a>
        </div>
        <iframe id="caseQuoteFrame" title="報價單 PDF 預覽"></iframe>
      </div></section>`;
  }
  function vendorFileControl(vendor,kind,label,replaceKey='',disabled=false) {
    return `<label class="case-doc-file"><span>${e(label)}</span>
      <input type="file" accept=".pdf,application/pdf" data-doc-vendor="${e(vendor)}"
        data-doc-kind="${e(kind)}" data-doc-replace="${e(replaceKey)}" ${disabled?'disabled':''}></label>`;
  }
  function vendorSection(c) {
    const docs=VendorDocs.documents(c);
    return `<section class="case-section" aria-label="廠商交易文件">
      <h4>${uiIcon('receipt-text')} 廠商銷貨單與發票</h4>
      <div class="case-doc-grid">${Cases.vendors.flatMap(vendor=>VendorDocs.kinds.map(kind=>{
        const canImport=Cases.hasVendor(c,vendor);
        const entries=docs.filter(d=>d.vendor===vendor&&d.kind===kind);
        return `<div class="case-doc-card">
          <strong>${e(vendor+' '+kind)}</strong>
          <div class="case-meta">${canImport?(entries.length?'已保存 '+entries.length+' 份':'尚未匯入'):'此案件沒有此廠商的設備'}</div>
          ${entries.map(d=>`<div class="case-doc-saved"><strong>${e(d.name)} · PDF</strong>
            <span class="case-meta">${e(d.parsed.id)} · ${d.parsed.warnings.length||d.pair?.issues?.length?'部分欄位待核對':'已配對'}</span>
            <div class="case-actions">
            <button type="button" class="case-btn" data-doc-inspect="${e(d.key)}">查看結果</button>
            ${d.archiveKey?`<button type="button" class="case-btn" data-doc-download="${e(d.key)}">下載原始 PDF</button>`:''}
            <button type="button" class="case-btn" data-doc-remove="${e(d.key)}">${uiIcon('trash')} 移除</button>
            </div>${vendorFileControl(vendor,kind,'替換這份文件',d.key,!canImport)}</div>`).join('')}
          </div>`;
      })).join('')}</div>
      <details${vendorPreview&&!vendorPreview.saved?' open':''}><summary>單筆補件（PDF）</summary>
        <div class="case-doc-grid">${Cases.vendors.flatMap(vendor=>VendorDocs.kinds.map(kind=>
          vendorFileControl(vendor,kind,vendor+' '+kind+' PDF','',!Cases.hasVendor(c,vendor)))).join('')}</div>
      </details>
      <div id="caseVendorPreview"></div>
      </section>`;
  }
  function renderVendorPreview() {
    const node=byId('caseVendorPreview'), c=order(), pending=vendorPreview;
    if(!node)return;
    if(!pending||pending.caseId!==c?.id){node.innerHTML='';return;}
    if(!pending.doc){
      node.innerHTML=`<div class="case-doc-card"><strong>${e(pending.name)} · ${e(pending.vendor)} ${e(pending.kind)}</strong>
        <p class="${pending.error?'case-warning':'case-meta'}">${e(pending.error||'正在解析 PDF…')}</p></div>`;return;
    }
    const d=pending.doc;
    const stored=pending.saved?VendorDocs.documents(c).find(ref=>ref.key===d.key):null;
    const warnings=[...new Set([...d.warnings,...(stored?.pair?.issues||[])])];
    const matchKey=stored?.pair?.key?JSON.parse(stored.pair.key).slice(1).join(' '):'';
    const invoice=VendorDocs.invoiceFields(state,c,d);
    let evidence=[], problem='';
    try{evidence=VendorDocs.association(state,c,d);}
    catch(err){problem=err.message;}
    const fields=[['文件單號',d.id],['銷貨／出貨單號',d.shipNo],['銷貨／出貨日期',d.shipDate],
      ['發票號碼',invoice.no],['發票日期',invoice.date],['廠商訂單單號',d.orderNo],
      ['帳款客戶',d.buyer],['買方統編',d.buyerId||''],['賣方統編',d.sellerId||''],
      ['收件／轉寄資訊',d.recipient],['未稅',d.net],['稅額',d.tax],['含稅',d.gross]];
    const cell=value=>e(value===null||value===''?'—':String(value));
    node.innerHTML=`<div class="case-doc-card case-doc-preview">
      <strong>${e(d.vendor)} ${e(d.kind)} · ${e(d.name)} · PDF</strong>
      <p class="case-meta">${VendorDocs.pageLabel(d.pages)?'第 '+VendorDocs.pageLabel(d.pages)+' 頁 · ':''}${pending.saved?'已保存':'待確認'} · 案件 ${e(labelFor(c))}</p>
      <p class="${problem?'case-warning':'case-meta'}">${e(problem || evidence.join('；') || '缺少可直接核對的案件識別。請拿原件核對收件、品項及案件後再確認。')}</p>
      ${matchKey?`<p class="case-meta">配對依據 ${e(stored.pair.orderFallback?'訂單單號 '+stored.pair.orderFallback:matchKey)} · ${stored.pair.related?.length||0} 份關聯附件</p>`:''}
      ${invoice.ambiguous?'<p class="case-warning">此單據有多張相符發票，請查看各筆發票。</p>':
        invoice.no!==d.invoiceNo||invoice.date!==d.invoiceDate?`<p class="case-meta">已帶入關聯發票或人工修正資訊。原始辨識值 ${e(d.invoiceNo||'—')} ｜ ${e(d.invoiceDate||'—')}</p>`:''}
      ${warnings.length?`<p class="case-warning">${e(warnings.join('；'))}</p>`:''}
      <dl class="case-doc-values">${fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${cell(value)}</dd></div>`).join('')}</dl>
      <div id="caseVendorItems"></div>
      ${!pending.saved?`<form id="caseVendorConfirm">
        <label class="case-tick"><input type="checkbox" name="confirmed" required>已核對文件屬於此案件及供應商</label>
        ${d.invoiceReady?`<label class="case-tick"><input type="checkbox" name="linkInvoice" checked>將發票欄位帶入請款前整理，設備與金額仍需核對</label>`:''}
        <div class="case-actions"><button type="submit" class="case-btn primary" ${problem?'disabled':''}>${pending.replaceKey?'確認替換':'確認關聯'}</button>
          <button type="button" class="case-btn" data-case-action="cancel-doc">取消</button></div>
        </form>`:`<button type="button" class="case-btn" data-case-action="cancel-doc">關閉預覽</button>`}
      </div>`;
    renderVendorItems();
  }
  function renderVendorItems() {
    const node=byId('caseVendorItems'), d=vendorPreview?.doc;
    if(!node||!d)return;
    const page=vendorPreview.page||0, size=25, from=page*size;
    const cell=value=>e(value===null||value===''?'—':String(value));
    node.innerHTML=d.items.length?`<div class="erp-table-shell"><div id="caseDocTable" class="case-table-scroll table-viewport" tabindex="0" aria-label="廠商品項預覽">
      <table class="case-table"><thead><tr>${['品名／規格','產品編號','數量','單位','單價','未稅','含稅'].map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead>
      <tbody>${d.items.slice(from,from+size).map(i=>`<tr>${[i.name,i.code,i.quantity,i.unit,i.unitPrice,i.net,i.gross].map(value=>`<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <button type="button" id="caseDocTableGrip" class="erp-resize" aria-controls="caseDocTable" aria-label="調整表格高度。可拖曳、點按或用方向鍵微調">${uiIcon('grip')}</button></div>
      ${d.items.length>size?`<div class="case-preview-pager"><button type="button" class="case-btn" data-doc-page="${page-1}" ${page===0?'disabled':''}>上一頁</button>
        <span>${from+1}–${Math.min(from+size,d.items.length)}／${d.items.length} 筆</span>
        <button type="button" class="case-btn" data-doc-page="${page+1}" ${from+size>=d.items.length?'disabled':''}>下一頁</button></div>`:''}`:'';
    const table=byId('caseDocTable');
    if(table?.style)initTableGrip(byId('caseDocTableGrip'),table);
  }
  async function readVendorDocument(file,vendor,kind,replaceKey) {
    const c=order();
    if(!c||!Cases.hasVendor(c,vendor))throw Error('請先確認目前案件含有此供應商的設備。');
    if(!replaceKey){await runBatch([file],vendor,kind);return;}
    vendorPreview={caseId:c.id,name:file.name,vendor,kind,replaceKey,file};
    renderVendorPreview();
    try{
      vendorPreview.doc=await VendorDocs.read(file,vendor,kind);
      status('PDF 解析完成，請核對文件預覽。');
    }catch(err){
      vendorPreview.error=err.message;
      throw err;
    }finally{renderVendorPreview();}
  }
  function renderDetail() {
    clearQuoteResult();
    const node = byId('caseDetail');
    const c = order();
    node.hidden = !c;
    if (!c) { node.innerHTML = ''; return; }
    const p = c.pos, partner = Cases.desc(c, '拍檔'), messages = Cases.orderMessages(c);
    const cv = Cases.vendors.filter(v => Cases.hasVendor(c, v));
    const bill = cv.flatMap(v => Cases.invoiceLinks(state, c, v).map(entry => ({...entry, vendor: v})));
    const hints=new Map();
    const formVendor=cv.at(-1);
    for(const {parsed:d} of VendorDocs.documents(c)){
      if(d.vendor===formVendor&&d.kind==='銷貨單'&&d.invoiceNo&&d.invoiceDate&&
        !bill.some(({inv})=>inv.vendor===d.vendor&&(inv.no===d.invoiceNo||inv.corrections?.some(x=>x.from.no===d.invoiceNo)))){
        hints.set(d.invoiceNo+' '+d.invoiceDate,d);
      }
    }
    const hint=hints.size===1?[...hints.values()][0]:null;
    const sale = Cases.salesCandidates(state, c).sales;
    node.innerHTML = `<div class="case-detail-top">
      <div><h3>${e(p.merchant || '待補公司名稱')}</h3><p>${e(p.quote || '無報價單號')} ｜ SHOP ID ${e(p.shopId || '—')} ｜ 第 ${p.row} 列</p></div>
      <button type="button" class="case-btn" data-case-action="close">關閉詳情</button></div>
      <p id="caseDetailFeedback" class="case-meta" aria-live="polite"></p>
      <p class="case-meta">${e(p.source)} ｜ ${e(p.sheet)}${p.request ? ' ｜ POS 設備請款單號 ' + e(p.request) : ''}</p>
      ${c.purchaseBatch?`<p class="case-meta">採購批次 ${e(c.purchaseBatch.id)}${c.purchaseBatch.parentCaseId?' ｜ 原案件 '+e(c.purchaseBatch.parentCaseId):''}</p>`:''}
      <p>設備：${p.devices.map(d => `${e(d.raw)} × ${d.qty ?? '待確認'}`).join('、') || '—'}</p>
      ${p.issues.length ? `<p class="case-warning">${e(p.issues.join('；'))}。請更正 POS 後補匯入。</p>` : ''}
      ${c.review ? '<p class="case-warning">設備資料已變更。請核對發票設備與單價，再按下方確認。</p><button type="button" class="case-btn" data-case-action="review">已核對更新後的設備資料</button>' : ''}
      ${partner ? `<div class="case-description"><div><strong>拍檔請款描述</strong><p>${e(partner)}</p></div>
      <button type="button" class="case-btn" data-copy="partner">複製描述</button></div>` : ''}
      ${messages.length ? `<section class="case-section"><h4>廠商下單訊息</h4>
        ${messages.map(m => {
          const s = c.orders[m.vendor] || {};
          return `<article class="case-message"><strong>${e(m.vendor)}</strong>
          ${!p.contact || !p.address || !p.phone ? '<span class="case-warning">收件人、電話或地址待補</span>' : ''}
          <div class="case-actions">
          <button type="button" class="case-btn" data-copy="subject" data-vendor="${m.vendor}">複製 Email 主旨</button>
          <button type="button" class="case-btn" data-copy="emailBody" data-vendor="${m.vendor}">複製 Email 內文</button>
          <button type="button" class="case-btn" data-copy="lineMessage" data-vendor="${m.vendor}">複製 LINE 文字</button></div>
          <details><summary>預覽 Email 與 LINE 內容</summary><pre>${e(m.subject + '\n\n' + m.emailBody + '\n\n' + m.lineMessage)}</pre></details>
          <label class="case-tick"><input type="checkbox" data-order="email" data-vendor="${m.vendor}" ${s.email ? 'checked' : ''}>Email 已寄出</label>
          <label class="case-tick"><input type="checkbox" data-order="line" data-vendor="${m.vendor}" ${s.line ? 'checked' : ''} ${!s.email ? 'disabled' : ''}>LINE 已通知</label></article>`;
        }).join('')}</section>` : ''}
      ${vendorSection(c)}
      <div class="case-phase">
      <h4>請款前整理</h4>
      ${cv.length ? `<form id="caseInvoiceForm" data-auto-no="${e(hint?.invoiceNo||'')}" data-auto-date="${e(hint?.invoiceDate||'')}"><div class="case-fields">
      <label>供應商<select name="vendor">${cv.slice().reverse().map(v => option(v,v)).join('')}</select></label>
      ${field('no','採購發票號碼',hint?.invoiceNo||'','text','placeholder="AB12345678" required')}
      ${field('date','發票日期',hint?.invoiceDate||'','date','required')}
      ${field('net','未稅金額','','text','inputmode="decimal" required')}
      ${field('tax','稅額（選填）','','text','inputmode="decimal"')}
      ${field('gross','含稅金額','','text','inputmode="decimal" required')}
      ${field('source','憑證檔名或參考（選填）')}
      </div>${hint?'<p class="case-meta">已帶入銷貨單的發票號碼與日期。正式發票可補入採購金額。</p>':''}
      <div class="case-actions">
      <button class="case-btn primary">儲存發票</button>
      <label class="case-tick"><input type="checkbox" name="replace">更新同號發票資料</label></div>
      </form>` : '<p>此案件沒有華茂或拍檔設備。</p>'}
      ${bill.map(({inv, link, vendor}) => {
        const entries = Cases.invoiceLinks(state, c, vendor);
        const stateLabel = Cases.billStatus(c, inv, link, entries);
        return `<section class="case-bill">
        <details><summary>修正 ${e(inv.no)} 的發票號碼或日期</summary>
          <form data-invoice-correction="${e(inv.key)}">
            <div class="case-fields">${field('no','發票號碼',inv.no,'text','required')}${field('date','發票日期',inv.date,'date','required')}</div>
            <p class="case-meta">修正會更新此憑證及其關聯案件，請款核對狀態會重設。</p>
            <button type="submit" class="case-btn">${uiIcon('square-pen')} 儲存修正</button>
            ${inv.corrections?.length?`<ul>${inv.corrections.map(({from,to,at})=>
              `<li>${e(from.no)} ${e(from.date)} → ${e(to.no)} ${e(to.date)} <time datetime="${e(at)}">${e(at)}</time></li>`).join('')}</ul>`:''}
          </form>
        </details>
        <form data-bill="${e(inv.key)}"><strong>${e(vendor)}・${e(inv.no)}・${e(inv.date)}</strong>
          <p class="case-meta">未稅 ${money(inv.net)} ｜ 稅額 ${money(inv.tax)} ｜ 含稅 ${money(inv.gross)} ｜ ${stateLabel}${inv.source ? ' ｜ ' + e(inv.source) : ''}</p>
          <fieldset><legend>發票對應設備${entries.length === 1 ? '（未指定時採同廠商全部設備）' : ''}</legend>
          ${p.devices.filter(d => vendorForItem(d.item) === vendor && d.qty > 0).map(d =>
            `<label class="case-tick"><input type="checkbox" name="slot" value="${d.slot}" ${link.slots.includes(d.slot) ? 'checked' : ''}>${e(d.raw)} × ${d.qty}</label>`).join('')}
          </fieldset>
          ${(inv.links.length > 1 || inv.everShared) ? `<div class="case-fields">${field('net','此案分配未稅',link.net ?? '')}${field('gross','此案分配含稅',link.gross ?? '')}</div>
            <p class="case-meta">此發票關聯 ${inv.links.length} 案。各案分配加總須等於發票總額。</p>` : ''}
          <label class="case-tick"><input type="checkbox" name="confirmed" ${link.confirmed ? 'checked' : ''}>已核對發票、金額與設備</label>
          <h4>請款後回填</h4>
          <div class="case-fields">${field('pr','實際請款單號',link.pr,'text',p.request ? 'placeholder="' + e(p.request) + '"' : '')}
          ${field('requestDate','請款日期',dateInput(link.requestDate),'date')}
          ${tri('claimed','已請款',link.claimed)}${tri('paid','已撥款',link.paid)}</div>
          <div class="case-actions"><button class="case-btn primary">儲存核對與回填</button>
          <button class="case-btn" type="button" data-detach="${e(inv.key)}">移除此案連結</button></div>
        </form></section>`;
      }).join('')}
      </div>
      <section class="case-section"><h4>報價、銷售發票及附件備註</h4>
        <form id="caseSalesForm">
        <div class="case-fields">${field('no','順立開出發票號碼',c.sale.no || '')}
        ${field('date','銷售發票日期',dateInput(c.sale.date),'date')}</div>
        ${sale.length > 0 ? `<p class="case-meta">報價匯出候選：${sale.map(s => e(s.no + '／' + s.date)).join('、')}</p>` : ''}
        <details><summary>逐項銷售單價（選填）</summary><fieldset><legend>留空時保留原 VK 或已配對的報價</legend>
          ${p.devices.filter(d => d.qty > 0).map(d => {
            const prices = c.sale.lines?.find(l => l.slot === d.slot);
            return `<div class="case-fields sale-prices"><span>${e(d.raw)} × ${d.qty}</span>
                ${field('gross' + d.slot,'含稅單價',prices?.gross ?? '')}${field('net' + d.slot,'未稅單價',prices?.net ?? '')}</div>`;
          }).join('')}
        </fieldset></details>
        <button class="case-btn primary">儲存銷售資料</button></form>
        ${quotationForm(p)}
        <div class="case-fields"><label>附件類別<select id="caseDocKind"><option>銷貨單</option><option>報價</option><option>請款附件</option></select></label>
        <label><span id="caseDocLabel">銷貨單 PDF/Excel</span><input type="file" id="caseDocument" accept=".pdf,.xlsx,.xls"></label></div>
        <ul>${c.docs.filter(d=>!d.parsed).map(d => `<li>${e(d.kind)}・${e(d.name)}${d.summary ? ' ｜ ' + e(d.summary) : ''}</li>`).join('')}</ul>
      </section>
      ${Cases.hasVendor(c, '華茂') ? `<section class="case-section"><h4>華茂對帳資料</h4>
        <form id="caseHuamaoForm"><div class="case-fields">
        ${field('payDate','預計撥款日',dateInput(c.bills['華茂']?.payDate),'date')}
        ${field('statement','對帳單',c.bills['華茂']?.statement || '')}${field('notes','備註',c.bills['華茂']?.notes || '')}
        </div><button class="case-btn primary">儲存華茂對帳資料</button></form>
      </section>` : ''}`;
    renderVendorPreview();
  }
  function render() {
    indexCases();
    indexBills();
    renderList();
    renderDetail();
    renderPreview();
    scheduleOrderPreview();
    byId('caseSapSource').textContent=state.sap?'SAP資料庫已載入（'+state.sap.rows.length+' 列）':'Excel 檔，讀取指定的 VK SAP 工作表';
  }
  function clearPosFile() {
    posImport=null;
    byId('casePosRange').hidden=true;
  }
  function preparePosRange(name, rows, quick) {
    const first=rows[0].row, last=rows.at(-1).row;
    posImport={name,rows,first,last,quick};
    for(const [id,value] of [['casePosFrom',first],['casePosTo',last]]){
      const input=byId(id);
      input.min=first; input.max=last; input.value=String(value);
    }
    byId('casePosRangeInfo').textContent=`${name} · 可選 Excel 第 ${first} 至 ${last} 列（含起訖列）`;
    byId('casePosRange').hidden=false;
    byId('casePosFrom').focus?.();
    status('請選擇列範圍，再按「匯入所選列」。');
  }
  async function applyPosRange() {
    if(!posImport) return;
    const {name,rows,first,last,quick}=posImport;
    const from=Number(byId('casePosFrom').value), to=Number(byId('casePosTo').value);
    staged=null;
    renderPreview();
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<first||to>last||to<from){
      throw Error(`請填寫第 ${first} 至 ${last} 列之間的整數，起始列須小於或等於結束列。`);
    }
    const within=rows.filter(p=>p.row>=from&&p.row<=to);
    if(!within.length)throw Error('選定的列範圍沒有可匯入的資料。');
    const preview=Cases.previewPos(state,within);
    const counts={new:0,same:0,conflict:0},items=[];
    preview.forEach((r,i)=>{counts[r.type]++;if(r.type==='conflict')items.push(i);});
    staged={type:'pos',name,rows:preview,page:0,counts,items,choices:new Map(),from,to};
    if(quick&&!items.length)return commit();
    renderPreview();
    byId('casePreview').scrollTop=0;
    byId('casePreview').focus?.();
    status('請核對預覽，再按「確認匯入」。');
  }
  async function importExcel(file, type, quick=false) {
    if (!file) return;
    const c = order();
    clearPosFile();
    staged = null;
    renderPreview();
    const token=++stageToken;
    const vendor=byId('caseImportVendor').value;
    if(type==='request'){
      if(!c)throw Error('先在案件列表按「查看」，再匯入請款單匯出.xlsx。');
      if(!Cases.hasVendor(c,vendor))throw Error('此案件沒有此供應商的設備。');
    }
    const projected=await ImportIO.excel(file,type,vendor);
    if(token!==stageToken)return;
    if(type==='pos'){preparePosRange(file.name,projected,quick);return;}
    const data=type==='sap'?projected:null;
    let rows=type==='sap'?data.rows:projected;
    if(type==='request'){
      const known = new Set(Cases.invoiceLinks(state, c, vendor).map(x => x.inv.no));
      rows = rows.filter(r =>
        vendor !== '拍檔' || (r.taxId !== '27632985' && !/^華茂/.test(r.memo))).filter(r =>
        vendor !== '華茂' || !/^拍檔/.test(r.memo)).map(r => ({
        ...r, suggested: (!!r.quote && Cases.quoteKey(r.quote) === Cases.quoteKey(c.pos.quote)) ||
          known.has(clean(r.no).toUpperCase()) || (r.pr && r.pr === c.pos.request && Cases.vendors.filter(v => Cases.hasVendor(c, v)).length === 1)
      }));
    }
    if (!rows?.length) throw Error('這個檔案沒有可匯入的資料。');
    const items=[],choices=new Map();
    if(type==='request')rows.forEach((r,i)=>{items.push(i);if(r.suggested)choices.set(i,true);});
    staged={type,name:file.name,rows,data,caseId:c?.id,page:0,items,choices};
    renderPreview();
    status('已讀取檔案，請核對預覽後確認匯入。');
  }
  async function commit() {
    if (!staged) return;
    const {type,rows,data,caseId,choices}=staged;
    // Only the branches touched by the import need an isolated copy.
    const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
    const next={...state};
    if(type==='pos'){
      const updates=new Set([...choices.values()].filter(v=>v.startsWith('case:')).map(v=>v.slice(5)));
      next.cases=state.cases.map(c=>updates.has(c.id)?clone(c):c);
      if(updates.size)next.invoices=state.invoices.map(inv=>inv.links.some(l=>updates.has(l.caseId))?clone(inv):inv);
      Cases.commitPos(next,rows,choices);
    }
    if (type === 'sap') next.sap = data;
    if (type === 'quote') {
      next.quotes=state.quotes.slice();
      const signature = ({source, ...r}) => JSON.stringify(r);
      const known = new Set(next.quotes.map(signature));
      for (const r of rows) {
        const key = signature(r);
        if (!known.has(key)) { known.add(key); next.quotes.push(r); }
      }
    }
    if (type === 'request') {
      const c = next.cases.find(c => c.id === caseId);
      next.invoices=clone(state.invoices);
      const chosen=[...choices.keys()].sort((a,b)=>a-b).map(i=>rows[i]);
      if (!chosen.length) throw Error('請先勾選要匯入此案件的列。');
      for (const r of chosen) {
        const inv = next.invoices.find(i => i.vendor === r.vendor && i.no === clean(r.no).toUpperCase());
        const incoming = {...r, net: r.net || inv?.net, gross: r.gross || inv?.gross, date: r.date || inv?.date};
        const savedInvoice = Cases.attachInvoice(next, c, incoming);
        const link = savedInvoice.links.find(l => l.caseId === c.id);
        const prDate = Cases.date(r.requestDate);
        if ((r.pr && link.pr && r.pr !== link.pr) || (prDate && link.requestDate && prDate !== link.requestDate)) {
          throw Error('此發票已回填不同請款單號或日期，請在案件詳情核對。');
        }
        link.pr = link.pr || r.pr;
        link.requestDate = link.requestDate || prDate;
      }
    }
    Cases.restore(next);
    state = next;
    showOrders=false;
    if(type==='pos')clearPosFile();
    staged = null;
    changed();
    render();
    status('匯入完成。請勾選要處理的案件。');
    if(type==='pos')await runQueuedFiles();
  }
  function downloadWork() {
    const blob = new Blob([JSON.stringify({data: state, selected: [...selected]}, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'POS案件工作檔_' + formatToday() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    saved();
    status('已要求下載案件工作檔。');
  }
  async function loadWork(file) {
    validateFile(file, ['json']);
    if (dirty && !confirm('目前有未下載的更新。載入工作檔並取代目前工作區？')) return;
    const work=await ImportIO.excel(file,'work');
    const next=work.data;
    state = next;
    batchItems=[];pendingDocuments=[];batchView='';batchPage=0;showOrders=false;
    renderBatch();
    const ids = new Set(state.cases.map(c => c.id));
    selected.clear();
    if (Array.isArray(work.selected)) for (const id of work.selected) if (ids.has(id)) selected.add(id);
    clearPosFile();
    vendorPreview=null;
    current = ''; staged = null; filterPage = 0;
    saved();
    render();
    status('已載入 ' + state.cases.length + ' 個案件。');
    await runQueuedFiles();
  }
  async function copy(text) {
    if (!text) throw Error('目前沒有可複製的內容。');
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      let ok=false;
      try { area.select(); ok=document.execCommand?.('copy'); }
      finally { area.remove(); }
      if (!ok) throw Error('無法使用剪貼簿，請從頁面的預覽選取、複製。');
    }
    status('已複製到剪貼簿。');
  }
  function checkBills() {
    const orders = focused();
    if (!orders.length) throw Error('先勾選要處理的案件。');
    return orders;
  }
  function scheduleOrderPreview() {
    orderDirty=true;
    byId('caseOrderFeedback').textContent='';
    if(!showOrders||orderFrame)return;
    if(typeof requestAnimationFrame!=='function'){drawOrderPreview();return;}
    orderFrame=requestAnimationFrame(()=>{orderFrame=0;drawOrderPreview();});
  }
  function selectedOrders() {
    if(orderDirty){
      ordersByVendor=new Map();
      for(const c of focused())for(const msg of Cases.orderMessages(c)){
        if(!ordersByVendor.has(msg.vendor))ordersByVendor.set(msg.vendor,[]);
        ordersByVendor.get(msg.vendor).push(msg);
      }
      orderDirty=false;
    }
    return ordersByVendor;
  }
  function drawOrderPreview() {
    const node=byId('caseOrderPreview'), groups=selectedOrders();
    node.innerHTML=[...groups].map(([vendor,messages])=>{
      const {to,cc}=vendorRecipients(vendor), {subject,body,line}=vendorCommunication(vendor,messages);
      const addresses=list=>e(list.map(([name,address])=>name?name+' <'+address+'>':address).join('、')||'—');
      return `<section class="case-order-group">
        <div class="case-detail-top"><h4>${e(vendor)} · ${messages.length} 筆</h4>
        </div>
        <dl class="erp-order-contacts"><div><dt>To</dt><dd>${addresses(to)}</dd></div><div><dt>CC</dt><dd>${addresses(cc)}</dd></div></dl>
        <div class="erp-communications">
          <div class="erp-channel"><strong>${uiIcon('mail')} Email</strong>
            <label>主旨<input readonly aria-label="${e(vendor)} Email 主旨" value="${e(subject)}"></label>
            <label>內文<textarea readonly rows="7" aria-label="${e(vendor)} Email 內文">${e(body)}</textarea></label>
            <div class="case-actions">
              <button type="button" class="case-btn" data-order-copy="${e(vendor)}" data-channel="email">${uiIcon('copy')} 複製 Email</button>
              <button type="button" class="case-btn" data-order-copy="${e(vendor)}" data-channel="subject">複製主旨</button>
              <button type="button" class="case-btn" data-order-copy="${e(vendor)}" data-channel="body">複製內文</button>
              <button type="button" class="case-btn primary" data-order-gmail="${e(vendor)}">${uiIcon('brand-gmail')} 使用 Gmail 撰寫</button>
              <a class="case-btn" href="https://mail.google.com/mail/" target="_blank" rel="noopener noreferrer">手動開啟 Gmail</a>
            </div></div>
          <div class="erp-channel"><strong>${uiIcon('brand-line')} LINE</strong>
            <label>下單文字<textarea readonly rows="9" aria-label="${e(vendor)} LINE 下單文字">${e(line)}</textarea></label>
            <button type="button" class="case-btn" data-order-copy="${e(vendor)}" data-channel="line">${uiIcon('copy')} 複製 LINE</button>
          </div></div></section>`;
    }).join('')||'<p class="case-meta">勾選有有效設備的案件後，可依供應商取得下單文字。</p>';
  }
  async function copyOrders(vendor,channel) {
    const feedback=byId('caseOrderFeedback');
    try {
      const data=vendorCommunication(vendor,selectedOrders().get(vendor)||[]);
      await copy(channel==='email'?[data.subject,data.body].join('\n\n'):data[channel]);
      feedback.textContent='已複製 '+vendor+' 的'+(channel==='line'?' LINE':' Email')+'文字。';
    } catch(err) {
      feedback.textContent=err.message;
    }
  }
  function openVendorGmail(vendor) {
    const feedback=byId('caseOrderFeedback');
    try{
      const messages=selectedOrders().get(vendor);
      if(!messages?.length)throw Error('請先勾選有效的下單案件。');
      const {to,cc}=vendorRecipients(vendor);
      const emails=list=>list.map(([,address])=>address).join(',');
      const {subject,body}=vendorCommunication(vendor,messages);
      const url=gmailComposeUrl(emails(to),subject,body,emails(cc));
      window.open(url,'_blank','noopener,noreferrer');
      feedback.textContent='已要求開啟 Gmail。請檢查登入帳號與信件內容，再於 Gmail 寄送。';
    }catch(err){feedback.textContent=err.message;}
  }
  function clearQuoteResult() {
    if(!quoteUrl)return;
    URL.revokeObjectURL(quoteUrl);
    quoteUrl='';
    byId('caseQuoteResult').hidden=true;
    byId('caseQuoteFrame').removeAttribute('src');
  }
  async function buildQuotation(form,c) {
    clearQuoteResult();
    const fields=Object.fromEntries(new FormData(form));
    const quote=Cases.quotationDocument(state,c,fields);
    const bytes=await QuotePDF.create(quote);
    if(form!==byId('caseQuotationForm')||order()!==c)return;
    if(Object.keys(fields).some(key=>form.elements[key].value!==fields[key])){
      status('報價資料已變更，請重新產生 PDF。');
      return;
    }
    quoteUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    byId('caseQuoteFrame').src=quoteUrl;
    byId('caseQuoteOpen').href=quoteUrl;
    const download=byId('caseQuoteDownload');
    download.href=quoteUrl;
    download.download='報價單_'+quote.no.replace(/[\\/:*?"<>|\x00-\x1F]/g,'_')+'.pdf';
    byId('caseQuoteResult').hidden=false;
    status('已產生報價單 PDF，可預覽或下載。');
  }
  function write(book, label) {
    XLSX.writeFile(book, label + '_' + formatToday() + '.xlsx');
    status('已要求下載「' + label + '」。');
  }
  const exports={
    partner:orders=>write(Cases.billWorkbook(state,orders),'拍檔請款彙整'),
    'partner-ready':orders=>write(Cases.billWorkbook(state,orders,true),'拍檔請款_可填請款'),
    hm:orders=>write(Cases.huamaoWorkbook(state,orders,Cases.date(byId('casePayDate').value)),'華茂款項匯入資訊'),
    sap:orders=>write(Cases.sapWorkbook(state,orders),'SAP_Key-in準備表')
  };
  function closeDetail() {
    current='';vendorPreview=null;
    updateActiveRow();renderDetail();
    if(detailOpener?.isConnected)detailOpener.focus();
    detailOpener=null;
  }
  async function readDoc(file) {
    const c = order();
    if (!c || !file) return;
    const kind = byId('caseDocKind').value;
    let summary = '';
    if (/\.pdf$/i.test(file.name)) {
      const pages = await readPdfRecords(file, (text, _, page) => ({page, text: clean(text)}));
      const content = pages.map(p => p.text).filter(Boolean).join(' ');
      if (kind === '銷貨單' && content) {
        const sales = pages.map(p => extractSalesRecordFromText(p.text, file.name, p.page));
        summary = sales.slice(0, 3).map(s => [s.銷貨單號, s.發票號碼, s.總計].filter(Boolean).join('／')).join('、');
      } else if (kind === '報價' && content) {
        const quote = content.match(/\bQU\d{11}\b/i)?.[0];
        if (quote && Cases.quoteKey(quote) !== Cases.quoteKey(c.pos.quote)) throw Error('PDF 報價單號 ' + quote + ' 與目前案件不同。');
        summary = quote || '待核對報價欄位';
      }
      if (!content) summary = '掃描文件，待人工核對';
    } else {
      const records=await ImportIO.excel(file,kind==='報價'?'quote':'attachment');
      if(kind==='報價'){
        const rows=records.filter(r=>Cases.quoteKey(r.quote)===Cases.quoteKey(c.pos.quote));
        if (!rows.length) throw Error('Excel 內找不到此案件的報價單號。');
        for (const r of rows) if (!state.quotes.some(old => JSON.stringify(old) === JSON.stringify(r))) state.quotes.push(r);
        summary = '已補入 ' + rows.length + ' 筆報價資料';
      }
    }
    if (!c.docs.some(d => d.kind === kind && d.name === file.name)) c.docs.push({kind, name: file.name, summary});
    changed(); render(); status('已加入附件參考。');
  }
  root.addEventListener('input',event=>{
    if(staged?.type==='pos'&&['casePosFrom','casePosTo'].includes(event.target.id)){
      staged=null;
      renderPreview();
      status('列範圍已變更，請重新套用。');
    }
    if(event.target.form?.id==='caseQuotationForm')clearQuoteResult();
    if(!event.isComposing&&['caseSearch','caseFirstRow','caseLastRow'].includes(event.target.id))scheduleFilter();
  });
  root.addEventListener('compositionend',event=>{
    if(event.target.id==='caseSearch')scheduleFilter();
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (busy) return;
    if(target.id==='caseBatchFiles'){
      const batch=Array.from(target.files||[]);
      target.value='';
      action(()=>importBatch(batch));
      return;
    }
    const files = {casePos: 'pos', caseQuote: 'quote', caseSap: 'sap', caseRequests: 'request'};
    const upload = target.files?.[0];
    if (upload) {
      target.value = '';
      if (files[target.id]) action(() => importExcel(upload, files[target.id]));
      if (target.id === 'caseWork') action(() => loadWork(upload));
      if(target.dataset?.docVendor)action(()=>readVendorDocument(upload,target.dataset.docVendor,target.dataset.docKind,target.dataset.docReplace));
      if (target.id === 'caseDocument') action(() => readDoc(upload));
    } else if (target.id === 'caseSelectPage') {
      for(const c of visibleCases){
        if (target.checked) selected.add(c.id); else selected.delete(c.id);
      }
      changed(); renderSelection();
    } else if (target.dataset.select) {
      if (target.checked) selected.add(target.dataset.select); else selected.delete(target.dataset.select);
      changed(); renderSelection();
    } else if(staged&&target.dataset.choice!==undefined){
      const i=Number(target.dataset.choice);
      staged.choices.set(i,target.value);
      const entry=staged.rows[i];
      const comparison=byId('casePreview').querySelector('[data-candidate="'+i+'"]');
      if(comparison)comparison.innerHTML=comparePos(entry,target.value);
      byId('casePosDecisions').textContent=posDecisions();
    } else if(staged&&target.dataset.requestChoice!==undefined){
      const i=Number(target.dataset.requestChoice);
      if(target.checked)staged.choices.set(i,true);else staged.choices.delete(i);
      byId('casePickedRequests').textContent=staged.choices.size;
    } else if(target.id==='caseDocKind'){
      byId('caseDocLabel').textContent=target.value==='報價'?'內部系統報價單 PDF/Excel':target.value+' PDF/Excel';
    } else if (target.dataset.order) {
      const c = order(), v = target.dataset.vendor;
      const s = c.orders[v] ||= {};
      if (target.dataset.order === 'email') { s.email = target.checked; if (!s.email) s.line = false; }
      if (target.dataset.order === 'line' && s.email) s.line = target.checked;
      changed();
      const line = target.closest('.case-message').querySelector('[data-order="line"]');
      line.checked = Boolean(s.line); line.disabled = !s.email;
    } else if (['caseVendor','caseStateFilter','caseDocumentFilter'].includes(target.id)) {
      filterPage = 0; renderList();
    } else if(target.form?.id==='caseInvoiceForm'&&target.name==='vendor'){
      const {elements,dataset}=target.form;
      if(dataset.autoNo&&elements.no.value===dataset.autoNo)elements.no.value='';
      if(dataset.autoDate&&elements.date.value===dataset.autoDate)elements.date.value='';
    } else if(target.id==='caseExportKind'){
      byId('casePayDateLabel').hidden=target.value!=='hm';
    }
  });
  root.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || busy) return;
    if(b.dataset.batchView){
      batchView=batchView===b.dataset.batchView?'':b.dataset.batchView;
      batchPage=0;renderBatch();
      return;
    }
    if(b.dataset.batchPage){
      batchPage+=Number(b.dataset.batchPage);renderBatch();
      return;
    }
    if(b.dataset.orderCopy){action(()=>copyOrders(b.dataset.orderCopy,b.dataset.channel));return;}
    if(b.dataset.orderGmail){openVendorGmail(b.dataset.orderGmail);return;}
    if(b.dataset.docPage!==undefined){
      const page=Number(b.dataset.docPage);
      if(vendorPreview?.doc&&Number.isInteger(page)&&page>=0&&page*25<vendorPreview.doc.items.length){
        vendorPreview.page=page;renderVendorItems();
      }
      return;
    }
    if(b.dataset.docInspect){
      const c=order(), d=c&&VendorDocs.documents(c).find(d=>d.key===b.dataset.docInspect);
      if(d){vendorPreview={caseId:c.id,doc:d.parsed,saved:true};renderVendorPreview();}
      return;
    }
    if(b.dataset.docDownload){
      action(async()=>{
        const d=VendorDocs.documents(order()).find(ref=>ref.key===b.dataset.docDownload);
        if(!d?.archiveKey)throw Error('找不到原始 PDF。');
        const file=await VendorDocs.original(d.archiveKey);
        if(!file)throw Error('這個瀏覽器沒有原始 PDF。請從原匯入裝置下載。');
        const url=URL.createObjectURL(file);
        const link=document.createElement('a');
        link.href=url;
        link.download=d.name;
        link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      });
      return;
    }
    if(b.dataset.docRemove){
      const c=order(), d=c&&VendorDocs.documents(c).find(d=>d.key===b.dataset.docRemove);
      if(d&&confirm('移除這份文件？已儲存的發票或回填可在請款前整理個別管理。')){
        c.docs.splice(c.docs.indexOf(d),1);vendorPreview=null;changed();renderList();renderDetail();
        status('已移除文件參考。');
      }
      return;
    }
    if (b.dataset.open) {
      detailOpener=b;
      vendorPreview=null;
      current=b.dataset.open; updateActiveRow(); renderDetail();
      byId('caseDetail').focus?.();
      return;
    }
    if (b.dataset.copy) {
      action(() => {
        const c = order();
        const v = b.dataset.copy === 'partner' ? Cases.desc(c, '拍檔') :
          Cases.orderMessages(c).find(m => m.vendor === b.dataset.vendor)?.[b.dataset.copy];
        return copy(v);
      });
      return;
    }
    if (b.dataset.detach) {
      if (!confirm('移除此案件的發票與請款回填連結？')) return;
      const inv = state.invoices.find(i => i.key === b.dataset.detach);
      inv.links = inv.links.filter(l => l.caseId !== current);
      if (!inv.links.length) state.invoices = state.invoices.filter(i => i !== inv);
      changed(); render();
    }
    const handlers = {
      'cancel-doc':()=>{vendorPreview=null;renderVendorPreview();},
      'apply-pos-range':applyPosRange,
      'clear-queued-files':()=>{queuedFiles=[];renderQueue();},
      'download-vendor-batch':downloadVendorBatch,
      'pos-add-all':()=>setPosChoices('add','pos-add-all'),
      'pos-skip-all':()=>setPosChoices('skip','pos-skip-all'),
      'clear-pos-file':()=>{clearPosFile();staged=null;renderPreview();status('已取消選檔。');},
      commit, cancel: () => { staged = null; renderPreview(); },
      prev: () => { filterPage--; renderList(); }, next: () => { filterPage++; renderList(); },
      close:closeDetail,
      'preview-prev':()=>{if(staged&&staged.page>0){staged.page--;renderPreview();}},
      'preview-next':()=>{if(staged&&(staged.page+1)*previewSize<staged.items.length){staged.page++;renderPreview();}},
      review: () => { order().review = false; changed(); render(); },
      'select-filter': () => { for(const c of lookup()) selected.add(c.id); changed(); renderSelection(); },
      'clear-select': () => { selected.clear(); changed(); renderSelection(); },
      save: downloadWork,
      'export-selected':async()=>{
        const exportBook=exports[byId('caseExportKind').value];
        if(!exportBook)throw Error('請選擇匯出格式。');
        const orders=checkBills();
        status(`正在整理 ${orders.length} 個案件的 Excel…`);
        await yieldUI();
        exportBook(orders);
      },
      'toggle-order':()=>{
        showOrders=!showOrders;
        renderSelection(lookupCount);
        if(showOrders)drawOrderPreview();
      },
    };
    const handler = handlers[b.dataset.caseAction] ||
      (Object.hasOwn(exports,b.dataset.caseAction)?()=>exports[b.dataset.caseAction](checkBills()):null);
    if (handler) action(handler);
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    if(busy)return;
    if(!order())return;
    if(form.id==='caseQuotationForm'){action(()=>buildQuotation(form,order()));return;}
    action(async () => {
      const c = order();
      const f = new FormData(form);
      if(form.id==='caseVendorConfirm'){
        const pending=vendorPreview;
        if(!pending?.doc||pending.saved||pending.caseId!==c.id||!f.has('confirmed'))throw Error('請先核對文件與目前案件。');
        const archiveKey=await VendorDocs.archive(pending.file).catch(()=> '');
        VendorDocs.save(state,c,pending.doc,pending.replaceKey,f.has('linkInvoice'),false,{archiveKey});
        vendorPreview=null;
        status('已儲存文件關聯。'+(archiveKey?'':'瀏覽器無法保存原始 PDF，請保留原始檔案。')+
          (f.has('linkInvoice')?'請再核對發票金額與設備。':''));
      } else if (form.id === 'caseInvoiceForm') {
        Cases.attachInvoice(state, c, Object.fromEntries(f), f.has('replace'));
        status('已儲存發票。請勾選已核對並儲存。');
      } else if (form.dataset?.invoiceCorrection) {
        Cases.correctInvoice(state,c,form.dataset.invoiceCorrection,{no:f.get('no'),date:f.get('date')});
        status('已儲存發票修正，原始辨識資料已保留。');
      } else if (form.dataset.bill) {
        const inv = state.invoices.find(i => i.key === form.dataset.bill);
        const link = inv.links.find(l => l.caseId === c.id);
        const pr = cleanRequestNo(f.get('pr')), requestDate = Cases.date(f.get('requestDate'));
        if (Boolean(pr) !== Boolean(requestDate)) throw Error('回填請款時，請同時輸入請款單號與日期。');
        const net = Cases.amount(f.get('net')), gross = Cases.amount(f.get('gross'));
        if ((net === null) !== (gross === null) || (gross !== null && gross < net)) throw Error('請確認分配的未稅及含稅金額。');
        const claimed = asTri(f.get('claimed')), paid = asTri(f.get('paid'));
        if (paid && claimed === false) throw Error('已撥款與未請款狀態互相衝突，請核對。');
        if (pr && !f.has('confirmed')) throw Error('請先勾選已核對發票，再回填請款資料。');
        Object.assign(link, {slots: f.getAll('slot').map(Number), confirmed: f.has('confirmed'), pr, requestDate,
          net, gross, claimed, paid});
        status('已儲存發票核對與請款回填。');
      } else if (form.id === 'caseSalesForm') {
        const no = clean(f.get('no')).toUpperCase(), date = Cases.date(f.get('date'));
        if (Boolean(no) !== Boolean(date)) throw Error('銷售發票號碼與日期請一併填寫。');
        if (no && !/^[A-Z]{2}\d{8}$/.test(no)) throw Error('銷售發票號碼格式不符。');
        const lines = c.pos.devices.filter(d => d.qty > 0).map(d => ({
          slot: d.slot, net: Cases.amount(f.get('net' + d.slot)), gross: Cases.amount(f.get('gross' + d.slot))
        })).filter(d => d.net !== null || d.gross !== null);
        if (lines.some(d => d.net !== null && d.gross !== null && d.gross < d.net)) throw Error('含稅單價不可小於未稅單價。');
        c.sale = {no, date, lines};
        status('已儲存銷售發票與報價單價。');
      } else if (form.id === 'caseHuamaoForm') {
        c.bills['華茂'] = {payDate: Cases.date(f.get('payDate')), statement: clean(f.get('statement')), notes: clean(f.get('notes'))};
        status('已儲存華茂對帳資料。');
      }
      const feedback = byId('caseStatus').textContent;
      changed(); render();
      status(feedback);
    });
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&current&&!busy)closeDetail();
  });
  const drop=byId('caseBatchDrop');
  drop.addEventListener('dragover',event=>{
    event.preventDefault();
    if(!busy)drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave',()=>drop.classList.remove('is-dragging'));
  drop.addEventListener('drop',event=>{
    event.preventDefault();
    drop.classList.remove('is-dragging');
    if(!busy)action(()=>importBatch(Array.from(event.dataTransfer.files)));
  });
  render();
  root.setAttribute?.('data-ready','');
})();

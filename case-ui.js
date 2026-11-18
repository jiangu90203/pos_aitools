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
  let posImport = null;
  const pageSize = 30, previewSize = 20, orderSize = 12;
  let quoteUrl='', orderFrame=0, orderPage=0, orderDirty=true, orderMessages=[];
  let caseIndex = new Map(), indexedCases, billsByCase = new Map(), visibleCases = [], filterFrame = 0;
  const order = () => caseIndex.get(current)?.record;
  const partnerEntries = id => billsByCase.get(id) || [];
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
    for(const inv of state.invoices){
      if(inv.vendor!=='拍檔')continue;
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
  function lookup() {
    const query = norm(byId('caseSearch').value);
    const vendor = byId('caseVendor').value;
    const mode = byId('caseStateFilter').value;
    const first = Number(byId('caseFirstRow').value) || 0;
    const last = Number(byId('caseLastRow').value) || Infinity;
    return state.cases.filter(c => {
      if (c.pos.row < first || c.pos.row > last) return false;
      const meta=caseIndex.get(c.id);
      if(query&&!meta.search.some(v=>v.includes(query)))return false;
      if(vendor&&!meta.vendors.includes(vendor))return false;
      if (mode === 'selected') return selected.has(c.id);
      if (mode === 'check') return c.review || c.pos.issues.length > 0 ||
        (meta.vendors.includes('拍檔') && !partnerEntries(c.id).some(x => x.link.confirmed));
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
      const entries=partnerEntries(c.id);
      const flags = p.issues.length || c.review ? '待核對設備' :
        entries.length ? [...new Set(entries.map(({inv, link}) => Cases.billStatus(c, inv, link, entries)))].join('／') :
        meta.vendors.includes('拍檔') ? '待補拍檔發票' : '—';
      return `<tr data-case-row="${e(c.id)}"${c.id === current ? ' class="case-active"' : ''}>
        <td><input type="checkbox" data-select="${e(c.id)}" aria-label="勾選 ${e(labelFor(c))}" ${selected.has(c.id) ? 'checked' : ''}></td>
        <td>${p.row}</td><td>${e(p.quote || '—')}</td><td>${e(p.merchant || '—')}</td>
        <td>${e(tags)}</td><td>${e(flags)}</td>
        <td><button type="button" class="case-btn" data-open="${e(c.id)}">查看</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="case-empty">匯入 POS 檔開始。沒有符合篩選的案件時，可清除搜尋條件。</td></tr>';
  }
  function renderSelection(count) {
    if(count===undefined)scheduleOrderPreview();
    if(count===undefined&&byId('caseStateFilter').value==='selected'){renderList();return;}
    byId('caseCount').textContent=`共 ${state.cases.length} 案｜符合 ${count??lookupCount} 案｜已勾選 ${selected.size} 案`;
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
      ['華茂下單日期', 'hmDate'], ['峰潮下單日期', 'peakDate'], ['備註', 'notes']
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
      contents=`<p class="case-meta">本次範圍：Excel 第 ${staged.from} 至 ${staged.to} 列</p><p>新增 ${counts.new} 筆，重複 ${counts.same} 筆，需決定 ${counts.conflict} 筆。未選擇處理方式的差異將略過。</p>`;
      for(const index of items.slice(start,end)){
        const entry=rows[index];
        const value=choices.get(index)||'';
        contents+=`<div class="case-conflict"><strong>${e(entry.pos.quote)} ${e(entry.pos.merchant)}・新檔第 ${entry.pos.row} 列</strong>
          <div data-candidate="${index}">${comparePos(entry,value)}</div>
          <label>處理方式<select data-choice="${index}">
            ${option('','暫不匯入',value)}${option('add','新增為另一批次',value)}
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
      <button type="button" class="case-btn primary" data-case-action="commit"><span aria-hidden="true">✓</span> ${type==='pos'?'確認匯入':'套用匯入'}</button>
      <button type="button" class="case-btn" data-case-action="cancel">取消</button></div>`;
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
  function renderDetail() {
    clearQuoteResult();
    const node = byId('caseDetail');
    const c = order();
    node.hidden = !c;
    if (!c) { node.innerHTML = ''; return; }
    const p = c.pos, partner = Cases.desc(c, '拍檔'), messages = Cases.orderMessages(c);
    const cv = Cases.vendors.filter(v => Cases.hasVendor(c, v));
    const bill = cv.flatMap(v => Cases.invoiceLinks(state, c, v).map(entry => ({...entry, vendor: v})));
    const sale = Cases.salesCandidates(state, c).sales;
    node.innerHTML = `<div class="case-detail-top">
      <div><h3>${e(p.merchant || '待補公司名稱')}</h3><p>${e(p.quote || '無報價單號')} ｜ SHOP ID ${e(p.shopId || '—')} ｜ 第 ${p.row} 列</p></div>
      <button type="button" class="case-btn" data-case-action="close">關閉詳情</button></div>
      <p id="caseDetailFeedback" class="case-meta" aria-live="polite"></p>
      <p class="case-meta">${e(p.source)} ｜ ${e(p.sheet)}${p.request ? ' ｜ POS 設備請款單號 ' + e(p.request) : ''}</p>
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
      <div class="case-phase">
      <h4>請款前整理</h4>
      ${cv.length ? `<form id="caseInvoiceForm"><div class="case-fields">
      <label>供應商<select name="vendor">${cv.slice().reverse().map(v => option(v,v)).join('')}</select></label>
      ${field('no','採購發票號碼','','text','placeholder="AB12345678" required')}
      ${field('date','發票日期','','date','required')}
      ${field('net','未稅金額','','text','inputmode="decimal" required')}
      ${field('tax','稅額（選填）','','text','inputmode="decimal"')}
      ${field('gross','含稅金額','','text','inputmode="decimal" required')}
      ${field('source','憑證檔名或參考（選填）')}
      </div>
      <div class="case-actions"><label class="case-upload"><span id="caseInvoicePdfLabel">${e(cv.at(-1))}發票 PDF</span><input type="file" id="caseInvoicePdf" accept=".pdf"></label>
      <button class="case-btn primary">儲存發票</button>
      <label class="case-tick"><input type="checkbox" name="replace">更新同號發票資料</label></div>
      <p id="casePdfHint" class="case-meta">PDF 擷取值為候選資料，請對照原始發票確認。</p></form>` : '<p>此案件沒有華茂或拍檔設備。</p>'}
      ${bill.map(({inv, link, vendor}) => {
        const entries = Cases.invoiceLinks(state, c, vendor);
        const stateLabel = Cases.billStatus(c, inv, link, entries);
        return `<form class="case-bill" data-bill="${e(inv.key)}"><strong>${e(vendor)}・${e(inv.no)}・${e(inv.date)}</strong>
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
        </form>`;
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
        <ul>${c.docs.map(d => `<li>${e(d.kind)}・${e(d.name)}${d.summary ? ' ｜ ' + e(d.summary) : ''}</li>`).join('')}</ul>
      </section>
      ${Cases.hasVendor(c, '華茂') ? `<section class="case-section"><h4>華茂對帳資料</h4>
        <form id="caseHuamaoForm"><div class="case-fields">
        ${field('payDate','預計撥款日',dateInput(c.bills['華茂']?.payDate),'date')}
        ${field('statement','對帳單',c.bills['華茂']?.statement || '')}${field('notes','備註',c.bills['華茂']?.notes || '')}
        </div><button class="case-btn primary">儲存華茂對帳資料</button></form>
      </section>` : ''}`;
  }
  function render() {
    indexCases();
    indexBills();
    renderList();
    renderDetail();
    renderPreview();
    scheduleOrderPreview();
    byId('caseSapSource').textContent=state.sap?'SAP資料庫已載入（'+state.sap.rows.length+' 列）':'Excel 檔，讀取指定的 VK SAP 工作表';
    byId('casePartnerCode').value = state.partnerCode || '';
  }
  function clearPosFile() {
    posImport=null;
    byId('casePosRange').hidden=true;
  }
  function preparePosRange(name, rows) {
    const first=rows[0].row, last=rows.at(-1).row;
    posImport={name,rows,first,last};
    for(const [id,value] of [['casePosFrom',first],['casePosTo',last]]){
      const input=byId(id);
      input.min=first; input.max=last; input.value=String(value);
    }
    byId('casePosRangeInfo').textContent=`${name} · 可選 Excel 第 ${first} 至 ${last} 列（含起訖列）`;
    byId('casePosRange').hidden=false;
    byId('casePosFrom').focus?.();
    status('請選擇列範圍，再按「套用範圍」。');
  }
  function applyPosRange() {
    if(!posImport) return;
    const {name,rows,first,last}=posImport;
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
    renderPreview();
    byId('casePreview').scrollTop=0;
    byId('casePreview').focus?.();
    status('請核對預覽，再按「確認匯入」。');
  }
  async function importExcel(file, type) {
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
    if(type==='pos'){preparePosRange(file.name,projected);return;}
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
  function commit() {
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
    if(type==='pos')clearPosFile();
    staged = null;
    changed();
    render();
    status('匯入完成。請勾選要處理的案件。');
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
    const ids = new Set(state.cases.map(c => c.id));
    selected.clear();
    if (Array.isArray(work.selected)) for (const id of work.selected) if (ids.has(id)) selected.add(id);
    clearPosFile();
    current = ''; staged = null; filterPage = 0;
    saved();
    render();
    status('已載入 ' + state.cases.length + ' 個案件。');
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
    orderPage=0;
    byId('caseOrderFeedback').textContent='';
    if(orderFrame)return;
    if(typeof requestAnimationFrame!=='function'){drawOrderPreview();return;}
    orderFrame=requestAnimationFrame(()=>{orderFrame=0;drawOrderPreview();});
  }
  function selectedMessages() {
    if(orderDirty){
      orderMessages=selected.size?focused().flatMap(Cases.orderMessages):[];
      orderDirty=false;
    }
    return orderMessages;
  }
  function orderText(messages) {
    const channel=byId('caseOrderChannel').value||'lineMessage';
    return messages.map(m=>channel==='all'?[m.subject,m.emailBody,m.lineMessage].join('\n\n'):m[channel]).join('\n\n');
  }
  function drawOrderPreview() {
    const node=byId('caseOrderPreview'), messages=selectedMessages();
    if(!messages.length){
      node.innerHTML='<p class="case-meta">'+(selected.size?'已勾選的案件沒有可下單的明細，請先核對設備與數量。':'勾選案件後即可預覽下單文字。')+'</p>';
      return;
    }
    const items=messages.slice(orderPage*orderSize,(orderPage+1)*orderSize);
    node.innerHTML=Cases.vendors.map(vendor=>{
      const count=messages.filter(m=>m.vendor===vendor).length;
      if(!count)return '';
      const visible=items.filter(m=>m.vendor===vendor);
      return `<section class="case-order-group"><div class="case-detail-top"><strong>${e(vendor)} · ${count} 筆</strong>
        <button type="button" class="case-btn" data-order-copy="${e(vendor)}">一鍵複製全部 ${e(vendor)}</button></div>
        ${visible.length?`<textarea readonly rows="6" aria-label="${e(vendor)}下單文字預覽">${e(orderText(visible))}</textarea>`:
        '<p class="case-meta">此頁無此廠商的訊息，可翻頁預覽。</p>'}</section>`;
    }).join('')+(messages.length>orderSize?`<nav class="case-preview-pager" aria-label="下單預覽分頁">
      <button type="button" class="case-btn" data-case-action="order-prev" ${orderPage===0?'disabled':''}>上一頁</button>
      <span>${orderPage+1} ／ ${Math.ceil(messages.length/orderSize)} 頁 · 每次複製包含該廠商所有頁</span>
      <button type="button" class="case-btn" data-case-action="order-next" ${(orderPage+1)*orderSize>=messages.length?'disabled':''}>下一頁</button>
      </nav>`:'');
  }
  async function copyOrders(vendor) {
    const feedback=byId('caseOrderFeedback');
    try {
      await copy(orderText(selectedMessages().filter(m=>m.vendor===vendor)));
      feedback.textContent='已複製 '+vendor+' 的下單文字。';
    } catch(err) {
      feedback.textContent=err.message;
    }
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
  function pdfInvoiceFields(text) {
    // Candidate extraction only. Layouts vary, so a user verifies all four fields.
    const s = clean(text).replace(/\s+/g, ' ');
    const no = s.match(/發\s*票\s*(?:號\s*碼|字\s*軌)\s*[:：]?\s*([A-Z]{2}\s*[- ]?\s*\d{8})/i)?.[1] || '';
    const d = s.match(/(?:發票日期|開立日期|日期)\s*[:：]?\s*((?:20\d{2}|1\d{2})[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2})/)?.[1] || '';
    const readMoney = re => s.match(re)?.[1]?.replace(/,/g, '') || '';
    return {no: no.replace(/[\s-]/g,''), date: dateInput(d.replace(/\s/g,'')),
      net: readMoney(/(?:銷售額合計|未稅金額|未稅合計)\s*[:：]?\s*([\d,]+(?:\.\d{1,2})?)/),
      tax: readMoney(/(?:稅額合計|營業稅額|稅額)\s*[:：]?\s*([\d,]+(?:\.\d{1,2})?)/),
      gross: readMoney(/(?:含稅金額|含稅總計|總計金額|應付總額)\s*[:：]?\s*([\d,]+(?:\.\d{1,2})?)/)};
  }
  async function readInvoicePdf(file) {
    if (!file || !order()) return;
    const original = current, form = byId('caseInvoiceForm');
    const extracted = await readPdfRecords(file, text => ({text, values: pdfInvoiceFields(text)}));
    if (current !== original || form !== byId('caseInvoiceForm')) return;
    const raw = extracted.map(p => p.text).join(' ');
    if (form.elements.vendor.value === '拍檔' && /華\s*茂\s*資\s*訊|27632985/.test(raw)) {
      throw Error('這份 PDF 含華茂資訊，請改選對應供應商或核對原始發票。');
    }
    let count = 0;
    for (const name of ['no','date','net','tax','gross']) {
      const candidates = [...new Set(extracted.map(x => x.values[name]).filter(Boolean))];
      if (candidates.length === 1 && !form.elements[name].value) { form.elements[name].value = candidates[0]; count++; }
    }
    form.elements.source.value = file.name;
    byId('casePdfHint').textContent = count ? '帶入 ' + count + ' 個候選欄位。請對照發票，補齊其餘欄位再儲存。' :
      '此版型未辨識出可帶入的欄位。已帶入檔名，請由原件手動填寫。';
    status('已讀取 PDF，請核對發票表單。');
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
    const files = {casePos: 'pos', caseQuote: 'quote', caseSap: 'sap', caseRequests: 'request'};
    const upload = target.files?.[0];
    if (upload) {
      target.value = '';
      if (files[target.id]) action(() => importExcel(upload, files[target.id]));
      if (target.id === 'caseWork') action(() => loadWork(upload));
      if (target.id === 'caseInvoicePdf') action(() => readInvoicePdf(upload));
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
      if(target.value)staged.choices.set(i,target.value);else staged.choices.delete(i);
      const entry=staged.rows[i];
      const comparison=byId('casePreview').querySelector('[data-candidate="'+i+'"]');
      if(comparison)comparison.innerHTML=comparePos(entry,target.value);
    } else if(staged&&target.dataset.requestChoice!==undefined){
      const i=Number(target.dataset.requestChoice);
      if(target.checked)staged.choices.set(i,true);else staged.choices.delete(i);
      byId('casePickedRequests').textContent=staged.choices.size;
    } else if(target.id==='caseDocKind'){
      byId('caseDocLabel').textContent=target.value==='報價'?'內部系統報價單 PDF/Excel':target.value+' PDF/Excel';
    } else if(target.name==='vendor'&&target.form?.id==='caseInvoiceForm'){
      byId('caseInvoicePdfLabel').textContent=target.value+'發票 PDF';
    } else if (target.dataset.order) {
      const c = order(), v = target.dataset.vendor;
      const s = c.orders[v] ||= {};
      if (target.dataset.order === 'email') { s.email = target.checked; if (!s.email) s.line = false; }
      if (target.dataset.order === 'line' && s.email) s.line = target.checked;
      changed();
      const line = target.closest('.case-message').querySelector('[data-order="line"]');
      line.checked = Boolean(s.line); line.disabled = !s.email;
    } else if (target.id === 'caseVendor' || target.id === 'caseStateFilter') {
      filterPage = 0; renderList();
    } else if(target.id==='caseOrderChannel'){
      byId('caseOrderFeedback').textContent='';
      drawOrderPreview();
    } else if (target.id === 'casePartnerCode') {
      state.partnerCode = clean(target.value); changed();
    }
  });
  root.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || busy) return;
    if(b.dataset.orderCopy){action(()=>copyOrders(b.dataset.orderCopy));return;}
    if (b.dataset.open) {
      current=b.dataset.open; updateActiveRow(); renderDetail();
      byId('caseDetail').scrollIntoView({block:'start',behavior:'auto'});
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
      'apply-pos-range':applyPosRange,
      'clear-pos-file':()=>{clearPosFile();staged=null;renderPreview();status('已取消選檔。');},
      commit, cancel: () => { staged = null; renderPreview(); },
      prev: () => { filterPage--; renderList(); }, next: () => { filterPage++; renderList(); },
      close:()=>{current='';updateActiveRow();renderDetail();},
      'preview-prev':()=>{if(staged&&staged.page>0){staged.page--;renderPreview();}},
      'preview-next':()=>{if(staged&&(staged.page+1)*previewSize<staged.items.length){staged.page++;renderPreview();}},
      review: () => { order().review = false; changed(); render(); },
      'select-filter': () => { for(const c of lookup()) selected.add(c.id); changed(); renderSelection(); },
      'clear-select': () => { selected.clear(); changed(); renderSelection(); },
      save: downloadWork,
      partner: () => write(Cases.billWorkbook(state, checkBills()), '拍檔請款彙整'),
      'partner-ready': () => write(Cases.billWorkbook(state, checkBills(), true), '拍檔請款_可填請款'),
      hm: () => write(Cases.huamaoWorkbook(state, checkBills(), Cases.date(byId('casePayDate').value)), '華茂款項匯入資訊'),
      sap: () => write(Cases.sapWorkbook(state, checkBills()), 'SAP_Key-in準備表'),
      'order-prev':()=>{if(orderPage>0){orderPage--;drawOrderPreview();}},
      'order-next':()=>{if((orderPage+1)*orderSize<selectedMessages().length){orderPage++;drawOrderPreview();}},
    };
    const handler = handlers[b.dataset.caseAction];
    if (handler) action(handler);
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    if (busy || !order()) return;
    if(form.id==='caseQuotationForm'){action(()=>buildQuotation(form,order()));return;}
    action(() => {
      const c = order();
      const f = new FormData(form);
      if (form.id === 'caseInvoiceForm') {
        Cases.attachInvoice(state, c, Object.fromEntries(f), f.has('replace'));
        status('已儲存發票。請勾選已核對並儲存。');
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
  render();
  root.setAttribute?.('data-ready','');
})();

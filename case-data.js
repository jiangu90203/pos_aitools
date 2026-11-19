/* Browser-only case data and workbook exporters. */
const Cases = (() => {
  const vendors = ['華茂', '拍檔'];
  const sapName = 'VK「SAP匯入擋(銷售)(4~6)」';
  const sapHeaders = ['', 'SHOP ID', '報價單編號', 'SAP 銷售(全)', '正式區銷項後勤', '銷售發票',
    '華茂下單日期', '商家名稱', '順立開出發票號碼', '發票日期', 'SAP 採購', '正式區進項交貨', '採購發票',
    '設備', '銷售價(含稅)', '數量', '試算未稅', '請款總金額', '採購價(含稅)', '採購價(未稅)',
    '出貨廠商', '出貨廠商ID', 'vk請款單', '峰潮下單日期', '請款憑證', '憑證日期', '請款日期', '', '備註', '拍檔下單日期'];
  const sapOrderColumns = [6, 23, sapHeaders.indexOf('拍檔下單日期')];
  const priceFields = ['saleGross','saleNet','purchaseGross','purchaseNet'];
  function validateSapPrices(profile) {
    if (profile?.version!==1 || !profile.items || typeof profile.items!=='object' || Array.isArray(profile.items))
      throw Error('請選擇 SAP_固定單價.json。');
    const pairs=Object.entries(profile.items);
    if (!pairs.length || pairs.length>200) throw Error('SAP 固定單價的品項數量不符。');
    const cleanItems=pairs.map(([name,price])=>{
      const key=clean(name).normalize('NFKC');
      if (!key || !price || typeof price!=='object' || Array.isArray(price) ||
          !['sale','purchase'].every(kind=>Object.hasOwn(price,kind+'Gross')||Object.hasOwn(price,kind+'Net')) ||
          !Object.entries(price).every(([field,value])=>priceFields.includes(field)&&typeof value==='number'&&amount(value)!==null))
        throw Error('SAP 固定單價的品項或金額格式不符。');
      return [key,price];
    });
    if (new Set(cleanItems.map(([name])=>name)).size!==pairs.length) throw Error('SAP 固定單價中有重複品項。');
    return Object.fromEntries(cleanItems);
  }
  let sapPrices=globalThis.SapPriceProfile?.items||{};
  function setSapPrices(profile) {
    sapPrices=validateSapPrices(profile);
  }
  const sapPriceCount=()=>Object.keys(sapPrices).length;
  const sapPrinterItems = new Set(['P8802','EPSON發票機','WIFI發票機(M303)']);
  const paperItem = '發票紙捲';
  const partnerSupplier = {code:'VAA0001432', id:'拍檔科技'};
  const hmHeaders = ['預計撥款日', '請款單號', '發票號碼', '發票日期', '說明', '金額', '已請款', '已撥款', '對帳單', '備註'];
  const billHeaders = ['來源列', 'SHOP ID', '報價單編號', '公司名稱', '供應商', '請款描述', '發票號碼',
    '發票日期', '金額（未稅）', '金額（含稅）', '處理狀態', '請款單號', '請款日期', '憑證來源', '備註'];
  const create = () => ({version: 1, cases: [], invoices: [], quotes: [], sap: null});
  const initCase = pos => ({id: crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join(''),
    pos, orders: {}, docs: [], sale: {}, bills: {}});
  const desc = (order, vendor) => {
    const agg = Object.create(null);
    for (const d of order.pos.devices) {
      if (vendorForItem(d.item) !== vendor || d.qty <= 0) continue;
      agg[d.item] = (agg[d.item] || 0) + d.qty;
    }
    if (!order.pos.merchant) return '';
    if (vendor === '華茂') return hmDescription(agg, order.pos.merchant);
    const parts = Object.entries(agg).map(([item, qty]) => PARTNER_ITEM_LABEL[item] + '*' + qty + '台');
    return parts.length ? '拍檔出貨' + parts.join('+') + '至' + order.pos.merchant : '';
  };
  const hasVendor = (order, vendor) => order.pos.devices.some(d => vendorForItem(d.item) === vendor);
  const quoteKey = value => norm(value).replace(/^qu(?=\d{11}$)/, '');
  const posRowKey = pos => JSON.stringify([norm(pos.sheet || '下單設備資料'), pos.row]);
  const signature = ({source, sourceDigest, sheet, row, ...fields}) => JSON.stringify(fields);
  const purchaseGroup = p => norm(p.shopId) ? 'shop:'+norm(p.shopId) : norm(p.merchant) ? 'merchant:'+norm(p.merchant) : '';
  const populated = value => value !== undefined && value !== null && value !== '';
  function requestNo(value) {
    const pr = cleanRequestNo(value);
    return /^(待確認|無需請款|未請款|未申請|無設備|不請款|已請款)$/i.test(pr) ? '' : pr;
  }
  function posRows(wb, source) {
    const sheet = getPosSheet(wb);
    const data = sheetRows(wb, sheet);
    validatePosColumns(data,true);
    const headers=new Set(data.headers.map(norm));
    for(let slot=1;slot<=5;slot++){
      if(hasHeader(headers,['設備'+slot])&&!hasHeader(headers,['設備'+slot+'數量',slot===1?'數量':'數量_'+(slot-1)]))
        throw Error('「下單設備資料」缺少設備'+slot+'對應的數量欄。');
    }
    return data.rows.map(row => {
      const devices = [], issues = [];
      for (let slot = 1; slot <= 5; slot++) {
        const raw = clean(findVal(row, ['設備' + slot]));
        if (!raw) continue;
        const value = clean(findVal(row, ['設備' + slot + '數量', slot === 1 ? '數量' : '數量_' + (slot - 1)]));
        const qty = Number(value.replace(/,/g, ''));
        if (!value || !Number.isSafeInteger(qty) || qty < 0) {
          issues.push('設備' + slot + '「' + raw + '」的數量待確認（' + (value || '空白') + '）');
          devices.push({slot, item: standardItem(raw), raw, qty: null});
        } else if (qty > 0) devices.push({slot, item: standardItem(raw), raw, qty});
      }
      const info = getVendorContactInfo(row);
      const partnerDate = excelDateToText(findVal(row, ['拍檔下單日期','拍檔下單日','拍檔訂購日期']));
      return {...info, quote: clean(findVal(row, ['報價單編號', '報價單號'])), shopId: clean(findVal(row, ['SHOP ID'])),
        request: requestNo(findVal(row, ['設備請款單號', '請款單號', '請款單編號'])),
        installRequest: requestNo(findVal(row, ['裝機請款單號'])),
        hmDate: excelDateToText(findVal(row, ['華茂下單日期'])), peakDate: excelDateToText(findVal(row, ['峰潮下單日期'])),
        ...(partnerDate ? {partnerDate} : {}),
        notes: clean(findVal(row, ['備註'])), row: row.__rowNum, source, sheet, devices, issues};
    }).filter(p => p.merchant || p.quote || p.devices.length);
  }
  function previewPos(state, rows) {
    const byRow=new Map(), groups=new Map(), protectedIds=new Set();
    for(const invoice of state.invoices) for(const link of invoice.links) protectedIds.add(link.caseId);
    for(const order of state.cases){
      const k=posRowKey(order.pos), group=purchaseGroup(order.pos);
      if(!byRow.has(k))byRow.set(k,[]);
      byRow.get(k).push(order);
      if(group&&!groups.has(group))groups.set(group,order);
    }
    for(const [k,orders] of byRow){
      byRow.set(k,orders.slice().reverse().sort((a,b)=>evidence(b)-evidence(a)));
    }
    function evidence(order){
      return (protectedIds.has(order.id)?4:0)+(order.docs.length?2:0)+
        (Object.keys(order.sale).length||Object.keys(order.orders).length||Object.keys(order.bills).length?1:0);
    }
    return rows.map(pos=>{
      const [old,...duplicates]=byRow.get(posRowKey(pos))||[];
      const type=!old?'new':signature(old.pos)===signature(pos)?'same':'update';
      return {type,pos,old,duplicates,relatedCase:groups.get(purchaseGroup(pos))};
    });
  }
  function commitPos(state, preview) {
    const counts={new:0,update:0,same:0,duplicates:0,archived:0};
    const replacements=new Map(), removed=new Map(), invalidated=new Map(), archived=new Map(), reassigned=new Set(), additions=[];
    const roots=new Map();
    const incomingByRow=new Map(preview.map(entry=>[posRowKey(entry.pos),entry]));
    for(const {type,pos,old,duplicates,relatedCase} of incomingByRow.values()){
      counts[type]++;
      for(const duplicate of duplicates){
        removed.set(duplicate.id,old.id);
        archived.set(duplicate.id,duplicate);
        counts.duplicates++;
      }
      if(type==='same')continue;
      if(type==='new'){
        const batch=initCase(pos), group=purchaseGroup(pos), related=relatedCase||roots.get(group);
        batch.purchaseBatch={id:batch.id,parentCaseId:related?.purchaseBatch?.parentCaseId||related?.id||'',createdAt:new Date().toISOString()};
        if(group&&!roots.has(group))roots.set(group,batch);
        additions.push(batch);
        continue;
      }
      const before=old.pos;
      const identityChanged=[[before.merchant,pos.merchant],[before.shopId,pos.shopId]].some(([a,b])=>a&&b&&norm(a)!==norm(b))||
        (before.quote&&pos.quote&&quoteKey(before.quote)!==quoteKey(pos.quote));
      if(identityChanged){
        reassigned.add(old.id);
        archived.set(old.id,old);
        replacements.set(old.id,{...initCase(pos),id:old.id});
        continue;
      }
      const next={...old,pos};
      const itemsChanged=JSON.stringify(before.devices)!==JSON.stringify(pos.devices);
      const deliveryChanged=itemsChanged||['merchant','address','contact','phone'].some(field=>before[field]!==pos[field]);
      if(deliveryChanged)next.orders={};
      if(itemsChanged){
        const slots=new Set(pos.devices.filter(d=>before.devices.some(o=>o.slot===d.slot&&o.item===d.item&&o.qty===d.qty)).map(d=>d.slot));
        invalidated.set(old.id,slots);
        next.sale={...old.sale,lines:(old.sale.lines||[]).filter(line=>slots.has(line.slot))};
        if(old.sale.lines?.length||old.docs.length)next.review=true;
      }
      replacements.set(old.id,next);
    }
    if(archived.size||invalidated.size){
      const historicalLinks=new Map(), invoices=[];
      for(const inv of state.invoices){
        const links=[];
        for(const link of inv.links){
          if(archived.has(link.caseId)){
            if(!historicalLinks.has(link.caseId))historicalLinks.set(link.caseId,[]);
            historicalLinks.get(link.caseId).push({...inv,links:[link]});
          }else if(invalidated.has(link.caseId)){
            links.push({...link,slots:link.slots.filter(slot=>invalidated.get(link.caseId).has(slot)),confirmed:false});
            replacements.get(link.caseId).review=true;
          }else links.push(link);
        }
        if(links.length)invoices.push({...inv,links});
      }
      state.invoices=invoices;
      const history=[];
      for(const [id,order] of archived){
        const invoices=historicalLinks.get(id)||[];
        if(invoices.length||order.docs.length||Object.keys(order.sale).length||Object.keys(order.orders).length||Object.keys(order.bills).length){
          history.push({order,invoices,replacedAt:new Date().toISOString()});
        }
      }
      counts.archived=history.length;
      if(history.length)state.posHistory=[...(state.posHistory||[]),...history];
    }
    if(replacements.size||removed.size||additions.length){
      state.cases=state.cases.filter(order=>!removed.has(order.id)).map(order=>{
        const next=replacements.get(order.id)||order, parent=next.purchaseBatch?.parentCaseId;
        if(!removed.has(parent))return next;
        const replacement=removed.get(parent);
        return {...next,purchaseBatch:{...next.purchaseBatch,parentCaseId:replacement===next.id?'':replacement}};
      }).concat(additions.map(batch=>{
        const replacement=removed.get(batch.purchaseBatch.parentCaseId);
        if(replacement)batch.purchaseBatch.parentCaseId=replacement;
        return batch;
      }));
    }
    return {...counts,addedIds:new Set(additions.map(c=>c.id)),removed,reassigned};
  }
  function amount(value) {
    const valueText = clean(value).replace(/[,\s]/g, '');
    if (!valueText) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(valueText) || !Number.isSafeInteger(Math.round(Number(valueText) * 100))) {
      throw Error('金額請填寫非負數，最多兩位小數。');
    }
    return Number(valueText);
  }
  const cents = value => Math.round(value * 100);
  function date(value, required = false) {
    const s = clean(value);
    if (!s && !required) return '';
    const match = excelDateToText(s).match(/^(\d{3,4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:[ T].*)?$/);
    if (!match) throw Error('日期請使用 YYYY-MM-DD。');
    let [, y, m, d] = match.map(Number);
    if (y < 1000) y += 1911;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) throw Error('日期無效。');
    return [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
  }
  const invoiceKey = (vendor, no) => vendor + ':' + no;
  function invoiceData(input) {
    const no = clean(input.no).toUpperCase().replace(/[\s-]+/g, '');
    if (!/^[A-Z]{2}\d{8}$/.test(no)) throw Error('發票號碼請輸入 2 碼英文字母及 8 碼數字。');
    if (!vendors.includes(input.vendor)) throw Error('請選擇有效的供應商。');
    const net = amount(input.net), gross = amount(input.gross), tax = amount(input.tax);
    if (net === null || gross === null) throw Error('請填未稅及含稅金額。');
    if (gross < net || (tax !== null && cents(gross) !== cents(net) + cents(tax))) throw Error('未稅加稅額應等於含稅金額。');
    return {vendor: input.vendor, no, date: date(input.date, true), net, gross,
      tax: tax ?? (cents(gross) - cents(net)) / 100, source: clean(input.source)};
  }
  function attachInvoice(state, order, input, replace = false) {
    const values = invoiceData(input);
    if (!hasVendor(order, values.vendor)) throw Error('此案件沒有此供應商的設備。');
    const k = invoiceKey(values.vendor, values.no);
    let inv = state.invoices.find(i => i.key === k);
    if(!inv&&state.invoices.some(i=>i.vendor===values.vendor&&i.corrections?.some(event=>event.from.no===values.no)))
      throw Error('此發票號碼曾被人工修正。請先查看現有憑證的修正紀錄。');
    if (inv && !['date', 'net', 'gross', 'tax'].every(field => inv[field] === values[field])) {
      if (!replace) throw Error(`同一發票已存在（${inv.date}、未稅 ${inv.net}、含稅 ${inv.gross}）。確認新值後，勾選「更新同號發票資料」再儲存。`);
      if(inv.date!==values.date)recordInvoiceCorrection(inv,values);
      Object.assign(inv, values);
      for (const link of inv.links) link.confirmed = false;
    }
    if (!inv) {
      inv = {...values, key: k, links: []};
      state.invoices.push(inv);
    }
    if (!inv.links.some(l => l.caseId === order.id)) {
      if (inv.links.length) inv.everShared = true;
      inv.links.push({caseId: order.id, slots: [], net: null, gross: null, pr: '', requestDate: ''});
    }
    return inv;
  }
  function recordInvoiceCorrection(inv,values) {
    (inv.corrections ||= []).push({from:{no:inv.no,date:inv.date},to:{no:values.no,date:values.date},at:new Date().toISOString()});
  }
  function correctInvoice(state,order,key,input) {
    const inv=state.invoices.find(i=>i.key===key&&i.links.some(l=>l.caseId===order.id));
    if(!inv)throw Error('找不到要修正的案件發票。');
    const values=invoiceData({...inv,no:input.no,date:input.date});
    if(values.no===inv.no&&values.date===inv.date)return inv;
    if(state.invoices.some(i=>i!==inv&&i.vendor===inv.vendor&&
      (i.no===values.no||i.corrections?.some(event=>event.from.no===values.no))))
      throw Error('此發票號碼已屬於其他憑證。');
    recordInvoiceCorrection(inv,values);
    Object.assign(inv,{no:values.no,date:values.date,key:invoiceKey(inv.vendor,values.no)});
    for(const link of inv.links)link.confirmed=false;
    return inv;
  }
  function invoiceLinks(state, order, vendor) {
    return state.invoices.filter(i => i.vendor === vendor && i.links.some(l => l.caseId === order.id))
      .map(inv => ({inv, link: inv.links.find(l => l.caseId === order.id)}));
  }
  function allocation(inv, link) {
    if (inv.links.length === 1 && !inv.everShared) return {net: inv.net, gross: inv.gross};
    if (inv.links.some(l => l.net === null || l.gross === null || l.gross < l.net)) return null;
    for (const field of ['net', 'gross']) {
      if (inv.links.reduce((sum, l) => sum + cents(l[field]), 0) !== cents(inv[field])) return null;
    }
    return {net: link.net, gross: link.gross};
  }
  function linkSlots(order, entries, link, vendor) {
    const valid = order.pos.devices.filter(d => d.qty > 0 && vendorForItem(d.item) === vendor).map(d => d.slot);
    if (entries.length === 1 && !link.slots.length) return valid;
    return link.slots.filter(slot => valid.includes(slot));
  }
  function billStatus(order, inv, link, entries) {
    if (order.review || order.pos.issues.length || !desc(order, inv.vendor)) return '待核對設備';
    if (!allocation(inv, link)) return '待確認跨案金額';
    const slots = linkSlots(order, entries, link, inv.vendor);
    if (!slots.length) return '待選擇發票對應設備';
    const allSlots = entries.flatMap(e => linkSlots(order, entries, e.link, inv.vendor));
    if (new Set(allSlots).size !== allSlots.length) return '待確認發票對應設備重疊';
    if (link.confirmed && link.pr && link.requestDate) return '已回填請款';
    if (!link.confirmed) return '待核對發票';
    return '可填請款';
  }
  const isReady = status => ['已回填請款', '可填請款'].includes(status);
  function descriptionFor(order, vendor, slots) {
    return desc({...order, pos: {...order.pos, devices: order.pos.devices.filter(d => slots.includes(d.slot))}}, vendor);
  }
  function billWorkbook(state, orders, readyOnly = false) {
    const details = [], invoices = [];
    const emitted = new Set();
    for (const order of orders.filter(c => hasVendor(c, '拍檔'))) {
      const p = order.pos;
      const common = [p.row, p.shopId, p.quote, p.merchant, '拍檔'];
      const entries = invoiceLinks(state, order, '拍檔');
      if (!entries.length && !readyOnly) details.push([...common, desc(order, '拍檔'), '', '', null, null,
        order.pos.issues.length ? '待核對設備' : '待補拍檔發票', '', '', '', order.pos.issues.join('；')]);
      for (const {inv, link} of entries) {
        const status = billStatus(order, inv, link, entries);
        if (readyOnly && !isReady(status)) continue;
        const split = allocation(inv, link);
        details.push([...common, descriptionFor(order, '拍檔', linkSlots(order, entries, link, '拍檔')), inv.no, inv.date,
          split?.net ?? null, split?.gross ?? null, status, link.pr, link.requestDate, inv.source,
          order.pos.issues.join('；')]);
        if (!emitted.has(inv.key)) {
          emitted.add(inv.key);
          invoices.push([inv.no, inv.date, inv.net, inv.tax, inv.gross, inv.links.length, inv.source]);
        }
      }
    }
    if (!details.length) throw Error(readyOnly ? '勾選的案件沒有已核對且可請款的拍檔資料。' : '勾選的案件沒有拍檔設備。');
    const book = XLSX.utils.book_new();
    addSheet(book, '拍檔請款彙整', billHeaders, details);
    addSheet(book, '拍檔發票明細', ['發票號碼', '發票日期', '整張發票未稅', '整張發票稅額', '整張發票含稅', '關聯案件數', '憑證來源'], invoices);
    appendVendorSheets(book,state,orders,'拍檔',readyOnly?(order,doc)=>{
      const entries=invoiceLinks(state,order,'拍檔');
      const ready=entries.filter(({inv,link})=>isReady(billStatus(order,inv,link,entries)));
      const invoice=VendorDocs.invoiceFields(state,order,doc,ready);
      return !invoice.ambiguous&&ready.some(({inv})=>invoice.no===inv.no);
    }:undefined);
    return book;
  }
  function addSheet(book, name, headers, rows) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows], {cellDates: false});
    ws['!cols'] = headers.map(h => ({wch: h === '請款描述' ? 64 : h.length > 6 ? 22 : 16}));
    XLSX.utils.book_append_sheet(book, ws, name);
    return ws;
  }
  function appendVendorSheets(book,state,orders,vendor,include=()=>true) {
    const header=['案件來源列','SHOP ID','報價單編號','商家名稱','廠商','文件類型','文件單號','來源檔案'];
    const files=[], items=[];
    const byCase = new Map(orders.map(c=>[c.id,[]]));
    for(const inv of state.invoices){
      if(vendor&&vendor!==inv.vendor)continue;
      for(const link of inv.links)byCase.get(link.caseId)?.push({inv,link});
    }
    for(const order of orders){
      for(const d of (typeof VendorDocs==='undefined'?[]:VendorDocs.documents(order))){
        const doc=d.parsed;
        if((vendor&&d.vendor!==vendor)||!hasVendor(order,d.vendor)||!include(order,doc))continue;
        const p=order.pos, base=[p.row,p.shopId,p.quote,p.merchant,d.vendor,d.kind,doc.id,d.name];
        const invoice=VendorDocs.invoiceFields(state,order,doc,byCase.get(order.id));
        files.push([...base,doc.shipNo,doc.shipDate,invoice.no,invoice.date,doc.orderNo,
          doc.buyer,doc.shipCompany||doc.recipient,doc.net,doc.tax,doc.gross,
          [...new Set([...doc.warnings,...(d.pair?.issues||[])])].join('；'),VendorDocs.pageLabel(doc.pages)]);
        for(const i of doc.items) items.push([...base,i.code,i.name,i.unit,i.quantity,i.unitPrice,i.net,i.gross,i.raw]);
      }
    }
    if(!files.length)return;
    addSheet(book,'廠商文件',[...header,'銷貨／出貨單號','出貨日期','發票號碼','發票日期','廠商訂單單號',
      '帳款客戶','收件／轉寄資訊','未稅','稅額','含稅','待核對','來源頁碼'],files);
    addSheet(book,'廠商品項',[...header,'產品編號','品名／規格','單位','數量','單價','未稅','含稅','原始品項文字'],items);
  }
  function huamaoWorkbook(state, orders, payDate) {
    const rows = [], issues = [];
    for (const order of orders.filter(c => hasVendor(c, '華茂'))) {
      const p = order.pos, meta = order.bills['華茂'] || {};
      const entries = invoiceLinks(state, order, '華茂');
      if (p.issues.length || order.review || !desc(order, '華茂')) {
        issues.push([p.quote, p.merchant, p.issues.join('；') || '請核對設備或公司名稱']);
        continue;
      }
      if (!entries.length) {
        const hw = p.devices.filter(d => vendorForItem(d.item) === '華茂' && d.qty > 0);
        const estimated = hw.every(d => Object.hasOwn(COST, d.item)) ? hw.reduce((sum, d) => sum + d.qty * COST[d.item][0], 0) : null;
        const shipments=typeof VendorDocs==='undefined'?[]:VendorDocs.documents(order).filter(d=>
          d.vendor==='華茂'&&d.kind==='銷貨單'&&d.parsed.invoiceNo&&d.parsed.invoiceDate&&!d.pair?.issues?.length);
        const doc=shipments.length===1?shipments[0].parsed:null;
        rows.push([meta.payDate || payDate, '', doc?.invoiceNo||'', doc?.invoiceDate||'', desc(order, '華茂'), estimated, null, meta.paid ?? null,
          meta.statement || '',doc?'發票欄位取自銷貨單'+(doc.shipNo?' '+doc.shipNo:'')+'，金額依 POS 採購規則':
            estimated === null ? '待補發票與採購金額' : '暫估金額，待補發票核對']);
        continue;
      }
      for (const {inv, link} of entries) {
        const status = billStatus(order, inv, link, entries);
        const slots = linkSlots(order, entries, link, '華茂');
        const split = allocation(inv, link);
        rows.push([meta.payDate || payDate, link.pr, inv.no, inv.date, descriptionFor(order, '華茂', slots),
          isReady(status) ? split.gross : null, link.claimed ?? null, link.paid ?? null, meta.statement || '',
          isReady(status) ? (meta.notes || '') : status]);
      }
    }
    if (!rows.length && !issues.length) throw Error('勾選的案件沒有華茂設備。');
    const book = XLSX.utils.book_new();
    addSheet(book, '華茂款項匯入資訊', hmHeaders, rows);
    if (issues.length) addSheet(book, '待確認', ['報價單編號', '公司名稱', '待確認事項'], issues);
    appendVendorSheets(book,state,orders,'華茂');
    return book;
  }
  function orderMessages(order) {
    const messages = [];
    if (order.pos.issues.length || !order.pos.merchant) return messages;
    const groups=new Map();
    for(const d of order.pos.devices){
      const vendor=vendorForItem(d.item);
      if(!vendor||!(d.qty>0))continue;
      if(!groups.has(vendor))groups.set(vendor,Object.create(null));
      const agg=groups.get(vendor);
      agg[d.item]=(agg[d.item]||0)+d.qty;
    }
    for(const vendor of new Set([...vendors,...groups.keys()])){
      const agg=groups.get(vendor);
      if(agg)messages.push(buildVendorMessageFromGroup({info:order.pos,vendor,agg,rows:[order.pos.row]}));
    }
    return messages;
  }
  function sapTemplate(wb, source) {
    if (!wb.Sheets[sapName]) throw Error('找不到「' + sapName + '」分頁。');
    const ws = wb.Sheets[sapName];
    if(!ws['!ref'])throw Error('「'+sapName+'」工作表是空的。');
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r > 20000) throw Error('SAP 工作表超過 20,000 列。');
    const values = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: null,
      range: {s: {r: 0, c: 0}, e: {r: range.e.r, c: sapHeaders.length - 1}}});
    const [,,partnerColumn] = sapOrderColumns;
    if (!sapHeaders.slice(0,partnerColumn).every((h, i) => !h || norm(values[0][i]) === norm(h))) {
      throw Error('SAP 樣板欄位與指定格式不同。');
    }
    const hasPartnerDate = norm(values[0][partnerColumn]) === norm(sapHeaders[partnerColumn]);
    const last = values.slice(1).filter(r => populated(r[2]));
    if(!last.length)throw Error('VK 工作表有表頭，但沒有報價單編號明細。');
    if(!hasPartnerDate)for(const row of last)row.length=partnerColumn;
    return {source, rows: last};
  }
  function quotationRows(wb, source) {
    const preferred = wb.SheetNames.find(n => n === '內部系統報價單');
    const name = preferred || wb.SheetNames[0];
    const data = sheetRows(wb, name);
    const headers=new Set(data.headers.map(norm));
    if(!hasHeader(headers,['報價單號','報價單編號'])||
       !hasHeader(headers,['設備','品項','購買項目&數量(台)','發票號碼','順立開出發票號碼','銷售價(含稅)','銷售單價(含稅)','含稅單價','試算未稅','銷售單價(未稅)','未稅單價'])||
       hasHeader(headers,['設備1','SAP 銷售(全)'])){
      throw Error('內部系統報價單.xlsx 需包含報價單號，以及品項、銷售單價或發票號碼欄。');
    }
    return data.rows.map(row => ({
      quote: clean(findVal(row, ['報價單號', '報價單編號'])),
      shopId: clean(findVal(row, ['SHOP ID', 'EcShopID'])),
      no: clean(findVal(row, ['發票號碼', '順立開出發票號碼'])),
      date: excelDateToText(findVal(row, ['發票開立時間', '發票日期'])),
      item: clean(findVal(row, ['設備', '品項', '購買項目&數量(台)'])),
      quantity: clean(findVal(row, ['數量'])),
      gross: clean(findVal(row, ['銷售價(含稅)', '銷售單價(含稅)', '含稅單價'])),
      net: clean(findVal(row, ['試算未稅', '銷售單價(未稅)', '未稅單價'])),
      invoiceStatus: clean(findVal(row, ['發票狀態'])), source,
    })).filter(r => r.quote);
  }
  function salesCandidates(state, order) {
    const shop = norm(order.pos.shopId);
    const matches = state.quotes.filter(r => quoteKey(r.quote) === quoteKey(order.pos.quote) &&
      (!shop || !r.shopId || norm(r.shopId) === shop) && !/作廢|取消/.test(r.invoiceStatus));
    const pairs = new Map();
    for (const r of matches) if (r.no && r.date) {
      try { pairs.set(r.no + ':' + date(r.date), {no: r.no, date: date(r.date)}); } catch { /* invalid dates remain for manual verification */ }
    }
    return {matches, sales: [...pairs.values()]};
  }
  function compatibleSalePrices(matches, d) {
    const matchesItem = matches.filter(r => standardItem(r.item) === d.item && (!r.quantity || Number(r.quantity) === d.qty));
    const amounts = new Map();
    for (const r of matchesItem) {
      try {
        const price = [amount(r.gross), amount(r.net)];
        if (price.some(populated)) amounts.set(JSON.stringify(price), price);
      } catch { /* unrecognized amount needs confirmation */ }
    }
    return amounts.size === 1 ? [...amounts.values()][0] : [];
  }
  function quotationDocument(state, order, fields) {
    const p = order.pos;
    const buyer = clean(fields.buyer), issuer = clean(fields.issuer), no = clean(fields.no);
    if (!buyer || !issuer || !no) throw Error('請填寫客戶名稱、報價公司及報價單號。');
    if (no.length > 80) throw Error('報價單號最多 80 個字元。');
    if (p.issues.length || order.review) throw Error('請先核對設備及數量。');
    const devices = p.devices.filter(d => d.qty > 0);
    if (!devices.length) throw Error('此案件沒有可報價的品項。');
    const {matches} = salesCandidates(state, order);
    const key = quoteKey(p.quote), shop = norm(p.shopId);
    const historical = key ? (state.sap?.rows || []).filter(r => quoteKey(r[2]) === key &&
      (!shop || !r[1] || norm(r[1]) === shop)) : [];
    const lines = devices.map(d => {
      const manual = order.sale.lines?.find(l => l.slot === d.slot);
      const unique = devices.filter(other => other.item === d.item && other.qty === d.qty).length === 1;
      const old = historical.filter(row => standardItem(row[13]) === d.item && Number(row[15]) === d.qty);
      const [rawGross, rawNet] = manual ? [manual.gross, manual.net] :
        unique ? (old.length === 1 && [old[0][14],old[0][16]].some(populated) ?
          [old[0][14],old[0][16]] : compatibleSalePrices(matches,d)) : [];
      const net = amount(rawNet), gross = amount(rawGross);
      if (net === null && gross === null) throw Error('「' + d.raw + '」缺少確定的銷售單價，請先儲存逐項銷售單價。');
      if (net !== null && gross !== null && gross < net) throw Error('「' + d.raw + '」含稅單價低於未稅單價。');
      return {name:d.raw, qty:d.qty, net, gross, netTotal:net === null ? null : cents(net)*d.qty,
        grossTotal:gross === null ? null : cents(gross)*d.qty};
    });
    const sum = name => lines.every(l => l[name] !== null) ? lines.reduce((total,l) => total+l[name],0) : null;
    const net = sum('netTotal'), gross = sum('grossTotal');
    if (net === null && gross === null) throw Error('各品項至少需有同一稅別的單價（全部未稅或全部含稅），才能計算合計。');
    if (![net,gross,...lines.flatMap(l => [l.netTotal,l.grossTotal])]
        .every(n => n === null || Number.isSafeInteger(n))) throw Error('報價總額超出可處理的金額範圍。');
    const issued = date(fields.date,true), expires = date(fields.expires);
    if (expires && expires < issued) throw Error('報價有效期限不可早於報價日期。');
    return {issuer,buyer,no,issued,expires,buyerTaxId:clean(fields.buyerTaxId),
      contact:clean(fields.contact), phone:clean(fields.phone), address:clean(fields.address),
      email:clean(fields.email), issuerContact:clean(fields.issuerContact), shopId:p.shopId,
      notes:String(fields.notes || '').trim(), lines, net, gross, tax:net === null || gross === null ? null : gross-net};
  }
  function sapOrderDate(value) {
    const source=clean(value).replace(/^(\d{3,4})(\d{2})(\d{2})$/,'$1-$2-$3');
    try {return date(source);} catch {return '';}
  }
  function fillSapOrderDates(row, pos={}) {
    const sources=[pos.hmDate,pos.peakDate,pos.partnerDate];
    const dates=sapOrderColumns.map((col,i)=>sapOrderDate(row[col])||sapOrderDate(sources[i]));
    sapOrderColumns.forEach((column,i)=>{
      if(sapOrderDate(row[column])||isBlankRequestNo(row[column])||clean(row[column])==='0'){
        row[column]=dates[i]||null;
      }
    });
    return row;
  }
  const sapGross = net => Math.round(cents(net)*105/100)/100;
  const sapNet = gross => Math.round(cents(gross)*100/105)/100;
  function sapPrice(item) {
    const key=clean(item).normalize('NFKC');
    if (Object.hasOwn(sapPrices,key)) return sapPrices[key];
    const compact=key.replace(/\s+/g,'');
    return Object.hasOwn(sapPrices,compact)?sapPrices[compact]:{};
  }
  function sapNumeric(value) {
    const raw=clean(value).replace(/,/g,'');
    return /^\d+(?:\.\d+)?$/.test(raw)&&Number.isFinite(Number(raw))?Number(raw):null;
  }
  function completeSapPrice(row, grossColumn, netColumn, defaults, kind) {
    const gross=sapNumeric(row[grossColumn]);
    const net=sapNumeric(row[netColumn]);
    if (gross!==null || net!==null) {
      if (gross!==null) row[grossColumn]=gross;
      if (net!==null) row[netColumn]=net;
      if (!populated(row[grossColumn])) row[grossColumn]=sapGross(net);
      if (!populated(row[netColumn])) row[netColumn]=sapNet(gross);
      return;
    }
    if (populated(row[grossColumn]) || populated(row[netColumn])) return;
    const defaultGross=defaults[kind+'Gross'], defaultNet=defaults[kind+'Net'];
    if (defaultGross===undefined&&defaultNet===undefined) return;
    row[grossColumn]=defaultGross??sapGross(defaultNet);
    row[netColumn]=defaultNet??sapNet(defaultGross);
  }
  function sapPaperType(row, raw) {
    const values=[row[14],row[16]].filter(populated);
    if (values.some(value=>sapNumeric(value)===null)) return 'conflict';
    const hasPaid=values.some(value=>sapNumeric(value)>0)||/單購|加購/.test(raw);
    const hasFree=values.some(value=>sapNumeric(value)===0)||/贈品|贈送|免費/.test(raw);
    if (hasPaid&&hasFree) return 'conflict';
    return hasPaid?'paid':hasFree?'free':'';
  }
  function fillSapPaper(entries, pos, devices, report, hasPrinterConflict) {
    const papers=entries.filter(({row})=>standardItem(row[13])===paperItem);
    let remaining=devices.reduce((qty,d)=>qty+(sapPrinterItems.has(d.item)?2*d.qty:0),0);
    const newPaper=(qty, insertAfter=null)=>{
      const row=Array(sapHeaders.length).fill(null);
      Object.assign(row,{1:pos.shopId,2:pos.quote,7:pos.merchant,13:paperItem,15:qty});
      fillSapOrderDates(row,pos);
      const entry={row};
      if(insertAfter) entries.splice(entries.indexOf(insertAfter)+1,0,entry);
      else entries.push(entry);
      return row;
    };
    const free=row=>{
      for (const column of [14,16,18,19]) {
        if (!populated(row[column])||sapNumeric(row[column])===0) row[column]=0;
      }
    };
    const paid=row=>{
      const price=sapPrice(paperItem);
      // 已付費的紙捲在舊 VK 以 0 代記空白採購價。
      if ((price.purchaseGross!==undefined||price.purchaseNet!==undefined) &&
          [row[18],row[19]].every(x=>!populated(x)||sapNumeric(x)===0)) row[18]=row[19]=null;
      completeSapPrice(row,14,16,{saleGross:50,...price},'sale');
      completeSapPrice(row,18,19,price,'purchase');
      if ([18,19].some(column=>sapNumeric(row[column])===null)) report('單購紙捲的採購單價待確認');
    };
    const unpriced=[];
    let unsafe=hasPrinterConflict;
    for(const entry of papers){
      const {row,raw}=entry, type=sapPaperType(row,raw??row[13]);
      const qty=sapNumeric(row[15]);
      if(type==='conflict'||!Number.isSafeInteger(qty)||qty<=0){
        report('紙捲數量或單價有衝突，請確認購買與贈品數量');
        unsafe=true;
      } else if(type==='free'){
        free(row);
        remaining=Math.max(0,remaining-qty);
      } else if(type==='paid') paid(row);
      else unpriced.push(entry);
    }
    if (unsafe) return;
    // POS 有兩行紙捲時，先辨識數量剛好等於贈送額度的那一行。
    const exact=remaining>0?unpriced.findIndex(({row})=>Number(row[15])===remaining):-1;
    if(exact>0) unpriced.unshift(...unpriced.splice(exact,1));
    for(const entry of unpriced){
      const {row,historical}=entry, qty=Number(row[15]);
      if (!remaining) { paid(row); continue; }
      if (qty<=remaining) {
        free(row);
        remaining-=qty;
      } else if(historical){
        report('VK 原有紙捲列未區分贈送與單購，請確認數量後拆列');
        return;
      } else {
        report('單列紙捲未標示是否含贈品，已按含贈品拆列。若此列全為加購，請在 POS 表標為「發票紙捲（加購）」後重新匯入。');
        row[15]=remaining;
        free(row);
        const extra=newPaper(qty-remaining,entry);
        extra[8]=row[8]; extra[9]=row[9];
        paid(extra);
        remaining=0;
      }
    }
    if(remaining) free(newPaper(remaining));
  }
  function fillEquipmentPrices(row,item,report) {
    const price=sapPrice(item);
    completeSapPrice(row,14,16,price,'sale');
    completeSapPrice(row,18,19,price,'purchase');
    const missing=[];
    if ([14,16].some(column=>sapNumeric(row[column])===null)) missing.push('銷售');
    if ([18,19].some(column=>sapNumeric(row[column])===null)) missing.push('採購');
    if (missing.length) report('設備「'+item+'」的'+missing.join('及')+'單價待確認');
  }
  function formatSapDates(sheet, length) {
    for (const [column, includeTime] of [...sapOrderColumns.map(c=>[c,false]),[9,false],[25,false],[26,true]]) {
      for (let row = 1; row <= length; row++) {
        const cell = sheet[XLSX.utils.encode_cell({r:row,c:column})];
        if (!cell) continue;
        if (cell.t === 'n' && cell.v >= 30000 && cell.v < 80000) {
          cell.z = includeTime ? 'yyyy/mm/dd hh:mm:ss' : 'yyyy/mm/dd';
        } else if (cell.t === 's' && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(cell.v)) {
          try {
            const [y,m,d] = date(cell.v).split('-').map(Number);
            cell.t = 'n'; cell.v = (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30)) / 86400000;
            cell.z = 'yyyy/mm/dd';
            delete cell.w;
          } catch { /* keep original unrecognized dates */ }
        }
      }
    }
  }
  function sapWorkbook(state, orders) {
    const rows = [], notes = [], historical = state.sap?.rows || [];
    const historyIndex = new Map(), caseIndex = new Map();
    for (const row of historical) {
      const k = quoteKey(row[2]);
      if (!historyIndex.has(k)) historyIndex.set(k, []);
      historyIndex.get(k).push(row);
    }
    for (const c of state.cases) {
      const k = quoteKey(c.pos.quote);
      if (!caseIndex.has(k)) caseIndex.set(k, []);
      caseIndex.get(k).push(c);
    }
    const blockedHistory = new Set();
    const freightCandidates=new Map();
    for (const order of orders) {
      const p = order.pos, quote = quoteKey(p.quote), shop = norm(p.shopId);
      const report = s => notes.push([p.row, p.quote, p.merchant, s]);
      if (!quote) { report('缺報價單編號，請確認後再 Key-in'); continue; }
      const peers = caseIndex.get(quote).filter(c => !shop || !c.pos.shopId || norm(c.pos.shopId) === shop);
      const old = (historyIndex.get(quote) || []).filter(r => !shop || !r[1] || norm(r[1]) === shop);
      if (p.issues.length || order.review || peers.length > 1 && old.length) {
        report(peers.length > 1 && old.length ? '同報價單有多筆可能的 POS 案件，ERP 歷史保留原列，新資料待確認分批歸屬' :
          '設備待核對，ERP 歷史保留原列：' + p.issues.join('；'));
        for (const r of old) if (!blockedHistory.has(r)) { rows.push(fillSapOrderDates(r.slice())); blockedHistory.add(r); }
        continue;
      }
      const {matches, sales} = salesCandidates(state, order);
      const sale = order.sale.no ? order.sale : sales.length === 1 ? sales[0] : {};
      if (sales.length > 1 && !order.sale.no) report('有多張銷售發票候選，請確認後填入');
      if (!state.sap) report('未匯入歷史 VK 工作表，沒有歷史 SAP 單號可帶入');
      if (!sapPriceCount()) report('尚未設定固定單價，請在「資料來源與範圍設定」匯入 SAP_固定單價.json');
      const used = new Set(), totaled = new Set(), checkedPartnerInvoices = new Set();
      const caseRows=[];
      let printerConflict=false;
      const devices = p.devices.filter(d => d.qty > 0)
        .map(d=>({...d,item:standardItem(clean(d.raw||d.item).normalize('NFKC'))}));
      if (!devices.length) report('缺少有效的設備明細');
      const byVendor = Object.fromEntries(vendors.map(v => [v, invoiceLinks(state, order, v)]));
      const count = d => devices.filter(other => other.item === d.item && other.qty === d.qty).length;
      const oldPaper=old.filter(row=>standardItem(row[13])===paperItem);
      const newPaper=devices.filter(d=>d.item===paperItem);
      const knownPaperBreakdown=oldPaper.length>1 && newPaper.length===1 && !/單購|加購|贈品|贈送|免費/.test(newPaper[0].raw)
        && oldPaper.every(row=>['free','paid'].includes(sapPaperType(row,row[13]))&&Number.isSafeInteger(sapNumeric(row[15]))&&Number(row[15])>0)
        && [oldPaper,oldPaper.filter(row=>sapPaperType(row,row[13])==='paid')]
          .some(group=>group.reduce((sum,row)=>sum+Number(row[15]),0)===newPaper[0].qty);
      for (const d of devices) {
        if (d.item===paperItem&&knownPaperBreakdown) continue;
        const vendor = vendorForItem(d.item);
        const sameItem = old.filter(r => standardItem(r[13]) === d.item);
        const oldMatches = sameItem.filter(r => Number(r[15]) === d.qty);
        if (!oldMatches.length && sameItem.length) {
          report('設備「' + d.item + '」的數量與 VK 原表不一致，保留原列並待確認');
          if(sapPrinterItems.has(d.item)) printerConflict=true;
          continue;
        }
        if (oldMatches.length > 1 || (oldMatches.length && count(d) > 1)) {
          report('設備「' + d.item + '」對應多筆明細，保留 VK 原列並待確認');
          if(sapPrinterItems.has(d.item)) printerConflict=true;
          continue;
        }
        const oldRow = oldMatches[0];
        if (oldRow) used.add(oldRow);
        const row = oldRow?.slice() || Array(sapHeaders.length).fill(null);
        const fill = (i, value) => {
          if (!populated(row[i]) && populated(value)) row[i] = value;
        };
        fill(1, p.shopId); fill(2, p.quote); fill(7, p.merchant); fill(13, d.item); fill(15, d.qty);
        fillSapOrderDates(row,p);
        const partnerPrice=vendor==='拍檔'?sapPrice(d.item):null;
        if (vendor === '拍檔') {
          row[20]=partnerSupplier.code;
          row[21]=partnerSupplier.id;
        }
        if (vendor === '華茂') fill(20, 'VAA0000037');
        fill(21, vendor === '華茂' ? '華茂資訊' : vendor);
        if (sale.no && populated(row[8]) && clean(row[8]) !== clean(sale.no)) report('既有銷售發票與補件不同，已保留原值');
        fill(8, sale.no); fill(9, sale.date);
        const prices = order.sale.lines?.find(l => l.slot === d.slot);
        const [gross, net] = prices ? [prices.gross, prices.net] : count(d) === 1 ? compatibleSalePrices(matches, d) : [];
        if (!populated(row[14]) && !populated(row[16])) {fill(14, gross); fill(16, net);}
        const entries = byVendor[vendor] || [];
        const entry = entries.find(e => isReady(billStatus(order, e.inv, e.link, entries)) &&
          linkSlots(order, entries, e.link, vendor).includes(d.slot));
        if (entry) {
          const {inv, link} = entry, split = allocation(inv, link);
          const slots = linkSlots(order, entries, link, vendor);
          const historicalTotals = historical.filter(r => clean(r[24]) === inv.no && populated(r[17]));
          const existingAmount = historicalTotals.some(r => (clean(r[21]) === '' || clean(r[21]).includes(vendor)));
          const mismatched = populated(row[24]) && clean(row[24]) !== inv.no;
          if (mismatched) report('既有採購憑證與補件不同，已保留原值');
          else {
            const consistentPr = !populated(row[22]) || !link.pr || clean(row[22]) === clean(link.pr);
            if (!consistentPr) report('既有請款單號與回填不同，已保留原值');
            fill(24, inv.no); fill(25, inv.date);
            if (consistentPr) { fill(22, link.pr); fill(26, link.requestDate); }
            if (!totaled.has(inv.key) && !existingAmount && consistentPr && !populated(row[17])) {
              fill(17, split.gross);
              totaled.add(inv.key);
            }
            if (slots.length === 1 && cents(split.gross) % d.qty === 0 && cents(split.net) % d.qty === 0) {
              if (!populated(row[18]) && !populated(row[19])) {
                fill(18, cents(split.gross) / d.qty / 100); fill(19, cents(split.net) / d.qty / 100);
              }
            } else if (partnerPrice?.purchaseNet!==undefined && !checkedPartnerInvoices.has(inv.key)) {
              checkedPartnerInvoices.add(inv.key);
              const covered=devices.filter(device=>slots.includes(device.slot));
              if (covered.every(device=>sapPrice(device.item).purchaseNet!==undefined)) {
                const net=covered.reduce((sum,device)=>sum+sapPrice(device.item).purchaseNet*device.qty,0);
                if (cents(net)!==cents(split.net)||cents(sapGross(net))!==cents(split.gross)) {
                  report('拍檔發票 '+inv.no+' 與標準採購價合計不同，採購單價待核對，保留實際發票總額');
                }
              }
            } else if (!partnerPrice && sapPrice(d.item).purchaseGross===undefined && sapPrice(d.item).purchaseNet===undefined &&
              (!populated(row[18]) || !populated(row[19]))) report('多設備憑證的個別採購價待分攤，已保留發票總額');
          }
        }
        fill(28, p.notes);
        if (d.item!==paperItem) fillEquipmentPrices(row,d.item,report);
        caseRows.push({row,raw:d.raw,historical:Boolean(oldRow)});
      }
      for (const r of old) if (!used.has(r)) {
        const row=fillSapOrderDates(r.slice());
        const item=standardItem(row[13]);
        if (!(item===paperItem&&knownPaperBreakdown)) report('VK 原表有未對應的設備列，已保留 ERP 歷史');
        if (item!==paperItem&&item!=='運費'&&item) fillEquipmentPrices(row,item,report);
        caseRows.push({row,historical:true});
      }
      fillSapPaper(caseRows,p,devices,report,printerConflict);
      rows.push(...caseRows.map(({row})=>row));
      if(newPaper.length&&!old.some(row=>clean(row[13])==='運費'||clean(row[4])==='運費')&&
          peers.every(c=>!c.review&&!c.pos.issues.length&&c.pos.devices.every(d=>d.qty===0||
            d.qty>0&&standardItem(clean(d.raw||d.item).normalize('NFKC'))===paperItem))){
        const group=JSON.stringify([quote,...peers.map(c=>c.id)]);
        if(!freightCandidates.has(group))freightCandidates.set(group,{pos:p,peers:peers.length,cases:new Map()});
        freightCandidates.get(group).cases.set(order.id,caseRows.map(({row})=>row));
      }
    }
    const freightAfter=new Map();
    for(const {pos,peers,cases} of freightCandidates.values()){
      if(cases.size!==peers)continue;
      const lines=[...cases.values()].flat();
      if(!lines.length||lines.some(row=>standardItem(row[13])!==paperItem))continue;
      const amounts=lines.map(row=>{
        const gross=sapNumeric(row[14]), qty=sapNumeric(row[15]);
        return gross!==null&&qty>0?cents(gross)*qty:null;
      });
      const gross=amounts.reduce((sum,amount)=>sum+amount,0);
      if(amounts.includes(null)||gross<=0||gross>cents(100000))continue;
      const freight=Array(sapHeaders.length).fill(null);
      Object.assign(freight,{1:pos.shopId||null,2:pos.quote,4:'運費',7:pos.merchant||null,13:'運費',14:150,15:1,16:143});
      freightAfter.set(lines.at(-1),fillSapOrderDates(freight,pos));
    }
    if (!rows.length && !notes.length) throw Error('勾選的案件沒有可輸出的設備資料。');
    const book = XLSX.utils.book_new();
    const output=rows.flatMap(row=>freightAfter.has(row)?[row,freightAfter.get(row)]:[row]);
    formatSapDates(addSheet(book, sapName, sapHeaders, output), output.length);
    if(output.length){
      book.Workbook={Names:[{Name:'SAP_Copy_Range',Ref:"'"+sapName+"'!$A$2:$AC$"+(output.length+1)}]};
    }
    const unique = [...new Map(notes.map(n => [JSON.stringify(n), n])).values()];
    if (unique.length) addSheet(book, '待確認', ['來源列', '報價單編號', '公司名稱', '待確認事項'], unique);
    appendVendorSheets(book,state,orders);
    return book;
  }
  function requestRows(wb, vendor, source) {
    const data = chooseInvoiceSheet(wb,true);
    return data.rows.map(r => ({
      vendor, source,
      quote: clean(findVal(r, ['報價單編號', '報價單號'])),
      no: clean(findVal(r, ['發票號碼', '憑證文件號碼', '請款憑證'])),
      date: clean(findVal(r, ['發票日期', '憑證日期'])),
      net: clean(findVal(r, ['金額（未稅）', '金額(未稅)', '未稅金額'])),
      gross: clean(findVal(r, ['金額（含稅）', '金額(含稅)', '含稅金額', '金額'])),
      tax: clean(findVal(r, ['稅額', '營業稅'])),
      pr: requestNo(findVal(r, ['請款單號', 'vk請款單', '設備請款單號'])),
      requestDate: clean(findVal(r, ['請款日期', '建檔日期'])),
      memo: clean(findVal(r, ['請款描述', '摘要說明', '說明'])),
      taxId: clean(findVal(r, ['供應商統一編號'])),
    })).filter(r => r.no || r.pr);
  }
  function restore(raw) {
    const state = typeof raw==='string'?JSON.parse(raw):raw;
    if (!state || state.version !== 1 || !Array.isArray(state.cases) || !Array.isArray(state.invoices) ||
        !Array.isArray(state.quotes) || state.cases.length > 20000 || state.invoices.length > 20000 ||
        state.quotes.length > 40000 || (state.sap && (!Array.isArray(state.sap.rows) || state.sap.rows.length > 20000))) {
      throw Error('工作檔格式不符或資料量過大。');
    }
    const ids = new Set(), keys = new Set();
    for (const c of state.cases) {
      if (!c?.id || typeof c.id !== 'string' || ids.has(c.id) || !Array.isArray(c.pos?.devices) ||
          !Number.isInteger(c.pos.row) || c.pos.row < 1 ||
          !c.pos.devices.every(d => d && typeof d.item === 'string' && typeof d.raw === 'string' &&
            Number.isInteger(d.slot) && d.slot > 0 && d.slot <= 5 && (d.qty === null || Number.isSafeInteger(d.qty) && d.qty > 0)) ||
          !Array.isArray(c.pos.issues) || !Array.isArray(c.docs) || !c.orders || !c.sale || !c.bills) throw Error('工作檔的案件資料不完整。');
      ids.add(c.id);
      for(const doc of c.docs){
        if(doc?.archiveKey&&!(typeof doc.archiveKey==='string'&&/^[a-f\d]{64}$/.test(doc.archiveKey)))
          throw Error('工作檔的原始 PDF 索引格式不符。');
        if(!doc?.pair)continue;
        const {key,related,issues,orderFallback}=doc.pair;
        let parts;
        try{parts=JSON.parse(key);}catch{throw Error('工作檔的單據配對格式不符。');}
        const textList=list=>Array.isArray(list)&&list.every(value=>typeof value==='string');
        if(!textList(parts)||parts.length!==3||parts[0]!==doc.vendor||!textList(related)||!textList(issues)||
            (orderFallback!==undefined&&typeof orderFallback!=='string'))throw Error('工作檔的單據配對格式不符。');
      }
    }
    for (const inv of state.invoices) {
      const verified = invoiceData(inv);
      if(inv.corrections!==undefined&&(!Array.isArray(inv.corrections)||inv.corrections.some(event=>
        ![event?.from,event?.to].every(v=>/^[A-Z]{2}\d{8}$/.test(v?.no)&&/^\d{4}-\d{2}-\d{2}$/.test(v.date))||
        typeof event.at!=='string')))throw Error('工作檔的發票修正紀錄不完整。');
      if (inv.key !== invoiceKey(verified.vendor, verified.no) || keys.has(inv.key) || !Array.isArray(inv.links) ||
          !inv.links.length || inv.links.some(l => !ids.has(l.caseId) || !Array.isArray(l.slots) ||
            (l.net !== null && typeof l.net !== 'number') || (l.gross !== null && typeof l.gross !== 'number'))) throw Error('工作檔的發票連結不完整。');
      if (new Set(inv.links.map(l => l.caseId)).size !== inv.links.length ||
          inv.links.some(l => l.slots.some(slot => !Number.isInteger(slot) || slot < 1 || slot > 5))) {
        throw Error('工作檔的發票關聯重複或設備欄位無效。');
      }
      keys.add(inv.key);
    }
    return state;
  }
  return {vendors, sapName, sapHeaders, hmHeaders, create, desc, hasVendor, quoteKey, date, amount, posRows, previewPos,
    commitPos, attachInvoice, correctInvoice, invoiceLinks, invoiceData, allocation, linkSlots, billStatus, descriptionFor,
    isReady, orderMessages, billWorkbook, huamaoWorkbook, sapTemplate, quotationRows, salesCandidates,
    sapWorkbook, requestRows, restore, quotationDocument, setSapPrices, sapPriceCount};
})();

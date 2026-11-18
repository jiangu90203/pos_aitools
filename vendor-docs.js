/* PDF text-layer extraction for the four observed supplier document layouts. */
const VendorDocs = (() => {
  const kinds = ['銷貨單','發票'];
  const issuers = {'華茂':'華茂資訊股份有限公司','拍檔':'拍檔亞太股份有限公司'};
  const salesTitles = {'華茂':['銷貨憑單','銷貨單'],'拍檔':['出貨單']};
  const compact = s => clean(s).replace(/\s/g,'');
  function number(s) {
    const raw=clean(s);
    if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?$/.test(raw))return null;
    const value=Number(raw.replace(/,/g,''));
    return Number.isSafeInteger(Math.round(value*1000))?value:null;
  }
  const line = row => row.map(c=>c.text).join(' ');
  const currency = '(\\d[\\d,]*(?:\\.\\d{1,3})?)(?![\\d,.])';
  const datePattern = /((?:20\d{2}|1\d{2})[-/.年]\d{1,2}[-/.月]\d{1,2}日?)(?!\d)/;
  const invoicePattern = /發票號碼[:：]?([A-Z]{2}\d{8})(?!\d)/i;
  const partnerShip = /出貨單號[:：]?(S41-\d+)/i;
  const dateOf = value => {
    try{return value?Cases.date(value.replace(/[年月]/g,'-').replace(/日$/,'')):'';}
    catch{return '';}
  };
  function group(items) {
    const cells=items.filter(i=>i.transform && clean(i.str)).map(i=>({
      x:i.transform[4],y:i.transform[5],width:i.width,text:clean(i.str)
    })).sort((a,b)=>b.y-a.y);
    const rows=[];
    for(const cell of cells){
      const last=rows.at(-1);
      if(last&&last[0].y-cell.y<=2.2)last.push(cell);
      else rows.push([cell]);
    }
    return rows.map(row=>row.sort((a,b)=>a.x-b.x));
  }
  function tableRows(page, vendor, kind, warnings) {
    const sale=kind==='銷貨單';
    const header=page.findIndex(row=>{
      const t=compact(line(row));
      return /數量.*單價.*金額/.test(t) &&
        (sale ? t.includes('產品編號') : t.includes('品名')&&t.includes('備註'));
    });
    if(header<0)return [];
    const columns=page[header];
    const quantity=columns.find(c=>/^(?:出貨)?數量$/.test(compact(c.text)));
    const code=columns.find(c=>compact(c.text)==='產品編號');
    const note=columns.find(c=>/^(備註|備|分錄備註)$/.test(compact(c.text)));
    const amountIndex=columns.findLastIndex(c=>/^(金額|含稅金額|金)$/.test(compact(c.text)));
    if(!quantity||amountIndex<0||(sale&&!code)){
      warnings.push('品項表頭版型無法可靠辨識。');return [];
    }
    const monetaryEnd = note ? (columns[amountIndex].x + columns[amountIndex].width + note.x)/2 : Infinity;
    const result=[];
    for(let i=header+1;i<page.length;i++){
      const row=page[i], raw=line(row), t=compact(raw);
      if(/銷售額合計|發票日期[:：]|本幣小計|原幣小計|由\d+\/|單據編號[:：]/.test(t))break;
      const left=row.filter(c=>c.x<quantity.x-8);
      const n=row.filter(c=>c.x>=quantity.x-8&&(!sale||vendor!=='拍檔'?c.x+c.width/2<monetaryEnd:true)).map(c=>number(c.text)).filter(v=>v!==null);
      const expected=sale&&vendor==='華茂'?4:3;
      if(!left.length)continue;
      const position = sale ? number(left[0].text) : null;
      if(sale&&(position===null||!Number.isInteger(position)||position<1))continue;
      if(n.length!==expected){
        warnings.push('有品項的數量或金額欄位無法可靠辨識。');continue;
      }
      const item={name:'',code:'',unit:'',quantity:n[0],unitPrice:n[1],net:n[2],
        gross:expected===4?n[3]:null,raw};
      if(!sale)item.name=line(left);
      else if(vendor==='華茂'){
        item.code=left[1]?.text||'';
        item.name=line(left.slice(2));
        item.unit=row.find(c=>/^(台|套|組|個|支|PCS|SET)$/i.test(c.text))?.text||'';
      }else{
        const codeCell=left.find(c=>Math.abs(c.x-code.x)<=3);
        item.code=codeCell?.text||'';
        item.name=line((page[i+1]||[]).filter(c=>c.x>=code.x-3 && c.x<quantity.x-8));
        item.unit=left.find(c=>/^(PCS|SET)$/i.test(c.text))?.text||'';
        if(item.name){item.raw+=' / '+line(page[++i]);}
      }
      if(!item.name||!Number.isFinite(item.quantity)||item.quantity<=0){
        warnings.push('有品項的名稱或數量待確認。');continue;
      }
      result.push(item);
    }
    return result;
  }
  function parse(packet, fileName, vendor, kind) {
    const pages=packet.map(page=>page.rows);
    const rows=pages.flat(), text=rows.map(line).map(compact);
    if(!text.some(Boolean))throw Error('這份 PDF 沒有文字層。請使用同一份單據的原始電子 PDF，或使用原有手動發票表單。');
    const needsReview=message=>Object.assign(new Error(message),{code:'VENDOR_DOC_REVIEW'});
    const recognized = Object.keys(issuers).filter(v=>text.some(t=>t.startsWith(issuers[v])));
    if(recognized.length!==1)throw needsReview('無法唯一辨識廠商抬頭。請核對原件，或使用案件詳情的手動補登。');
    if(vendor&&vendor!==recognized[0])throw Error('文件抬頭為'+recognized[0]+'，請改用正確的匯入欄位。');
    vendor=recognized[0];
    kind=kind||(text.includes('電子發票證明聯')?'發票':
      salesTitles[vendor].some(title=>text.includes(title))?'銷貨單':'');
    if(!kinds.includes(kind))throw needsReview('無法辨識文件類型。請核對原件，或使用案件詳情的手動補登。');
    const sale=kind==='銷貨單';
    const typeTitle=sale ? salesTitles[vendor].find(title=>text.includes(title)) : '電子發票證明聯';
    if(text.includes('電子發票證明聯')&&salesTitles[vendor].some(title=>text.includes(title)))throw needsReview('同頁包含銷貨單及發票。');
    if(!typeTitle||!text.includes(typeTitle))throw Error('文件類型與「'+vendor+kind+'」不符，或文字版型無法辨識。');
    const read=(re, label)=>{
      const matches=[...new Set(text.flatMap(s=>[...s.matchAll(new RegExp(re.source,re.flags.replace('g','')+'g'))].map(m=>m[1])))];
      if(matches.length>1)throw needsReview('同一份文件有多個'+label+'，請拆成個別單據後匯入。');
      return matches[0]||'';
    };
    const sourceFields={};
    const take=(label,re)=>{
      const value=read(re,label);
      if(value)sourceFields[label]=value;
      return value;
    };
    const warnings=[];
    const legacy=vendor==='華茂'&&sale?packet.map(p=>extractSalesRecordFromText(p.raw,fileName,p.page)):[];
    const fallback=field=>{
      const values=[...new Set(legacy.map(p=>p[field]).filter(Boolean))];
      if(values.length>1)throw needsReview('同一單據的'+field+'有衝突。');
      return values[0]||'';
    };
    const invoiceNo=(take('發票號碼',invoicePattern)||fallback('發票號碼')).toUpperCase();
    const shipNo=vendor==='華茂' ? take('銷貨單號',/銷貨單號[:：]?(\d{8,})(?!\d)/)||fallback('銷貨單號') : take('出貨單號',sale?/(?:出貨單號|單據編號)[:：]?(S41-\d+)/i:partnerShip);
    const orderNo=vendor==='拍檔' ? take('訂單單號',/(?:訂單單號|訂單編號)[:：]?(S21-\d+)/i) : '';
    const shipDate=sale ? dateOf(take(vendor==='華茂'?'銷貨日期':'出貨日期',
      new RegExp((vendor==='華茂'?'銷貨日期':'出貨日期')+'[:：]?'+datePattern.source))) : '';
    let invoiceDate=dateOf(take('發票日期',new RegExp('發票日期[:：]?'+datePattern.source))||fallback('發票日期'));
    if(!sale&&!sourceFields['發票日期']){
      const dates=[...new Set(pages.map(page=>{
        const index=page.findIndex(row=>compact(line(row))===typeTitle);
        return index<0?'':page.slice(index+1,index+3).map(row=>
          compact(line(row)).match(new RegExp('^'+datePattern.source+'$'))?.[1]).find(Boolean)||'';
      }).filter(Boolean))];
      if(dates.length>1)throw needsReview('同一份文件有多個發票日期，請拆成個別單據後匯入。');
      if(dates[0])sourceFields['發票日期']=dates[0];
      invoiceDate=dateOf(dates[0]);
    }
    const money=(label,pattern)=>number(take(label,new RegExp(pattern+currency)));
    const net=sale ? (vendor==='華茂'?money('合計','合計[:：]'):money('本幣小計','^本幣小計[:：]?')) :
      money('銷售額合計','^銷售額合計[:：]?');
    const tax=sale ? (vendor==='華茂'?money('稅金','稅金[:：]'):money('稅額','^稅額[:：]?')) :
      money('營業稅','^營業稅(?:應稅[Vv✓]?)?(?:零稅率[Vv✓]?)?(?:免稅[Vv✓]?)?');
    const gross=(sale&&vendor==='拍檔'?money('本幣合計','^本幣合計[:：]?'):
      money('總計',sale?'總計[:：]':'^總計[:：]?'))??(fallback('總計')||null);
    const recipient=sale&&vendor==='華茂' ? take('收件公司',/^公司名稱[:：](.+)$/) :
      sale ? take('轉寄資訊',/^貨寄[:：](.+)$/) : '';
    // The observed partner shipping layout puts the recipient / contact in a dedicated cell.
    const shipRow=sale&&vendor==='拍檔'?rows.find(row=>/^貨寄[:：]/.test(compact(line(row)))):null;
    const shipCell=shipRow?.find(c=>/^[^/]+\s+\/\s+[^/]+$/.test(c.text)&&!/[：:]/.test(c.text));
    const [partnerCompany='',partnerContact='']=shipCell?.text.split(/\s+\/\s+/)||[];
    const shipCompany=vendor==='華茂'?recipient||fallback('公司名稱'):partnerCompany;
    const shipContact=sale&&vendor==='華茂'?take('收件聯絡人',/^聯絡人[:：](.+)$/):partnerContact;
    const shipPhone=sale&&vendor==='華茂'?take('收件電話',/^電話[:：]([\d#-]+)$/):
      shipRow?.find(c=>/^\d{2,4}-\d{6,8}$/.test(c.text))?.text||'';
    const buyer=take('帳款客戶',vendor==='華茂'&&sale?/^客戶名稱[:：]\d{8}(.+?)統一編號[:：]/:
      sale?/^帳款客戶[:：]([^()]+)\(/:/^買方[:：](.+?)(?:隨機碼[:：]|$)/)||fallback('客戶名稱');
    const items=pages.flatMap(page=>tableRows(page,vendor,kind,warnings));
    const id=sale?(shipNo||(vendor==='華茂'&&invoiceNo?'發票:'+invoiceNo:'')):invoiceNo;
    if(!id)warnings.push('缺少可辨識的文件單號。');
    if(!(sale?shipDate:invoiceDate))warnings.push('缺少有效的文件日期。');
    if([net,tax,gross].some(n=>n===null))warnings.push('未稅、稅額或含稅總額有缺漏。');
    const cents=n=>Math.round(n*100);
    const validTotals=[net,tax,gross].every(n=>n!==null)&&cents(net)+cents(tax)===cents(gross);
    if(!validTotals&&[net,tax,gross].every(n=>n!==null))warnings.push('未稅加稅額不等於含稅總額。');
    if(!items.length)warnings.push('沒有成功辨識的品項。');
    const linesMatch=items.length>0&&net!==null&&items.reduce((sum,r)=>sum+cents(r.net),0)===cents(net);
    if(items.length&&net!==null&&!linesMatch)warnings.push('品項未稅金額合計與單據未稅總額不同。');
    if(items.some(i=>cents(i.quantity*i.unitPrice)!==cents(i.net)))warnings.push('有品項的數量乘單價與未稅金額不同。');
    if(sale&&vendor==='華茂'&&items.length&&gross!==null&&items.reduce((sum,i)=>sum+cents(i.gross),0)!==cents(gross)){
      warnings.push('品項含稅金額合計與單據含稅總額不同。');
    }
    if(!sale&&invoiceNo&&invoiceDate&&validTotals){
      try{Cases.invoiceData({vendor,no:invoiceNo,date:invoiceDate,net,tax,gross});}
      catch(err){warnings.push(err.message);}
    }
    const invoiceReady=!sale&&!!(invoiceNo&&invoiceDate)&&validTotals&&linesMatch&&!warnings.length;
    return {key:id?JSON.stringify([vendor,kind,id]):'',name:fileName,pages:packet.map(p=>p.page),vendor,kind,id,shipNo,shipDate,invoiceNo,invoiceDate,orderNo,
      recipient,shipCompany,shipContact,shipPhone,buyer,net,tax,gross,items,sourceFields,warnings:[...new Set(warnings)],invoiceReady};
  }
  async function readRecords(file,vendor,kind) {
    const pages=await readPdfRecords(file,(raw,_name,page,items)=>({raw,page,rows:group(items)}));
    const groups=[];
    for(const page of pages){
      const lines=page.rows.map(line).map(compact), text=lines.join(' ');
      const type=lines.includes('電子發票證明聯')?'發票':lines.some(s=>s==='銷貨憑單'||s==='出貨單'||s==='銷貨單')?'銷貨單':'';
      const id=type==='發票'?text.match(invoicePattern)?.[1]:
        (text.match(/銷貨單號[:：]?(\d{8,})/i)||text.match(/(?:出貨單號|單據編號)[:：]?(S41-\d+)/i))?.[1];
      const supplier=Object.keys(issuers).find(v=>lines.some(t=>t.startsWith(issuers[v])));
      const prev=groups.at(-1);
      if(prev&&text&&(!supplier||!prev.supplier||supplier===prev.supplier)&&
        (!type||type===prev.type&&id&&id===prev.id)&&!prev.pages.some(p=>p.raw===page.raw)){
        prev.pages.push(page);
      } else groups.push({type,id,supplier,pages:[page]});
    }
    return groups.map(group=>{
      const pages=group.pages.map(p=>p.page);
      try{return {doc:parse(group.pages,file.name,vendor,kind),pages};}
      catch(err){return {error:err,pages};}
    });
  }
  async function read(file,vendor,kind) {
    const records=await readRecords(file,vendor,kind);
    if(records.length!==1)throw Error('此 PDF 有多筆文件，請使用批次匯入。');
    if(records[0].error)throw records[0].error;
    return records[0].doc;
  }
  const documents = order => order.docs.filter(d=>d?.key&&Object.hasOwn(issuers,d.vendor)&&kinds.includes(d.kind)&&
    d.parsed?.key===d.key&&Array.isArray(d.parsed.items)&&Array.isArray(d.parsed.warnings));
  const pageLabel = pages => Array.isArray(pages)?pages.filter(p=>Number.isInteger(p)&&p>0).join('、'):'';
  function invoiceFields(state,order,doc,linked=Cases.invoiceLinks(state,order,doc.vendor)) {
    const candidates=new Map();
    const entries=linked.filter(({inv})=>inv.vendor===doc.vendor);
    for(const {parsed:ref} of documents(order)){
      if(ref.vendor!==doc.vendor||ref.kind!=='發票'||!ref.invoiceReady)continue;
      const sameNumber=doc.invoiceNo&&doc.invoiceNo===ref.invoiceNo;
      if(doc.invoiceNo?!sameNumber:(!doc.shipNo||doc.shipNo!==ref.shipNo))continue;
      const inv=entries.find(({inv})=>inv.no===ref.invoiceNo||
        (inv.source===ref.name&&inv.corrections?.some(event=>event.from.no===ref.invoiceNo)))?.inv;
      if(inv)candidates.set(inv.key,inv);
    }
    if(doc.invoiceNo&&!candidates.size){
      const inv=entries.find(({inv})=>inv.no===doc.invoiceNo||
        (inv.source===doc.name&&inv.corrections?.some(event=>event.from.no===doc.invoiceNo)))?.inv;
      if(inv)candidates.set(inv.key,inv);
    }
    const current=candidates.size===1?[...candidates.values()][0]:null;
    return {no:current?.no||doc.invoiceNo,date:current?.date||doc.invoiceDate,ambiguous:candidates.size>1};
  }
  function association(state,order,doc) {
    if(!Cases.hasVendor(order,doc.vendor))throw Error('此案件沒有'+doc.vendor+'的設備，無法關聯。');
    if(!doc.key)throw Error('缺少文件單號，請核對原始文件。');
    const other=state.cases.find(c=>c.id!==order.id&&documents(c).some(d=>d.key===doc.key));
    if(other)throw Error('此文件已關聯其他案件。請核對原案件或依既有發票分攤流程處理。');
    const existing=documents(order).filter(d=>d.vendor===doc.vendor).map(d=>d.parsed);
    const evidence=[];
    if(doc.recipient&&doc.vendor==='華茂'&&compact(doc.recipient)===compact(order.pos.merchant)) evidence.push('收件公司與商家相符');
    if(doc.invoiceNo && Cases.invoiceLinks(state,order,doc.vendor).some(({inv})=>inv.no===doc.invoiceNo))evidence.push('與案件發票號碼相符');
    for(const [key,label] of [['shipNo','銷貨／出貨單號'],['invoiceNo','發票號碼'],['orderNo','廠商訂單單號']]){
      if(doc[key]&&existing.some(d=>d[key]===doc[key]&&d.kind!==doc.kind))evidence.push('與案件已存文件的'+label+'相符');
    }
    return evidence;
  }
  function save(state,order,doc,replaceKey,linkInvoice,automatic=false) {
    association(state,order,doc);
    const prior=replaceKey&&documents(order).find(d=>d.key===replaceKey);
    if(replaceKey&&(!prior||prior.vendor!==doc.vendor||prior.kind!==doc.kind))throw Error('找不到可替換的同廠商、同類型文件。');
    if(documents(order).some(d=>d.key===doc.key&&d!==prior))throw Error('同一單號已匯入。請從已保存的文件使用「替換」。');
    if(linkInvoice){
      if(prior&&prior.parsed.invoiceNo!==doc.invoiceNo&&Cases.invoiceLinks(state,order,doc.vendor).some(({inv})=>inv.no===prior.parsed.invoiceNo)){
        throw Error('原文件對應的發票仍連結此案件。請先核對舊發票，或取消帶入發票欄位後只替換文件。');
      }
      if(!doc.invoiceReady)throw Error('發票解析不完整，請以原件人工核對。');
      const same=state.invoices.find(inv=>inv.vendor===doc.vendor&&inv.no===doc.invoiceNo);
      if(automatic&&same&&!same.links.some(l=>l.caseId===order.id))
        throw Error('發票已關聯其他採購批次。');
      const invoice=Cases.attachInvoice(state,order,{vendor:doc.vendor,no:doc.invoiceNo,date:doc.invoiceDate,net:doc.net,tax:doc.tax,gross:doc.gross,source:doc.name});
      if(automatic&&!same&&!order.review&&!order.pos.issues.length)invoice.links[0].confirmed=true;
    }
    const attachment={key:doc.key,name:doc.name,kind:doc.kind,vendor:doc.vendor,summary:doc.id,parsed:doc};
    if(prior)order.docs.splice(order.docs.indexOf(prior),1,attachment);
    else order.docs.push(attachment);
  }
  function signature(doc) {
    const {name,pages,...record}=doc;
    return JSON.stringify(record);
  }
  const identifiers = doc => ['shipNo','invoiceNo'].flatMap(field=>doc[field]?
    [JSON.stringify([doc.vendor,field,compact(doc[field]).toUpperCase()])]:[]);
  const digits=s=>clean(s).replace(/\D/g,'');
  function shippingRank(doc,c,anchored) {
    const company=doc.shipCompany||(doc.vendor==='華茂'?doc.recipient:'');
    const contact=doc.shipContact&&c.pos.contact;
    const phone=digits(doc.shipPhone)&&digits(c.pos.phone);
    const verified=(contact||phone)&&(!contact||compact(c.pos.contact)===compact(doc.shipContact))&&
      (!phone||digits(c.pos.phone)===digits(doc.shipPhone));
    if(anchored&&!verified)return 0;
    if(doc.vendor==='拍檔'){
      if((contact||phone)&&!verified)return 0;
      const name=normalizeMerchantName(company);
      return name&&name===normalizeMerchantName(c.pos.merchant)?(verified?150:100):0;
    }
    const sales={公司名稱:company,客戶名稱:doc.buyer,總計:doc.gross};
    if(!salesRecordScore(c.pos.merchant,sales))return 0;
    const lines=c.pos.devices.filter(d=>vendorForItem(d.item)==='華茂'&&d.qty>0);
    const reliable=lines.length&&!c.pos.issues.length&&lines.every(d=>Object.hasOwn(COST,d.item));
    const expected=reliable?hmAmount(aggregateVendorItems(lines)):0;
    const rank=salesRecordScore(c.pos.merchant,sales,expected,true);
    return rank?(verified?50:0)+rank:0;
  }
  function planBatch(state, docs) {
    const identities=new Map(), attached=new Map(), supplierCases=new Map(), alreadyShipped=new Map(), invoiceRecords=new Map();
    const insert=(map,key,value)=>{
      if(!map.has(key))map.set(key,new Set());
      map.get(key).add(value);
    };
    for(const c of state.cases){
      for(const vendor of Cases.vendors.filter(v=>Cases.hasVendor(c,v)))insert(supplierCases,vendor,c);
      for(const d of documents(c)){
        insert(attached,d.key,c);
        if(d.kind==='銷貨單')insert(alreadyShipped,d.vendor,c);
        identifiers(d.parsed).forEach(key=>insert(identities,key,c));
      }
    }
    const cases=new Map(state.cases.map(c=>[c.id,c]));
    for(const inv of state.invoices){
      const key=JSON.stringify([inv.vendor,'invoiceNo',inv.no]);
      invoiceRecords.set(key,inv);
      for(const l of inv.links)if(cases.has(l.caseId))insert(identities,key,cases.get(l.caseId));
    }
    // SAP contributes only exact purchase invoice / quote / SHOP ID matches with a known supplier.
    const byShopQuote=new Map();
    for(const c of state.cases){
      if(c.pos.quote&&c.pos.shopId)insert(byShopQuote,JSON.stringify([Cases.quoteKey(c.pos.quote),norm(c.pos.shopId)]),c);
    }
    for(const row of state.sap?.rows||[]){
      const vendor={'華茂資訊':'華茂','華茂':'華茂','拍檔':'拍檔'}[clean(row[21])], no=clean(row[24]).toUpperCase();
      if(!vendor||!/^[A-Z]{2}\d{8}$/.test(no)||!row[1]||!row[2])continue;
      const matches=byShopQuote.get(JSON.stringify([Cases.quoteKey(row[2]),norm(row[1])]))||[];
      for(const c of matches)if(Cases.hasVendor(c,vendor))insert(identities,JSON.stringify([vendor,'invoiceNo',no]),c);
    }
    const sets=new Map(), copies=new Map(), conflicts=new Set();
    docs.forEach((doc,i)=>{
      if(doc.key){
        if(!copies.has(doc.key))copies.set(doc.key,i);
        else if(signature(docs[copies.get(doc.key)])!==signature(doc))conflicts.add(doc.key);
      }
    });
    const blocked = new Set(docs.filter(doc=>conflicts.has(doc.key)).flatMap(identifiers));
    const usable = doc => doc.key&&!conflicts.has(doc.key);
    // Shared orders can span several deliveries, so only exact invoice/ship identifiers are joined.
    docs.forEach((doc,i)=>{
      if(usable(doc))identifiers(doc).forEach(key=>insert(sets,key,i));
    });
    const groups=new Map();
    docs.forEach((doc,i)=>{
      if(groups.has(i))return;
      const group={candidates:new Set(),invalid:false,mismatch:false,conflict:false,anchored:false,shipping:false};
      groups.set(i,group);
      if(!usable(doc))return;
      const queue=[i], seen=new Set(), processedKeys=new Set();
      for(let cursor=0;cursor<queue.length;cursor++){
        const n=queue[cursor];
        if(seen.has(n))continue;
        seen.add(n); groups.set(n,group);
        const d=docs[n];
        for(const key of identifiers(d)){
          if(processedKeys.has(key))continue;
          processedKeys.add(key);
          if(blocked.has(key))group.conflict=true;
          for(const c of identities.get(key)||[]){
            if(Cases.hasVendor(c,d.vendor))group.candidates.add(c);
            else group.invalid=true;
          }
          for(const j of sets.get(key)||[])if(j!==n&&!seen.has(j))queue.push(j);
        }
      }
      group.anchored=group.candidates.size>0;
      const ships=[...seen].map(n=>docs[n]).filter(d=>d.kind==='銷貨單');
      group.shipping=ships.length>0;
      for(const d of ships){
        if(attached.has(d.key))continue;
        let best=0, candidates=[];
        for(const c of supplierCases.get(d.vendor)||[]){
          if(!group.anchored&&alreadyShipped.get(d.vendor)?.has(c))continue;
          const score=shippingRank(d,c,group.anchored);
          if(score>best){best=score;candidates=[c];}
          else if(score&&score===best)candidates.push(c);
        }
        // An existing exact document number takes precedence over loose names.
        if(!group.anchored||candidates.length===1){
          for(const c of candidates)group.candidates.add(c);
        }
      }
      const totals=new Map();
      const invoiceNos=new Set([...seen].map(n=>docs[n]).filter(d=>d.kind==='發票').map(d=>d.invoiceNo));
      if(invoiceNos.size>1)group.conflict=true;
      for(const n of seen){
        const d=docs[n];
        if(!d.invoiceNo)continue;
        const invoiceKey=JSON.stringify([d.vendor,'invoiceNo',d.invoiceNo]);
        const prior=totals.get(invoiceKey);
        const conflictingAmount=(a,b)=>['net','tax','gross'].some(key=>a[key]!=null&&b[key]!=null&&a[key]!==b[key]);
        if(prior&&(conflictingAmount(prior,d)||
          (prior.invoiceDate&&d.invoiceDate&&prior.invoiceDate!==d.invoiceDate)))group.mismatch=true;
        const savedInvoice=invoiceRecords.get(invoiceKey);
        if(savedInvoice&&(conflictingAmount(savedInvoice,d)||
          (d.invoiceDate&&savedInvoice.date!==d.invoiceDate)))group.mismatch=true;
        if(!prior?.invoiceDate)totals.set(invoiceKey,d);
      }
    });
    const shipments=new Map();
    docs.forEach((doc,i)=>{
      const g=groups.get(i);
      if(g.shipping&&g.candidates.size===1&&usable(doc)){
        g.target=[...g.candidates][0].id;
        insert(shipments,JSON.stringify([doc.vendor,g.target]),g);
      }
    });
    return docs.map((doc,i)=>{
      const group=groups.get(i);
      const matches=[...group.candidates].map(c=>c.id);
      const previous=[...attached.get(doc.key)||[]].map(c=>c.id);
      let reason='';
      let type='unmatched';
      if(!doc.key){reason=doc.warnings.join('；')||'文件識別欄位不足。';type='failed';}
      else if(previous.length||conflicts.has(doc.key)||copies.get(doc.key)!==i){
        type='duplicate';
        reason=previous.length?'同單號已保存，保留原資料。':conflicts.has(doc.key)?'同批有相同單號且內容不同。':'同批文件重複，已略過。';
      }
      else if(group.conflict)reason='關聯文件有相同單號且內容不同，或同一出貨單對應多張發票。';
      else if(group.invalid)reason='文件識別與案件供應商不一致。';
      else if(group.mismatch)reason='發票金額或日期有衝突。';
      else if(matches.length>1)reason='有多個同分候選案件。';
      else if(!matches.length)reason='沒有可靠的商家、金額或單號配對。';
      else if(!group.anchored&&shipments.get(JSON.stringify([doc.vendor,group.target]))?.size>1)
        reason='多份銷貨單指向同一案件，無法區分採購批次。';
      return {doc,caseId:!reason?matches[0]:'',matches,type:reason?type:'ready',reason};
    });
  }
  return {kinds,read,readRecords,association,save,documents,pageLabel,invoiceFields,planBatch};
})();

/* PDF text-layer extraction for the four observed supplier document layouts. */
const VendorDocs = (() => {
  const kinds = ['銷貨單','發票'];
  const issuers = {'華茂':'華茂資訊股份有限公司','拍檔':'拍檔亞太股份有限公司'};
  const issuerIds = {'華茂':'27632985','拍檔':'83008274'};
  const aliases = {'華茂':['華茂資訊','華茂資訊公司'],'拍檔':['拍檔亞太','拍檔亞太公司']};
  const salesTitles = {'華茂':['銷貨憑單','銷貨單'],'拍檔':['出貨單']};
  const compact = s => clean(s).normalize('NFKC').replace(/\s/g,'');
  const separator = '[-‐‑‒–—−]';
  const invoicePattern = new RegExp('發票號碼[:：]?([A-Z]{2}'+separator+'?\\d{8})(?![A-Z0-9])','i');
  const partnerShip = new RegExp('出貨單號[:：]?(S41'+separator+'?\\d{8})(?![A-Z0-9-])','i');
  const deliveryPattern = new RegExp('(?:出貨單號|單據編號)[:：]?(S41'+separator+'?\\d{8})(?![A-Z0-9-])','i');
  const orderPattern = new RegExp('(?:訂單單號|訂單編號)[:：]?(S21'+separator+'?\\d{8})(?![A-Z0-9-])','i');
  const salePattern = /銷貨單號[:：]?(\d{8,})(?![A-Z0-9])/i;
  const invoiceNumber = value => {
    const no=compact(value).toUpperCase().replace(new RegExp(separator,'g'),'');
    return /^[A-Z]{2}\d{8}$/.test(no)?no:'';
  };
  const partnerNumber = (value, prefix) => {
    const no=compact(value).toUpperCase().replace(new RegExp(separator,'g'),'');
    return new RegExp('^'+prefix+'\\d{8}$').test(no)?prefix+'-'+no.slice(3):'';
  };
  const issuerOn = text => Object.keys(issuers).filter(v=>text.some(t=>
    t.startsWith(issuers[v])||aliases[v].includes(t)));
  const decimal = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,3})?';
  function number(s) {
    const raw=compact(s).replace(/^(?:NT\$|NTD\$?|TWD\$?|新臺幣|新台幣|\$)/i,'').replace(/元$/,'');
    if(!new RegExp('^'+decimal+'$').test(raw))return null;
    const value=Number(raw.replace(/,/g,''));
    return Number.isSafeInteger(Math.round(value*1000))?value:null;
  }
  const line = row => row.map(c=>c.text).join(' ');
  const rawLine = row => row.map(c=>c.original).join(' ');
  const currency = '((?:(?:NTD|TWD|NT)?\\$|NTD|TWD|新臺幣|新台幣)?'+decimal+'元?)(?![\\d,.])';
  const datePattern = /((?:民國\d{1,3}|\d{3}|\d{4})[-/.年]\d{1,2}[-/.月]\d{1,2}日?)(?!\d)/;
  const dateOf = value => {
    try{return value?Cases.date(compact(value).replace(/^民國(\d{1,3})/,(_,y)=>String(Number(y)+1911)).replace(/[年月]/g,'-').replace(/日$/,'')):'';}
    catch{return '';}
  };
  function group(items) {
    const cells=items.filter(i=>i.transform && clean(i.str)).map(i=>({
      x:i.transform[4],y:i.transform[5],width:i.width,text:clean(i.str),original:i.str
    })).sort((a,b)=>b.y-a.y);
    const rows=[];
    for(const cell of cells){
      const last=rows.at(-1);
      if(last&&last[0].y-cell.y<=2.2)last.push(cell);
      else rows.push([cell]);
    }
    return rows.map(row=>row.sort((a,b)=>a.x-b.x));
  }
  function invoiceNotes(pages) {
    const notes=new Map();
    for(const rows of pages){
      const header=rows.findIndex(row=>/品名.*數量.*單價.*金額.*備註/.test(compact(line(row))));
      if(header<0)continue;
      const columns=rows[header];
      const note=columns.findIndex(c=>/^(備|備註)$/.test(compact(c.text)));
      if(note<1)continue;
      const amount=columns[note-1];
      const boundary=amount.x+amount.width;
      for(const row of rows.slice(header+1)){
        if(/^銷售額合計/.test(compact(line(row))))break;
        notes.set(row,compact(line(row.filter(c=>c.x>=boundary))));
      }
    }
    return notes;
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
    let lastNameRow;
    for(let i=header+1;i<page.length;i++){
      const row=page[i], raw=line(row), t=compact(raw);
      if(/銷售額合計|發票日期[:：]|本幣小計|原幣小計|由\d+\/|單據編號[:：]/.test(t))break;
      const left=row.filter(c=>c.x<quantity.x-8);
      const n=row.filter(c=>c.x>=quantity.x-8&&(!sale||vendor!=='拍檔'?c.x+c.width/2<monetaryEnd:true)).map(c=>number(c.text)).filter(v=>v!==null);
      const expected=sale&&vendor==='華茂'?4:3;
      if(!left.length)continue;
      const name=line(left);
      const huamaoWrap=vendor==='華茂'&&lastNameRow&&lastNameRow.index===i-1&&
        row.length===left.length&&Math.abs(left[0].x-lastNameRow.x)<=2&&
        lastNameRow.y-left[0].y>2&&lastNameRow.y-left[0].y<=15&&
        /[（(][^）)]*$/.test(result.at(-1).name)&&/^[^（(]*[）)]$/.test(name);
      const partnerWrap=vendor==='拍檔'&&/^[A-Z0-9][A-Z0-9./+ -]*$/i.test(name);
      if(!sale&&!n.length&&result.length&&(huamaoWrap||partnerWrap)){
        const previous=result.at(-1);
        previous.name+=(huamaoWrap&&/\p{Script=Han}$/u.test(previous.name)&&/^\p{Script=Han}/u.test(name)?'':' ')+name;
        previous.raw+=' / '+raw;
        lastNameRow={index:i,x:left[0].x,y:left[0].y};
        continue;
      }
      const position = sale ? number(left[0].text) : null;
      if(sale&&(position===null||!Number.isInteger(position)||position<1))continue;
      if(n.length!==expected){
        warnings.push('有品項的數量或金額欄位無法可靠辨識。');continue;
      }
      const item={name:'',code:'',unit:'',quantity:n[0],unitPrice:n[1],net:n[2],
        gross:expected===4?n[3]:null,raw};
      if(!sale)item.name=line(left);
      else if(vendor==='華茂'){
        const product=left[1]?.text||'';
        const combined=left.length===2?product.match(/^([A-Z0-9_-]{4,})\s+(.+)$/i):null;
        item.code=combined?.[1]||product;
        item.name=combined?.[2]||line(left.slice(2));
        item.unit=row.find(c=>/^(台|套|組|個|支|條|PCS|SET)$/i.test(c.text))?.text||'';
      }else{
        const codeCell=left.find(c=>Math.abs(c.x-code.x)<=3);
        item.code=codeCell?.text||'';
        item.name=line((page[i+1]||[]).filter(c=>c.x>=code.x-3 && c.x<quantity.x-8));
        item.unit=left.find(c=>/^(PCS|SET)$/i.test(c.text))?.text||'';
        if(item.name){
          item.raw+=' / '+line(page[++i]);
          while(page[i+1]?.[0].x>=code.x-3&&page[i+1].every(c=>c.x<quantity.x-8)&&
              /^[A-Z0-9][A-Z0-9./+ -]*$/i.test(line(page[i+1]))){
            item.name+=' '+line(page[i+1]);
            item.raw+=' / '+line(page[++i]);
          }
        }
      }
      if(!item.name||!Number.isFinite(item.quantity)||item.quantity<=0){
        warnings.push('有品項的名稱或數量待確認。');continue;
      }
      result.push(item);
      lastNameRow={index:i,x:left[0].x,y:left[0].y};
    }
    return result;
  }
  function parse(packet, fileName, vendor, kind) {
    const pages=packet.map(page=>page.rows);
    const rows=pages.flat(), text=rows.map(line).map(compact);
    if(!text.some(Boolean))throw Error('這份 PDF 沒有文字層。請使用同一份單據的原始電子 PDF，或使用原有手動發票表單。');
    const needsReview=message=>Object.assign(new Error(message),{code:'VENDOR_DOC_REVIEW'});
    const recognized = issuerOn(text);
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
    const sourceFields={};
    const sourceRows={};
    const take=(label,re,normalize=value=>value,accept=()=>true,scope=null)=>{
      const values=new Set();
      const pattern=new RegExp(re.source,re.flags.replace('g','')+'g');
      text.forEach((s,index)=>{
        if(!accept(index))return;
        for(const [,value] of (scope ? scope.get(rows[index])||'' : s).matchAll(pattern)){
          values.add(normalize(value));
          sourceFields[label]??=value;
          (sourceRows[label]??=[]).push(rawLine(rows[index]));
        }
      });
      if(values.size>1)throw needsReview('同一份文件有多個'+label+'，請拆成個別單據後匯入。');
      return [...values][0]||'';
    };
    const warnings=[];
    const legacy=vendor==='華茂'&&sale?packet.map(p=>extractSalesRecordFromText(p.raw,fileName,p.page)):[];
    const fallback=field=>{
      const values=[...new Set(legacy.map(p=>p[field]).filter(Boolean))];
      if(values.length>1)throw needsReview('同一單據的'+field+'有衝突。');
      return values[0]||'';
    };
    const invoiceNo=take('發票號碼',invoicePattern,invoiceNumber)||invoiceNumber(fallback('發票號碼'));
    const notes=vendor==='拍檔'&&!sale?invoiceNotes(pages):null;
    const shipNo=vendor==='華茂' ? take('銷貨單號',salePattern)||fallback('銷貨單號') :
      take('出貨單號',sale?deliveryPattern:partnerShip,value=>partnerNumber(value,'S41'),undefined,notes);
    const orderNo=vendor==='拍檔' ? take('訂單單號',orderPattern,value=>partnerNumber(value,'S21'),undefined,notes) : '';
    const shipDate=sale ? take(vendor==='華茂'?'銷貨日期':'出貨日期',
      new RegExp((vendor==='華茂'?'銷貨日期':'出貨日期')+'[:：]?'+datePattern.source),dateOf) : '';
    let invoiceDate=take('發票日期',new RegExp('發票日期[:：]?'+datePattern.source),dateOf)||dateOf(fallback('發票日期'));
    if(!sale&&!sourceFields['發票日期']){
      const dates=[...new Set(pages.map(page=>{
        const index=page.findIndex(row=>compact(line(row))===typeTitle);
        return index<0?'':page.slice(index+1,index+3).map(rawLine).find(row=>
          new RegExp('^'+datePattern.source+'$').test(compact(row)))||'';
      }).filter(Boolean))];
      if(dates.length>1)throw needsReview('同一份文件有多個發票日期，請拆成個別單據後匯入。');
      if(dates[0]){
        sourceFields['發票日期']=dates[0];
        sourceRows['發票日期']=[dates[0]];
      }
      invoiceDate=dateOf(dates[0]);
    }
    const money=(label,pattern)=>number(take(label,new RegExp(pattern+currency)));
    const net=sale ? (vendor==='華茂'?money('合計','合計[:：]'):money('本幣小計','^本幣小計[:：]?')) :
      money('銷售額合計','^銷售額合計[:：]?');
    const tax=sale ? (vendor==='華茂'?money('稅金','稅金[:：]'):money('稅額','^稅額[:：]?')) :
      money('營業稅','^營業稅(?:應稅[Vv✓]?)?(?:零稅率[Vv✓]?)?(?:免稅[Vv✓]?)?');
    const gross=(sale&&vendor==='拍檔'?money('本幣合計','^本幣合計[:：]?'):
      money('總計',sale?'總計[:：]':'^總計[:：]?'))??(fallback('總計')||null);
    const recipientHeading=text.findIndex(row=>row.includes('設備收件資訊'));
    const inRecipient=i=>recipientHeading<0||i>recipientHeading&&i<=recipientHeading+8;
    const recipient=sale&&vendor==='華茂' ? take('收件公司',/^公司名稱[:：](.+)$/,undefined,inRecipient) :
      sale ? take('轉寄資訊',/^貨寄[:：](.+)$/) : '';
    // The observed partner shipping layout puts the recipient / contact in a dedicated cell.
    const shipRow=sale&&vendor==='拍檔'?rows.find(row=>/^貨寄[:：]/.test(compact(line(row)))):null;
    const shipCell=shipRow?.find(c=>/^[^/]+\s+\/\s+[^/]+$/.test(c.text)&&!/[：:]/.test(c.text));
    const phoneCell=shipRow?.find(c=>/^0[\d -]{7,14}(?:\s*#\s*\d+)?$/.test(c.text));
    const delivery=shipRow?line(shipRow.filter(c=>c!==phoneCell)).replace(/^(?:貨寄\s*[:：]\s*)+/,''):'';
    const explicit=delivery.match(/^(.*?)公司名稱\s*[:：]\s*(.*?)(?:聯絡人\s*[:：]\s*(.*))?$/);
    const [partnerCompany='',partnerContact='']=explicit?explicit.slice(2):shipCell?.text.split(/\s+\/\s+/)||[];
    const shipCompany=vendor==='華茂'?recipient||fallback('公司名稱'):partnerCompany;
    const shipContact=sale&&vendor==='華茂'?take('收件聯絡人',/^聯絡人[:：](.+)$/,undefined,inRecipient):partnerContact;
    const shipPhone=sale&&vendor==='華茂'?take('收件電話',/^電話[:：]([\d#\-+、/,]+)$/,undefined,inRecipient):
      phoneCell?.text||'';
    const shipAddress=sale&&vendor==='華茂'&&recipientHeading>=0?
      take('收件地址',/^(?:收件)?地址[:：](.+)$/,undefined,inRecipient):
      explicit?.[1].trim()||(shipCell?line(shipRow.filter(c=>c.x<shipCell.x)).replace(/^(?:貨寄\s*[:：]\s*)+/,''):'');
    const buyer=take('帳款客戶',vendor==='華茂'&&sale?/^客戶名稱[:：]\d{8}(.+?)統一編號[:：]/:
      sale?/^帳款客戶[:：]([^()]+)\(/:/^買方[:：](.+?)(?:隨機碼[:：]|$)/)||fallback('客戶名稱');
    const buyerLabel=text.findIndex(row=>/^買方[:：]/.test(row));
    const buyerId=sale?take('買方統編',/^客戶名稱[:：].*?統一編號[:：](\d{8})(?!\d)/):
      take('買方統編',/(?:^|買方[:：].*?)統一編號[:：](\d{8})(?!\d)/,undefined,
        i=>buyerLabel>=0&&i>=buyerLabel&&i<=buyerLabel+2);
    const sellerLabel=take('賣方統編',/^統編[:：](\d{8})(?!\d)/);
    const sellerIds=new Set([sellerLabel].filter(Boolean));
    if(!sale){
      for(const [index,row] of text.entries()){
        if(!row.includes('營業人蓋統一發票專用章'))continue;
        for(let i=index;i<Math.min(text.length,index+8);i++){
          const seller=text[i].match(/統一編號[:：](\d{8})(?!\d)/)?.[1];
          if(seller){
            sellerIds.add(seller);
            sourceFields['賣方統編']??=seller;
            (sourceRows['賣方統編']??=[]).push(rawLine(rows[i]));
            break;
          }
        }
      }
    }
    const identityIssues=[];
    if(sellerIds.size>1||[...sellerIds].some(id=>id!==issuerIds[vendor]))
      identityIssues.push('賣方統編與'+vendor+'抬頭有衝突');
    const sellerId=[...sellerIds][0]||'';
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
    const invoiceReady=!sale&&!!(invoiceNo&&invoiceDate)&&validTotals&&linesMatch&&!warnings.length&&!identityIssues.length;
    return {key:id?JSON.stringify([vendor,kind,id]):'',name:fileName,pages:packet.map(p=>p.page),vendor,kind,id,shipNo,shipDate,invoiceNo,invoiceDate,orderNo,
      recipient,shipCompany,shipContact,shipPhone,shipAddress,buyer,buyerId,sellerId,net,tax,gross,items,sourceFields,sourceRows,
      warnings:[...new Set(warnings)],identityIssues,invoiceReady};
  }
  async function readRecords(file,vendor,kind) {
    const pages=await readPdfRecords(file,(raw,_name,page,items)=>({raw,page,rows:group(items)}));
    const groups=[];
    for(const page of pages){
      const lines=page.rows.map(line).map(compact), text=lines.join(' ');
      const type=lines.includes('電子發票證明聯')?'發票':lines.some(s=>s==='銷貨憑單'||s==='出貨單'||s==='銷貨單')?'銷貨單':'';
      const id=type==='發票'?invoiceNumber(text.match(invoicePattern)?.[1]):
        text.match(salePattern)?.[1]||partnerNumber(text.match(deliveryPattern)?.[1],'S41');
      const [supplier]=issuerOn(lines);
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
    const candidates=new Map(), parsed=new Map();
    const entries=linked.filter(({inv})=>inv.vendor===doc.vendor);
    const attachments=documents(order), stored=attachments.find(d=>d.key===doc.key);
    for(const {parsed:ref,pair} of attachments){
      if(ref.vendor!==doc.vendor||ref.kind!=='發票'||!ref.invoiceNo)continue;
      const sameDocument=ref.key===doc.key;
      const related=doc.kind==='銷貨單'&&pairedInvoice(doc,ref,stored?.pair,pair);
      if(!sameDocument&&!related)continue;
      parsed.set(ref.key,ref);
      const inv=entries.find(({inv})=>inv.no===ref.invoiceNo||
        inv.corrections?.some(event=>event.from.no===ref.invoiceNo))?.inv;
      if(inv)candidates.set(inv.key,inv);
    }
    if(doc.invoiceNo&&!candidates.size){
      const inv=entries.find(({inv})=>inv.no===doc.invoiceNo||
        (inv.source===doc.name&&inv.corrections?.some(event=>event.from.no===doc.invoiceNo)))?.inv;
      if(inv)candidates.set(inv.key,inv);
    }
    const ambiguous=candidates.size>1||parsed.size>1;
    const current=!ambiguous&&candidates.size===1?[...candidates.values()][0]:null;
    const original=!ambiguous&&parsed.size===1?[...parsed.values()][0]:null;
    return {no:current?.no||doc.invoiceNo||original?.invoiceNo||'',
      date:current?.date||doc.invoiceDate||original?.invoiceDate||'',ambiguous};
  }
  function pairedInvoice(doc,invoice,docPair,invoicePair) {
    const left=primaryKey(doc), right=primaryKey(invoice);
    const diff=differences(doc,invoice);
    if(diff.hard.length)return false;
    if(left&&right)return left===right;
    const order=orderKey(doc);
    return Boolean(order&&order===orderKey(invoice)&&!diff.notes.length&&(
      (docPair?.orderFallback===order&&docPair.related.includes(invoice.key))||
      (invoicePair?.orderFallback===order&&invoicePair.related.includes(doc.key))));
  }
  function association(state,order,doc) {
    if(!Cases.hasVendor(order,doc.vendor))throw Error('此案件沒有'+doc.vendor+'的設備，無法關聯。');
    if(!doc.key)throw Error('缺少文件單號，請核對原始文件。');
    if(doc.identityIssues?.length)throw Error(doc.identityIssues.join('；')+'。');
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
  function save(state,order,doc,replaceKey,linkInvoice,automatic=false,metadata={}) {
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
      if(automatic&&!metadata.requiresReview&&!same&&!order.review&&!order.pos.issues.length)invoice.links[0].confirmed=true;
    }
    const attachment={key:doc.key,name:doc.name,kind:doc.kind,vendor:doc.vendor,summary:doc.id,parsed:doc,...metadata};
    if(prior)order.docs.splice(order.docs.indexOf(prior),1,attachment);
    else order.docs.push(attachment);
  }
  const recordKey = (...parts) => JSON.stringify(parts);
  const invoiceKey = doc => invoiceNumber(doc.invoiceNo) ? recordKey(doc.vendor,'發票號碼',invoiceNumber(doc.invoiceNo)) : '';
  const primaryKey = doc => {
    if(doc.vendor==='華茂')return invoiceKey(doc);
    const delivery=partnerNumber(doc.shipNo,'S41');
    return delivery?recordKey(doc.vendor,'出貨單號',delivery):'';
  };
  const filingKey = doc => primaryKey(doc)||(doc.vendor==='華茂'&&doc.kind==='銷貨單'&&doc.shipNo?
    recordKey(doc.vendor,'銷貨單號',doc.shipNo):'');
  const orderKey = doc => doc.vendor==='拍檔' ? partnerNumber(doc.orderNo,'S21') : '';
  const digits=s=>compact(s).replace(/\D/g,'');
  const textId = value => compact(value).toUpperCase();
  const merchantKey = s => normalizeMerchantName(compact(s).replace(/臺/g,'台'));
  const contactKey = s => textId(s).replace(/(?:先生|小姐|女士|店長|經理)$/,'');
  const addressKey = s => {
    const address=compact(s).replace(/臺/g,'台').replace(/\([^)]*\)$/,'').replace(/^[\d]{3,6}(?=[^\d])/,'');
    return address.length>=8&&/[\d一二三四五六七八九十百零〇]+號/.test(address)?address:'';
  };
  const phones = value => compact(value).split(/[,、/;]/).map(part=>digits(part.replace(
    /^\+886-?0?/,'0').replace(/(?:#|分機|ext\.?)[-\d]+$/i,''))).filter(s=>/^0\d{8,9}$/.test(s));
  function partnerQuantities(slip, order) {
    const types={'A4-1-E':'拍檔POS主機','PMC-1500':'拍檔POS客顯螢幕'};
    const units={};
    for(const item of slip.items){
      const model=Object.keys(types).find(prefix=>textId(item.name).startsWith(prefix+'/'));
      if(!model&&item.net!==0)return null;
      if(model)units[types[model]]=(units[types[model]]||0)+item.quantity;
    }
    if(!Object.keys(units).length)return null;
    return Object.values(types).every(type=>(units[type]||0)===order.pos.devices
      .filter(d=>d.item===type).reduce((sum,d)=>sum+(d.qty||0),0));
  }
  function recipientRank(slip, order) {
    const company=merchantKey(slip.shipCompany||slip.recipient);
    const merchant=merchantKey(order.pos.merchant);
    if(!company||!merchant)return 0;
    const exact=company===merchant, partial=Math.min(company.length,merchant.length)>=4&&
      (company.includes(merchant)||merchant.includes(company));
    if(!exact&&!partial)return 0;
    const address=addressKey(slip.shipAddress), localAddress=addressKey(order.pos.address);
    const docPhones=phones(slip.shipPhone), casePhones=phones(order.pos.phone);
    const sameAddress=Boolean(address&&address===localAddress);
    const samePhone=docPhones.some(phone=>casePhones.includes(phone));
    const fromContact=contactKey(slip.shipContact), toContact=contactKey(order.pos.contact);
    const contactConflict=fromContact&&toContact&&fromContact!==toContact;
    if(slip.vendor==='拍檔'&&partnerQuantities(slip,order)===false)return 0;
    if(sameAddress&&samePhone&&!contactConflict)return exact?4:3;
    if(sameAddress||samePhone&&!contactConflict)return exact?3:2;
    if(!exact||slip.vendor!=='華茂'||slip.gross==null||slip.gross<=0||order.pos.issues.length||
        contactConflict||docPhones.length&&casePhones.length||address&&localAddress)return 0;
    const lines=order.pos.devices.filter(d=>vendorForItem(d.item)==='華茂'&&d.qty>0);
    if(!lines.length||lines.some(d=>!Object.hasOwn(COST,d.item)))return 0;
    const expected=hmAmount(aggregateVendorItems(lines));
    return expected>0&&Math.abs(expected-slip.gross)<=5?1:0;
  }
  const itemKey = ({name,quantity}) => recordKey(textId(name),quantity);
  const itemsKey = doc => doc.items.map(itemKey).sort().join('\n');
  const connectorDifference='同型號錢櫃的接頭規格不同（RJ11／RJ12）';
  const comparableHuamaoItems = doc => doc.items.map(item =>
    /\bHS-410A\b/i.test(item.name)
      ? itemKey({...item,name:item.name.replace(/\bRJ1[12]\b/gi,'RJXX').replace(/\((?:8C\/4B|標準)\)/gi,'')})
      : itemKey(item)).sort().join('\n');
  function differences(a,b) {
    const hard=[], notes=[];
    for(const [field,label] of [['sellerId','賣方統編'],['buyerId','買方統編']]){
      if(a[field]&&b[field]&&a[field]!==b[field])hard.push(label+'不同');
    }
    if(a.vendor==='拍檔'&&orderKey(a)&&orderKey(b)&&orderKey(a)!==orderKey(b))hard.push('訂單單號不同');
    if(a.vendor==='拍檔'&&invoiceKey(a)&&invoiceKey(b)&&invoiceKey(a)!==invoiceKey(b))hard.push('同一出貨單對應不同發票號碼');
    for(const [field,label] of [['gross','含稅總額'],['net','未稅金額'],['tax','稅額']]){
      if(a[field]!=null&&b[field]!=null&&Math.round(a[field]*100)!==Math.round(b[field]*100))notes.push(label+'不同');
    }
    if(a.invoiceDate&&b.invoiceDate&&a.invoiceDate!==b.invoiceDate)notes.push('發票日期不同');
    const shipment=a.kind==='銷貨單'?a:b, invoice=a.kind==='發票'?a:b;
    if(a.vendor==='拍檔'&&shipment.shipDate&&invoice.invoiceDate){
      const days=(Date.parse(invoice.invoiceDate)-Date.parse(shipment.shipDate))/86400000;
      if(days<0||days>7)notes.push('出貨與發票日期有差異');
    }
    if(a.items.length&&b.items.length&&itemsKey(a)!==itemsKey(b)){
      notes.push(a.vendor==='華茂'&&comparableHuamaoItems(a)===comparableHuamaoItems(b)?
        connectorDifference:'品項名稱或數量不同');
    }
    return {hard,notes};
  }
  function signature(doc) {
    return recordKey(primaryKey(doc),invoiceKey(doc),orderKey(doc),doc.shipDate,doc.invoiceDate,
      textId(doc.shipCompany||doc.recipient),textId(doc.shipContact),digits(doc.shipPhone),textId(doc.buyer),
      doc.net,doc.tax,doc.gross,
      doc.items.map(i=>recordKey(itemKey(i),textId(i.code),textId(i.unit),i.unitPrice,i.net,i.gross)).sort());
  }
  function planBatch(state, docs) {
    const attached=new Map(), recipients=new Map(), alreadyShipped=new Set(), anchors=new Map(), invoices=new Map();
    const byPrimary=new Map(), byOrder=new Map(), byKey=new Map(), archived=[];
    const insert=(map,key,value)=>{
      if(!key)return;
      if(!map.has(key))map.set(key,new Set());
      map.get(key).add(value);
    };
    const parseGroups = doc => {
      insert(byPrimary,filingKey(doc),doc);
      insert(byOrder,orderKey(doc),doc);
    };
    const cases=new Map(state.cases.map(c=>[c.id,c]));
    const byShopQuote=new Map();
    for(const c of state.cases){
      if(c.pos.quote&&c.pos.shopId)insert(byShopQuote,recordKey(Cases.quoteKey(c.pos.quote),norm(c.pos.shopId)),c);
      for(const vendor of Cases.vendors.filter(v=>Cases.hasVendor(c,v))){
        const merchant=merchantKey(c.pos.merchant), address=addressKey(c.pos.address);
        if(merchant)insert(recipients,recordKey(vendor,'merchant',merchant),c);
        if(address)insert(recipients,recordKey(vendor,'address',address),c);
        for(const phone of phones(c.pos.phone))insert(recipients,recordKey(vendor,'phone',phone),c);
      }
      for(const d of documents(c)){
        if(!Cases.hasVendor(c,d.vendor))continue;
        insert(attached,d.key,c);
        for(const key of [filingKey(d.parsed),invoiceKey(d.parsed),d.pair?.key])insert(anchors,key,c);
        if(d.kind==='銷貨單')alreadyShipped.add(recordKey(d.vendor,c.id));
        archived.push(d.parsed);
        parseGroups(d.parsed);
      }
    }
    for(const inv of state.invoices){
      const keys=[inv.no,...(inv.corrections||[]).map(event=>event.from.no)];
      for(const no of keys){
        const key=invoiceKey({vendor:inv.vendor,invoiceNo:no});
        insert(invoices,key,inv);
        for(const l of inv.links)if(cases.has(l.caseId))insert(anchors,key,cases.get(l.caseId));
      }
    }
    for(const row of state.sap?.rows||[]){
      const vendor=Cases.vendors.find(v=>[issuers[v],v,...aliases[v]].includes(compact(row[21])));
      const key=invoiceKey({vendor,invoiceNo:row[24]});
      if(!vendor||!key||!row[1]||!row[2])continue;
      for(const c of byShopQuote.get(recordKey(Cases.quoteKey(row[2]),norm(row[1])))||[]){
        if(Cases.hasVendor(c,vendor))insert(anchors,key,c);
      }
    }
    const stored=new Map(archived.map(doc=>[doc.key,doc]));
    const conflicts=new Set();
    for(const doc of docs){
      if(!doc.key)continue;
      const prior=byKey.get(doc.key)||stored.get(doc.key);
      if(prior&&(signature(prior)!==signature(doc)||differences(prior,doc).hard.length||doc.identityIssues?.length))
        conflicts.add(doc.key);
      if(!byKey.has(doc.key)){
        byKey.set(doc.key,doc);
        if(!stored.has(doc.key))parseGroups(doc);
      }
    }
    const blocked=new Set(docs.filter(d=>conflicts.has(d.key)).flatMap(d=>[filingKey(d),invoiceKey(d)]).filter(Boolean));
    const fallback=new Map(), orderIssues=new Map();
    for(const members of byOrder.values()){
      const shipments=[...members].filter(d=>d.kind==='銷貨單');
      const receipts=[...members].filter(d=>d.kind==='發票');
      for(const invoice of receipts){
        if(primaryKey(invoice))continue;
        const shipment=shipments[0];
        if(shipments.length!==1||receipts.length!==1||!primaryKey(shipment)){
          orderIssues.set(invoice.key,shipments.length>1||receipts.length>1?'訂單單號有多份候選文件':'缺少可核對的出貨單號');
          continue;
        }
        const companions=[...byPrimary.get(primaryKey(shipment))||[]];
        const diff=differences(shipment,invoice);
        if(!companions.some(d=>d.kind==='發票')&&!diff.hard.length&&!diff.notes.length&&
            shipment.gross!=null&&invoice.gross!=null&&shipment.items.length&&invoice.items.length){
          fallback.set(invoice.key,primaryKey(shipment));
          companions.push(invoice);
          byPrimary.set(primaryKey(shipment),new Set(companions));
        }else orderIssues.set(invoice.key,'訂單單號相同，但缺少一致的出貨品項與金額，或已有其他發票');
      }
    }
    const groups=new Map(), proposed=new Map();
    function resolve(doc,key){
      const index=key||doc.key;
      if(groups.has(index))return groups.get(index);
      const peers=[...byPrimary.get(key)||[doc]];
      const group={peers,key,matches:new Set(),hard:new Set(),notes:new Set()};
      groups.set(index,group);
      for(const d of peers){
        const no=invoiceKey(d);
        for(const issue of d.identityIssues||[])group.hard.add(issue);
        if([key,no].some(k=>blocked.has(k)))group.hard.add('關聯文件有相同單號且內容不同');
        for(const k of [key,no])for(const c of anchors.get(k)||[]){
          if(Cases.hasVendor(c,d.vendor))group.matches.add(c.id);
          else group.hard.add('案件供應商與文件不一致');
        }
        for(const inv of invoices.get(no)||[]){
          if(inv.no!==invoiceNumber(d.invoiceNo)){
            group.notes.add('發票號碼已人工修正');
            continue;
          }
          for(const label of differences(d,{...d,invoiceDate:inv.date,net:inv.net,tax:inv.tax,gross:inv.gross}).notes)
            group.notes.add('與案件已保存發票的'+label);
        }
      }
      const slips=peers.filter(d=>d.kind==='銷貨單'), bills=peers.filter(d=>d.kind==='發票');
      if(doc.vendor==='拍檔'&&bills.length>1)group.hard.add('同一出貨單對應多張發票');
      for(const slip of slips)for(const bill of bills){
        const diff=differences(slip,bill);
        diff.hard.forEach(label=>group.hard.add(label));
        diff.notes.forEach(label=>group.notes.add(label));
      }
      group.anchored=group.matches.size>0;
      for(const slip of slips){
        const company=slip.shipCompany||(slip.vendor==='華茂'?slip.recipient:'');
        if(!company)continue;
        const keys=[recordKey(slip.vendor,'merchant',merchantKey(company)),
          recordKey(slip.vendor,'address',addressKey(slip.shipAddress)),
          ...phones(slip.shipPhone).map(phone=>recordKey(slip.vendor,'phone',phone))];
        const candidates=new Set(keys.flatMap(k=>[...recipients.get(k)||[]]));
        let rank=group.anchored?2:1, matches=[];
        for(const c of candidates){
          const score=recipientRank(slip,c);
          if(score<rank)continue;
          if(score>rank){matches=[];rank=score;}
          matches.push(c);
        }
        if(group.anchored){
          if(matches.length&&!matches.some(c=>group.matches.has(c.id)))group.hard.add('收件資料指向其他案件');
        }else{
          if(slip.vendor==='拍檔'&&matches.length>1&&slip.shipDate){
            const recent=matches.filter(c=>{
              let ordered;
              try{ordered=Cases.date(c.pos.peakDate);}catch{return false;}
              const delta=(Date.parse(slip.shipDate)-Date.parse(ordered))/86400000;
              return delta>=0&&delta<=45;
            });
            if(recent.length===1)matches=recent;
          }
          for(const c of matches)group.matches.add(c.id);
        }
      }
      if(!group.anchored&&slips.length&&group.matches.size===1&&key){
        const target=recordKey(doc.vendor,[...group.matches][0]);
        if(alreadyShipped.has(target))group.hard.add('此案件已有其他出貨附件，無法區分採購批次');
        else if(!group.hard.size)insert(proposed,target,group);
      }
      return group;
    }
    for(const doc of byKey.values())resolve(doc,filingKey(doc)||fallback.get(doc.key));
    const seen=new Set();
    return docs.map(doc=>{
      const key=filingKey(doc)||fallback.get(doc.key);
      const group=groups.get(key||doc.key);
      const matches=[...group?.matches||[]];
      const pair=group&&key?{
        key,
        orderFallback:group.peers.some(d=>fallback.has(d.key))?orderKey(doc):'',
        related:group.peers.filter(d=>d.key!==doc.key&&d.kind!==doc.kind).map(d=>d.key),
        issues:[...group.notes]
      }:null;
      const scoped=key?JSON.parse(key).slice(1).join(' '):'';
      const summary=doc.vendor+(scoped?'｜'+scoped:'');
      let type='unmatched', reason='';
      if(!doc.key){type='failed';reason=doc.warnings.join('；')||'文件識別欄位不足。';}
      else if(attached.has(doc.key)||conflicts.has(doc.key)||seen.has(doc.key)){
        type='duplicate';
        reason=conflicts.has(doc.key)?'有相同單號且內容不同，保留已存資料。':
          attached.has(doc.key)?'同單號已保存，保留原資料。':'同批文件重複，已略過。';
      }
      else if(!key)reason=orderIssues.get(doc.key)||'缺少主要配對單號。';
      else if(group.hard.size)reason=[...group.hard].join('；')+'。';
      else if(matches.length>1)reason='找到 '+matches.length+' 筆候選案件，無法唯一關聯。';
      else if(!matches.length)reason='沒有可驗證的單號或收件資料對應案件。';
      else if(!group.anchored&&proposed.get(recordKey(doc.vendor,matches[0]))?.size>1)
        reason='多份文件指向同一案件，無法區分採購批次。';
      else {
        type='ready';
        const notices=[...new Set([...pair.issues,...doc.warnings])];
        if(doc.vendor==='華茂'&&doc.kind==='銷貨單'&&!doc.invoiceNo)
          notices.push('已歸檔銷貨單，原件未列發票號碼');
        if(notices.length)reason=notices.join('；')+'，請核對後帶入請款。';
      }
      seen.add(doc.key);
      const owners=attached.get(doc.key);
      const caseId=type==='ready'?matches[0]:
        type==='duplicate'&&!conflicts.has(doc.key)&&owners?.size===1?[...owners][0].id:'';
      return {doc,caseId,matches,type,reason:reason?summary+'｜'+reason:'',pair};
    });
  }
  function saveDecision(state,order,decision,archiveKey='') {
    if(decision.type!=='ready'||decision.caseId!==order.id)throw Error('此文件沒有可確認的案件關聯。');
    const {doc,pair}=decision;
    const requiresReview=pair.issues.length>0;
    const useInvoice=doc.invoiceReady&&pair.issues.every(issue=>issue===connectorDifference);
    save(state,order,doc,'',useInvoice,true,{pair,archiveKey,...requiresReview&&{requiresReview}});
    for(const stored of documents(order)){
      if(pair.related.includes(stored.key)){
        const related=new Set([...(stored.pair?.related||[]),doc.key]);
        const issues=new Set([...(stored.pair?.issues||[]),...pair.issues]);
        stored.pair={...pair,related:[...related],issues:[...issues]};
      }
    }
  }
  async function refreshInvoice(state,doc,file){
    if(doc.vendor!=='華茂'||doc.kind!=='發票'||!doc.invoiceReady)return null;
    const candidates=state.cases.flatMap(order=>documents(order)
      .filter(stored=>stored.key===doc.key&&stored.archiveKey&&!stored.parsed.invoiceReady&&
        stored.parsed.warnings.includes('有品項的數量或金額欄位無法可靠辨識。'))
      .map(stored=>({order,stored})));
    if(candidates.length!==1)return null;
    const [{order,stored}]=candidates;
    if(await fileKey(file)!==stored.archiveKey)return null;
    const slips=documents(order).filter(item=>item.kind==='銷貨單'&&filingKey(item.parsed)===filingKey(doc));
    if(slips.length!==1)return null;
    const [slip]=slips, diff=differences(slip.parsed,doc);
    if(diff.hard.length||diff.notes.some(issue=>issue!==connectorDifference))return null;
    const priorIssues=(stored.pair?.issues||[]).filter(issue=>issue!=='品項名稱或數量不同');
    if(priorIssues.some(issue=>issue!==connectorDifference))return null;
    const pair={key:filingKey(doc),related:[slip.key],issues:diff.notes,orderFallback:''};
    save(state,order,doc,stored.key,true,true,{pair,archiveKey:stored.archiveKey,requiresReview:Boolean(diff.notes.length)});
    originals.set(stored.archiveKey,file);
    slip.pair={...pair,related:[doc.key]};
    return {caseId:order.id,pair,reason:diff.notes.join('；')};
  }
  const originals=new Map();
  async function fileKey(file) {
    const digest=await crypto.subtle.digest('SHA-256',await readArrayBuffer(file));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function archive(file) {
    const key=await fileKey(file);
    originals.set(key,file);
    return key;
  }
  const original = key => originals.get(key);
  return {kinds,read,readRecords,association,save,documents,pageLabel,invoiceFields,planBatch,saveDecision,refreshInvoice,archive,original};
})();

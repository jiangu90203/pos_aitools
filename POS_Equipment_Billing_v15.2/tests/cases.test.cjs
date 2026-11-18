const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {test} = require('node:test');

const root = fs.existsSync(path.resolve(__dirname, '../site/index.html')) ? path.resolve(__dirname,'../site') : path.resolve(__dirname,'..');
const nodes = new Map();
const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {id, innerHTML: '', textContent: '', value: '', hidden: false,
      files: [], listeners: {},
      addEventListener(type, fn) {this.listeners[type] = fn;},
      querySelectorAll() { return []; }, removeAttribute(name) { delete this[name]; }, scrollIntoView() {}, classList: {toggle() {}, add() {}, remove() {}}});
    return nodes.get(id);
  }
};
class FileReader {
  readAsArrayBuffer(file) {
    queueMicrotask(() => this.onload({target:{result:file.data}}));
  }
}
class FormData {
  constructor(form) { this.data = new Map(Object.entries(form.values)); }
  get(key) { return this.data.get(key) ?? null; }
  has(key) { return this.data.has(key); }
  getAll(key) { return this.data.get(key) || []; }
  [Symbol.iterator]() { return this.data[Symbol.iterator](); }
}
const sandbox = {console, document, FileReader, FormData, atob, Blob, URL, TextDecoder, navigator:{}, crypto: webcrypto, setTimeout, clearTimeout, addEventListener() {}, localStorage: {getItem() { return null; }}};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const name of ['vendor/xlsx.full.min.js', 'app.js', 'case-data.js', 'import-io.js', 'quote-pdf.js', 'case-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), sandbox, {filename:name});
}
const Cases = vm.runInContext('Cases', sandbox);
const X = sandbox.XLSX;
const plain = x => JSON.parse(JSON.stringify(x));
const headers = ['','下單狀態','負責業務','SHOP ID','商家名稱','報價單編號','硬體方便收件日期',
  '收件人姓名','收件地址','收件人手機','設備1','數量','設備2','數量','設備3','數量','設備4','數量','設備5','數量',
  '峰潮下單日期','華茂下單日期','','','設備請款單號','裝機請款單號'];
const base = ['','','', '00017','範例公司','QU20261112345','','王先生','台北','0912345678',
  'EPSON發票機',1,'拍檔POS主機',1,'拍檔POS客顯螢幕',2,'發票紙捲',5,'發票紙捲',2,'2026/11/17','','','','PR01','INSTALL01'];
function workbook(name, rows) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet(rows), name);
  return book;
}
function makeCases(rows = [base]) {
  const data = Cases.posRows(workbook('下單設備資料', [headers, ...rows]), 'sample.xlsx');
  const state = Cases.create();
  Cases.commitPos(state, Cases.previewPos(state, data), new Map());
  return state;
}
function different(row = base, quote = 'QU20261112346') {
  const result = row.slice();
  result[5] = quote;
  return result;
}
function readSheet(book, sheet) {
  const bytes = X.write(book, {bookType: 'xlsx', type: 'array'});
  const wb = X.read(bytes, {type: 'array', cellDates: false});
  return X.utils.sheet_to_json(wb.Sheets[sheet], {header: 1, defval: null});
}
const bill = {vendor: '拍檔', no: 'AB12345678', date: '2026-11-18', net: '1200', tax: '60', gross: '1260', source: 'invoice.pdf'};

test('工作區成功啟動與 POS 草稿 Excel 保留設備、空白金額與 SHOP ID 前導零', () => {
  assert.match(nodes.get('caseRows').innerHTML, /匯入 POS/);
  const state = makeCases();
  const c = state.cases[0];
  assert.equal(Cases.desc(c, '拍檔'), '拍檔出貨拍檔POS主機*1台+拍檔POS客顯螢幕*2台至範例公司');
  assert.equal(c.pos.request, 'PR01');
  assert.equal(c.pos.installRequest, 'INSTALL01');
  const table = readSheet(Cases.billWorkbook(state, [c]), '拍檔請款彙整');
  assert.equal(table[1][1], '00017');
  assert.equal(table[1][8], null);
  assert.equal(table[1][10], '待補拍檔發票');
  assert.throws(() => Cases.billWorkbook(state, [c], true), /沒有已核對/);
});
test('拆單依供應商並排除紙捲，保留各設備 slot', () => {
  const c = makeCases().cases[0];
  const messages = Cases.orderMessages(c);
  assert.equal(messages.length, 2);
  assert.match(messages[0].lineMessage, /T823發票機\(USB\)\* 1/);
  assert.match(messages[1].lineMessage, /拍檔POS客顯螢幕\* 2/);
  assert.doesNotMatch(messages[1].emailBody, /T823|紙捲/);
  assert.equal(c.pos.devices.filter(d => d.item === '發票紙捲').length, 2);
});
test('空白或負數數量保留待確認，避免廠商訊息出貨', () => {
  const row = base.slice(); row[13] = ''; row[15] = -1;
  const c = makeCases([row]).cases[0];
  assert.equal(c.pos.issues.length, 2);
  assert.equal(Cases.orderMessages(c).length, 0);
});
test('重傳 POS 不倍增，衝突更新保留 PR 並要求重驗憑證', () => {
  const state = makeCases();
  const c = state.cases[0];
  const inv = Cases.attachInvoice(state, c, bill);
  inv.links[0].pr = 'PR-A';
  inv.links[0].confirmed = true;
  const repeat = Cases.previewPos(state, Cases.posRows(workbook('下單設備資料', [headers, base]), 'later.xlsx'));
  assert.equal(repeat[0].type, 'same');
  Cases.commitPos(state, repeat, new Map());
  assert.equal(state.cases.length, 1);
  const update = base.slice(); update[13] = 3;
  const preview = Cases.previewPos(state, Cases.posRows(workbook('下單設備資料', [headers, update]), 'later.xlsx'));
  assert.equal(preview[0].type, 'conflict');
  Cases.commitPos(state, preview, new Map([[0, 'case:' + c.id]]));
  assert.equal(state.cases[0].pos.devices.find(d => d.slot === 2).qty, 3);
  assert.equal(inv.links[0].pr, 'PR-A');
  assert.equal(inv.links[0].confirmed, false);
  assert.equal(state.cases[0].review, true);
});
test('已核對發票可正式請款與回填，重複匯入同號只保留一張', () => {
  const state = makeCases(), c = state.cases[0];
  const inv = Cases.attachInvoice(state, c, bill);
  assert.equal(Cases.attachInvoice(state, c, bill), inv);
  assert.equal(inv.links.length, 1);
  assert.throws(() => Cases.attachInvoice(state, c, {...bill,net:1100, tax:160}), /同一發票已存在/);
  const link = inv.links[0];
  link.confirmed = true;
  link.pr = 'PR123';
  link.requestDate = '2026-11-18';
  const table = readSheet(Cases.billWorkbook(state, [c], true), '拍檔請款彙整');
  assert.deepEqual(plain(table[1].slice(6, 14)), ['AB12345678','2026-11-18',1200,1260,'已回填請款','PR123','2026-11-18','invoice.pdf']);
  Cases.attachInvoice(state, c, {...bill, net:1100, tax:160}, true);
  assert.equal(link.confirmed, false);
});
test('跨案分配未確認先留白，確認分配後明細仍只記一張整票', () => {
  const state = makeCases([base, different()]);
  const inv = Cases.attachInvoice(state, state.cases[0], bill);
  Cases.attachInvoice(state, state.cases[1], bill);
  let x = Cases.billWorkbook(state, state.cases);
  assert.equal(readSheet(x, '拍檔請款彙整')[1][9], null);
  assert.equal(readSheet(x, '拍檔發票明細').length, 2);
  for (const l of inv.links) Object.assign(l, {net: 600, gross: 630, confirmed:true});
  x = Cases.billWorkbook(state, state.cases, true);
  assert.deepEqual(plain(readSheet(x, '拍檔請款彙整').slice(1).map(r => r[9])), [630,630]);
  assert.equal(readSheet(x, '拍檔發票明細')[1][4], 1260);
  inv.links.pop();
  assert.equal(Cases.allocation(inv, inv.links[0]), null);
});
test('同案多發票設備重疊時禁止正式匯出', () => {
  const state = makeCases(), c = state.cases[0];
  const a = Cases.attachInvoice(state, c, bill);
  const b = Cases.attachInvoice(state, c, {...bill, no: 'AB12345679'});
  for (const i of [a,b]) Object.assign(i.links[0], {confirmed: true, slots: [2]});
  assert.throws(() => Cases.billWorkbook(state, [c], true), /沒有已核對/);
  b.links[0].slots = [3];
  const result = readSheet(Cases.billWorkbook(state, [c], true), '拍檔請款彙整');
  assert.match(result[2][5], /客顯螢幕\*2台/);
});
test('華茂 10 欄、PR 與撥款狀態各自保留', () => {
  const state = makeCases(), c = state.cases[0];
  const inv = Cases.attachInvoice(state, c, {...bill, vendor:'華茂'});
  Object.assign(inv.links[0], {confirmed: true, pr:'PR-HM', requestDate:'2026-11-18', claimed:true, paid:false});
  const result = readSheet(Cases.huamaoWorkbook(state,[c],'2026-12-25'), '華茂款項匯入資訊');
  assert.deepEqual(plain(result[0]), ['預計撥款日','請款單號','發票號碼','發票日期','說明','金額','已請款','已撥款','對帳單','備註']);
  assert.equal(result[1][1], 'PR-HM');
  assert.equal(result[1][6], true);
  assert.equal(result[1][7], false);
});
test('SAP 維持欄位與歷史單號，採購與銷售憑證及價格不混用', () => {
  const state = makeCases(), c = state.cases[0], inv = Cases.attachInvoice(state,c,bill);
  Object.assign(inv.links[0], {confirmed:true, pr:'PR123', requestDate:'2026-11-18'});
  c.sale = {no:'CD12345678', date:'2026-11-10', lines:[{slot:4, gross:50, net:48},{slot:5,gross:0,net:0}]};
  const historical = Array(Cases.sapHeaders.length).fill(null);
  Object.assign(historical,{1:'00017',2:c.pos.quote,3:777,5:'已取消 T1RI-1，重開 T1RI-2',12:'PI-777',
    13:'拍檔POS主機',15:1,27:'1301 商品存貨'});
  state.sap = Cases.sapTemplate(workbook(Cases.sapName,[Cases.sapHeaders,historical]),'template.xlsx');
  const table = readSheet(Cases.sapWorkbook(state,[c]), Cases.sapName);
  assert.deepEqual(plain(table[0].slice(1,27)), plain(Cases.sapHeaders.slice(1,27)));
  assert.equal(table.length,6);
  const p = table.find(r=>r[13] === '拍檔POS主機');
  assert.equal(p[3],777);
  assert.match(p[5], /重開 T1RI-2/);
  assert.equal(p[12], 'PI-777');
  assert.equal(p[27], '1301 商品存貨');
  assert.equal(p[8], 'CD12345678');
  assert.equal(p[24], 'AB12345678');
  assert.equal(p[20], null);
  assert.equal(table.slice(1).reduce((sum,r)=>sum+(r[17]||0),0),1260);
  assert.deepEqual(plain(table.filter(r=>r[13]==='發票紙捲').map(r=>r[14])),[50,0]);
});
test('原 VK 數量衝突時保留歷史列並出待確認，不重複寫入', () => {
  const state = makeCases(), c = state.cases[0];
  const historical = Array(Cases.sapHeaders.length).fill(null);
  Object.assign(historical,{1:'00017',2:c.pos.quote,3:555,13:'拍檔POS主機',15:8});
  state.sap = Cases.sapTemplate(workbook(Cases.sapName,[Cases.sapHeaders,historical]),'template.xlsx');
  const wb = Cases.sapWorkbook(state, [c]), table = readSheet(wb, Cases.sapName);
  const matches = table.filter(r => r[13] === '拍檔POS主機');
  assert.equal(matches.length, 1);
  assert.equal(matches[0][3], 555);
  assert.ok(readSheet(wb, '待確認').some(r => r[3].includes('數量與 VK 原表不一致')));
});
test('金額、日期和工作檔校驗', () => {
  assert.throws(() => Cases.invoiceData({...bill, gross:'1261'}), /未稅加稅額/);
  assert.throws(() => Cases.invoiceData({...bill, date:'2026-02-30'}), /日期無效/);
  assert.throws(() => Cases.amount('1.234'), /最多兩位/);
  assert.equal(Cases.date('115/11/18'), '2026-11-18');
  const state = makeCases();
  Cases.attachInvoice(state,state.cases[0],bill);
  const back = Cases.restore(JSON.stringify(state));
  assert.equal(back.cases[0].pos.quote, base[5]);
  assert.equal(back.invoices[0].links[0].caseId, back.cases[0].id);
  back.invoices[0].links[0].caseId = 'bad';
  assert.throws(() => Cases.restore(JSON.stringify(back)), /發票連結不完整/);
});
test('報價與 VK 請款補件各取正確欄位', () => {
  const q = workbook('內部系統報價單',[['報價單號','EcShopID','發票號碼','發票開立時間','設備','銷售價(含稅)'],
    [base[5],'00017','CD12345678','2026/11/17','發票紙捲',50]]);
  const r = workbook('VK請款單',[['請款單號','建檔日期','憑證文件號碼','憑證日期','金額(未稅)','金額'],
    ['PR111','2026/11/18 10:59:03',bill.no,'2026/11/16',1200,1260]]);
  const state = makeCases();
  state.quotes = Cases.quotationRows(q,'quotes.xlsx');
  assert.equal(Cases.salesCandidates(state,state.cases[0]).sales[0].no,'CD12345678');
  const record = Cases.requestRows(r,'拍檔','pr.xlsx')[0];
  assert.equal(record.gross,'1260');
  assert.equal(record.net,'1200');
  assert.equal(Cases.date(record.requestDate),'2026-11-18');
});
test('實際 POS 與 VK 檔核對第 556、559、544 列', {skip: !process.env.POS_FIXTURE || !process.env.VK_FIXTURE}, () => {
  const read = f => X.read(fs.readFileSync(f), {type:'buffer',cellDates:false});
  const state = Cases.create();
  const records = Cases.posRows(read(process.env.POS_FIXTURE),'POS');
  Cases.commitPos(state,Cases.previewPos(state,records),new Map());
  const c556 = state.cases.find(c=>c.pos.row===556), c559 = state.cases.find(c=>c.pos.row===559);
  assert.equal(Cases.desc(c556,'拍檔'),'拍檔出貨拍檔POS主機*1台+拍檔POS客顯螢幕*1台至華洋食品股份有限公司');
  assert.equal(Cases.desc(c559,'拍檔'),'拍檔出貨拍檔POS主機*2台至帝一化工原料股份有限公司');
  const messages = Cases.orderMessages(c559);
  assert.deepEqual(plain(messages.map(row=>[row.vendor,row.devices[0].qty])),[['華茂',3],['拍檔',2]]);
  const historical = read(process.env.VK_FIXTURE);
  state.sap = Cases.sapTemplate(historical,'VK');
  const c544 = state.cases.find(c=>c.pos.row===544);
  assert.equal(c544.pos.request,'PR20261103575');
  const table = readSheet(Cases.sapWorkbook(state,[c544]),Cases.sapName);
  const selected = table.find(r=>r[24]==='HT14617830');
  assert.equal(selected[8],'FH41046676');
  const dateBook = Cases.sapWorkbook(state,[c544]);
  const sheet = dateBook.Sheets[Cases.sapName];
  const dateCells = Object.entries(sheet).filter(([cell,value]) => /^Z[2-9]/.test(cell) && value.t==='n');
  assert.ok(dateCells.length);
  assert.equal(dateCells[0][1].z,'yyyy/mm/dd');
  assert.match(selected[5],/已取消並建立文件/);
  assert.equal(table.length,4);
});

test('案件畫面從匯入、勾選到正式請款下載，經過實際事件處理函式', async () => {
  const workspace = nodes.get('caseWorkspace');
  const change = target => workspace.listeners.change({target});
  const click = dataset => workspace.listeners.click({target:{closest:() => ({dataset})}});
  const submit = target => workspace.listeners.submit({target,preventDefault(){}});
  const wait = () => new Promise(resolve => setImmediate(resolve));
  const workbookBytes = X.write(workbook('下單設備資料',[headers,base]), {type:'array',bookType:'xlsx'});
  const file = {name:'fixture.xlsx',size:workbookBytes.byteLength,data:workbookBytes};
  change({id:'casePos',files:[file]});
  await wait();
  assert.match(nodes.get('casePreview').innerHTML, /新增 1 筆/);
  click({caseAction:'commit'});
  await wait();
  assert.match(nodes.get('caseCount').textContent, /共 1 案/);
  const id = nodes.get('caseRows').innerHTML.match(/data-open="([^"]+)"/)[1];
  change({dataset:{select:id},checked:true});
  click({open:id});
  assert.match(nodes.get('caseDetail').innerHTML, /拍檔出貨拍檔POS主機\*1台/);
  submit({id:'caseInvoiceForm',values:bill});
  await wait();
  assert.match(nodes.get('caseDetail').innerHTML, /AB12345678/);
  submit({id:'',dataset:{bill:'拍檔:AB12345678'},values:{confirmed:'on',pr:'PR123',requestDate:'2026-11-18',claimed:'true',paid:'false'}});
  await wait();
  const downloads = [];
  X.writeFile = (wb,name) => downloads.push([wb,name]);
  click({caseAction:'partner-ready'});
  await wait();
  assert.equal(downloads.length, 1);
  const [wb, name] = downloads[0];
  assert.match(name,/拍檔請款_可填請款/);
  assert.equal(readSheet(wb,'拍檔請款彙整')[1][10],'已回填請款');
});

test('請款補匯入跨頁勾選會一起套用，已勾選篩選即時更新', async () => {
  const listeners = nodes.get('caseWorkspace').listeners;
  const change = target => listeners.change({target});
  const click = dataset => listeners.click({target:{closest:()=>({dataset})}});
  const wait = () => new Promise(resolve => setImmediate(resolve));
  const id = nodes.get('caseRows').innerHTML.match(/data-open="([^"]+)"/)[1];
  nodes.get('caseStateFilter').value = 'selected';
  change({id:'caseStateFilter',dataset:{}});
  change({dataset:{select:id},checked:false});
  assert.match(nodes.get('caseCount').textContent,/符合 0 案/);
  change({dataset:{select:id},checked:true});
  assert.match(nodes.get('caseCount').textContent,/符合 1 案/);
  click({open:id});
  nodes.get('caseImportVendor').value='拍檔';
  const invoices = Array.from({length:24}, (_,i) => ['AA'+String(i).padStart(8,'0'),'2026-11-18',100,105]);
  const data=X.write(workbook('請款單匯出',[['發票號碼','發票日期','未稅金額','含稅金額'],...invoices]),{type:'array',bookType:'xlsx'});
  change({id:'caseRequests',files:[{name:'請款單匯出.xlsx',size:data.byteLength,data}]});
  await wait();
  const preview=nodes.get('casePreview');
  assert.equal([...preview.innerHTML.matchAll(/data-request-choice=/g)].length,20);
  change({dataset:{requestChoice:'0'},checked:true});
  click({caseAction:'preview-next'});
  await wait();
  assert.equal([...preview.innerHTML.matchAll(/data-request-choice=/g)].length,4);
  change({dataset:{requestChoice:'23'},checked:true});
  click({caseAction:'preview-prev'});
  await wait();
  assert.match(preview.innerHTML,/data-request-choice="0" checked/);
  assert.match(preview.innerHTML,/已勾選 <span[^>]*>2<\/span>/);
  click({caseAction:'commit'});
  await wait();
  assert.match(nodes.get('caseDetail').innerHTML,/AA00000000/);
  assert.match(nodes.get('caseDetail').innerHTML,/AA00000023/);
  assert.doesNotMatch(nodes.get('caseDetail').innerHTML,/AA00000001/);
});

const quoteFields = {buyer:'範例企業股份有限公司',issuer:'範例發行公司',no:'QU20261112345',
  date:'2026-11-18',expires:'2026-11-30',buyerTaxId:'00001111',contact:'測試承辦人',
  phone:'0901000000',email:'sales@example.invalid',address:'臺北市信義路一段 1 號',
  issuerContact:'範例業務',notes:'設備 × 2｜規格・Ⓐ & ©'};
test('報價由原案件品項、SAP 歷史或匯入與逐項單價取值，精確加總兩種稅別', () => {
  const state=makeCases(), c=state.cases[0];
  const historical=Array(Cases.sapHeaders.length).fill(null);
  Object.assign(historical,{1:base[3],2:base[5],13:'EPSON發票機',14:10.5,15:1,16:10});
  state.sap={rows:[historical]};
  state.quotes=[{quote:base[5],item:'拍檔POS主機',quantity:'1',net:'20.01',gross:'21.01'}];
  c.sale.lines=[{slot:3,net:30,gross:31.5},{slot:4,net:0,gross:0},{slot:5,net:3.2,gross:3.36}];
  const q=Cases.quotationDocument(state,c,quoteFields);
  assert.deepEqual(plain(q.lines.map(l=>[l.qty,l.net,l.gross])), [[1,10,10.5],[1,20.01,21.01],[2,30,31.5],[5,0,0],[2,3.2,3.36]]);
  assert.equal(q.net,9641);assert.equal(q.gross,10123);assert.equal(q.tax,482);
  assert.equal(q.shopId,'00017');
  assert.equal(q.buyerTaxId,'00001111');
  assert.throws(()=>Cases.quotationDocument(state,c,{...quoteFields,expires:'2026-11-01'}),/有效期限/);
  c.sale.lines[2].gross=null;c.sale.lines[2].net=null;
  assert.throws(()=>Cases.quotationDocument(state,c,quoteFields),/缺少確定/);
  c.sale.lines[2].net=0;c.sale.lines[1].net=null;
  assert.throws(()=>Cases.quotationDocument(state,c,quoteFields),/同一稅別/);
});

test('勾選案件依廠商預覽，完整剪貼簿內容與既有訊息相同並跟隨取消勾選',async()=>{
  const listeners=nodes.get('caseWorkspace').listeners, list=nodes.get('caseRows');
  const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
  const wait=()=>new Promise(resolve=>setImmediate(resolve));
  const items=makeCases([base,different(base,'QU20261112349')]).cases;
  const select=await (async()=>{
    click({caseAction:'clear-select'});await wait();
    const data=new TextEncoder().encode(JSON.stringify({data:{...makeCases(),cases:items},selected:[]})).buffer;
    sandbox.confirm=()=>true;
    listeners.change({target:{id:'caseWork',files:[{name:'test.json',size:data.byteLength,data}]}});
    await wait();
    nodes.get('caseStateFilter').value='';
    listeners.change({target:{id:'caseStateFilter',dataset:{}}});
    assert.equal((list.innerHTML.match(/data-select=/g)||[]).length,2);
    return (id,checked)=>listeners.change({target:{dataset:{select:id},checked}});
  })();
  select(items[0].id,true);select(items[1].id,true);
  const target=nodes.get('caseOrderChannel');target.value='all';target.dataset={};
  listeners.change({target});
  const preview=nodes.get('caseOrderPreview');
  assert.match(preview.innerHTML,/一鍵複製全部 華茂/);
  assert.match(preview.innerHTML,/拍檔 · 2 筆/);
  let clipboard;
  sandbox.navigator.clipboard={writeText:async text=>{clipboard=text;}};
  click({orderCopy:'拍檔'});await wait();
  const formatted=order=>{const m=Cases.orderMessages(order).find(m=>m.vendor==='拍檔');return [m.subject,m.emailBody,m.lineMessage].join('\n\n');};
  assert.equal(clipboard,items.map(formatted).join('\n\n'));
  assert.match(nodes.get('caseOrderFeedback').textContent,/已複製 拍檔/);
  select(items[1].id,false);
  assert.match(preview.innerHTML,/拍檔 · 1 筆/);
  click({orderCopy:'拍檔'});await wait();
  assert.equal(clipboard,formatted(items[0]));
  sandbox.navigator.clipboard={writeText:async()=>{throw Error('permission denied');}};
  document.createElement=()=>({style:{},select(){},remove(){}});
  document.body={append(){}};
  document.execCommand=()=>false;
  click({orderCopy:'拍檔'});await wait();
  assert.match(nodes.get('caseOrderFeedback').textContent,/無法使用剪貼簿/);
});

test('案件操作輸出可重讀的真實 PDF，修改表單撤銷舊版預覽與下載',async()=>{
  for(const name of ['vendor/quote/pdf-lib.min.js','vendor/quote/noto-tc.cff.js']){
    vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),sandbox);
  }
  const listeners=nodes.get('caseWorkspace').listeners, click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
  const wait=()=>new Promise(resolve=>setImmediate(resolve));
  const id=nodes.get('caseRows').innerHTML.match(/data-open="([^"]+)"/)[1];
  click({open:id});
  const values={};for(let i=1;i<=5;i++){values['net'+i]='100';values['gross'+i]='105';}
  const submit=form=>listeners.submit({target:form,preventDefault(){}});
  submit({id:'caseSalesForm',dataset:{},values});await wait();
  const form={id:'caseQuotationForm',values:quoteFields,
    elements:Object.fromEntries(Object.entries(quoteFields).map(([k,value])=>[k,{value}]))};
  nodes.set(form.id,form);
  submit(form);await wait();
  const download=nodes.get('caseQuoteDownload');
  assert.equal(download.download,'報價單_QU20261112345.pdf');
  assert.equal(download.href,nodes.get('caseQuoteFrame').src);
  const saved=await fetch(download.href);
  assert.equal(saved.headers.get('content-type'),'application/pdf');
  const bytes=new Uint8Array(await saved.arrayBuffer());
  const pdf=await require(path.join(root,'vendor/quote/pdf-lib.min.js')).PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1);
  assert.match(pdf.getTitle(),/範例企業股份有限公司/);
  listeners.input({target:{form}});
  assert.equal(nodes.get('caseQuoteResult').hidden,true);
  await assert.rejects(fetch(download.href));
});

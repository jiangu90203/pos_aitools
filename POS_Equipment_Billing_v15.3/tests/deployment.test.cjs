const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const site = resolve(__dirname, '../site');
const html = readFileSync(resolve(site, 'index.html'), 'utf8');
const inline = html.match(/<script id="embeddedSheetJS">([\s\S]*?)<\/script>/)[1];
const scripts = [...html.matchAll(/<script data-site-core defer src="([^"]+)"/g)].map(m => m[1]);
const bootstrap = html.match(/<script>\s*\(\(\) => \{\s*const failures[\s\S]*?<\/script>/)[0].slice(8,-9);

function loadPage(missing = []) {
  const nodes = new Map(), loaded = new Map(), events = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      const attrs = new Map();
      nodes.set(id, {id, textContent:'', innerHTML:'', value:'', hidden:true, files:[],
        addEventListener() {}, querySelectorAll:()=>[], classList:{toggle(){},add(){},remove(){}},
        setAttribute:(k,v)=>attrs.set(k,v), hasAttribute:k=>attrs.has(k)});
    }
    return nodes.get(id);
  };
  const doc = {baseURI:'https://test.invalid/pos_aitools/', getElementById:node,
    addEventListener:(type,fn)=>loaded.set(type,fn), querySelectorAll:()=>[]};
  const page = vm.createContext({document:doc, console, URL, TextDecoder,
    location:new URL(doc.baseURI), addEventListener:(type,fn)=>events.set(type,fn),
    setTimeout, clearTimeout, localStorage:{getItem:(key)=>key.endsWith('lastHuamaoRow')?'42':null}});
  page.window = page;
  vm.runInContext(bootstrap,page,{filename:'index.html startup'});
  vm.runInContext(inline,page,{filename:'index.html embedded Excel'});
  for(const src of scripts) {
    const url=new URL(src,doc.baseURI);
    assert.match(url.pathname,/^\/pos_aitools\//);
    assert.equal(url.searchParams.get('v'),'15.3');
    const file=url.pathname.slice('/pos_aitools/'.length);
    if(missing.includes(file)){
      events.get('error')({target:{hasAttribute:()=>true,getAttribute:()=>src}});
      continue;
    }
    vm.runInContext(readFileSync(resolve(site,file),'utf8'),page,{filename:file});
  }
  loaded.get('DOMContentLoaded')();
  return {node,page,run:src=>vm.runInContext(src,page)};
}

test('部署首頁無 vendor 主執行緒請求即可初始化、讀入並重新寫出 Excel，重新開頁可重新初始化', () => {
  assert.deepEqual(scripts.map(p=>p.split('?')[0]),['assets.js','app.js','case-data.js','import-io.js','quote-pdf.js','case-ui.js']);
  assert.equal(inline.slice(1),readFileSync(resolve(site,'vendor/xlsx.full.min.js'),'utf8'));
  const {node,run} = loadPage();
  assert.equal(node('deploymentStatus').hidden,true);
  assert.match(node('lastRowInfo').textContent,/42/);
  assert.match(node('caseCount').textContent,/共 0 案/);
  const result = run(`(() => {
    const book=XLSX.utils.book_new();
    const rows=[['商家名稱','報價單編號','設備1','數量'],['測試企業','0008','拍檔POS主機',2]];
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'下單設備資料');
    const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
    const data=ImportIO.project(bytes,'測試.xlsx','pos')[0];
    return [XLSX.version,data.merchant,data.quote,data.devices[0].qty].join('|');
  })()`);
  assert.equal(result,'0.20.3|測試企業|0008|2');
  const refreshed=loadPage();
  assert.equal(refreshed.node('deploymentStatus').hidden,true);
  assert.match(refreshed.node('lastRowInfo').textContent,/42/);
});

test('發布漏檔時，首頁在操作前指出缺失的核心程式', () => {
  const {node}=loadPage(['case-ui.js']);
  assert.equal(node('deploymentStatus').hidden,false);
  assert.match(node('deploymentStatus').textContent,/case-ui\.js/);
});

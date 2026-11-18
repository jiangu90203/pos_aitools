const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync,execFileSync}=require('node:child_process');
const {test}=require('node:test');
const root=path.resolve(__dirname,'../site');
const c=vm.createContext({atob,Uint8Array,console,setTimeout,clearTimeout});
for(const name of ['vendor/quote/pdf-lib.min.js','vendor/quote/noto-tc.cff.js','quote-pdf.js']){
  vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),c,{filename:name});
}
const create=vm.runInContext('QuotePDF.create',c);
const pdfInfo=spawnSync('pdfinfo',['-v']).status===0;
const pdfText=spawnSync('pdftotext',['-v']).status===0;
test('正式 PDF 可自動分頁、保留繁中及符號，合計僅列於末頁', {skip:!pdfInfo||!pdfText},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-quote-'));
  try{
    const lines=Array.from({length:42},(_,i)=>({
      name:'品項 NO. '+String(i+1).padStart(3,'0')+' 臺灣（觸控）× POS '+
        (i===0?'超長繁中規格說明與含括號及標點的品項名稱・'.repeat(15):''),
      qty:2,net:100,gross:105,netTotal:20000,grossTotal:21000
    }));
    const data={issuer:'範例發行公司',buyer:'臺灣測試門市股份有限公司',no:'QU0001',
      issued:'2026-11-18',expires:'2026-11-30',buyerTaxId:'00123456',shopId:'00104',
      contact:'王小姐',phone:'0901000000',address:'臺北市信義區 1 號',email:'sales@example.invalid',
      notes:'含規格 × 2｜Ⓐ & ©\n請依正式通知為準。',lines,net:840000,gross:882000,tax:42000};
    const filename=path.join(dir,'quote.pdf');
    fs.writeFileSync(filename,await create(data));
    const info=execFileSync('pdfinfo',[filename],{encoding:'utf8'});
    assert.match(info,/595\.28 x 841\.89 pts \(A4\)/);
    const text=execFileSync('pdftotext',['-layout',filename,'-'],{encoding:'utf8'});
    const pages=text.trimEnd().split('\f').filter(p=>p.trim());
    assert.ok(pages.length>1);
    assert.ok(pages.every(page=>page.includes('POS 系統報價單')&&page.includes('未稅單價')));
    for(let i=1;i<=42;i++)assert.equal([...text.matchAll(new RegExp('NO\\. '+String(i).padStart(3,'0'),'g'))].length,1);
    assert.match(pages[0],/臺灣測試門市股份有限公司/);
    assert.match(pages[0],/統一編號 00123456/);
    assert.match(pages[0],/SHOP ID 00104/);
    assert.match(pages.at(-1),/未稅合計\s+8,400[\s\S]*稅額\s+420[\s\S]*含稅合計\s+8,820/);
    assert.match(pages.at(-1),/含規格 × 2｜Ⓐ & ©/);
    assert.ok(pages.slice(0,-1).every(page=>!page.includes('含稅合計')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

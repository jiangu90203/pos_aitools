/* Local A4 quote renderer. Original Unicode maps to the bundled Noto CJK CID font. */
const QuotePDF = (() => {
  const pageWidth = 595.28, pageHeight = 841.89, margin = 42;
  const fontName = 'NotoSansCJKtc-Regular';
  const key = 'QuoteTC';
  const columns = [181,35,70,70,77,78];
  let pending, font;
  const hex = value => value.toString(16).toUpperCase().padStart(4,'0');
  const decode = b64 => {
    const raw = atob(b64), bytes = new Uint8Array(raw.length);
    for (let i=0; i<raw.length; i++) bytes[i]=raw.charCodeAt(i);
    return bytes;
  };
  function load() {
    if (globalThis.PDFLib && globalThis.QuoteFontAsset) return Promise.resolve();
    if (!pending) {
      const script = (name, ready) => ready ? Promise.resolve() : new Promise((resolve,reject) => {
        const tag = document.createElement('script');
        tag.src = 'vendor/quote/' + name;
        tag.onload = resolve;
        tag.onerror = () => { tag.remove(); reject(Error('報價單 PDF 元件載入失敗：' + name)); };
        document.head.append(tag);
      });
      pending = Promise.all([
        script('pdf-lib.min.js',globalThis.PDFLib),
        script('noto-tc.cff.js',globalThis.QuoteFontAsset),
      ]).catch(err => { pending=undefined; throw err; });
    }
    return pending;
  }
  function fontData() {
    if (font) return font;
    const asset = globalThis.QuoteFontAsset;
    const bytes = decode(asset.metrics), view = new DataView(bytes.buffer), glyphs = new Map();
    for (let i=0; i<bytes.length; i+=8) {
      glyphs.set(view.getUint32(i),[view.getUint16(i+4),view.getUint16(i+6)]);
    }
    font = {data:decode(asset.data), bounds:asset.bounds, glyphs};
    return font;
  }
  function registerFont(doc, ref, mapped) {
    const ctx = doc.context, {PDFString} = PDFLib, {data,bounds} = fontData();
    const program = ctx.register(ctx.stream(data,{Filter:'FlateDecode',Subtype:'CIDFontType0C'}));
    const descriptor = ctx.register(ctx.obj({Type:'FontDescriptor',FontName:fontName,Flags:4,
      FontBBox:bounds,Ascent:1160,Descent:-288,ItalicAngle:0,CapHeight:733,StemV:80,FontFile3:program}));
    const entries = [...mapped.entries()].sort((a,b)=>a[0]-b[0]);
    const cid = ctx.register(ctx.obj({Type:'Font',Subtype:'CIDFontType0',BaseFont:fontName,
      CIDSystemInfo:{Registry:PDFString.of('Adobe'),Ordering:PDFString.of('Identity'),Supplement:0},
      FontDescriptor:descriptor,W:entries.flatMap(([id,glyph])=>[id,[glyph.width]])}));
    const pairs = entries.map(([id,glyph]) => {
      const units = glyph.char.split('').map(c=>hex(c.charCodeAt(0))).join('');
      return '<'+hex(id)+'> <'+units+'>';
    });
    let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /QuoteUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for(let i=0;i<pairs.length;i+=100){
      const segment=pairs.slice(i,i+100);
      cmap+=segment.length+' beginbfchar\n'+segment.join('\n')+'\nendbfchar\n';
    }
    cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const unicode=ctx.register(ctx.flateStream(cmap));
    ctx.assign(ref,ctx.obj({Type:'Font',Subtype:'Type0',BaseFont:fontName,Encoding:'Identity-H',
      DescendantFonts:[cid],ToUnicode:unicode}));
  }
  async function create(data) {
    await load();
    const {PDFDocument,PDFHexString,PDFName,rgb,beginText,endText,setFontAndSize,
      moveText,showText,setFillingColor}=PDFLib;
    const {glyphs}=fontData();
    const doc=await PDFDocument.create();
    doc.setTitle(data.no+' '+data.buyer+' POS 系統報價單');
    doc.setAuthor(data.issuer);
    const ref=doc.context.nextRef(), used=new Map(), pages=[];
    const ink=rgb(.10,.17,.24), muted=rgb(.30,.36,.42), blue=rgb(.12,.29,.42);
    const line=rgb(.80,.85,.88), pale=rgb(.94,.96,.98), white=rgb(1,1,1);
    const right=pageWidth-margin, totalWidth=columns.reduce((a,b)=>a+b,0);
    let page, y;
    function glyph(c) {
      const g=glyphs.get(c.codePointAt(0));
      if(!g)throw Error('報價單字型缺少「'+c+'」（U+'+c.codePointAt(0).toString(16).toUpperCase()+'），請改用等義文字。');
      return g;
    }
    function width(str,size) {
      return Array.from(str,c=>glyph(c)[1]).reduce((a,b)=>a+b,0)*size/1000;
    }
    function text(value,x,base,size=10,color=ink,align='left') {
      const str=String(value ?? '');
      if(!str)return;
      const encoded=Array.from(str,c=>{
        const [id,w]=glyph(c);
        if(!used.has(id))used.set(id,{char:c,width:w});
        return hex(id);
      }).join('');
      page.pushOperators(beginText(),setFontAndSize(PDFName.of(key),size),setFillingColor(color),
        moveText(align==='right'?x-width(str,size):x,base),showText(PDFHexString.of(encoded)),endText());
    }
    function wrap(input,max,size) {
      const rows=[];
      for(const paragraph of String(input).replace(/\r\n?/g,'\n').replace(/\t/g,' ').split('\n')){
        let row='', advance=0;
        for(const c of paragraph){
          const step=glyph(c)[1]*size/1000;
          if(row&&advance+step>max){rows.push(row);row='';advance=0;}
          row+=c;advance+=step;
        }
        rows.push(row);
      }
      return rows;
    }
    function rect(x,top,w,h,color) {
      page.drawRectangle({x,y:top-h,width:w,height:h,color});
    }
    function rule(base,x=margin,end=right) {
      page.drawLine({start:{x,y:base},end:{x:end,y:base},thickness:.5,color:line});
    }
    function newPage(first=false) {
      page=doc.addPage([pageWidth,pageHeight]);pages.push(page);
      page.node.setFontDictionary(PDFName.of(key),ref);
      rect(margin,800,totalWidth,4,blue);
      text('CYBERBIZ POS 系統報價單',margin,770,first?21:16,blue);
      y=748;
      if(!first){
        for(const row of wrap('報價單號  '+data.no,totalWidth,9)){text(row,margin,y,9,muted);y-=13;}
        y-=10;
      }
    }
    function ensure(height,table=false) {
      if(y-height>=67)return;
      newPage();
      if(table)header();
    }
    function info(label,value, x=margin, max=totalWidth, size=10) {
      if(!value)return;
      for(const row of wrap(label+'  '+value,max,size)){
        ensure(16);text(row,x,y,size);y-=16;
      }
    }
    function cells(values, base, color=ink) {
      let x=margin;
      values.forEach((value,i)=>{
        const size=i ? Math.min(9,(columns[i]-12)/Math.max(1,width(String(value),1))) : 10;
        text(value,i?x+columns[i]-6:x+8,base,size,color,i?'right':'left');
        x+=columns[i];
      });
    }
    function header() {
      rect(margin,y,totalWidth,25,blue);
      cells(['品項','數量','未稅單價','含稅單價','未稅小計','含稅小計'],y-16,white);
      y-=25;
    }
    const fmt=value=>value===null?'—':value.toLocaleString('en-US',{maximumFractionDigits:2});
    const fmtCents=value=>value===null?'—':fmt(value/100);
    newPage(true);
    info('報價公司',data.issuer);info('報價窗口',data.issuerContact);
    info('報價單號',data.no);info('報價日期',data.issued);info('有效期限',data.expires);
    y-=5; rule(y+9); y-=7;
    info('客戶名稱',data.buyer);info('統一編號',data.buyerTaxId);info('SHOP ID',data.shopId);
    info('聯絡人',data.contact);info('聯絡電話',data.phone);info('電子郵件',data.email);info('地址',data.address);
    y-=5;ensure(56);text('設備品項與價格（新臺幣）',margin,y,12,blue);y-=14;header();
    data.lines.forEach((d,i)=>{
      const labels=wrap(d.name,columns[0]-16,10);
      if(labels.length<=30)ensure(12+14*labels.length,true);
      let first=true;
      while(labels.length){
        ensure(26,true);
        const part=labels.splice(0,Math.max(1,Math.floor((y-67-12)/14)));
        const height=12+14*part.length;
        if(i%2===0)rect(margin,y,totalWidth,height,pale);
        cells([part[0],...(first?[d.qty,fmt(d.net),fmt(d.gross),fmtCents(d.netTotal),fmtCents(d.grossTotal)]:[])],y-16);
        part.slice(1).forEach((label,j)=>text(label,margin+8,y-30-14*j));
        y-=height;rule(y);first=false;
      }
    });
    y-=14;ensure(90);
    const total = (label,value,highlight=false) => {
      if(highlight)rect(right-238,y+14,238,25,blue);
      text(label,right-224,y,11,highlight?white:ink);
      text(fmtCents(value),right-10,y,11,highlight?white:ink,'right');
      y-=25;
    };
    if(data.net!==null)total('未稅合計',data.net,data.gross===null);
    if(data.tax!==null)total('稅額',data.tax);
    if(data.gross!==null)total('含稅合計',data.gross,true);
    if(data.notes){
      y-=4;ensure(42);text('備註',margin,y,12,blue);y-=17;
      for(const row of wrap(data.notes,totalWidth,9)){ensure(15);text(row,margin,y,9);y-=15;}
    }
    for(let i=0;i<pages.length;i++){page=pages[i];rule(49);
      text('POS 系統報價單',margin,32,9,muted);text((i+1)+' / '+pages.length,right,32,9,muted,'right');
    }
    registerFont(doc,ref,used);
    return doc.save();
  }
  return {create};
})();

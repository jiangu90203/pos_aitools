const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const frames=[];
const defaultSite=path.resolve(__dirname,'../site');
const current=fs.existsSync(defaultSite)?defaultSite:path.resolve(__dirname,'..');
const baseline=process.argv[2];
if(!baseline){console.error('Usage: node tests/performance.cjs /path/to/v15.0/site');process.exit(1);}
const wait=()=>new Promise(r=>setImmediate(r)), round=n=>Math.round(n*100)/100;
function runtime(dir){
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{id,value:'',listeners:{},writes:0,textWrites:0,
      get innerHTML(){return this.markup??'';},set innerHTML(value){this.writes++;this.markup=value;},
      get textContent(){return this.text??'';},set textContent(value){this.textWrites++;this.text=value;},
      addEventListener(event,fn){this.listeners[event]=fn;},querySelectorAll(){return [];},
      setAttribute(){},removeAttribute(){},classList:{toggle(){},add(){},remove(){}}
    });
    return nodes.get(id);
  }
  const c=vm.createContext({console,TextDecoder,setTimeout,clearTimeout,addEventListener(){},
    document:{getElementById:node,querySelectorAll(){return [];}},
    FileReader:class{readAsArrayBuffer(file){queueMicrotask(()=>this.onload({target:{result:file.data}}));}},
    requestAnimationFrame(fn){frames.push(fn);return frames.length;},localStorage:{getItem(){return null;}}});
  c.window=c;
  for(const name of ['vendor/xlsx.full.min.js','app.js','case-data.js','import-io.js','case-ui.js']){
    const loc=path.join(dir,name);
    if(fs.existsSync(loc))vm.runInContext(fs.readFileSync(loc,'utf8'),c,{filename:name});
  }
  return {c,node,run:source=>vm.runInContext(source,c)};
}
const flush=()=>{while(frames.length)frames.shift()(performance.now());};
const count=15000;
const cases=Array.from({length:count},(_,i)=>({id:'case'+i,pos:{row:i+2,quote:'Q'+i,shopId:String(i).padStart(6,'0'),
  merchant:'範例測試公司'+i,devices:[{slot:1,item:'拍檔POS主機',raw:'拍檔POS主機',qty:1}],issues:[]},orders:{},docs:[],sale:{},bills:{}}));
const invoices=Array.from({length:count/2},(_,i)=>{const no='AA'+String(i).padStart(8,'0');return {vendor:'拍檔',key:'拍檔:'+no,no,date:'2026-11-18',
  net:100,gross:105,tax:5,links:[{caseId:'case'+i,slots:[],net:null,gross:null,confirmed:true,pr:'',requestDate:''}]}});
const json=JSON.stringify({data:{version:1,cases,invoices,quotes:[],partnerCode:'',sap:null},selected:[]});
const work={name:'工作檔.json',data:new TextEncoder().encode(json).buffer,text:async()=>json};work.size=work.data.byteLength;
function measure(prepare,fn,reps=5){
  const timing=[];
  for(let i=0;i<=reps;i++){prepare();const start=performance.now();fn();flush();if(i)timing.push(performance.now()-start);}
  timing.sort((a,b)=>a-b);return round(timing[Math.floor(timing.length/2)]);
}
async function profile(dir){
  const {c,node,run}=runtime(dir);
  const listen=node('caseWorkspace').listeners;
  listen.change({target:{id:'caseWork',files:[work]}});
  await wait();assert.match(node('caseStatus').textContent,/已載入 15000/);
  const table=node('caseRows'), query=node('caseSearch'), status=node('caseStateFilter'), log=node('log');
  const filter=value=>{status.value=value;listen.change({target:{id:status.id,dataset:{}}});};
  let tableWrites=0;
  const selectionMs=measure(()=>{},()=>{
    const before=table.writes;
    for(let i=0;i<30;i++)listen.change({target:{dataset:{select:'case0'},checked:i%2===0}});
    tableWrites=table.writes-before;
  });
  assert.match(node('caseCount').textContent,/已勾選 0 案/);
  const checkMs=measure(()=>filter(''),()=>filter('check'),3);
  assert.match(node('caseCount').textContent,/符合 7500 案/);filter('');
  let searchWrites;
  const burstMs=measure(()=>{query.value='';listen.input({target:query});flush();},()=>{
    const before=table.writes;
    for(const value of ['Q','Q1','Q12','Q123','Q1234','Q12345']){
      query.value=value;listen.input({target:query});
    }
    flush();searchWrites=table.writes-before;
  });
  assert.match(node('caseCount').textContent,/符合 1 案/);
  let logWrites;
  const logMs=measure(()=>{c.resetLog('start');flush();},()=>{
    const before=log.textWrites;
    run("for(let i=0;i<3000;i++)log('測試處理紀錄 '+i)");
    flush();logWrites=log.textWrites-before;
  });
  return {selectionMs,tableWrites,checkMs,burstMs,searchWrites,logMs,logWrites};
}
(async()=>console.log(JSON.stringify({node:process.version,cases:count,invoices:invoices.length,before:await profile(path.resolve(baseline)),after:await profile(current)},null,2)))().catch(err=>{console.error(err);process.exitCode=1;});

/* Shared settings have a list view and an explicit editor. */
(() => {
  const byId=id=>document.getElementById(id);
  const root=byId('customSettings');
  if(!root)return;
  const content=byId('orderSettingsContent');
  const notice=byId('orderSettingsNotice');
  const connection=byId('settingsConnection');
  const enabled=document.querySelector?.('meta[name="settings-mode"]')?.content==='server';
  const client=enabled?createSettingsClient((...args)=>fetch(...args),OrderSettings):null;
  let tab='items', editing=null, saving=false;
  const e=escapeHtml;
  const number=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});
  const input=(field,label,value='',attributes='')=>
    '<label>'+label+'<input name="'+field+'" value="'+e(value)+'" '+attributes+'></label>';
  const area=(field,label,value,rows=5)=>
    '<label>'+label+'<textarea name="'+field+'" rows="'+rows+'">'+e(value)+'</textarea></label>';
  const nameField=(value,label)=>input('name',label,value,value?'readonly':'required maxlength="100"');
  function feedback(message,tone='info') {
    notice.textContent=message;
    notice.classList.toggle('case-warning',tone==='error');
    reportOperation(message,tone);
  }
  function lockWorkspace(locked) {
    for(const id of ['caseWorkspace','reconciliationView']){
      const node=byId(id);
      if(node)node.inert=locked;
    }
  }
  function configuredPrice(name,kind) {
    const price=Cases.sapPrice(name);
    const net=price[kind+'Net'], gross=price[kind+'Gross'];
    return {net:net??(gross==null?null:Math.round(gross*100/1.05)/100),gross:gross??(net==null?null:configuredGross(net))};
  }
  const priceText=(name,kind)=>{
    const {net,gross}=configuredPrice(name,kind);
    return net==null?'—':number.format(net)+' ／ '+number.format(gross);
  };
  function list() {
    const item=tab==='items', templates=tab==='templates', canEdit=client?.canEdit();
    const headings=item?['品項','供應商','採購 未稅／含稅','銷售 未稅／含稅']:
      templates?['供應商','Email 主旨','LINE／群組訊息']:['供應商','收件人（To）','副本（CC）','SAP 代碼／廠商 ID'];
    const names=item?OrderSettings.itemNames():OrderSettings.vendorNames();
    const rows=names.map(name=>{
      const record=item?OrderSettings.item(name)||OrderSettings.itemDefaults(name):OrderSettings.vendor(name);
      if(item)return [name,record.vendor||'—',priceText(name,'purchase'),priceText(name,'sale')];
      if(templates)return [name,record.subject,record.line.split('\n')[0]];
      return [name,record.to||'—',record.cc||'—',[record.code,record.sapName].filter(Boolean).join(' ／ ')||'—'];
    });
    const add=canEdit&&!templates?'<button type="button" class="case-btn primary" data-setting-action="new">新增'+(item?'品項':'供應商')+'</button>':'';
    return '<div class="case-actions settings-list-actions">'+add+'</div><div class="settings-table-viewport"><table class="settings-table"><thead><tr>'+
      headings.map(value=>'<th scope="col">'+e(value)+'</th>').join('')+'<th scope="col">操作</th></tr></thead><tbody>'+
      rows.map(([name,...cols])=>'<tr><th scope="row">'+e(name)+'</th>'+cols.map(value=>'<td>'+e(value)+'</td>').join('')+
        '<td><button type="button" class="case-btn" data-settings-edit="'+e(name)+'" aria-label="'+(canEdit?'編輯':'查看')+' '+e(name)+'">'+(canEdit?'編輯':'查看')+'</button></td></tr>').join('')+
      '</tbody></table></div>';
  }
  function editor() {
    const name=editing, item=tab==='items', templates=tab==='templates', canEdit=client?.canEdit();
    const record=item?OrderSettings.item(name)||OrderSettings.itemDefaults(name):OrderSettings.vendor(name);
    const actions='<div class="case-actions">'+(canEdit?'<button class="case-btn primary" type="submit">儲存設定</button>':'')+
      (templates?'<button class="case-btn" type="button" data-setting-action="preview">預覽範例</button>':'')+
      (templates&&canEdit?'<button class="case-btn" type="button" data-setting-action="default-templates">載入預設文案</button>':'')+
      '<button class="case-btn" type="button" data-setting-action="close">返回清單</button></div>';
    let fields, remove='';
    if(item){
      const numeric='type="number" min="0" max="1000000000" step="0.01"';
      const priceInput=(kind,label)=>{
        const base=configuredPrice(name,kind).net;
        const current=record[kind+'Net'];
        return input(kind+'Net',label,current??base??'',numeric+' data-default-price="'+e(current==null?base??'':'')+'"');
      };
      const vendors=['',...OrderSettings.vendorNames()].map(v=>'<label><input type="radio" name="vendor" value="'+e(v)+'" '+(record.vendor===v?'checked':'')+'> '+e(v||'未指定')+'</label>').join('');
      fields='<div class="erp-settings-fields">'+nameField(name,'品項名稱')+input('label','下單品名',record.label,'maxlength="160"')+
        input('unit','下單單位',record.unit,'required maxlength="12"')+
        priceInput('purchase','採購單價（未稅）')+priceInput('sale','銷售單價（未稅）')+'</div>'+
        '<fieldset class="settings-vendor-options"><legend>供應商</legend>'+vendors+'</fieldset>'+
        area('aliases','即時庫存品項別名（每行一個）',record.aliases.join('\n'),3)+
        '<p class="case-meta">單價填入報表空欄，含稅按 5% 計算。留空可恢復預設單價。</p>';
      if(OrderSettings.item(name))remove=OrderSettings.isBuiltInItem(name)?'恢復預設品項':'移除品項';
    }else if(!templates){
      fields='<div class="erp-settings-fields">'+nameField(name,'供應商名稱')+input('to','收件人（To）',record.to,'maxlength="512"')+
        input('cc','副本（CC）',record.cc,'maxlength="512"')+input('code','出貨廠商代碼',record.code,'maxlength="50"')+
        input('sapName','出貨廠商 ID',record.sapName,'maxlength="100"')+
        '</div><p class="case-meta">多個信箱以逗號分隔。新增供應商可手動登錄發票。</p>';
      if(OrderSettings.snapshot().vendors.some(v=>v.name===name))remove=OrderSettings.isBuiltInVendor(name)?'恢復供應商預設':'移除供應商';
    }else{
      fields='<p class="case-meta">可用變數 '+orderTokens.map(token=>'<code>{{'+token+'}}</code>').join(' ')+'</p>'+
        '<div class="erp-settings-fields">'+input('subject','單筆 Email 主旨',record.subject,'required maxlength="4000"')+
        input('batchSubject','多筆 Email 主旨',record.batchSubject,'required maxlength="4000"')+
        '</div><p class="case-meta">多筆主旨可使用 <code>{{供應商}}</code>、<code>{{筆數}}</code>、<code>{{公司名稱}}</code>、<code>{{品項}}</code>。</p>'+
        '<div class="erp-settings-fields">'+area('body','Email 內文',record.body,10)+area('line','LINE／群組訊息',record.line,10)+'</div>';
    }
    return '<form id="orderSettingsForm" class="erp-settings-form"><h2>'+e(name||'新增'+(item?'品項':'供應商'))+'</h2>'+
      '<fieldset class="settings-fields" '+(canEdit?'':'disabled')+'>'+fields+'</fieldset>'+actions+
      (canEdit&&remove?'<button class="case-btn settings-remove" type="button" data-setting-action="remove">'+e(remove)+'</button>':'')+
      (templates?'<pre id="orderSettingsPreview" hidden></pre>':'')+'</form>';
  }
  function render() {
    for(const button of root.querySelectorAll('[data-settings-tab]')){
      button.setAttribute('aria-pressed',String(button.dataset.settingsTab===tab));
    }
    byId('orderSettingsFile').disabled=!client?.canEdit();
    content.innerHTML=editing===null?list():editor();
  }
  async function applySettings(data,message,question) {
    if(saving||!client?.canEdit())return;
    const valid=OrderSettings.prepare(data,CaseWorkspace.checkOrderSettings);
    if(!window.confirm(question))return;
    saving=true;
    content.inert=true;
    lockWorkspace(true);
    try{
      await client.save(valid,CaseWorkspace.checkOrderSettings);
      CaseWorkspace.refreshOrderSettings();
      editing=null;
      render();
      feedback(message,'success');
    }finally{
      saving=false;
      content.inert=false;
      lockWorkspace(false);
    }
  }
  const replaceRow=(data,kind,value)=>({...data,[kind]:[...data[kind].filter(row=>row.name!==value.name),value]});
  root.addEventListener('submit',async event=>{
    event.preventDefault();
    if(event.target.id!=='orderSettingsForm'||saving)return;
    try{
      const form=event.target, data=OrderSettings.snapshot(), f=new FormData(form);
      const get=key=>String(f.get(key)??'').trim();
      const name=get('name')||editing;
      if(tab==='items'){
        if(!editing&&OrderSettings.itemNames().some(item=>itemLookupKey(item)===itemLookupKey(name)))throw Error('品項名稱已存在。');
        const net=field=>{
          const value=get(field), defaultValue=form.elements[field].dataset.defaultPrice;
          return value===''||value===defaultValue?null:Number(value);
        };
        const item={name,vendor:get('vendor'),label:get('label')||name,unit:get('unit'),
          aliases:get('aliases').split(/\r?\n/).map(alias=>alias.trim()).filter(Boolean),
          saleNet:net('saleNet'),purchaseNet:net('purchaseNet')};
        await applySettings(replaceRow(data,'items',item),'品項設定已儲存。','將「'+name+'」的品項設定儲存到共用後端？');
      }else{
        if(!editing&&OrderSettings.vendorNames().some(vendor=>norm(vendor)===norm(name)))throw Error('供應商已存在。');
        const fields=tab==='templates'?orderTemplateFields:['to','cc','code','sapName'];
        const vendor={...OrderSettings.vendor(name),name};
        for(const field of fields)vendor[field]=tab==='templates'?String(f.get(field)??''):get(field);
        await applySettings(replaceRow(data,'vendors',vendor),'供應商設定已儲存。','將「'+name+'」的'+(tab==='templates'?'下單文案':'供應商設定')+'儲存到共用後端？');
      }
    }catch(err){feedback(err.message,'error');}
  });

  async function importSettings(file) {
    validateFile(file,['json']);
    if(file.size>2*1024*1024)throw Error('自訂參數備份須小於 2 MB。');
    let data;
    try{data=JSON.parse(await file.text());}catch{throw Error('自訂參數備份無法讀取，請選擇有效的 JSON。');}
    await applySettings(data,'自訂參數已匯入並儲存。','以此備份取代目前的共用參數？');
  }
  root.addEventListener('change',event=>{
    if(event.target.id!=='orderSettingsFile'||saving)return;
    const file=event.target.files[0];
    event.target.value='';
    if(file)importSettings(file).catch(err=>feedback(err.message,'error'));
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');
    if(!button||saving)return;
    if(button.dataset.settingsTab){
      tab=button.dataset.settingsTab;
      editing=null;
      render();
      return;
    }
    if(button.dataset.settingsEdit!==undefined){
      editing=button.dataset.settingsEdit;
      render();
      content.querySelector('input,textarea,button')?.focus();
      return;
    }
    const action=button.dataset.settingAction;
    if(action==='new'||action==='close'){editing=action==='new'?'':null;render();return;}
    try{
      const data=OrderSettings.snapshot();
      if(action==='export')downloadTextFile('設備請款助手_自訂參數.json',JSON.stringify(data,null,2)+'\n','application/json');
      if(action==='default-templates'){
        const defaults=OrderSettings.vendorDefaults(editing);
        for(const field of orderTemplateFields)button.form.elements[field].value=defaults[field];
      }
      if(action==='preview'){
        const example={供應商:editing,公司名稱:'範例商家',品項:'掃碼槍*2',聯絡人:'王小姐',電話:'0912-000-000',地址:'臺北市範例路 1 號',發票機備註:'',筆數:1};
        const sample=[example,{...example,筆數:2},{...example,品項:'2支掃碼槍'},example];
        const preview=byId('orderSettingsPreview');
        preview.textContent=orderTemplateFields.map((field,i)=>renderOrderTemplate(button.form.elements[field].value,sample[i])).join('\n\n────────\n\n');
        preview.hidden=false;
      }
      if(action==='remove')await applySettings({...data,[tab]:data[tab].filter(row=>row.name!==editing)},
        '已更新共用設定。','要'+button.textContent+'「'+editing+'」並儲存到共用後端嗎？');
    }catch(err){feedback(err.message,'error');}
  });
  render();
  root.setAttribute('data-ready','');
  if(!enabled){
    notice.textContent='此版本使用內建參數。請開啟有共用後端的版本來編輯。';
    return;
  }
  lockWorkspace(true);
  connection.hidden=false;
  connection.textContent='正在載入共用參數…';
  client.load().then(()=>{
    CaseWorkspace.refreshOrderSettings();
    render();
    notice.textContent=client.canEdit()?'已載入共用參數。':'已載入共用參數。此帳號可查看設定。';
    connection.hidden=true;
    lockWorkspace(false);
  }).catch(err=>{connection.textContent=err.message+' 重新整理前暫停作業。';feedback(err.message,'error');});
})();

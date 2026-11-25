/* Browser-local settings for inventory mapping and supplier communication. */
(() => {
  const root=document.getElementById('customSettings');
  if(!root||!root.addEventListener)return;
  const content=document.getElementById('orderSettingsContent');
  const notice=document.getElementById('orderSettingsNotice');
  const e=escapeHtml;
  let tab='items';
  const selection={items:OrderSettings.itemNames()[0],vendors:'華茂',templates:'華茂'};

  const opt=(value,label,selected)=>'<option value="'+e(value)+'"'+(value===selected?' selected':'')+'>'+e(label)+'</option>';
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
  const actions=(removeLabel='')=>'<div class="case-actions"><button class="case-btn primary" type="submit">儲存設定</button>'+
    (removeLabel?'<button class="case-btn" type="button" data-setting-action="remove">'+e(removeLabel)+'</button>':'')+'</div>';

  function render() {
    for(const button of root.querySelectorAll('[data-settings-tab]')){
      button.setAttribute('aria-pressed',String(button.dataset.settingsTab===tab));
    }
    const item=tab==='items', template=tab==='templates', name=selection[tab];
    const names=item?OrderSettings.itemNames():OrderSettings.vendorNames();
    const selected=item?OrderSettings.item(name):OrderSettings.snapshot().vendors.find(v=>v.name===name);
    const record=selected||(item?OrderSettings.itemDefaults(name):OrderSettings.vendor(name));
    const title=item?'品項':'供應商';
    const selector='<div class="erp-settings-select"><label>'+title+
      '<select data-settings-select aria-label="選擇'+title+'">'+
      names.map(value=>opt(value,value,name)).join('')+(!template?opt('','＋ 新增'+title,name):'')+'</select></label>'+
      (!template?'<button class="case-btn" type="button" data-setting-action="new">新增'+title+'</button>':'')+'</div>';
    if(item){
      const removeLabel=selected?(OrderSettings.isBuiltInItem(name)?'恢復預設品項':'移除品項'):'';
      const prices='type="number" min="0" max="1000000000" step="0.01" placeholder="沿用預設"';
      content.innerHTML=selector+'<form id="orderItemForm" class="erp-settings-form"><div class="erp-settings-fields">'+
        nameField(name,'品項名稱')+input('label','下單品名',record.label,'maxlength="160" placeholder="留空使用品項名稱"')+
        '<label>供應商<select name="vendor">'+['',...OrderSettings.vendorNames()].map(v=>opt(v,v||'未指定',record.vendor)).join('')+
        '</select></label>'+input('unit','下單單位',record.unit,'required maxlength="12"')+
        input('purchaseNet','採購單價（未稅）',record.purchaseNet??'',prices)+
        input('saleNet','銷售單價（未稅）',record.saleNet??'',prices)+
        '</div><p class="case-meta">設定的單價用於填補報表空欄，按 5% 稅率計算含稅金額。</p>'+
        area('aliases','即時庫存品項別名（每行一個）',record.aliases.join('\n'),4)+
        '<p class="case-meta">別名可填寫 Excel 中的品名或型號。若變更會影響已匯入案件，請先匯出本次成果，重新整理後再變更。</p>'+
        actions(removeLabel)+'</form>';
    }else if(!template){
      const removeLabel=selected?(OrderSettings.isBuiltInVendor(name)?'恢復供應商預設':'移除供應商'):'';
      content.innerHTML=selector+'<form id="orderVendorForm" class="erp-settings-form"><div class="erp-settings-fields">'+
        nameField(name,'供應商名稱')+input('to','收件人（To）',record.to,'maxlength="512" placeholder="多個信箱以逗號分隔"')+
        input('cc','副本（CC）',record.cc,'maxlength="512" placeholder="多個信箱以逗號分隔"')+
        input('code','出貨廠商代碼',record.code,'maxlength="50"')+input('sapName','出貨廠商 ID',record.sapName,'maxlength="100"')+
        '</div><p class="case-meta">新增供應商後，可將品項指派給它、設定下單文案，並在案件手動登錄發票。PDF 自動辨識支援華茂及拍檔。</p>'+
        actions(removeLabel)+'</form>';
    }else{
      content.innerHTML=selector+'<form id="orderTemplateForm" class="erp-settings-form">'+
        '<p class="case-meta">可用變數 '+orderTokens.map(token=>'<code>{{'+token+'}}</code>').join(' ')+'</p>'+
        '<div class="erp-settings-fields">'+input('subject','單筆 Email 主旨',record.subject,'required maxlength="4000"')+
        input('batchSubject','多筆 Email 主旨',record.batchSubject,'required maxlength="4000"')+
        '</div><p class="case-meta">多筆主旨可使用 <code>{{供應商}}</code>、<code>{{筆數}}</code>、<code>{{公司名稱}}</code>、<code>{{品項}}</code>。</p>'+
        '<div class="erp-settings-fields">'+area('body','Email 內文',record.body,10)+area('line','LINE／群組訊息',record.line,10)+'</div>'+
        '<div class="case-actions"><button class="case-btn primary" type="submit">儲存文案</button>'+
        '<button class="case-btn" type="button" data-setting-action="preview">預覽範例</button>'+
        '<button class="case-btn" type="button" data-setting-action="default-templates">載入預設文案</button></div>'+
        '<pre id="orderSettingsPreview" hidden></pre></form>';
    }
  }
  function applySettings(data,message,preferred='') {
    OrderSettings.save(data,CaseWorkspace?.checkOrderSettings);
    CaseWorkspace?.refreshOrderSettings();
    if(preferred)selection[tab]=preferred;
    for(const section of ['items','vendors','templates']){
      const names=section==='items'?OrderSettings.itemNames():OrderSettings.vendorNames();
      if(!names.includes(selection[section]))selection[section]=names[0];
    }
    render();
    feedback(message,'success');
  }
  function replaceRow(data,kind,value) {
    return {...data,[kind]:[...data[kind].filter(row=>row.name!==value.name),value]};
  }
  root.addEventListener('submit',event=>{
    const form=event.target;
    if(!['orderItemForm','orderVendorForm','orderTemplateForm'].includes(form.id))return;
    event.preventDefault();
    try{
      const data=OrderSettings.snapshot(), f=new FormData(form), get=key=>String(f.get(key)??'').trim();
      const name=get('name')||selection[tab];
      if(tab==='items'){
        if(!selection.items&&OrderSettings.itemNames().some(item=>itemLookupKey(item)===itemLookupKey(name)))throw Error('品項名稱已存在。');
        const net=field=>get(field)===''?null:Number(get(field));
        const item={name,vendor:get('vendor'),label:get('label')||name,unit:get('unit'),
          aliases:get('aliases').split(/\r?\n/).map(alias=>alias.trim()).filter(Boolean),
          saleNet:net('saleNet'),purchaseNet:net('purchaseNet')};
        applySettings(replaceRow(data,'items',item),'品項設定已儲存。',name);
      }else if(tab==='vendors'){
        if(!selection.vendors&&OrderSettings.vendorNames().some(vendor=>norm(vendor)===norm(name)))throw Error('供應商已存在。');
        const vendor={...OrderSettings.vendor(name),name};
        for(const field of ['to','cc','code','sapName'])vendor[field]=get(field);
        applySettings(replaceRow(data,'vendors',vendor),'供應商設定已儲存。',name);
      }else{
        const vendor={...OrderSettings.vendor(name)};
        for(const field of orderTemplateFields)vendor[field]=String(f.get(field)??'');
        applySettings(replaceRow(data,'vendors',vendor),'下單文案已儲存。',name);
      }
    }catch(err){feedback(err.message,'error');}
  });

  async function importSettings(file) {
    validateFile(file,['json']);
    if(file.size>8*1024*1024)throw Error('自訂參數備份須小於 8 MB。');
    let data;
    try{data=JSON.parse(await file.text());}catch{throw Error('自訂參數備份無法讀取，請選擇有效的 JSON。');}
    if(window.confirm('以此備份取代目前的自訂參數？'))applySettings(data,'自訂參數已匯入並儲存。');
  }
  function exportSettings() {
    const data=JSON.stringify(OrderSettings.snapshot(),null,2);
    const url=URL.createObjectURL(new Blob([data+'\n'],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='設備請款助手_自訂參數.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    feedback('已要求下載自訂參數 JSON。','success');
  }

  root.addEventListener('change',event=>{
    const node=event.target;
    if(node.id==='orderSettingsFile'){
      const file=node.files[0];
      node.value='';
      if(file)importSettings(file).catch(err=>feedback(err.message,'error'));
    }else if(node.hasAttribute('data-settings-select')){
      selection[tab]=node.value;
      render();
      content.querySelector('[data-settings-select]')?.focus();
    }
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.settingsTab){
      tab=button.dataset.settingsTab;
      render();
      return;
    }
    try{
      const data=OrderSettings.snapshot(), action=button.dataset.settingAction, name=selection[tab];
      if(action==='new'){
        selection[tab]='';
        render();
        content.querySelector('input[name="name"]')?.focus();
      }
      if(action==='export')exportSettings();
      if(action==='remove'&&window.confirm('要'+button.textContent+'「'+name+'」嗎？')){
        applySettings({...data,[tab]:data[tab].filter(row=>row.name!==name)},'已更新自訂參數。');
      }
      if(action==='default-templates'){
        const form=button.form, defaults=OrderSettings.vendorDefaults(name);
        for(const field of orderTemplateFields)form.elements[field].value=defaults[field];
      }
      if(action==='preview'){
        const form=button.form, preview=document.getElementById('orderSettingsPreview');
        const sample={供應商:name,公司名稱:'範例商家',品項:'掃碼槍*2',聯絡人:'王小姐',電話:'0912-000-000',地址:'臺北市範例路 1 號',
          發票機備註:'',筆數:1};
        const sampleFor={subject:sample,batchSubject:{...sample,筆數:2,公司名稱:'範例商家、第二家商家',品項:'掃碼槍*2+錢箱*1'},
          body:{...sample,品項:'2支掃碼槍'},line:{...sample,品項:'掃碼槍* 2'}};
        const labels=['單筆 Email 主旨','多筆 Email 主旨','Email 內文','LINE／群組訊息'];
        preview.textContent=orderTemplateFields.map((field,i)=>labels[i]+'\n'+renderOrderTemplate(form.elements[field].value,sampleFor[field])).join('\n\n');
        preview.hidden=false;
      }
    }catch(err){feedback(err.message,'error');}
  });
  render();
  root.setAttribute('data-ready','');
  if(OrderSettings.readError())feedback('本機的自訂參數無法讀取，目前使用預設值。可匯入 JSON 備份復原。','error');
})();

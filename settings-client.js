/* Shared parameters are committed on the server before becoming active. */
function createSettingsClient(request,profileApi) {
  let revision, canEdit=false;
  async function fetchProfile(options) {
    let response, result;
    try{
      response=await request(new URL('api/order-settings',document.baseURI),{cache:'no-store',
        signal:AbortSignal.timeout(12_000),...options});
      result=await response.json();
    }catch{throw Error('共用設定連線失敗，請確認已登入及服務狀態。');}
    if(!response.ok)throw Error(result?.error||'共用設定無法讀寫。');
    if(!Number.isSafeInteger(result.revision)||result.revision<0||typeof result.canEdit!=='boolean')
      throw Error('共用設定回應格式不符。');
    profileApi.load(result.profile);
    revision=result.revision;
    canEdit=result.canEdit;
  }
  return {
    load:()=>fetchProfile(),
    canEdit:()=>canEdit,
    async save(raw,check) {
      if(!canEdit)throw Error('此帳號目前無法編輯共用設定。');
      const profile=profileApi.prepare(raw,check);
      await fetchProfile({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,profile})});
    }
  };
}

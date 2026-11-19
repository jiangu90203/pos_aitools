/* Personal backups in the Google Drive application data folder. */
const DriveSync = (() => {
  const scope = 'https://www.googleapis.com/auth/drive.appdata';
  const origin = 'https://www.googleapis.com';
  const api = origin + '/drive/v3/';
  const upload = origin + '/upload/drive/v3/files';
  const marker = 'pos-billing-workspace-v1';
  const maxBytes = 30 * 1024 * 1024;
  const validClientId = id => /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(id);
  const idFormat = /^[a-zA-Z0-9_-]{1,100}$/;
  let loadingGoogle;

  function prepareGoogle() {
    if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
    if (loadingGoogle) return loadingGoogle;
    loadingGoogle = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const handle = setTimeout(fail, 12000);
      function fail() {
        clearTimeout(handle);
        script.remove();
        reject(Error('無法載入 Google 授權，請檢查網路或瀏覽器封鎖設定。'));
      }
      script.addEventListener('load', () => {
        if (!globalThis.google?.accounts?.oauth2) { fail(); return; }
        clearTimeout(handle);
        resolve();
      }, {once:true});
      script.addEventListener('error', fail, {once:true});
      document.head.append(script);
    }).catch(err => { loadingGoogle = null; throw err; });
    return loadingGoogle;
  }

  function authorize(clientId) {
    const oauth = globalThis.google.accounts.oauth2;
    return new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id:clientId,
        scope,
        include_granted_scopes:false,
        callback(result) {
          if (result.error || !result.access_token || !oauth.hasGrantedAllScopes(result, scope)) {
            reject(Error('Google Drive 尚未授權。請確認登入帳號及應用程式資料權限。'));
            return;
          }
          const seconds = Number(result.expires_in);
          if (!Number.isFinite(seconds) || seconds <= 15) {
            reject(Error('Google 授權已過期，請重新連線。'));
            return;
          }
          resolve(makeDrive(result.access_token, Date.now() + (seconds - 15) * 1000));
        },
        error_callback() { reject(Error('Google 授權視窗未完成。請解除彈出視窗封鎖後重試。')); },
      });
      client.requestAccessToken({prompt:'select_account'});
    });
  }

  function makeDrive(token, expires, fetcher = globalThis.fetch) {
    const active = () => Date.now() < expires;
    async function request(url, options = {}, accepted = []) {
      if (!active()) throw Object.assign(Error('Google 授權已過期，請重新連線。'), {code:401});
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetcher(url, {
          ...options, signal:controller.signal, credentials:'omit', redirect:'error',
          headers:{...options.headers, Authorization:'Bearer '+token}
        });
        if (response.ok || accepted.includes(response.status)) return response;
        let reason;
        try { reason = (await response.json()).error?.errors?.[0]?.reason; } catch {}
        const errors = {
          401:'Google 授權已過期，請重新連線。',
          403:reason === 'storageQuotaExceeded'?'Google Drive 儲存空間不足，請釋放空間後重試。'
            :'Google Drive 拒絕操作。請核對 API 是否啟用、帳號授權及用量。',
          404:'Google Drive 找不到這個版本，請更新雲端狀態。',
          429:'Google Drive 請求過多，請稍後再試。'
        };
        throw Object.assign(Error(errors[response.status] || 'Google Drive 暫時無法完成操作，請重試。'), {code:response.status});
      } catch (err) {
        if (err.code) throw err;
        throw Error('無法連上 Google Drive，請檢查網路後重試。');
      } finally { clearTimeout(timeout); }
    }

    const query = (base, fields) => base + '?' + new URLSearchParams(fields);
    return {
      active,
      async user() {
        const info = await (await request(query(api+'about',{fields:'user(permissionId,emailAddress)'}))).json();
        if (!info.user?.permissionId) throw Error('Google Drive 無法辨識目前的帳號。');
        return info.user;
      },
      async list() {
        const fields = {spaces:'appDataFolder', pageSize:'100',
          q:"trashed = false and appProperties has { key='workspace' and value='"+marker+"' }",
          fields:'nextPageToken,incompleteSearch,files(id,createdTime,size,appProperties)'};
        const files = new Map(), pages = new Set();
        do {
          const data = await (await request(query(api+'files',fields))).json();
          if (data.incompleteSearch) throw Error('Google Drive 未傳回完整版本，請更新雲端狀態後重試。');
          for (const file of data.files || []) {
            if (!idFormat.test(file.id)) throw Error('雲端版本識別碼格式不符。');
            files.set(file.id,file);
          }
          fields.pageToken = data.nextPageToken;
          if (!fields.pageToken) return [...files.values()];
          if (pages.has(fields.pageToken)) throw Error('無法讀取完整的 Google Drive 版本列表。');
          pages.add(fields.pageToken);
        } while (true);
      },
      async read(id) {
        if (!idFormat.test(id)) throw Error('雲端版本識別碼格式不符。');
        const res = await request(query(api+'files/'+id,{alt:'media'}));
        const blob = await res.blob();
        if (blob.size > maxBytes) throw Error('雲端工作檔超過 30 MB。');
        return JSON.parse(await blob.text());
      },
      async reserve() {
        const data = await (await request(query(api+'files/generateIds',{count:'1',space:'appDataFolder'}))).json();
        const id = data.ids?.[0];
        if (!idFormat.test(id||'')) throw Error('Google Drive 未傳回可用的版本識別碼。');
        return id;
      },
      async append(id, work, parents) {
        const body = new Blob([work],{type:'application/json'});
        if (body.size > maxBytes) throw Error('工作檔超過 30 MB，請先下載 JSON 備份。');
        if (!idFormat.test(id) || parents.length > 29 || parents.some(p=>!idFormat.test(p))) {
          throw Error('雲端版本過多或識別碼無效，無法建立新版本。');
        }
        const appProperties = {workspace:marker};
        parents.forEach((parent,i)=>{appProperties['parent'+i]=parent;});
        const metadata = {id, name:'POS 案件工作檔.json', parents:['appDataFolder'], appProperties};
        let result;
        if (body.size <= 4 * 1024 * 1024) {
          const boundary = 'pos-work-'+crypto.randomUUID();
          const multipart = new Blob([
            '--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
            JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n',
            body,'\r\n--'+boundary+'--\r\n'
          ]);
          result = await request(query(upload,{uploadType:'multipart', fields:'id,createdTime'}), {
            method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:multipart
          },[409]);
        } else {
          const start = await request(query(upload,{uploadType:'resumable', fields:'id,createdTime'}), {
            method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json',
              'X-Upload-Content-Length':String(body.size)},body:JSON.stringify(metadata)
          },[409]);
          result = start;
          if (start.status !== 409) {
            const location = start.headers.get('Location');
            if (!location) throw Error('Google Drive 未回傳大型工作檔的上傳網址。');
            const target = new URL(location);
            if (target.origin !== origin || !target.pathname.startsWith('/upload/drive/v3/files')) throw Error('Google Drive 回傳的上傳網址不符。');
            result = await request(target.href,{method:'PUT',headers:{'Content-Type':'application/json'},body},[409]);
          }
        }
        if (result.status === 409) {
          // A retry must reuse the reserved ID. Verify that the prior write actually landed.
          const remote = await (await request(query(api+'files/'+id,{fields:'id,createdTime,appProperties'}))).json();
          if (remote.id !== id || remote.appProperties?.workspace !== marker) throw Error('無法確認前次雲端儲存，請更新雲端狀態。');
          return remote;
        }
        const data = await result.json();
        if (data.id !== id) throw Error('無法確認新雲端版本，請重試同步。');
        return {...data,appProperties};
      }
    };
  }

  function heads(files) {
    const previous = new Set(files.flatMap(file=>Object.entries(file.appProperties||{})
      .filter(([key,value])=>/^parent\d+$/.test(key)&&value!==file.id).map(([,value])=>value)));
    const current = files.filter(file=>!previous.has(file.id));
    if (files.length && !current.length) throw Error('雲端版本索引異常，請保留本機工作檔。');
    return current.sort((a,b)=>String(b.createdTime).localeCompare(String(a.createdTime))||a.id.localeCompare(b.id));
  }
  const sameIds = (a,b) => a!==null && a.length===b.length && b.every(id=>a.includes(id));

  return {validClientId,prepareGoogle,authorize,makeDrive,heads,sameIds};
})();

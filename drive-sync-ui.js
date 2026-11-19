/* Coordinates cloud versions without replacing a working copy unexpectedly. */
function initDriveSync({snapshot,hasWork,canReplace,validateWork,restore,onSaved,onRestored,onError}) {
  const byId = id => document.getElementById(id);
  const panel = byId('driveSync');
  if (!panel) return null;
  const input = byId('driveClientId'), summary = byId('driveSyncSummary');
  const toggle = byId('driveSyncToggle');
  const account = byId('driveAccount'), detail = byId('driveSyncStatus');
  const connect = byId('driveConnect'), disconnect = byId('driveDisconnect');
  const refresh = byId('driveRefresh'), save = byId('driveSave');
  const versions = byId('driveVersions'), selector = byId('driveVersion');
  const load = byId('driveLoad'), download = byId('driveDownload'), keep = byId('driveKeepLocal');
  const key = 'posBilling:driveClientId:' + location.pathname.replace(/index\.html$/,'');
  let configured = globalThis.POS_GOOGLE_CLIENT_ID || '';
  try { configured = configured || localStorage.getItem(key) || ''; } catch {}
  input.value = configured;
  let drive, connectedKey, identity, timer;
  let frontier = [], baseline = null, pending = null;
  let revision = 0, unsynced = false, working = false, review = false;
  let lastSync = '';
  let lastWork;
  const date = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())?'時間未提供':parsed.toLocaleString('zh-TW',{hour12:false});
  };
  const ids = () => frontier.map(file=>file.id);
  const ready = () => Boolean(drive?.active());
  const same = DriveSync.sameIds;

  function draw(message, tone = 'info') {
    if (message !== undefined) {
      summary.textContent = message;
      summary.dataset.tone = tone;
      detail.textContent = message;
      toggle.dataset.tone = tone;
      toggle.title = 'Google Drive 個人同步 · ' + message;
      detail.dataset.tone = tone;
    }
    const authorized = ready();
    account.textContent = drive && identity ? 'Google 帳號 '+(identity.emailAddress || '已確認') : '';
    connect.disabled = working;
    connect.textContent = authorized ? '切換 Google 帳號' : drive ? '重新連線 Google' : '使用 Google 帳號連線';
    input.disabled = working || authorized;
    disconnect.disabled = working || !drive;
    refresh.disabled = working || !authorized;
    save.disabled = working || !authorized || review || baseline===null || !unsynced;
    versions.hidden = !frontier.length;
    selector.disabled = working || !authorized;
    load.disabled = download.disabled = working || !authorized || !frontier.length;
    keep.hidden = !review || !drive;
    keep.disabled = working || !authorized || !hasWork();
  }

  function showFrontier(next) {
    const previous = selector.value;
    frontier = next;
    selector.replaceChildren();
    for (const item of frontier) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = date(item.createdTime)+' · '+item.id.slice(-7);
      selector.append(option);
    }
    if (frontier.some(item=>item.id===previous)) selector.value = previous;
  }
  function markSaved(file, savedRevision, content) {
    baseline = [file.id];
    lastSync = date(file.createdTime || Date.now());
    lastWork = content;
    if (savedRevision===revision) {
      unsynced = false;
      onSaved();
    }
  }
  async function readFrontier(ownWrite) {
    const files = await drive.list();
    if (ownWrite && !files.some(file=>file.id===ownWrite.id)) files.push(ownWrite);
    const committed = pending && files.find(file=>file.id===pending.id);
    if (committed) {
      markSaved(committed,pending.revision,pending.work);
      pending = null;
    }
    showFrontier(DriveSync.heads(files));
  }
  function showState() {
    review = baseline===null || !same(baseline,ids());
    if (review) {
      draw(frontier.length>1?'雲端有多個版本，請下載備份並選擇要接續的版本。'
        :frontier.length?'雲端與目前工作版本不同，請先核對再同步。'
          :'請先確認將目前工作存到這個 Google 帳號。','warning');
    } else if (unsynced) draw('本機有更新，等待同步。','warning');
    else if (lastSync) draw('上次同步 '+lastSync,'success');
    else draw('Google Drive 已連線，工作變更會自動同步。','success');
  }

  function schedule() {
    clearTimeout(timer);
    if (!unsynced || working || review || baseline===null || !canReplace()) return;
    if (!ready()) {
      if (drive) draw('Google 授權已過期。請重新連線，或先下載工作檔。','warning');
      return;
    }
    timer = setTimeout(() => run(()=>write(false)), 5000);
  }
  async function run(task) {
    if (working) return;
    clearTimeout(timer);
    working = true;
    draw();
    let done = false;
    try { await task(); done = true; }
    catch(err) {
      const message = err.message || '同步未完成，請重試。';
      draw(message,'error');
      onError?.(message);
    }
    finally {
      working = false;
      draw();
      if (done) schedule();
    }
  }
  async function loadVersion(file, askFirst) {
    if (!canReplace()) throw Error('請先完成或取消目前的匯入與核對。');
    if (askFirst && hasWork() && !confirm('載入雲端版本將取代目前工作。需要保留時，請先下載目前的工作檔。是否載入？')) return;
    const before = revision;
    const work = validateWork(await drive.read(file.id));
    if (before!==revision || !canReplace()) throw Error('載入期間目前工作已變更，請下載備份後再載入。');
    restore(work);
    pending = null;
    revision++;
    unsynced = false;
    markSaved(file,revision,JSON.stringify(snapshot()));
    showState();
    onRestored();
  }

  async function connectDrive() {
    const clientId = input.value.trim();
    if (!DriveSync.validClientId(clientId)) throw Error('請在設定欄填入 Google OAuth 網頁應用程式用戶端 ID。');
    if (location.protocol!=='https:' && !['localhost','127.0.0.1'].includes(location.hostname)) {
      throw Error('Google 登入需使用 HTTPS 網站或 localhost。');
    }
    try { localStorage.setItem(key,clientId); } catch {}
    if (!globalThis.google?.accounts?.oauth2) {
      draw('正在載入 Google 授權…');
      await DriveSync.prepareGoogle();
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        draw('Google 授權已就緒，請再按一次連線。');
        return;
      }
    }
    draw('請在 Google 視窗確認登入及授權。');
    const connection = await DriveSync.authorize(clientId);
    const user = await connection.user();
    const nextKey = clientId+'|'+user.permissionId;
    if (nextKey!==connectedKey) {
      baseline = null;
      pending = null;
      lastSync = '';
      lastWork = undefined;
    }
    drive = connection;
    connectedKey = nextKey;
    identity = user;
    await readFrontier();
    if (!hasWork() && canReplace() && baseline===null && !unsynced) {
      if (frontier.length===1) {
        await loadVersion(frontier[0],false);
        return;
      }
      if (!frontier.length) baseline = [];
    }
    showState();
  }

  async function write(force) {
    if (!canReplace()) throw Error('請先完成或取消目前的匯入與核對。');
    const reviewed = ids();
    draw('正在核對雲端版本…');
    await readFrontier();
    if (!same(force?reviewed:baseline,ids())) { showState(); return; }
    if (!force && !unsynced) { showState(); return; }
    if (!canReplace()) throw Error('目前有匯入正在處理，請完成後再同步。');
    if (force || !pending) {
      const work = JSON.stringify(snapshot());
      if (!force && work===lastWork) { unsynced = false; onSaved(); showState(); return; }
      const captured = revision;
      const parents = ids();
      pending = {id:await drive.reserve(),work,revision:captured,parents};
    }
    draw('正在儲存到 Google Drive…');
    const job = pending;
    const file = await drive.append(job.id,job.work,job.parents);
    pending = null;
    markSaved(file,job.revision,job.work);
    showFrontier([file]);
    // A second device can append just after preflight. Both writes are kept.
    try { await readFrontier(file); }
    catch { draw('已存到 Google Drive，暫時無法核對其他裝置的更新。','warning'); return; }
    showState();
  }

  connect.addEventListener('click',()=>run(connectDrive));
  input.addEventListener('blur',()=>{
    if (DriveSync.validClientId(input.value.trim())) DriveSync.prepareGoogle().catch(()=>{});
  });
  panel.addEventListener('toggle',()=>{
    if (panel.open && DriveSync.validClientId(input.value.trim())) DriveSync.prepareGoogle().catch(()=>{});
  });
  panel.addEventListener('keydown',event=>{
    if (event.key !== 'Escape' || !panel.open) return;
    event.preventDefault();
    event.stopPropagation();
    panel.open = false;
    toggle.focus();
  });
  window.addEventListener('pointerdown',event=>{
    if (panel.open && !panel.contains(event.target)) panel.open = false;
  });
  disconnect.addEventListener('click',()=>{
    clearTimeout(timer);
    drive = null;
    identity = null;
    showFrontier([]);
    draw('Google Drive 已中斷連線。');
  });
  refresh.addEventListener('click',()=>run(async()=>{await readFrontier();showState();}));
  save.addEventListener('click',()=>run(()=>write(false)));
  keep.addEventListener('click',()=>{
    if (confirm('以目前工作建立此帳號的雲端版本？既有版本會保留。')) return run(()=>write(true));
  });
  load.addEventListener('click',()=>run(async()=>{
    const id = selector.value;
    await readFrontier();
    const file = frontier.find(item=>item.id===id);
    if (!file) { showState(); throw Error('選取的版本已更新，請重新選擇。'); }
    await loadVersion(file,true);
  }));
  download.addEventListener('click',()=>run(async()=>{
    const file = frontier.find(item=>item.id===selector.value);
    if (!file) return;
    const work = validateWork(await drive.read(file.id));
    const url = URL.createObjectURL(new Blob([JSON.stringify(work,null,2)],{type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'POS_雲端工作檔_'+file.id.slice(-7)+'.json';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));
  window.addEventListener('online',schedule);
  draw(configured?'尚未連線 Google Drive':'尚未設定 Google Drive');
  return {
    changed() {
      revision++;
      unsynced = true;
      if (ready() && !working && !review && baseline!==null) draw('本機有更新，等待同步。','warning');
      if (review) draw();
      schedule();
    },
    schedule
  };
}

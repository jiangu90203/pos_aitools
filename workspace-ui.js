/* Workspace preferences and non-blocking operation notifications. */
const WorkspaceUI = (() => {
  const root = document.documentElement;
  const byId = id => document.getElementById(id);
  const app = byId('erpApp');
  const nav = byId('erpNavToggle');
  const themeButton = byId('erpThemeToggle');
  const themeLabel = byId('erpThemeLabel');
  const path = (window.location?.pathname || '/').replace(/index\.html$/, '');
  const settingsKey = 'posBilling:workspaceUI:' + path;
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(settingsKey)) || {}; } catch {}
  const narrow = window.matchMedia?.('(max-width: 760px)');

  function save(key, value) {
    preferences = {...preferences, [key]: value};
    try { localStorage.setItem(settingsKey, JSON.stringify(preferences)); } catch {}
  }

  function setNavigation() {
    const mobile = Boolean(narrow?.matches);
    const collapsed = mobile ? preferences.mobileNav !== 'open' : preferences.desktopNav === 'collapsed';
    const label = collapsed ? '展開左側選單' : '收合左側選單';
    app.setAttribute('data-nav', collapsed ? 'collapsed' : 'open');
    nav.setAttribute('aria-expanded', String(!collapsed));
    nav.setAttribute('aria-label', label);
    nav.title = label;
  }

  function setTheme() {
    const theme = preferences.theme === 'dark' ? 'dark' : 'light';
    const next = theme === 'dark' ? '淺色模式' : '深色模式';
    root.setAttribute('data-theme', theme);
    themeLabel.textContent = next;
    themeButton.setAttribute('aria-label', '切換' + next);
    themeButton.title = '切換' + next;
  }

  if (root && app && nav && themeButton && themeLabel) {
    setNavigation();
    setTheme();
    nav.addEventListener('click', () => {
      const wasOpen = nav.getAttribute('aria-expanded') === 'true';
      if (narrow?.matches) save('mobileNav', wasOpen ? 'collapsed' : 'open');
      else save('desktopNav', wasOpen ? 'collapsed' : 'open');
      setNavigation();
    });
    themeButton.addEventListener('click', () => {
      save('theme', preferences.theme === 'dark' ? 'light' : 'dark');
      setTheme();
    });
    narrow?.addEventListener?.('change', setNavigation);
  }

  const progress = byId('erpProgress');
  const progressLabel = byId('erpProgressLabel');
  const tasks = new Set();
  let progressTimer;
  const activeTask = () => [...tasks].at(-1);
  function drawProgress(task) {
    progress.hidden = false;
    progress.dataset.mode = task.percent === null ? 'pending' : 'measured';
    progress.setAttribute('aria-label', task.label);
    if (task.percent === null) progress.removeAttribute('aria-valuenow');
    else progress.setAttribute('aria-valuenow', String(task.percent));
    progress.style.setProperty('--progress-fraction', String((task.percent ?? 0) / 100));
    progressLabel.textContent = task.percent === null ? task.label + '…' : task.label + ' · ' + task.percent + '%';
  }

  function beginProgress(label) {
    if (!progress?.style || !progressLabel) return undefined;
    const task = {label, percent:null, timer:0};
    tasks.add(task);
    clearTimeout(progressTimer);
    if (!progress.hidden) drawProgress(task);
    task.timer = setTimeout(() => {
      if (activeTask() === task) drawProgress(task);
    }, 120);
    return {
      update(label, completed, total) {
        if (!tasks.has(task)) return;
        task.label = label;
        if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
          task.percent = Math.max(task.percent ?? 0, Math.min(99, Math.floor(completed * 100 / total)));
        }
        if (activeTask() === task && !progress.hidden) drawProgress(task);
      },
      end(completed) {
        if (!tasks.has(task)) return;
        const wasActive = activeTask() === task;
        clearTimeout(task.timer);
        tasks.delete(task);
        if (!wasActive) return;
        const next = activeTask();
        if (next) {
          drawProgress(next);
        } else if (completed && task.percent !== null && !progress.hidden) {
          drawProgress({...task,label:'處理完成',percent:100});
          progressTimer = setTimeout(() => { progress.hidden = true; }, 360);
        } else progress.hidden = true;
      }
    };
  }

  const pane = byId('erpNotifications');
  const stack = byId('erpToastStack');
  const counter = byId('erpToastQueue');
  const labels = {info:'操作提示', success:'操作完成', warning:'需要確認', error:'發生錯誤'};
  const queue = [];
  const visible = new Map();
  const maxVisible = 2;
  const duration = 5500;

  function mount(notice) {
    const {message, tone, title} = notice;
    const card = document.createElement('article');
    const heading = document.createElement('strong');
    const detail = document.createElement('div');
    const close = document.createElement('button');
    card.className = 'erp-toast';
    card.dataset.tone = tone;
    heading.className = 'erp-toast-title';
    heading.textContent = title;
    detail.className = 'erp-toast-detail';
    detail.textContent = message;
    detail.tabIndex = 0;
    close.type = 'button';
    close.className = 'erp-toast-close';
    close.textContent = '×';
    close.setAttribute('aria-label', '關閉通知：' + title);
    card.append(heading, close, detail);
    stack.append(card);
    visible.set(notice, close);

    let timer;
    const pause = () => clearTimeout(timer);
    function dismiss() {
      pause();
      const hadFocus = card.contains(document.activeElement);
      card.remove();
      visible.delete(notice);
      display();
      if (hadFocus) (visible.values().next().value || notice.previousFocus)?.focus?.({preventScroll:true});
    }
    close.addEventListener('click', dismiss);
    if (tone !== 'error') {
      const resume = () => {
        pause();
        if (!card.matches(':hover') && !card.contains(document.activeElement)) timer = setTimeout(dismiss, duration);
      };
      card.addEventListener('pointerenter', pause);
      card.addEventListener('pointerleave', resume);
      card.addEventListener('focusin', pause);
      card.addEventListener('focusout', () => queueMicrotask(resume));
      resume();
    }
    const announcer = byId(tone === 'error' ? 'erpToastAlert' : 'erpToastStatus');
    if (announcer) announcer.textContent = title + '，' + message;
  }

  function display() {
    while (visible.size < maxVisible && queue.length) mount(queue.shift());
    pane.hidden = !visible.size;
    counter.hidden = !queue.length;
    counter.textContent = queue.length ? '另有 ' + queue.length + ' 則通知等候顯示' : '';
  }

  function notify(message, tone = 'info', title = labels[tone]) {
    if (!message || !pane || !stack?.append || !counter) return;
    queue.push({message, tone, title, previousFocus:document.activeElement});
    display();
  }

  return {notify,beginProgress};
})();

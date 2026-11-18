/* Same-release, same-origin URLs for scripts, workers and optional dependencies. */
const SiteAssets = (() => {
  const release = '15.6';
  const pending = new Map();

  function url(path) {
    const base = typeof document === 'undefined' ? location.href : document.baseURI;
    const resource = new URL(path, base);
    if (['http:', 'https:'].includes(resource.protocol)) resource.searchParams.set('v', release);
    return resource.href;
  }

  function failure(path, label, detail='載入失敗') {
    return Error(label + detail + '（' + new URL(url(path)).pathname +
      '）。請完整更新 GitHub Pages 發布資料夾後重新整理。');
  }

  function loadScript(path, label, ready) {
    if (ready()) return Promise.resolve();
    if (!pending.has(path)) {
      const result = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = url(path);
        const timer = setTimeout(() => finish('載入逾時'), 20000);
        function finish(error) {
          clearTimeout(timer);
          tag.onload = tag.onerror = null;
          if (error) {
            tag.remove();
            reject(failure(path, label, error));
          } else resolve();
        }
        tag.onload = () => finish(ready() ? '' : '已讀取但無法初始化');
        tag.onerror = () => finish('載入失敗');
        document.head.append(tag);
      }).finally(() => pending.delete(path));
      pending.set(path, result);
    }
    return pending.get(path);
  }
  return {release, url, failure, loadScript};
})();

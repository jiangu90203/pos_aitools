# GitHub Pages 部署與資料保存

網站程式可維持全前端。部署的是 `site/` 下的 HTML、JavaScript、樣式、依賴和字型。GitHub Pages 提供靜態讀取。匯入、計算及產出 PDF／Excel 均在操作者裝置上處理，瀏覽器也無法直接改寫網站上的檔案。[GitHub Pages 說明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)


## 更新既有 pos_aitools

1. 若目前頁面有未保存的案件，先「下載工作檔」。至儲存庫 **Settings → Pages** 確認實際發布分支及資料夾。
2. 解壓本版 ZIP，在發布資料夾透過 **Add file → Upload files** 上傳 `site/` 裡的 30 個檔案。保留 `vendor/`、`vendor/quote/`、`docs/` 等層級，讓新版 `index.html` 與 `vendor/` 位於同一層。檢查 GitHub 待提交清單是否有 `.nojekyll`；若上傳介面漏傳，可在發布資料夾補建該檔。[GitHub 上傳說明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
3. 全部檔案以同一次更新提交。在 **Actions** 確認 Pages 部署成功，再重新整理網站，核對頁首顯示 **v15.3**。以合成檔確認 Excel 匯入、PDF 報價及下單文字。[Pages 發布來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

本次網站只需要 `site/` 內容。完整 ZIP、測試、建置來源和營運資料保留在受控位置。現有公開儲存庫的根目錄仍有舊版 ZIP 與測試目錄，應另行審查哪些檔案可公開。

| 資料與來源 | 保存位置及期限 | 跨裝置 |
| --- | --- | --- |
| 靜態發佈內容 | 部署來源及網站，保存至替換或下架。現有程式含轉換用的品項、價格及供應商對應規則。 | 所有獲准開站的人都能讀取已發佈的內容。 |
| POS、SAP、報價、附件、案件狀態與勾選 | 匯入後在當前頁面記憶體。重新整理、關頁或瀏覽器程序結束時清除。報價表單額外填寫欄位在當次表單。 | 每個工作階段獨立。 |
| 華茂與廠商下單接續列數 | 程式僅將這兩個數字記錄到 `localStorage`。一般瀏覽跨工作階段保存至被清除或阻擋，無痕視窗結束時會清除。網址來源、瀏覽器設定檔及裝置各自保存。同網域不同專案路徑可能共用此設定。 | 網頁沒有同步。 |
| 案件工作檔 JSON | 按「下載工作檔」，依使用者選定位置保存至刪除。內容包括案件、部分來源名稱與摘錄、勾選、報價資料及 SAP 列資料。原附件檔案本身仍由操作者保管。 | 可在其他電腦手動載入同一檔案。 |
| 匯出的報價 PDF／其他 Excel | 瀏覽器下載，保存在操作者選定位置。 | 可依公司授權方式分享。 |
| 雲端可更新的共用資料 | 目前架構未配置後端資料服務。 | 自動同步需額外後端。 |

原始檔透過檔案選擇器讀取。網站的 worker、字型、程式和 PDF 依賴以相對路徑載入，已用本機 `/pos_aitools/` 子路徑驗證。工具在 `file://` 直接開啟時仍可執行大部分作業，Excel 背景解析需 HTTP／HTTPS。剪貼簿優先採 HTTPS 的 Clipboard API，權限不可用時畫面會提供複製回饋。專案沒有使用 `sessionStorage` 或 IndexedDB。[瀏覽器本地保存](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) · [剪貼簿權限](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)

### 內部使用建議

- 請在具有公司授權與登入限制的靜態網站使用正式版本。GitHub Pages 的網站可見性需獨立核對，私有發布需要具備支援的 Enterprise Cloud 設定。公開測試使用已審查的程式和合成資料。部署源及網站資產應排除實際 POS、SAP、報價、工作 JSON、內部價格或供應商等機密內容與憑證。正式資料由各使用者在網頁選檔。[GitHub Pages 可見性](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- 現行架構最少改動的共用方式為在公司既有受控檔案空間保存工作 JSON，約定一人編輯後交接。若要自動同步，再接公司既有登入與受控資料 API 或資料庫，需處理使用者與案件權限、版本衝突、異動紀錄及備份。此版本沿用手動載入與下載。

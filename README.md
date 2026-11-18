# 設備請款助手 Pro v15.2

## 本機開啟

解壓縮後開啟 `site/index.html`。大量匯入時可用本機 HTTP 啟動，以背景處理 Excel。Windows 執行 `start-local.bat`，macOS 或 Linux 執行 `python3 serve.py --open`。兩種方式皆需要 Python 3，網址為 `http://127.0.0.1:8765`。本機 HTTP 也可處理瀏覽器對直接開檔的 PDF 及剪貼簿限制。

基本作業順序為 **匯入 POS → 套用匯入 → 搜尋並勾選案件 → 查看、補件或匯出**。下次續作使用「下載工作檔」產生的 JSON。完整操作見 `site/docs/USER_GUIDE.md`。

## 拍檔請款

工作區可先依內容生成描述，採購發票號碼、日期、未稅及含稅由實際憑證補入。首版支援人工輸入、Excel 補件及 PDF 文字候選擷取。不同供應商的實際 PDF 版型須由人員比對原件後確認。發票可逐張關聯設備與請款單號，跨案發票由操作人員確認分配金額。

## 內部系統報價單與下單文字

在案件按「查看」，先核對銷售單價，之後在「內部系統報價單 PDF」確認客戶欄位，按「產生 PDF 預覽」，即可開啟或下載同一份 PDF。既有報價 Excel 仍可匯入。SAP資料庫讀取原 VK 工作表，SAP Key-in 維持 Excel 匯出。

勾選案件後，「勾選案件的廠商下單文字」會自動依廠商顯示。選好 LINE、Email 主旨、Email 內文或全部內容，再一鍵複製。長清單的複製範圍包含該廠商全部頁數。

## 部署到自有網域

部署素材放在 `site/`，首頁為 `site/index.html`。資料保存與權限分析見 `GITHUB_PAGES.md`。

1. **Cloudflare Pages 直接上傳**。進入 Workers & Pages，選 Create application 及拖放上傳，把整個 `site` 資料夾放進上傳區。[官方操作說明](https://developers.cloudflare.com/pages/get-started/direct-upload/)
2. **GitHub 私有 repository 交由 Cloudflare 部署**。把 `site` 推到 GitHub 的 `main`。Pages 用 Connect to Git，Framework preset 選 None，Build command 用 `exit 0`，Build output directory 填 `site`。[Git 整合](https://developers.cloudflare.com/pages/get-started/git-integration/) · [靜態 HTML 發布](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)
3. 在 Pages 的 **Custom domains** 綁定子網域。正式內部使用時，在 **Cloudflare Access** 以公司 Email 名單設定登入。也應檢查 `pages.dev` 正式與預覽入口皆受保護或導向驗證頁。先使用合成資料試跑。[自訂網域](https://developers.cloudflare.com/pages/configuration/custom-domains/) · [Pages 登入設定](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)
4. **GitHub Pages 公開示範**。只把可公開的 `site` 內容放在公開 repository 根目錄，至 Settings → Pages 選 Deploy from a branch，指定 `main` 及 `/(root)`。[發布來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

POS、發票、SAP 工作簿與案件 JSON 透過工具畫面選取並在本機處理。部署資料夾應只使用套件中的網站檔案。

## 版本驗證

測試指令、結果及重現方式見 `TEST_RESULTS.md`。內部參考檔可由操作者自行提供。若需要回復至 v15.1，先下載案件工作檔，再於另一個資料夾開啟原 v15.1，載入工作檔續作。

# Google Drive 個人同步

## 首次設定 Google Cloud

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立專案，再在「API 和服務」的「程式庫」啟用 **Google Drive API**。[啟用 API 說明](https://developers.google.com/workspace/guides/enable-apis)
2. 進入 **Google Auth Platform**。在「品牌」設定應用程式名稱及聯絡信箱。個人 Gmail 可將「目標對象」設為 **外部** 並維持測試狀態，再把自己要登入的帳號加入測試使用者。若使用公司 Google Workspace，可依公司管理設定使用內部目標對象。測試狀態下的 Drive 授權會在授權後 7 天到期，可重新授權。[目標對象說明](https://support.google.com/cloud/answer/15549945)
3. 在「資料存取」加入 `https://www.googleapis.com/auth/drive.appdata`，用於存取此工具專用的 Drive 空間。接著到「用戶端」建立類型為 **網頁應用程式** 的 OAuth 用戶端。[Drive 權限說明](https://developers.google.com/workspace/drive/api/guides/appdata)
4. 「已授權的 JavaScript 來源」加入 `https://jiangu90203.github.io`。來源僅填 HTTPS 網域。若另外用本機 HTTP 啟動測試，另加入實際使用的 `http://localhost:8765` 或 `http://127.0.0.1:8765`。[JavaScript 來源設定](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
5. 點選工具右上角的使用者圖示，開啟「Google Drive 個人同步」，貼上 **OAuth 用戶端 ID**，再按「使用 Google 帳號連線」。確認選到正確的帳號並允許存取應用程式資料。網站管理者也可以將公開的用戶端 ID 填入 `drive-config.js` 的 `POS_GOOGLE_CLIENT_ID`，上傳該檔後各裝置即可共用設定。用戶端密鑰應留在 Google Cloud，不需要輸入本工具或提交到 GitHub。

## 日常使用

- 已有本機案件且尚未設定雲端版本時，按「以目前工作建立雲端版本」。雲端已連線、版本一致且完成匯入或修改時，約 5 秒後會自動儲存，也可按「立即同步」。請等畫面出現「上次同步」再離開。
- 換電腦時，使用原本的 OAuth 用戶端 ID 及同一 Google 帳號連線。空白工作台在只有一個目前版本時會自動載入。若本機已有工作或雲端同時有多個版本，畫面會要求核對。
- 遇到版本不同時，先下載本機工作檔及需要保留的雲端版本。選擇想接續的版本並載入。若想將目前工作設為新的雲端版本，按「以目前工作建立雲端版本」確認。寫入會新增版本，即使兩台電腦同時寫入也各自保留。
- 網路中斷可先下載本機 JSON。Google 存取授權過期或網頁重開時，請重新連線。存取權杖只保存在開啟中的頁面，授權到期後需透過使用者操作重新取得。[Google 授權方式](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

## 同步範圍

同步現有案件工作檔 JSON，包括案件、解析後的文件與關聯、請款狀態、匯入的報價及 SAP 底稿、勾選狀態與附件索引。每份工作檔上限 30 MB。原始 PDF、自訂單價、色系、瀏覽器處理紀錄及待處理的匯入預覽會留在本機。Google Drive 的應用程式資料夾不會出現在一般雲端硬碟檔案清單中，且其他帳號無法直接分享使用。[應用程式資料夾說明](https://developers.google.com/workspace/drive/api/guides/appdata)

每次有效變更會新增版本並消耗 Drive 空間。版本不會自動刪除。Google Drive API 的標準用量無額外費用，適用 Google 的使用額度。[Drive API 用量](https://developers.google.com/workspace/drive/api/guides/limits)

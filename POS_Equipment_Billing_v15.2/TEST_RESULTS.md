# v15.2 驗證紀錄

| 項目 | 執行方式 | 結果 |
| --- | --- | --- |
| 核心回歸 | `node tests/core.test.cjs` | PASS，41 項 |
| 舊功能整合 | `node tests/integration.test.cjs` | PASS，22 項。含 Excel 寫出重讀、華茂對帳、華茂／拍檔下單及實際華茂樣本。 |
| 案件、匯入、下單與報價 | `node --test tests/cases.test.cjs tests/imports.test.cjs tests/quotation-pdf.test.cjs` | PASS，26 項。含實際 POS、VK、PDF 預覽與下載共用檔案、金額加總、變更撤銷舊預覽、跨案件電話與文字、剪貼簿拒絕回饋。 |
| PDF 成品 | Poppler 實際讀取、PDF.js 相依資源本機提供 | PASS。A4 及 42 筆測試品項自動分頁，繁中、符號、統編／SHOP ID 前導零、金額與頁尾均可讀取。實際渲染並目視查看多頁輸出。 |
| 靜態資源 | `python3 tests/check_package.py`、`python3 tests/http.test.py`、`python3 tests/pages.test.py` | PASS。15 項資源於本機根路徑及 `/pos-billing/` 子路徑皆可讀取。 |
| 目標瀏覽器與實站 | Chromium 與 GitHub Pages | BLOCKED。環境拒絕 Chromium 啟動所需的 socket。OS 剪貼簿、內嵌 PDF 檢視器及 GitHub Pages 實站須在部署環境驗收。 |

測試使用 Node.js v24 及 Poppler。真實樣本可透過 `POS_FIXTURE`、`VK_FIXTURE`、`HM_FIXTURE`、`SALES_FIXTURE` 提供，ZIP 的 `site/` 資料夾可獨立部署。

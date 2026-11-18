# v15.3 驗證紀錄

## 線上根因

已發布的 v15.2 首頁回傳 HTTP 200，與原交付的 v15.2 HTML 相同。GitHub Pages 實際瀏覽器在 `/pos_aitools/vendor/xlsx.full.min.js` 顯示 404。公開 GitHub Contents API 回傳的根目錄清單未包含 `vendor/`，而交付檔原本含有該資料夾。頁面程式載入後，Excel 引用找不到 SheetJS 的全域 `XLSX`，因此中斷匯入。線上 `vendor/pdf.min.js`、`vendor/pdf-resources.js` 也確認未正常提供。CSS、主要頁面程式、manifest 及說明檔的線上請求回傳 200。

## 修復版驗證

| 項目 | 執行方式 | 結果 |
| --- | --- | --- |
| 核心回歸 | `node tests/core.test.cjs` | PASS，41 項。 |
| 舊功能整合 | `node tests/integration.test.cjs` | PASS，23 項。含實際華茂樣本、匯出重讀、15,000 列 Excel、Google Sheet CSV 與 CORS 錯誤的模擬回覆。 |
| 工作區、PDF 與部署 | `node --test tests/{cases,imports,quotation-pdf,deployment}.test.cjs` | PASS，30 項。含 XLSX/XLS、實際 POS／VK、PDF 多頁產生與下載流程、廠商文字與剪貼簿處理函式、首頁內建 Excel 初始化、背景缺檔備援、重新載入初始化。 |
| 靜態部署 | `python3 tests/check_package.py`、`python3 tests/http.test.py`、`python3 tests/pages.test.py` | PASS。根路徑核心資源 16 項，以及 `/pos_aitools/` 下全部 30 個發布檔案回傳 200，JS／CSS MIME 和無尾斜線轉址通過。 |
| 線上新版及瀏覽器整合 | GitHub Pages、Chromium | 待發布。執行環境拒絕本機 Chromium 的 socket 啟動，因此真實 OS 剪貼簿與內嵌 PDF 閱讀器仍待驗收。 |

CSV 維持原先的 Google Sheet 讀取程式。介面既有的本機檔案選擇仍使用 XLSX/XLS。測試用戶資料可透過 `POS_FIXTURE`、`VK_FIXTURE`、`HM_FIXTURE`、`SALES_FIXTURE` 指定。網站執行期間的資料仍在頁面記憶體，重新整理前先下載工作檔。

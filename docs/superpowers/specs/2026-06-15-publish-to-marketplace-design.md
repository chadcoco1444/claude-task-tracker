# 設計:Claude Task Tracker 上架 Marketplace

- **日期**:2026-06-15
- **狀態**:已核准(待寫實作計畫)
- **目標**:讓 Claude Task Tracker 能在 **VS Code Marketplace** 與 **Open VSX** 被安裝、**裝完即用**,並以 GitHub Actions 一鍵發版。

## 已確認的決定

| 項目 | 決定 |
|------|------|
| 上架平台 | VS Code Marketplace + Open VSX |
| Publisher / namespace | `chadcoco1444` |
| 首發版本 | `0.3.0` |
| 市集 icon | 火箭(白火箭 + 珊瑚漸層底,`#E59072`→`#C25A39`)。備選 V2(深色底)、V3(奶油底)見附錄 |
| Hook 安裝方式 | extension 啟動時自動安裝 + 首次徵詢同意 + 可關閉設定 |
| 發佈機制 | GitHub Actions(推 tag 自動發兩個市集);保留本機手動發佈當作首發驗證 |

## 背景與問題

這是一個 **VS Code 擴充**(非 Claude Code plugin),透過 Claude Code 的 hooks 把事件寫到 `~/.claude/tracker/events.jsonl`,extension 監看該檔並渲染樹狀圖、Dashboard 與狀態列。

**關鍵問題:對市集使用者目前不可用。** [src/extension.ts](../../../src/extension.ts) 的 `activate()` 只負責*讀取*事件記錄;真正讓 Claude Code 產生事件的 hooks,只有在開發者執行 `npm run install-hooks`([scripts/install-hooks.js](../../../scripts/install-hooks.js))時才會寫入 `~/.claude/settings.json`。市集使用者不會 clone repo、不會跑該 script,因此安裝後**完全沒有資料**。本設計的核心之一就是補上這個缺口。

此外,manifest 缺少上架所需的欄位(`publisher` 為 `local`、無 `icon`、無 `LICENSE`、版本落後 CHANGELOG)。

---

## 區塊 1 — 啟動時自動安裝 hooks(核心修正)

### 1.1 抽出共用模組
將 [scripts/install-hooks.js](../../../scripts/install-hooks.js) 的邏輯抽成可測試的 **`src/hookInstaller.ts`**,由 extension 與 npm script 共用,避免重複。模組輸出:

- `install(opts: { hookCommandPath: string; settingsPath?: string }): { changed: boolean }`
  - 以 `node "<hookCommandPath>"` 為 command,寫入下列 hook 事件(沿用現有定義):
    - `SessionStart`
    - `PostToolUse`,matcher `TodoWrite|Write|Edit|MultiEdit`
    - `PreToolUse`,matcher `Task`
    - `SubagentStop`、`Stop`、`SessionEnd`
  - **冪等 + 自我修復**:先以正則 `dist[\\/]+hook\.js` 移除任何舊的本工具 entry(含搬移/改版後的失效路徑),再加入新 entry。
  - **不覆寫**:`settings.json` 無法解析時中止,不破壞使用者檔案。
  - **僅在內容有變時才寫檔**:計算新設定,與現有相同則 `changed: false` 不寫(避免每次啟動都改動檔案時間)。
- `uninstall(opts): { changed: boolean }`:以同一正則移除本工具的所有 entry。

`scripts/install-hooks.js` 改為薄包裝:解析 `dist/hook.js` 絕對路徑後呼叫 `install()`。

### 1.2 extension 啟動流程
hook 路徑使用 `context.extensionPath` → `<安裝目錄>/dist/hook.js`(每次更新版本安裝目錄會變,靠 1.1 的自我修復重寫)。

同意狀態存於 `context.globalState`,key `claudeTaskTracker.hooksConsent`,值 `'granted' | 'declined' | undefined`。新增設定 `claudeTaskTracker.autoInstallHooks`(boolean,預設 `true`)。

`activate()` 邏輯:

```
if (autoInstallHooks) {
  if consent === 'granted'      → 靜默執行 install()(只有變動才寫檔)
  else if consent === undefined → 跳同意提示
  else (declined)               → 不動作
}
// autoInstallHooks === false 時不自動執行,只剩手動指令
```

同意提示(`showInformationMessage`,modal=false):
> 「Claude Task Tracker 需要在 `~/.claude/settings.json` 加入 hooks,才能看到你的 Claude Code 工作階段。要現在安裝嗎?」
> 按鈕:**[安裝]** → consent=`granted` 並 `install()`;**[稍後]** → 維持 undefined(下次再問);**[不再詢問]** → consent=`declined`。

install 失敗以非阻斷的 warning 呈現,不讓 `activate()` 崩潰。

### 1.3 指令
- `claudeTaskTracker.installHooks` — 標題「Tracker: Install Claude Code hooks」:強制執行 `install()` 並設 consent=`granted`。
- `claudeTaskTracker.uninstallHooks` — 標題「Tracker: Remove Claude Code hooks」:執行 `uninstall()` 並設 consent=`declined`。

### 1.4 測試(vitest)
針對 `hookInstaller`:全新安裝寫入六個事件;重複呼叫冪等;舊路徑被新路徑取代(自我修復);內容未變時 `changed:false`;`settings.json` 損毀時中止不覆寫;`uninstall` 只移除本工具 entry、保留他人 hooks。

---

## 區塊 2 — 市集資產與 manifest

### 2.1 icon
- 將鎖定的 V1 火箭 SVG 存為 `media/icon.svg`,並輸出 **`media/icon.png`(128×128)**。
- **產生方式**:用無頭瀏覽器(Playwright,環境已具備)以 128×128 viewport 渲染 SVG 後截圖,**不新增任何建置相依**。

### 2.2 package.json 變更
- `publisher`: `"chadcoco1444"`(原 `local`)
- `version`: `"0.3.0"`
- `icon`: `"media/icon.png"`
- `galleryBanner`: `{ "color": "#C25A39", "theme": "dark" }`
- `categories`: `["AI", "Visualization", "Other"]`
- `keywords`: `["claude", "claude code", "anthropic", "ai", "agent", "subagent", "task", "todo", "tracker", "progress"]`
- `bugs`: `{ "url": "https://github.com/chadcoco1444/claude-task-tracker/issues" }`
- `homepage`: `"https://github.com/chadcoco1444/claude-task-tracker#readme"`
- `scripts`:新增 `"vscode:prepublish": "npm run build"`;選配 `"package": "vsce package"`、`"publish": "vsce publish"`
- `contributes.configuration.properties`:新增 `claudeTaskTracker.autoInstallHooks`(boolean,預設 true,附說明)
- `contributes.commands`:新增上述兩個 install/uninstall 指令
- `devDependencies`:新增 `@vscode/vsce`、`ovsx`

### 2.3 LICENSE
新增 MIT 授權檔(年份 2026,作者 `chadcoco1444`;之後可換成真實姓名)。

### 2.4 .vscodeignore
在現有內容上補排除:`scripts/`、`.github/`、`package-lock.json`、`*.vsix`、`.vscode-test/`。
最終 `.vsix` 只應含:`dist/`、`media/icon.png`(+`icon.svg` 可留)、`README.md`、`CHANGELOG.md`、`LICENSE`、`package.json`。

---

## 區塊 3 — README 上架化

- 頂部新增 **Install** 區:從 VS Code Marketplace / Open VSX 安裝;首次啟動會提示安裝 hooks;前置需求 Claude Code + Node。
- 既有開發步驟移到 **Development** 標題下。
- 新增 **Screenshots** 區:實機截圖最佳(建議由使用者提供);實作時若能跑起 Extension Dev Host 則擷取真實畫面,否則放清楚標記的 placeholder 待替換(**不放會誤導的假畫面**)。
- 選配:市集版本/安裝數 badge。

---

## 區塊 4 — GitHub Actions 自動發佈

### 4.1 `.github/workflows/release.yml`
- 觸發:`push` tag `v*.*.*`
- 步驟:checkout → `actions/setup-node` → `npm ci` → `npm test` → `npm run build` → `vsce package` → `vsce publish -p $VSCE_PAT` → `ovsx publish -p $OVSX_TOKEN` → 以 `softprops/action-gh-release` 將 `.vsix` 掛到 GitHub Release。
- Secrets:`VSCE_PAT`、`OVSX_TOKEN`。

### 4.2 `.github/workflows/ci.yml`
- 觸發:PR 與 push 到 `master`
- 步驟:`npm ci` → `npm run build` → `npm test` → `vsce package`(乾跑驗證打包),提早抓錯。

---

## 區塊 5 — 一次性帳號設定 Runbook(使用者自行執行)

寫入 README 或獨立 `docs/PUBLISHING.md`。

**VS Code Marketplace**
1. 建立 Azure DevOps org(dev.azure.com,若尚無)。
2. 在 <https://marketplace.visualstudio.com/manage/createpublisher> 建立 publisher,ID 必須等於 `chadcoco1444`。
3. Azure DevOps → User settings → Personal Access Tokens → 建 PAT,scope `Marketplace > Manage`、organization「All accessible organizations」。
4. 存成 GitHub repo secret `VSCE_PAT`。

**Open VSX**
1. 以 GitHub 登入 <https://open-vsx.org>。
2. 簽署 Eclipse Foundation Publisher Agreement。
3. 建立 namespace:`ovsx create-namespace chadcoco1444 -p <token>`。
4. 在 open-vsx.org 設定頁產生 access token,存成 GitHub secret `OVSX_TOKEN`。

**發版**:更新 CHANGELOG → bump `version` → `git tag v0.3.0` → `git push --tags` → CI 自動發佈兩個市集並建立 Release。
**首發驗證(選配)**:先在本機 `vsce publish` / `ovsx publish` 跑一次,確認帳號/權限無誤後再交給 CI。

---

## 區塊 6 — 驗證

- `hookInstaller` 單元測試全綠(見 1.4)。
- `vsce package` 成功;`vsce ls` 確認內容物乾淨(不含 `src/`、`node_modules/`、`docs/`、`.superpowers/`)。
- 本機 `code --install-extension claude-task-tracker-0.3.0.vsix`:確認首次同意提示 → 同意後 `~/.claude/settings.json` 出現六個 hook entry 且指向安裝目錄的 `dist/hook.js` → 跑一次 Claude Code 後 tree/Dashboard 有資料。
- 移除測試:執行 `Tracker: Remove Claude Code hooks` 後 entry 消失、他人 hooks 保留。

---

## 範圍外 / 開放項目

- 實機截圖 / GIF(需跑起 extension;建議使用者提供,或後續補)。
- LICENSE 作者真實姓名(先用 handle)。
- Telemetry、在地化(本次不做)。

---

## 附錄 — icon 備選

- **V2**:深色底(`#26243A`→`#16141f`)+ 珊瑚火箭。科技沉穩,融入深色 IDE 最自然。
- **V3**:奶油底(`#F0EEE6`)+ 珊瑚火箭。最貼近 Claude 官方品牌色,最柔和。

(最終採用 V1。)

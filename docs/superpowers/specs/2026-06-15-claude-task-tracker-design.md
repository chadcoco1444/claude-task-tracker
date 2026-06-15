# Claude Task Tracker — 設計文件

- **日期**:2026-06-15
- **狀態**:設計已確認,待 review
- **形態**:VSCode 擴充套件
- **一句話**:把 Claude Code 在 superpowers 流程(brainstorm → spec → plan → 執行)中的 task 進度與 subagent 收斂狀態,即時視覺化呈現在 VSCode。

---

## 1. 問題與目標

一個 feature 在執行階段會拆成許多 task,並由不同 subagent 處理。目前在 Claude Code 裡很難一眼掌握:

- 整體 task 進行到哪了?
- 哪些 subagent 還在跑、哪些已經收斂(完成回傳)?
- 多個 feature 同時在跑時,各自的狀況?

**目標**:提供一個 VSCode 內的狀態檢視,即時回答上述三個問題。

**非目標(本版不做)**:取代 Claude Code 本身的執行流程、修改 superpowers 既有 skill、產生報表/分析。

---

## 2. 已確認的決策(brainstorm 結論)

| 主題 | 決策 |
|---|---|
| Task 來源 | **混合**:plan markdown 當骨架 + 即時事件填入進度/收斂 |
| 資料管道 | **Claude Code hooks 寫狀態**(不靠解析 transcript) |
| 傳輸格式 | **Append-only 事件 log(JSONL)**,extension 自行 reduce |
| Subagent 細節 | **MVP 二元(running / converged)**,資料模型與 UI 預留多階段+目前動作 |
| 追蹤範圍 | **多 feature 並行**,一次看到全部 |
| 呈現介面 | **A 原生側邊樹狀檢視(主)** + **C 底部狀態列摘要(一眼看、點擊聚焦)** |
| 骨架對應 | **寬鬆並列(A)**;資料模型預留 `taskId` 以便日後升級半結構化錨點(C);**不做**文字模糊比對(B) |

骨架對應補充:在 superpowers 執行階段,TodoWrite 清單本身就是 plan task 的即時版且帶有真實狀態,因此「task 到哪」以 TodoWrite 為最可信來源,plan markdown 並列為參考骨架/完整細節。模糊比對會「自信地給錯」而侵蝕工具可信度,故排除。

---

## 3. 架構與資料流

```
Claude Code session(可能多個並行)
   │  觸發 hooks
   ▼
Hook scripts ──append 一行事件──▶  ~/.claude/tracker/events.jsonl  (全域、append-only)
                                          │  file watcher
                                          ▼
                          VSCode 擴充套件
                          Reducer:events[] → state(純函式)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                                ▼
                  側邊樹狀檢視 (主)                  底部狀態列摘要 (一眼看)
```

**原則**

- **全域 event log**:所有 session 的 hooks 都 append 到同一個 `~/.claude/tracker/events.jsonl`。任一個 VSCode 視窗的 extension 都讀同一份 → 達成「多 feature 並行、一次看到全部」。UI 可提供「只看目前 workspace」的過濾切換。
- **單向資料流**:hooks 只寫事件、不懂 UI;extension 只讀事件 → 算狀態 → 畫。兩端解耦,各自獨立測試。
- **Append-only**:多個平行 subagent 的 SubagentStop hook 可能同時觸發;append 一行不會互相覆蓋(避免 read-modify-write 競寫)。extension 中途打開也能從頭 reduce 重建現況。

---

## 4. 元件拆解

每個元件單一職責、介面清楚、可獨立測試。

| 元件 | 職責 | 依賴 |
|---|---|---|
| **Hook scripts**(`hooks/`) | 接 Claude Code 的 SessionStart、PostToolUse(TodoWrite)、PreToolUse(Task)、SubagentStop、Stop,各自 append 一個事件 | 僅 stdin 的 hook payload + 檔案系統 |
| **Event schema**(共用型別) | 定義事件種類與欄位(含預留 `taskId`) | 無 |
| **Reducer**(純函式) | `events[] → state`,無任何 IO → 最易測 | schema |
| **Watcher / Store** | tail event log、餵 reducer、變更時通知 UI | reducer + VSCode fs watcher |
| **TreeView Provider** | 把 state 畫成 Feature → Task → Subagent 樹 | store |
| **StatusBar Provider** | 從 state 算摘要字串、點擊聚焦樹 | store |

---

## 5. 資料模型

### 5.1 事件(append 到 `events.jsonl`,每行一個 JSON 物件)

```jsonc
// session 開始
{"t":"session_start","ts":1718000000,"session":"abc","cwd":"/path/to/repo","label":"Auth 系統"}

// 偵測到 plan(骨架);taskId 預留作日後精準對應
{"t":"plan_detected","ts":1718000001,"session":"abc","plan":"docs/superpowers/plans/auth-plan.md",
 "tasks":[{"id":"T1","text":"DB schema"},{"id":"T2","text":"API routes"},{"id":"T3","text":"Login UI"}]}

// TodoWrite 快照(PostToolUse 取得完整清單,直接覆蓋該 session 的 liveTodos)
{"t":"todo_update","ts":1718000050,"session":"abc",
 "todos":[{"text":"DB schema","status":"completed"},
          {"text":"Login UI","status":"in_progress"}]}

// subagent 啟動(PreToolUse on Task)
{"t":"subagent_start","ts":1718000060,"session":"abc","agent":"a1","kind":"frontend-developer","desc":"Login UI"}

// subagent 收斂(SubagentStop)
{"t":"subagent_stop","ts":1718000090,"session":"abc","agent":"a1"}

// session 結束(Stop)
{"t":"session_stop","ts":1718000200,"session":"abc"}
```

### 5.2 Reducer 折出的狀態

```
state.features: Map<sessionId, Feature>

Feature {
  label:      string             // 來自 plan 標題,退回首條 user prompt / session id
  planPath:   string | null
  skeleton:   { id, text }[]     // 來自 plan_detected,靜態參考大綱
  liveTodos:  { text, status }[] // 來自最新 todo_update(覆蓋式)
  subagents:  Map<agentId, { kind, desc, status: 'running' | 'converged' }>
  status:     'active' | 'idle' | 'done'
}
```

**語意對應**

- **task 到哪** = `liveTodos` 的 `in_progress / completed`;`skeleton` 為參考大綱。
- **subagent 收斂了沒** = 該 agent 是否收到 `subagent_stop`(MVP 二元)。
- **feature 身分** = session;標籤取自偵測到的 plan 標題。
- **整體進度 n/m** = 顯示用任務清單(見 §6.1)中 completed 數 / 總數。
- **`status` 推導**:`done` = 已收到 `session_stop` 且所有 todo 皆 completed;`active` = 有 running subagent 或有 in_progress todo;其餘為 `idle`。

---

## 6. UI 行為

### 6.1 側邊樹狀檢視(主)

```
⧉ Tracker
▼ ✅ Auth 系統            5/6
   ✓ DB schema
   ✓ API routes
   ▶ Login UI            · 2 agents
      ⟳ frontend-developer
      ✓ code-reviewer
   ○ 測試
▼ ▶ Billing              1/4
   ▶ Stripe 串接          · 1 agent
      ⟳ payment-integration
```

- 三層:**Feature**(進度 n/m + 整體圖示)→ **Task**(`✓ 完成 / ▶ 進行中 / ○ 待辦`)→ **Subagent**(`⟳ 跑中 / ✓ 收斂`)。
- **Task 層級的來源(寬鬆並列的明確規則,不做模糊比對)**:若該 feature 已有 `liveTodos`,Task 層級顯示 `liveTodos`(即時、帶真實狀態);若尚未有任何 `todo_update`,則顯示 `skeleton`(以淡色標示為「計畫中」),讓執行開始前也看得到預計的 task。兩者不交叉比對、不混合。
- 可折疊;點 Feature 可開對應 plan 檔。
- 圖示/顏色預留 `failed` 狀態,與未來多階段(running 顯示目前動作)。

### 6.2 底部狀態列摘要(C)

- 形式:`▶ Auth 5/6 · ⟳2`(進度 + 跑中 agent 數)。
- 多 feature 時並列最近活躍者;點擊聚焦/展開側邊樹。

---

## 7. 錯誤處理與邊界

| 情況 | 處理 |
|---|---|
| event log 有壞掉/不完整的行 | 跳過該行,繼續 reduce(避免一行壞掉全炸) |
| extension 中途才打開 | 從頭 reduce 既有事件重建現況(append-only 的好處) |
| `subagent_stop` 取不到對應 `agent` id | **待驗證的實作風險**。若拿不到,MVP 退而用「同 session 內 start 數 − stop 數 = 跑中數」近似,仍滿足二元收斂 |
| event log 無限長 | 本版先不處理;後續加 rotation / 啟動時截斷舊 session |
| 多視窗同時讀同一份 log | 唯讀;各 extension 各自 reduce,無協調問題 |

---

## 8. 測試策略

- **Reducer(純函式)**:核心測試重點。給定事件序列 → 斷言 state。涵蓋:多 session 交錯、todo 覆蓋、subagent start/stop 配對、壞行跳過、中途重建。
- **Hook scripts**:給定樣本 hook payload(stdin)→ 斷言 append 出的事件行格式正確。
- **Providers**:給定 state → 斷言樹節點結構與狀態列字串(可用 VSCode 測試或抽出純邏輯測)。
- **整合(手動/煙霧測試)**:跑一次真實 superpowers 執行,確認事件有寫入、樹有更新。

---

## 9. MVP 範圍(YAGNI)

**v1 要做**

- 5 個 hook scripts(SessionStart / PostToolUse-TodoWrite / PreToolUse-Task / SubagentStop / Stop)
- 全域 `events.jsonl` append
- Reducer(純函式)+ Watcher/Store
- 側邊樹狀檢視(Feature → Task → Subagent)
- 底部狀態列摘要 + 點擊聚焦
- Subagent 二元狀態(running / converged)
- 多 feature 並列

**之後再說**

- 半結構化 `taskId` 精準對應(C)
- Subagent 多階段 + 目前動作顯示
- 批次收斂(一批平行 agent 全部收斂)
- 歷史回看 / 已完成 feature 封存
- log rotation
- Webview 儀表板(B)

---

## 10. 開放問題(交給 plan / 實作階段驗證)

1. Claude Code 的 `SubagentStop` hook payload 是否帶有可對應 `PreToolUse(Task)` 的 id?(決定 §7 的 fallback 是否啟用)
2. `plan_detected` 如何觸發:由哪個 hook、用什麼條件判定「目前 session 對應哪個 plan 檔」?(候選:SessionStart 時掃描最近的 plan 檔;或 PostToolUse 在讀取 plan 檔時記錄)
3. Extension 技術選型:TreeDataProvider + StatusBarItem 的具體 API 與 file watcher 在 Windows 上的行為。
4. `~/.claude/tracker/` 目錄與 hooks 安裝方式(隨 extension 安裝寫入 Claude Code settings,或提供安裝指令)。

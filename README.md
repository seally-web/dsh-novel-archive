# dsh-novel-archive（复活 DeepSeek 人设版）

DSH bundle that turns a DeepSeek share link into a **modular knowledge base** in a work folder — transcript, per-chapter plot files, character sheets, event book, timeline, rules, rolling memory — plus a composer panel that continues the role-play in one click and reads that folder as its memory.

Panel: 输入框下方「📚 小说续接」→ 贴链接、选工作目录、可选上传原始人设与补充文件、开始整理 → 一键继续（第 N 轮）。
续接时自动现读 `01_剧情`…`17_场景` 这套模块（索引 + 按预算取用），再读 `设定/` 与记忆卡；改文件下一轮就生效，用来防设定漂移与忘上下文。

Tools:

- `novel_archive_extract` — fetch the share, download the attachment, merge user 人设/补充文件, write 01 + turns + chapter chunks + PLAN
- `novel_archive_search` — keyword/regex lookup over the rounds with context
- `novel_archive_status` — progress report for the pipeline
- `novel_archive_state` — compact JSON state (rounds, next round, chapters, pack)
- `novel_archive_continue` — build the ready-to-paste continuation prompt (knowledge-base modules + 设定 + memory cards) and the next round number
- `novel_archive_memory` — rolling memory: status / digest / save card / rebuild index / recall
- `novel_archive_kb` — modular knowledge base: init / index / read / sync / append (剧情 章节目录、角色、事件簿、时间线、规则按出处拆分、情感、伏笔、语感、来源、记忆卡)
- `novel_archive_assemble` — rebuild 01 with real names, assemble 03 from beats, sync the knowledge base, generate the 00—07 pack, zip it

No `novel.json` yet? `continue` and `assemble` infer one from the setting and the last rounds, write it to the work folder, and tell you to review it.

Details, `novel.json` schema, host API, and limitations: [docs/DETAIL.md](docs/DETAIL.md).

Install: Plugins → Add plugin → point at this directory, or `plugin_manager` `install_bundle` with the absolute path. 装好或更新后刷新一次页面，输入框下方的按钮才会重新挂上。

## 目录（15 个模块）

`00_知识库.md` 索引 + `01_剧情`（每章一个文件）+ `02_角色_他` + `03_角色_我` + `04_事件` + `05_时间线` + `06_特殊事件` + `07_其他人物` + `08_特殊物品` + `09_生活物品` + `10_规则`（`00_规则清单.md` + `来源NN_*.md` + `输出规则.md`）+ `11_记忆卡` + `12_情感`（要求/样本/曲线）+ `13_伏笔` + `14_语感` + `15_来源` + `16_世界观` + `17_场景`。

上传的人设与补充按段拆进 `10_规则/`（每份带出处）；每次一键继续会刷新当前这一幕、补事件簿、重写情感样本，并每满 20 轮自动落一张记忆卡。

续接 prompt 会写明「你就是这个角色」，并要求它的思考链也用角色的眼睛；`novel_archive_kb` 的 `append` 支持 `module:"hero"`，AI 可以自己把新的人物侧面追加进 `02_角色_他/角色_他.md`。

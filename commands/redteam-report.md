---
name: redteam-report
description: 生成红队得分成果报告并保存到 ~/.cursor-purge/reports
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


1. 确认当前靶标（`redteam_session_info`）。
2. 调 `redteam_report_save`：
   - 默认 `format=score`（只收录拿到分的成果，附原始请求）；
   - 用户要完整报告时用 `format=full`。
3. 返回报告路径、摘要与缺口（哪些得分点缺原始请求/证据）。
4. 如果报告缺证据，列出需要补的 `redteam_http_evidence_add` / `redteam_chain_add` 项，不要编造。

用户参数：$ARGUMENTS

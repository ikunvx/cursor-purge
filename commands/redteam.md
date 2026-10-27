---
name: redteam
description: 启动/继续一次授权红队演练（绑定靶标 → 预检 → 五阶段派发）
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


以 `redteam-lead` 子代理执行本流程（必要时在 Cursor 中直接选择/点名 `redteam-lead`）。加载 `redteam-ops` 技能，然后按下面顺序执行。用户参数：$ARGUMENTS

1. 调 `redteam_session_info` 看当前工作区是否已绑定靶标。
2. 如果没有绑定：向用户确认 **靶标名称、授权 CIDR/域名、授权书/工单号、有效时间窗、是否允许高危动作**。
   然后调 `redteam_engagement_open`（`high_risk` 默认 false；没有明确授权不要开 true）。
3. 调 `redteam_preflight`，把 `warnings` 和 `onboarding.missing` 一次列给用户；缺工具/key/VPS 先补齐，不要硬开工。
4. 按五阶段顺序推进，每次只派一个：
   `redteam-recon` → `redteam-assess` → `redteam-vuln-scan` → `redteam-exploit` → `redteam-internal`。
   派发前 `redteam_agent_slot action=acquire role=<role>`，Agent 返回后 `action=release key=<key>`。
5. 每次子代理返回后先核对落库数据（`redteam_asset_query` / `redteam_vuln_query` / `redteam_sessions`），再决定下一步。
6. 用户问进度时给：阶段、得分、已控资产/入口、下一步；要报告时调 `redteam_report_save`。

硬约束：没有 scope 不发包；超出 scope 的目标立即停止；高危动作必须用户明确确认。

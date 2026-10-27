---
name: redteam-status
description: 查看当前红队靶标的资产、得分、攻击链与可用入口
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


读取真实数据后汇总，不要凭记忆：

1. `redteam_session_info` — 当前靶标、授权范围、是否过期。
2. `redteam_asset_stats` — C 段/资产/存活/端口/Web 站点。
3. `redteam_score_list` — 已得分/总分、按阶段。
4. `redteam_attack_chain` — 五阶段进度与边界隧道。
5. `redteam_sessions` — WebShell / 隧道 / 凭据。

输出：当前阶段、得分、已控资产与入口、缺口、下一步建议派谁。用户参数：$ARGUMENTS

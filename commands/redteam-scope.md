---
name: redteam-scope
description: 查看或更新当前靶标的授权范围（CIDR/域名/到期时间）
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


1. 调 `redteam_scope_get` 显示当前 `cidrs`、`domains`、`authorization_ref`、`expires_at`、`high_risk`。
2. 如果用户要更新：先复述将要新增/替换的范围，得到明确确认后再调 `redteam_scope_update`。
   - 新增用 `add_cidrs` / `add_domains`；替换用 `cidrs` / `domains`。
   - 不允许 `0.0.0.0/0`、`::/0`、`*`；公网段不得宽于 /24。
3. 更新后调 `redteam_preflight` 复核，并提示 hook 会按新范围拦截。

用户参数：$ARGUMENTS

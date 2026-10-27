---
name: redteam-tools
description: Cursor 红队工具路径、用途与安全调用约定（nmap/nuclei/httpx/subfinder/ffuf/fscan/gogo/suo5 等）。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 工具清单与调用约定

工具路径来自 `~/.cursor-purge/config.json`（首次运行从 DSH 的 `~/.dsh/redteam/config.json` 继承）。先用 `redteam_preflight` 看 `exists=false` 的项。

| 工具 | 用途 | 注意事项 |
|---|---|---|
| subfinder / dnsx / naabu / httpx | 子域→解析→端口→存活 | 先被动后主动；结果用 `redteam_asset_add` 落库 |
| nmap | 端口/服务/指纹 | 授权范围内；避免 -T5 全速 |
| nuclei | 模板化 Nday/1day | 先 `redteam_poc_search`；建议 `-rate-limit 50` |
| ffuf / feroxbuster / gobuster | 目录/接口发现 | 控制并发，避免封禁 |
| fscan / gogo | 内网铺面/打点 | 仅通过合法隧道、内网授权段 |
| suo5 / chisel / frp | 隧道 | 必须登记 `redteam_tunnel_add`，写清 entry_kind |
| sqlmap / impacket | 数据库/域渗透 | 高危；需 `high_risk=true` + 用户确认 |

## Bash 约定
- 只执行授权范围内目标；scope-guard 会在 beforeShellExecution 拒绝越界目标。
- 命令与回显写入 `redteam_chain_add`（tool/result）；原始请求用 `redteam_http_evidence_add`。
- 不把真实网络请求写进自动化测试；不在未授权目标上做任何探测。

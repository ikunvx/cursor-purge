---
name: redteam-ops
description: Cursor 红队演练总流程：授权靶标、预检、五阶段派发、落库核对、计分与报告。启动 /redteam 时首先加载。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# Cursor 红队演练总流程

## 0. 授权（不可跳过）
1. 向用户确认：靶标单位/项目名、授权 CIDR/域名、授权书或工单号、有效时间窗。
2. 调 `redteam_engagement_open`：
   - `name`、`scope`（CIDR 数组）、`domains`、`authorization_ref`、`expires_at`、`high_risk`。
3. 调 `redteam_preflight`，一次列出缺的工具/模板/key/VPS，不要硬开工。
4. 没有 scope 不发包；超出 scope 的目标先停下，让用户更新授权。

## 1. 五阶段（顺序推进）
1. `redteam-recon`：FOFA/crt.sh/subfinder/dnsx/naabu/httpx，只收集资产并 `redteam_asset_add`。
2. `redteam-assess`：逐条 `redteam_asset_assess`，全部落库，给出先打谁。
3. `redteam-vuln-scan`：先 `redteam_poc_search`，再 nuclei/未授权验证；`redteam_vuln_add` + 原始请求。
4. `redteam-exploit`：只打已确认漏洞；拿到权限后登记凭据/WebShell/隧道，`redteam_score_hit`。
5. `redteam-internal`：有 active 且 legit 的隧道才开工；gogo 铺面 → fscan 打点 → 逐条落库。

## 2. Cursor 派发方式
- 直接点名 5 个子代理之一（`redteam-recon` / `redteam-assess` / `redteam-vuln-scan` / `redteam-exploit` / `redteam-internal`）；Cursor 会按 description 自动委派，也可用 `/redteam-recon` 直接调用。任务描述必须自包含（目标、已知入口、已测清单、期望落库、叶子节点不委派）。
- 每次派发前 `redteam_agent_slot action=acquire role=<role>`；Agent 返回后 `action=release key=<key>`。
- 同时最多 3 个；默认顺序派。

## 3. 验收纪律
- 子代理说"拿到了"：必须用 `redteam_asset_query` / `redteam_vuln_query` / `redteam_sessions` 核对落库与证据。
- 没落库 = 没发生；没原始请求 = 报告不可复现。
- 账号权限必须浏览器实测登录成功；只有凭据不算账号权限。
- 隧道必须能访问到内网目标；只在自己的 VPS 上开的代理不算穿越边界。
- 每个得分点用 `redteam_score_hit`；报告用 `redteam_report_save`。

## 4. 红线
- 禁止 DoS、批量爆破、对非授权目标扫描、持久化后门、超出证明所需的数据外带。
- 高危动作前向用户二次确认；用户未确认不得执行。
- 目标范围以 `scope.json` 为准；不要用"用户说过"替代授权范围。

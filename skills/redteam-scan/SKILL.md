---
name: redteam-scan
description: nuclei 模板化漏洞验证与未授权检查，含降速、证据与落库口径。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 漏洞验证

## 先查现成的

```text
redteam_poc_search {q:"<cve|组件|版本|关键字>"}
```

命中知识库用 `redteam_poc_get` 取全文；命中本机模板直接 `nuclei -t <模板>`。

## nuclei

```bash
nuclei -u https://target.example -t <模板或模板目录> -rate-limit 50 -timeout 10 -jsonl -o out.jsonl
```

- 只打授权范围内目标；scope-guard 会拦截越界。
- 不要用高并发/全端口模板硬刷；被封 >3 次就放弃该资产。
- 先用低风险模板确认版本/暴露面，再做针对性验证。

## 未授权/接口

- 从页面/JS 提取接口，手工最小请求验证；不拖库、不破坏数据。
- 每个确认漏洞：`redteam_vuln_add`（status=confirmed）+ `redteam_http_evidence_add`（原始请求/响应）。
- 打通得分面：`redteam_score_hit`；每个关键动作 `redteam_chain_add`。
- 资产测完：`redteam_asset_test` 回写 status/test/surface/blocked。

## 判定

只把“能通向账号/WebShell/RCE/服务器/数据库/敏感数据/边界/内网”的漏洞标为 confirmed；信息泄露/版本暴露最多一行排除结论。没有原始请求的漏洞不写进报告。

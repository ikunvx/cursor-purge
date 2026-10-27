---
name: redteam-evidence
description: 红队证据与报告纪律：原始请求、命令回显、截图、攻击链与得分报告。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 证据与报告

## 每个成果至少三件套

1. **动作**：`redteam_chain_add`（stage_code/action/tool/result/target）。
2. **证据**：原始 HTTP 请求 `redteam_http_evidence_add`，或命令回显/截图 `redteam_shot_add`。
3. **记分**：`redteam_score_hit`（先 `redteam_score_list` 核对 code 与上限）。

## 原始请求要求

`request` 必须是可直接重放的完整报文：请求行、Host、Cookie/Token、必要 body。响应只保留关键片段即可。

## 截图要求

- `kind=screenshot` 只用于现场截图；由记录生成的卡片写 `kind=card`，不能冒充现场证据。
- `label` 写清这张图证明了什么（后台页面、命令回显、隧道连通性、批量台账）。

## 报告

- 得分报告：`redteam_report_save {format:"score"}`；只收录拿到分的成果。
- 完整报告：`format:"full"`；包含已确认但未得分的项。
- 报告保存到 `~/.cursor-purge/reports/`。

## 缺口检查

报告前用 `redteam_score_report {markdown:false}` 看 `missing_evidence`/`withSteps`；缺证据的项先补，不要把“待验证”写成“已拿到”。

---
name: redteam-setup
description: Cursor 红队插件的环境检查与工具路径配置（不自动下载/安装任何工具）。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 环境检查

## 必做

```text
redteam_preflight
```

看三类信息：

1. `tools[]`：`exists=false` 的二进制；路径在 `~/.cursor-purge/config.json`。
2. `nuclei_templates`：模板目录是否存在。
3. `scope` / `expired` / `onboarding.complete`。

## 配置

首次运行会从本机 DSH 的 `~/.dsh/redteam/config.json` 继承工具路径；也可手动编辑 `~/.cursor-purge/config.json`：

```json
{
  "toolkitDir": "D:/Dev/Tools/RedTeam",
  "nucleiTemplatesDir": "D:/Dev/Tools/RedTeam/nuclei-templates",
  "tools": { "nmap": "...", "nuclei": "..." }
}
```

缺什么一次列给用户（要什么、为什么、给到哪），等补齐后再开工。**不要替用户下载或安装工具。**

## 依赖说明

数据层由本机已安装并授权的 `dsh-purge` 提供（`RedteamStore`/`dispatch`）。本插件不复制、不打包、不再分发其源码、提示词或技能。找不到 store 时，`redteam_preflight` 会返回明确错误。

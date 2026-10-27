# Cursor Purge · Red Team

在 Cursor 中使用授权红队演练模式：资产台账、漏洞/证据、凭据/WebShell/隧道、攻击链、计分与报告。

它是 [qoder-purge](../qoder-purge) 的 Cursor 版本，数据层同样在运行时桥接本机已安装的 [dsh-purge](https://github.com/yohurm/dsh-purge)，因此与 DSH / Qoder 版本共用同一套 `RedteamStore` 能力。

> ⚠️ `dsh-purge` 是**商业许可软件**，不是开源软件。本仓库**不包含**其源码、提示词或技能文件；请先在本机合法安装并授权使用。详见 [NOTICE.md](NOTICE.md)。

## 组件

```
cursor-purge/
├── .cursor-plugin/plugin.json     # Cursor 插件 manifest
├── mcp.json                       # MCP server: redteam
├── rules/redteam-policy.mdc       # 授权/范围/高危策略（Agent Requested）
├── agents/                        # redteam-lead / recon / assess / vuln-scan / exploit / internal
├── commands/                      # /redteam /redteam-status /redteam-report /redteam-scope
├── skills/                        # 8 个原创技能
├── hooks/hooks.json               # beforeShellExecution -> scope guard
├── bin/cursor-scope-guard.mjs     # CIDR/域名白名单、到期/高危/DoS 拦截
├── runtime/dsh-bridge.mjs         # 定位并加载本机 dsh-purge store
└── runtime/server.mjs             # MCP 桥（61 个 redteam_* 工具）
```

## 依赖

1. **Cursor 3.x**（支持 Plugins / Subagents / Skills / Commands / Hooks / MCP）。
2. **本机已安装的 dsh-purge**（提供 `lib/redteam/store-core.js`）。默认查找：
   - `~/.dsh/profiles/desktop/node_modules/dsh-purge/lib/redteam/store-core.js`
   - `~/.dsh/profiles/*/node_modules/dsh-purge/lib/redteam/store-core.js`
   - 或设置 `CURSOR_PURGE_DSH_STORE=<store-core.js 绝对路径>`
3. **Node.js ≥ 22.5**（`node:sqlite`）。
4. 红队工具包默认 `D:/Dev/Tools/RedTeam`，首次运行从 `~/.dsh/redteam/config.json` 继承路径。

## 安装

### 本地插件（推荐）

Cursor 本地插件目录是 `~/.cursor/plugins/local/`（Windows：`%USERPROFILE%\.cursor\plugins\local\`）。

```bash
mkdir -p ~/.cursor/plugins/local
cp -a /path/to/cursor-purge ~/.cursor/plugins/local/cursor-purge
```

然后在 Cursor 中：

1. 重启 Cursor（或等待插件重新加载）。
2. 打开 **Customize → Plugins**，确认 `cursor-purge` 已启用。
3. 在 **Customize → MCP** 确认 `redteam` server 已连接；失败时看其日志。

### 项目级

也可以只把 `rules/redteam-policy.mdc`、`commands/` 复制到项目的 `.cursor/` 下，但 MCP、hooks、subagents 建议用本地插件方式安装。

## 使用

1. 运行 `/redteam`，提供：
   - 靶标名称
   - 授权 CIDR / 域名
   - 授权书/工单号
   - 有效时间窗
   - 是否允许高危动作
2. Agent 会先 `redteam_engagement_open` + `redteam_preflight`。
3. 选择或点名 `redteam-lead` 子代理；它会按五阶段自动委派：
   `redteam-recon` → `redteam-assess` → `redteam-vuln-scan` → `redteam-exploit` → `redteam-internal`。
   Cursor 会按 description 自动选择子代理；也可以直接用 `/redteam-recon` 调用。
4. 状态/报告：
   - `/redteam-status`
   - `/redteam-report`
   - `/redteam-scope`

数据落在 `~/.cursor-purge/`：

```
~/.cursor-purge/
├── config.json
├── bindings.json            # 工作区 -> 靶标
├── current
├── engagements/<id>/        # engagement.yaml + scope.json + assets.db
├── reports/
└── audit/scope.ndjson       # beforeShellExecution 放行/拦截审计
```

## 授权闸门

- `redteam_engagement_open` 拒绝 `0.0.0.0/0`、`::/0`、`*`；公网段不得宽于 `/24`，私网不得宽于 `/8`。
- 未填 `expires_at` 默认 24 小时；过期后 hook 拒绝网络工具。
- `high_risk=false` 时，利用/隧道/内网动作应停止；Agent 会要求用户明确确认后才能开 `true`。
- `beforeShellExecution` hook 只检查网络/利用类命令；普通开发命令不受影响。
- masscan `--rate > 2000` 直接拒绝。
- 数据根可用 `CURSOR_PURGE_HOME` 覆盖；设为 `~/.qoder-purge` 可与 Qoder 版共用同一份台账。

## 与 qoder-purge 的差异

| 项 | qoder-purge | cursor-purge |
|---|---|---|
| Manifest | `.qoder-plugin/plugin.json` | `.cursor-plugin/plugin.json` |
| 角色派发 | Qoder `Agent` 工具 | Cursor Subagents（自动委派 / `/redteam-recon`） |
| Hook 事件 | `PreToolUse` | `beforeShellExecution` |
| MCP 配置 | `.mcp.json` | `mcp.json` |
| 本地安装 | Qoder 插件安装器 | `~/.cursor/plugins/local/cursor-purge` |
| 数据根 | `~/.qoder-purge` | `~/.cursor-purge` |

## 故障排查

| 现象 | 处理 |
|---|---|
| Cursor 没显示插件 | 确认目录是 `~/.cursor/plugins/local/cursor-purge/.cursor-plugin/plugin.json`，重启 Cursor |
| MCP `redteam` 未连接 | 检查 `mcp.json` 的 `${CURSOR_PLUGIN_ROOT}` 是否展开；可临时改成绝对路径 |
| 工具报 `node:sqlite` | Cursor 的 MCP 改用系统 Node ≥ 22.5 |
| 找不到 dsh-purge store | 安装/授权 dsh-purge，或设置 `CURSOR_PURGE_DSH_STORE` |
| Hook 不拦截 | 确认 Cursor 版本支持 `beforeShellExecution`，且 plugin 已启用 |
| 未绑定靶标 | 先 `redteam_engagement_open` 或 `redteam_session_bind` |

## 安全声明

仅用于**获得明确授权的安全测试、攻防演练、CTF 或自有靶场**。使用者必须确保目标在授权范围内，并遵守当地法律与授权书约束。禁止未授权扫描、DoS、批量攻击、数据窃取或持久化控制。

## 参考

- [Cursor Plugins](https://cursor.com/docs/plugins)
- [Cursor Plugins Reference](https://cursor.com/docs/reference/plugins)
- [Cursor Hooks](https://cursor.com/docs/hooks)
- [Cursor Subagents](https://cursor.com/docs/subagents)
- [dsh-purge](https://github.com/yohurm/dsh-purge)

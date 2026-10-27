---
name: redteam-recon
description: 授权范围内的资产测绘流水线（被动→DNS→端口→HTTP→落库），用于 redteam-recon 角色。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 资产测绘流水线

先 `redteam_preflight` 确认工具路径；工具在 `~/.cursor-purge/config.json` 的 `tools` 里。所有命令只在 `redteam_scope_get` 返回的 CIDR/域名内执行。

## 1. 被动

```bash
# 子域枚举（无 FOFA_KEY 时也可用）
subfinder -d example.com -silent -o subs.txt

# 证书透明（示例，按实际可用源）
curl -s "https://crt.sh/?q=%25.example.com&output=json" -o crt.json
```

把域名用 `redteam_asset_add` 落库（先落 IP；只有域名时先解析再落 IP，`names` 里保留域名）。

## 2. DNS 与端口

```bash
dnsx -l subs.txt -a -resp -o resolved.txt
naabu -list resolved.txt -top-ports 1000 -rate 500 -o ports.txt
```

端口结果用 `redteam_asset_add` 的 `ports` 写入（`proto/port/service/product/version/banner`）。

## 3. HTTP 指纹

```bash
httpx -l resolved.txt -ports 80,443,8080,8443 -title -tech-detect -status-code -o web.txt
```

把 `url`、`title`、技术栈写进对应资产的端口记录。

## 4. 落库与收口

- 每条资产：`redteam_asset_add`，`provenance=passive|active`，`tool` 写真实来源。
- 每轮：`redteam_asset_stats` 核对 C 段/资产/存活/端口/Web 数。
- 关键动作：`redteam_chain_add`（`stage_code=recon`，`tool` 写命令，`result` 写回显摘要）。
- 未覆盖的网段/域名/主体关联列出来，继续收；不要用“够用”提前收口。

## 边界

只收集，不验证漏洞；疑似线索写 `redteam_asset_test` 的 `surface`。越界目标会被 scope-guard 拒绝。

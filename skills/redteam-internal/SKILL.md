---
name: redteam-internal
description: 通过合法隧道做内网铺面与打点（gogo/fscan），含迭代收口与落库要求。
---

> Cursor 运行约定：本插件的 `redteam_*` 是 MCP 工具（server: redteam）；数据在 `~/.cursor-purge`；网络命令走 Cursor `beforeShellExecution` hook，scope-guard 会拦截授权范围外的目标。高危动作必须先得到用户确认。


# 内网推进

## 前提

```text
redteam_sessions
redteam_tunnel_list     # 找 status=active 且 entry_kind 指向目标侧的隧道
redteam_session_check   # 实测；不通先修
```

没有可用隧道就不要开工，回报“需要先建隧道”。

## 铺面与打点

```bash
# 通过 socks5 隧道铺面（监听地址来自 redteam_tunnel_list）
gogo -i 10.10.0.0/24 -p 1-65535 -proxy socks5://127.0.0.1:1080 -o gogo.txt

# 打点（弱口令/未授权/高危）
fscan -h 10.10.0.0/24 -socks5 127.0.0.1:1080 -o fscan.txt
```

- 只在内网授权段内；越界会被 scope-guard 拒绝。
- 控制并发与速率；被封就降速或转向。
- 新资产用 `redteam_asset_add` 落库（内网自动 scope=internal），然后 `redteam_asset_assess`。
- 新漏洞 `redteam_vuln_add`；拿到主机/系统权限 `redteam_access_add` + `redteam_score_hit`。
- 每步 `redteam_chain_add`（stage_code=internal|boundary，tool/result 写全）。

## 收口

每发现一个新网段/新存活就再跑一轮，直到没有新面。输出新网段、已控主机、得分、下一步。

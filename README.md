# luci-drcom-auth

独立的 LuCI 面板，用于配置并驱动**韩山师范学院 (HSTC) Dr.COM 校园网**的
Portal + CAS 票证认证流程。

本仓库是 `azurekiln-hstc-drcom-auth` 中 `openwrt/luci-app-drcom-auth` 部分的
**独立抽取版本**，不依赖原仓库的任何文件，可以直接放入 OpenWrt SDK / buildroot
构建，也可以在本仓库内直接打出 `.ipk`。

## 功能

- 网页授权链接获取（Dr.COM eportal `cas/create`）
- CAS 登录（RSA 加密密码 → 重定向取 ticket → 验证 ticket）
- HSCAS 公钥拉取 / 缓存 / 状态显示
- 联网检测（定时 ping，掉线自动重连）
- 中文简体 / 中文繁体 / English 三语言界面

## 目录结构

```text
.
├── Makefile                # OpenWrt 包定义 (BuildPackage)
├── htdocs/                 # LuCI 前端资源 (安装到 /www)
│   └── luci-static/resources/view/drcom-auth.js
├── root/                   # 安装到路由器根目录
│   ├── etc/config/drcom_auth          # UCI 默认配置
│   ├── etc/init.d/drcom_auth          # procd 服务 + 认证子命令
│   └── usr/share/drcom-auth/          # 认证 shell 脚本 + 公钥
│       ├── config.sh.template         # 由 init.d 用 UCI 渲染成 config.sh
│       ├── get_authorize_url.sh
│       ├── hscas_login.sh
│       ├── auto_login_and_verify.sh
│       ├── check_connection.sh
│       ├── check_network.sh
│       └── public_key.pem
├── scripts/package_ipk.ps1 # Windows 下一键打包 ipk
└── release/                # 打包产物
```

## 认证流程

```text
AUTHORIZE GET   get_authorize_url.sh   eportal /cas/create → authorize_uri
CAS POST        hscas_login.sh         POST 加密密码 → 302 + ticket
TICKET GET      hscas_login.sh         GET authorize_uri → 302 + ticket
TICKET VERIFY   hscas_login.sh         访问 ticket，302 视为成功
```

各阶段原始响应保存在 `/usr/share/drcom-auth/responses/`，状态日志为
`/usr/share/drcom-auth/logs/drcom_status_log.txt`。密码、Cookie、完整 ticket
不会写入日志。

## 构建

### 使用 OpenWrt SDK

```sh
cp -r luci-drcom-auth /path/to/openwrt-sdk/package/
cd /path/to/openwrt-sdk
./scripts/feeds update luci && ./scripts/feeds install luci-base
make menuconfig           # 选中 LuCI -> Applications -> luci-app-drcom-auth
make package/luci-app-drcom-auth/compile V=s
```

### Windows 一键打包 ipk

```powershell
pwsh ./scripts/package_ipk.ps1 -Version 1.0.0-1
```

产物位于 `release/luci-app-drcom-auth_<version>_all.ipk` 及同名 `.sha256.txt`。

## 安装与使用

```sh
opkg install luci-app-drcom-auth_1.0.0-1_all.ipk
/etc/init.d/drcom_auth enable
```

打开 `LuCI -> Services -> Dr.COM`：

1. **基础设置** — WAN 接口、设备类型（PC / 移动）、界面语言
2. **网页授权链接获取** — 点“获取网页授权链接”验证 eportal 可达
3. **CAS 认证** — 填账号密码、可更新公钥，点“认证”立即登录
4. **联网检测** — 启用后按间隔 ping，掉线自动重连
5. **服务器设置** — Dr.COM 服务器 IP、CAS 地址、User-Agent

## 命令行排错

```sh
/etc/init.d/drcom_auth authorize            # 只取授权链接
/etc/init.d/drcom_auth ticket               # 立即跑完整登录
/etc/init.d/drcom_auth public_key           # 更新公钥
/etc/init.d/drcom_auth public_key_status    # 查看公钥缓存状态
tail -n 100 /usr/share/drcom-auth/logs/drcom_status_log.txt
```

## 依赖

- 运行时：`curl`、`openssl-util`（RSA 密码加密）
- LuCI：`luci-base`
- 构建：OpenWrt SDK 或 buildroot

## License

GPL-3.0 — see [LICENSE](LICENSE).

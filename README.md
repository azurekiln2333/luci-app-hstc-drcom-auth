# luci-drcom-auth

独立的 LuCI 面板，用于配置并驱动**韩山师范学院 (HSTC) Dr.COM 校园网**的
Portal + CAS 票证认证流程。

本仓库是 `azurekiln-hstc-drcom-auth` 中 `openwrt/luci-app-drcom-auth` 部分的
**独立抽取版本**，不依赖原仓库的任何文件，可以直接放入 OpenWrt SDK / buildroot
构建，也可以在本仓库内直接打出 `.ipk`。

## 功能

- **独立 CAS 认证**（不经过 Dr.COM）：只依赖 `HSCAS_URL`，获取 CAS 登录页参数、
  RSA 加密密码、登录并持久化 Cookie（`TGC` / `SESSION`）
- 网页授权链接获取（Dr.COM eportal `cas/create`）
- 完整 Dr.COM 认证链（authorize → CAS → ticket → verify）
- HSCAS 公钥拉取 / 缓存 / 状态显示
- 联网检测（定时 ping，掉线自动重连）
- 中文简体 / 中文繁体 / English 三语言界面

## 独立 CAS 认证说明

CAS 板块**不携带任何 Dr.COM 参数**，只使用配置里的 `hscas_url`。流程如下：

```text
GET  $HSCAS_URL/cas/login              → 抓取 fm1 表单参数（服务端签发）
GET  $HSCAS_URL/cas/jwt/publicKey      → RSA 公钥
POST $HSCAS_URL/cas/login              → password="__RSA__<密文>" + fm1 参数
                                          → 写入 Cookie：TGC / SESSION
```

参数来源（哪些本地能生成、哪些必须服务端）：

| 参数 | 来源 | 说明 |
| --- | --- | --- |
| `username` | 本地 | 你配置的账号 |
| `password` | 本地 | `__RSA__` + RSA(PKCS#1 v1.5) 加密（公钥来自服务端） |
| `submit` | 本地 | 固定值 `登录` |
| `execution` | **服务端** | 每次会话变化，必须现场抓取，本地无法生成 |
| `currentMenu` | **服务端** | `fm1`（密码表单）下为 `1` |
| `failN` | **服务端** | 实测为 `-1` |
| `_eventId` | **服务端** | `fm1` 下为 `submit` |
| `geolocation` | **服务端** | 隐藏字段，通常为空 |

注意：

- 参数必须从 **`fm1`（密码表单）** 提取。页面还有 `fm2`（短信/动态码）和
  `fm3`（扫码），它们各自的 `currentMenu` / `_eventId` 不同。
- 密码必须 RSA 加密。明文密码会被服务器拒绝（返回验证码/失败页）。
- `execution` 是会话绑定的，登录时**每次重新抓取**；持久化仅为状态展示与
  Cookie 失效后重登使用。
- Cookie（`TGC` 为核心）失效后，`cas_auth.sh ensure` 会用 `HSCAS_LOGIN_URL`
  重新抓参数并登录，然后继续持久化。

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
│       ├── cas_auth.sh                # 独立 CAS 认证（params/login/status/ensure）
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
# 独立 CAS 认证
/etc/init.d/drcom_auth cas_params     # 抓取并保存 CAS 登录参数
/etc/init.d/drcom_auth cas_body       # 查看拼接好的 POST 请求体（含加密密码，URL 编码）
/etc/init.d/drcom_auth cas_login      # 执行独立 CAS 登录并持久化 Cookie
/etc/init.d/drcom_auth cas_status     # 查看参数 / Cookie 状态
/etc/init.d/drcom_auth cas_ensure     # Cookie 失效时才重新登录

# Dr.COM 认证链
/etc/init.d/drcom_auth authorize            # 只取授权链接
/etc/init.d/drcom_auth ticket               # 立即跑完整登录
/etc/init.d/drcom_auth public_key           # 更新公钥
/etc/init.d/drcom_auth public_key_status    # 查看公钥缓存状态

tail -n 100 /usr/share/drcom-auth/logs/drcom_status_log.txt
```

面板「CAS 认证」板块的「查看/复制请求体」按钮会调用 `cas_body`，展示：

- 加密后密码（`__RSA__<base64>`，可复制）
- 密码前缀 / 长度
- 字段顺序：`username password currentMenu failN execution _eventId geolocation submit`
- 完整 URL 编码后的请求体（可复制）

提交时使用 `--data-raw` 发送上述拼接好的 body，因此**面板展示的内容与
实际发出的请求字节一致**。

持久化文件位于 `/usr/share/drcom-auth/info/`（权限 600）：

| 文件 | 内容 |
| --- | --- |
| `cas_params.env` | 最近一次抓取的 CAS 表单参数 |
| `cas_cookie.txt` | CAS Cookie（`TGC` / `SESSION`） |
| `cas_state.env` | 最近一次登录结果与时间 |

## 本地测试

```sh
# 渲染 config.sh 模板（无需网络）
sh ./scripts/test_config_render.sh

# 独立 CAS 登录（需要 curl + openssl；无 openssl 时可用 shim）
USERNAME=... PASSWORD=... sh ./scripts/test_cas_login.sh
USERNAME=... PASSWORD=... sh ./scripts/test_cas_ensure.sh

# 纯 Node 验证 RSA 加密 + 独立 CAS 登录
node ./scripts/test_standalone_cas.mjs <username> <password>
```

`scripts/openssl-shim.mjs` 是在缺少 OpenSSL 的机器上用 Node 替代
`openssl pkeyutl/rsautl` 的测试垫片，仅用于本地测试；路由器上使用真实的
`openssl`（OpenWrt 包名通常为 `openssl-util`）。

## 依赖

- 运行时：`curl`、`openssl-util`（RSA 密码加密）
- LuCI：`luci-base`
- 构建：OpenWrt SDK 或 buildroot

## License

GPL-3.0 — see [LICENSE](LICENSE).

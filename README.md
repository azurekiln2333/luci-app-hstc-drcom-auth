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
- 设置页检查插件新版本、立即安装，以及每天定时自动检查并安装正式 Release
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
pwsh ./scripts/package_ipk.ps1
```

产物位于 `release/luci-app-drcom-auth_<version>_all.ipk` 及同名 `.sha256.txt`。
默认版本从 `Makefile` 的 `PKG_VERSION` 和 `PKG_RELEASE` 读取；当前为 `2.4.2-1`。

### GitHub 自动构建并发布 Release

仓库已提供 `.github/workflows/release.yml`。推送版本标签后，GitHub Actions
先运行更新器及模块测试，再打包；全部成功后自动创建正式 Release，上传 `.ipk`
和同名 `.ipk.sha256.txt`，并将它设为 Latest。无需手动上传附件。

1. 修改 `Makefile` 的 `PKG_VERSION`，例如 `2.4.2`，并提交推送到 GitHub。
2. 创建与该版本完全一致的标签并推送：

   ```sh
   git tag v2.4.2
   git push github v2.4.2
   ```

3. 到 GitHub **Actions → Build and publish release** 查看执行结果；成功后在
   **Releases** 中可以下载安装包。

也可以在同一个 Actions 页面点击 **Run workflow**，选择要发布的分支。
工作流会按该分支 `Makefile` 的版本创建标签和 Release。同一个版本只发布一次；
后续发布需要提升 `PKG_VERSION`。发布工作流需要仓库允许 GitHub Actions 运行，
其 `GITHUB_TOKEN` 的写权限已通过工作流的 `contents: write` 声明。

更新器只读取 `azurekiln2333/luci-app-hstc-drcom-auth` 的最新正式 Release。
例如 `v2.4.2` 必须包含 `luci-app-drcom-auth_2.4.2-1_all.ipk` 和
`luci-app-drcom-auth_2.4.2-1_all.ipk.sha256.txt`，两个文件由同一次构建生成。
请勿手动用其他版本或其他包名替换附件。

### 设置页自动更新

`2.4.0` 和 `2.4.1` 的更新器存在版本比较误判，可能将新版本显示为“已是最新版本”。
这两个版本需要手动安装一次 `2.4.2` 或更高版本，才能恢复正常检查和自动安装。

先手动安装一次带更新功能的版本，然后打开 **Dr.COM → 设置 → 插件更新**。
可以立即检查、安装，或者打开定时自动更新，选择每天的小时和分钟并点击
**保存并应用**。默认关闭；默认时间为每天 **04:00**，使用路由器本地时区。
更新计划独立于认证服务的启用开关。

自动更新会检查 GitHub 正式 Release，只安装比当前版本新的包，校验 SHA-256，
并通过 `opkg` 安装。现有账号及配置由包管理器保留；不会重刷固件，也不会安装
预发布版本。下载或校验失败时保留当前版本，状态栏显示原因，下次计划再试。
路由器需要能够访问 GitHub API 和 Release 附件。当前支持使用 `opkg` 的 IPK
系统；使用 `apk` 的固件会显示不支持。

## 安装与使用

```sh
opkg update
opkg install luci-app-drcom-auth_2.4.2-1_all.ipk
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

## 升级时的 conffile 提示

升级 ipk 时可能出现：

```text
Collected errors:
 * resolve_conffiles: Existing conffile /etc/config/drcom_auth is different
   from the conffile in the new package. The new conffile will be placed at
   /etc/config/drcom_auth-opkg.
```

这是 opkg 的 **conffile 保护机制**，不是安装失败：

- 你设备上现有的 `/etc/config/drcom_auth`（含账号/密码等）被**保留**
- 包里的默认配置被放到 `/etc/config/drcom_auth-opkg`

可选处理：

```sh
rm -f /etc/config/drcom_auth-opkg          # 不需要那个默认副本时直接删
uci show drcom_auth                         # 确认配置完整
```

postinst 会在升级后自动补齐**缺失**的新选项（如 `hscas_url`），
不会覆盖你已填的值。

## 依赖

- 运行时：`curl`、`openssl-util`（RSA 密码加密）、`jsonfilter`（Release 元数据）、
  `ca-bundle`（HTTPS 证书校验）、`flock`（防止并发更新）
- LuCI：`luci-base`
- 构建：OpenWrt SDK 或 buildroot

## License

GPL-3.0 — see [LICENSE](LICENSE).

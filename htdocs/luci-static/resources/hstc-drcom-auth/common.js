'use strict';
'require baseclass';
'require fs';
'require ui';
'require network';

// Shared helpers for the HSTC Dr.COM auth panel tabs. One module so every tab
// uses the same translations, exec helpers and CAS rendering.
//
// LuCI requires a module factory to yield a constructor, so this returns a
// baseclass instance (like wwand/bands.js) rather than a plain object.

// Collect candidate WAN interfaces: LuCI logical interfaces (with their device)
// plus raw system netdevs, so the dropdown matches what the router actually has.
function collectInterfaces() {
	var out = {};

	// Interfaces that can never be the WAN: loopback, container bridges, tunnel
	// devices, dummy devices and UCI device aliases (@name).
	function isVirtual(name) {
		return !name || name === 'lo' || name === 'docker0' || name === 'ip6tnl0'
			|| name === 'dummy0' || name.charAt(0) === '@';
	}

	try {
		network.getDevices().forEach(function (dev) {
			var name = dev.getName();
			if (name && !isVirtual(name))
				out[name] = name;
		});
	} catch (e) { /* network model unavailable */ }

	return Promise.all([
		fs.exec_direct('/sbin/uci', [ '-q', 'show', 'network' ]).catch(function () { return ''; }),
		fs.exec_direct('/bin/ls', [ '-1', '/sys/class/net' ]).catch(function () { return ''; }),
		fs.exec_direct('/sbin/uci', [ '-q', 'get', 'drcom_auth.main.wan_port' ]).catch(function () { return ''; }),
		fs.exec_direct('/sbin/ip', [ '-4', '-o', 'addr', 'show' ]).catch(function () {
			// Some images ship ip in /bin instead of /sbin.
			return fs.exec_direct('/bin/ip', [ '-4', '-o', 'addr', 'show' ]).catch(function () { return ''; });
		})
	]).then(function (res) {
		var uci = res[0] || '', ls = res[1] || '', current = (res[2] || '').trim();
		var ipOut = res[3] || '';
		var logical = {};
		var ips = {};

		// Map device -> first IPv4 address (e.g. "2: eth0    inet 192.168.1.2/24 ...").
		ipOut.split('\n').forEach(function (l) {
			var m = l.match(/^\s*\d+:\s+(\S+)\s+inet\s+([0-9.]+)\//);
			if (m)
				ips[m[1]] = m[2];
		});

		// Map each UCI interface to its device.
		var lines = uci.split('\n');
		var ifaces = {};
		lines.forEach(function (l) {
			var m = l.match(/^network\.([^.\[]+)\.device='([^']+)'/);
			if (m) ifaces[m[1]] = m[2];
		});

		// Raw system netdevs (skip virtual ones that cannot be a WAN).
		ls.split('\n').forEach(function (n) {
			n = n.trim();
			if (isVirtual(n))
				return;
			out[n] = n;
			logical[n] = ifaces[n] || null;
		});

		// Present logical interfaces, labelled "name (device)". Skip virtual
		// devices such as loopback so they never enter the list. When several
		// logical interfaces share one device (e.g. wan and wan6 both on eth0)
		// pick the most representative name instead of whichever came last.
		function labelScore(name) {
			var s = 0;
			// Prefer the primary interface over its IPv6 companion (wan over wan6).
			if (/(?:^|[^0-9])6$/.test(name))
				s -= 10;
			if (name === 'wan')
				s += 5;
			if (name.indexOf('wwan') === 0)
				s += 2;
			// Shorter names are usually the canonical ones.
			s -= name.length * 0.01;
			return s;
		}

		var bestLabel = {};
		Object.keys(ifaces).forEach(function (lname) {
			var dev = ifaces[lname];
			if (isVirtual(dev))
				return;
			if (out[dev] === undefined)
				out[dev] = dev;
			if (bestLabel[dev] === undefined || labelScore(lname) > labelScore(bestLabel[dev]))
				bestLabel[dev] = lname;
		});
		Object.keys(bestLabel).forEach(function (dev) {
			logical[dev] = bestLabel[dev];
		});

		return { devices: Object.keys(out).sort(), logical: logical, ips: ips, current: current };
	});
}

// Parse `accounts_list`: one "<id>\t<username>\t<active|->" per line.
function parseAccounts(raw) {
	return String(raw || '').trim().split('\n')
		.filter(function (l) { return l.indexOf('\t') > 0; })
		.map(function (l) {
			var p = l.split('\t');
			return { id: p[0], username: p[1] || '', active: p[2] === 'active' };
		});
}

// Language dictionary (zh / zh-TW / en).
		var dict = {
			zh: {
				title: 'Dr.COM 认证',
				desc: '配置校园网认证与自动重连。',
				basic: '基础设置',
				account: '账号密码',
				settings: '设置',
				tabOnline: '上网认证',
				tabDiag: '诊断',
				tabSettings: '设置',
				authorize: '网页授权链接获取',
				authorizeStep: '上网第一步',
				casStep: '上网第二步',
				authStep: '上网第三步',
				status: '状态',
				statusNetwork: '联网状态',
				statusDrcom: 'Dr.COM 认证状态',
				statusCas: 'CAS 认证状态',
				statusUnknown: '未知',
				statusNetworkUp: '已联网',
				statusNetworkDown: '未联网',
				statusDrcomOk: '已认证',
				statusDrcomOnline: '已在线',
				statusDrcomOnlineAcct: '已在线（%s）',
				statusDrcomOffline: '未在线',
				statusDrcomFail: '认证失败',
				statusCasOk: '已登录',
				statusCasNo: '未登录',
				statusCookiePresent: '存在（%s）',
				statusCookieNone: '不存在',
				refreshStatus: '刷新状态',
				statusRefreshed: '状态已刷新。',
				authCheck: '认证状态检查',
				authChecking: '检查中...',
				authDetail: '判定明细',
				authDetailProbe: '连通性探测',
				authDetailResult: '判定结果',
				authDetailRaw: '原始输出',
				tabAccounts: '账号管理',
				accountsTab: '账号管理',
				activeAccount: '当前账号',
				noAccounts: '尚无账号，请在下方添加。',
				accountHint: '新增或管理账号请到「账号管理」标签页。',
				accountAdd: '新增账号',
				accountSave: '保存',
				accountSaved: '账号已保存。',
				accountSaveFailed: '账号保存失败',
				accountDelete: '删除',
				accountDeleted: '账号已删除。',
				accountDeleteConfirm: '确定删除账号 %s 吗？',
				accountSwitched: '已切换当前账号。',
				accountSwitchFailed: '切换账号失败',
				accountNeedUsername: '请填写用户名。',
				connectNow: '一键登录并认证',
				connectNowDesc: '确保已登录并执行联网检测；已登录时会自动跳过。',
				connectRunning: '认证中...',
				connectDone: '已登录并完成联网检测。',
				connectFailed: '登录或认证失败',
				connectStatus: '认证结果',
				connectIdle: '未执行',
				getAuthorize: '获取网页授权链接',
				authorizeStatus: '网页授权链接状态',
				authorizeIdle: '未获取',
				authorizeRunning: '获取中...',
				authorizeDone: '获取成功',
				authorizeFailed: '获取失败',
				cas: 'CAS 认证',
				network: '联网检测',
				auth: '认证',
				authStatus: '认证状态',
				authIdle: '未认证',
				authTrace: '认证诊断',
				showAuthTrace: '查看认证诊断',
				authTraceLoading: '读取中...',
				authTraceEmpty: '暂无认证记录，请先执行认证。',
				authTraceSummary: '状态日志',
				authRunning: '认证中...',
				authDone: '已执行认证。',
				authFailed: '认证失败',
				enable: '启用联网检测',
				username: '账号',
				password: '密码',
				publicKey: 'CAS 公钥',
				publicKeyUrl: '公钥地址',
				updatePublicKey: '更新公钥',
				publicKeyStatus: '公钥状态',
				publicKeyIdle: '未更新',
				publicKeyUpdating: '更新中...',
				publicKeyDone: '公钥已更新',
				publicKeyFailed: '公钥更新失败',
				publicKeyUpdatedAt: '公钥已更新：%s（%s）',
				casParams: 'CAS 登录参数',
				fetchCasParams: '获取 CAS 参数',
				casParamsStatus: 'CAS 参数状态',
				casParamsIdle: '未获取',
				casParamsFetching: '获取中...',
				casParamsFailed: '获取 CAS 参数失败',
				casParamsSaved: '已保存参数：currentMenu=%s，failN=%s，_eventId=%s（%s）',
				casLogin: 'CAS 登录',
				doCasLogin: '获取 Cookie 并登录',
				casLoggingIn: '登录中...',
				casLoginDone: 'CAS 登录成功，Cookie 已保存。',
				casLoginFailed: 'CAS 登录失败',
				casCookieStatus: '登录状态',
				casCookieUnknown: '未检测',
				casSessionActive: '已登录（Cookie 有效：%s）',
				casSessionActiveRemote: '已登录（服务端会话有效）',
				casSessionInactive: '未登录',
				casRefresh: 'Cookie 状态',
				refreshCasStatus: '刷新状态',
				authDesc: '使用 Dr.COM 网页授权链接完成完整认证（需先获取授权链接）。',
				casEncryptedPassword: '加密后密码',
				casHeaders: '请求头',
				casRequestBody: '完整请求体',
				casResponse: '响应内容',
				casResponsePreview: '响应渲染预览',
				casRequestLine: '请求行',
				casCopy: '复制',
				casCopied: '已复制到剪贴板',
				casCopyFailed: '复制失败，请手动选择复制',
				casLogout: '退出登录',
				doCasLogout: '清除本地会话',
				casLogoutDone: '已清除本地 CAS 会话。',
				wanPort: 'WAN 接口',
				wanIp: '接口 IP 地址',
				wanIpNone: '未获取到 IP',
				wanPortDesc: '从路由器接口列表中选择用于上网的 WAN 网口。',
				deviceType: '设备类型',
				deviceTypeDesc: '以什么设备登录 Dr.COM：电脑或移动设备。',
				pc: '电脑',
				mobile: '移动设备',
				interval: '两次联网间隔时间',
				intervalDesc: '两次联网检测之间的秒数。',
				pingHost: '检测主机',
				server: '服务器设置',
				serverIp: 'Dr.COM 服务器 IP',
				casUrl: 'CAS 地址',
				userAgent: 'User-Agent',
				language: '语言',
				langZh: '简体中文',
				langZhTw: '繁體中文',
				langEn: 'English'
			},
			'zh-tw': {
				title: 'Dr.COM 認證',
				desc: '設定校園網認證與自動重連。',
				basic: '基礎設定',
				account: '帳號密碼',
				settings: '設定',
				tabOnline: '上網認證',
				tabDiag: '診斷',
				tabSettings: '設定',
				authorize: '網頁授權連結取得',
				authorizeStep: '上網第一步',
				casStep: '上網第二步',
				authStep: '上網第三步',
				status: '狀態',
				statusNetwork: '連網狀態',
				statusDrcom: 'Dr.COM 認證狀態',
				statusCas: 'CAS 認證狀態',
				statusUnknown: '未知',
				statusNetworkUp: '已連網',
				statusNetworkDown: '未連網',
				statusDrcomOk: '已認證',
				statusDrcomOnline: '已線上',
				statusDrcomOnlineAcct: '已線上（%s）',
				statusDrcomOffline: '未線上',
				statusDrcomFail: '認證失敗',
				statusCasOk: '已登入',
				statusCasNo: '未登入',
				statusCookiePresent: '存在（%s）',
				statusCookieNone: '不存在',
				refreshStatus: '重新整理狀態',
				statusRefreshed: '狀態已重新整理。',
				authCheck: '認證狀態檢查',
				authChecking: '檢查中...',
				authDetail: '判定明細',
				authDetailProbe: '連線偵測',
				authDetailResult: '判定結果',
				authDetailRaw: '原始輸出',
				tabAccounts: '帳號管理',
				accountsTab: '帳號管理',
				activeAccount: '目前帳號',
				noAccounts: '尚無帳號，請在下方新增。',
				accountHint: '新增或管理帳號請到「帳號管理」頁籤。',
				accountAdd: '新增帳號',
				accountSave: '儲存',
				accountSaved: '帳號已儲存。',
				accountSaveFailed: '帳號儲存失敗',
				accountDelete: '刪除',
				accountDeleted: '帳號已刪除。',
				accountDeleteConfirm: '確定刪除帳號 %s 嗎？',
				accountSwitched: '已切換目前帳號。',
				accountSwitchFailed: '切換帳號失敗',
				accountNeedUsername: '請填寫使用者名稱。',
				connectNow: '一鍵登入並認證',
				connectNowDesc: '確保已登入並執行連網偵測；已登入時會自動略過。',
				connectRunning: '認證中...',
				connectDone: '已登入並完成連網偵測。',
				connectFailed: '登入或認證失敗',
				connectStatus: '認證結果',
				connectIdle: '未執行',
				getAuthorize: '取得網頁授權連結',
				authorizeStatus: '網頁授權連結狀態',
				authorizeIdle: '未取得',
				authorizeRunning: '取得中...',
				authorizeDone: '取得成功',
				authorizeFailed: '取得失敗',
				cas: 'CAS 認證',
				network: '連網偵測',
				auth: '認證',
				authStatus: '認證狀態',
				authIdle: '未認證',
				authTrace: '認證診斷',
				showAuthTrace: '檢視認證診斷',
				authTraceLoading: '讀取中...',
				authTraceEmpty: '尚無認證記錄，請先執行認證。',
				authTraceSummary: '狀態日誌',
				authRunning: '認證中...',
				authDone: '已執行認證。',
				authFailed: '認證失敗',
				enable: '啟用連網偵測',
				username: '帳號',
				password: '密碼',
				publicKey: 'CAS 公鑰',
				publicKeyUrl: '公鑰位址',
				updatePublicKey: '更新公鑰',
				publicKeyStatus: '公鑰狀態',
				publicKeyIdle: '未更新',
				publicKeyUpdating: '更新中...',
				publicKeyDone: '公鑰已更新',
				publicKeyFailed: '公鑰更新失敗',
				publicKeyUpdatedAt: '公鑰已更新：%s（%s）',
				casParams: 'CAS 登入參數',
				fetchCasParams: '取得 CAS 參數',
				casParamsStatus: 'CAS 參數狀態',
				casParamsIdle: '未取得',
				casParamsFetching: '取得中...',
				casParamsFailed: '取得 CAS 參數失敗',
				casParamsSaved: '已儲存參數：currentMenu=%s，failN=%s，_eventId=%s（%s）',
				casLogin: 'CAS 登入',
				doCasLogin: '取得 Cookie 並登入',
				casLoggingIn: '登入中...',
				casLoginDone: 'CAS 登入成功，Cookie 已儲存。',
				casLoginFailed: 'CAS 登入失敗',
				casCookieStatus: '登入狀態',
				casCookieUnknown: '未偵測',
				casSessionActive: '已登入（Cookie 有效：%s）',
				casSessionActiveRemote: '已登入（伺服器工作階段有效）',
				casSessionInactive: '未登入',
				casRefresh: 'Cookie 狀態',
				refreshCasStatus: '重新整理狀態',
				authDesc: '使用 Dr.COM 網頁授權連結完成完整認證（需先取得授權連結）。',
				casEncryptedPassword: '加密後密碼',
				casHeaders: '請求標頭',
				casRequestBody: '完整請求體',
				casResponse: '回應內容',
				casResponsePreview: '回應渲染預覽',
				casRequestLine: '請求行',
				casCopy: '複製',
				casCopied: '已複製到剪貼簿',
				casCopyFailed: '複製失敗，請手動選取複製',
				casLogout: '登出',
				doCasLogout: '清除本機會話',
				casLogoutDone: '已清除本機 CAS 工作階段。',
				wanPort: 'WAN 介面',
				wanIp: '介面 IP 位址',
				wanIpNone: '未取得 IP',
				wanPortDesc: '從路由器介面清單中選擇用於上網的 WAN 網口。',
				deviceType: '裝置類型',
				deviceTypeDesc: '以什麼裝置登入 Dr.COM：電腦或行動裝置。',
				pc: '電腦',
				mobile: '行動裝置',
				interval: '兩次連網間隔時間',
				intervalDesc: '兩次連網偵測之間的秒數。',
				pingHost: '偵測主機',
				server: '伺服器設定',
				serverIp: 'Dr.COM 伺服器 IP',
				casUrl: 'CAS 位址',
				userAgent: 'User-Agent',
				language: '語言',
				langZh: '簡體中文',
				langZhTw: '繁體中文',
				langEn: 'English'
			},
			en: {
				title: 'Dr.COM Auth',
				desc: 'Configure campus network authentication and automatic reconnect.',
				basic: 'Basic Settings',
				account: 'Account',
				settings: 'Settings',
				tabOnline: 'Online Auth',
				tabDiag: 'Diagnostics',
				tabSettings: 'Settings',
				authorize: 'Web Authorize URL',
				authorizeStep: 'Step 1: get online',
				casStep: 'Step 2: CAS login',
				authStep: 'Step 3: authenticate',
				status: 'Status',
				statusNetwork: 'Network',
				statusDrcom: 'Dr.COM Auth',
				statusCas: 'CAS Auth',
				statusUnknown: 'Unknown',
				statusNetworkUp: 'Online',
				statusNetworkDown: 'Offline',
				statusDrcomOk: 'Authenticated',
				statusDrcomOnline: 'Online',
				statusDrcomOnlineAcct: 'Online (%s)',
				statusDrcomOffline: 'Offline',
				statusDrcomFail: 'Failed',
				statusCasOk: 'Logged in',
				statusCasNo: 'Not logged in',
				statusCookiePresent: 'Present (%s)',
				statusCookieNone: 'Absent',
				refreshStatus: 'Refresh Status',
				statusRefreshed: 'Status refreshed.',
				authCheck: 'Auth Status Check',
				authChecking: 'Checking...',
				authDetail: 'Decision Detail',
				authDetailProbe: 'Connectivity Probe',
				authDetailResult: 'Verdict',
				authDetailRaw: 'Raw Output',
				tabAccounts: 'Accounts',
				accountsTab: 'Accounts',
				activeAccount: 'Active Account',
				noAccounts: 'No accounts yet - add one below.',
				accountHint: 'Add or manage accounts on the Accounts tab.',
				accountAdd: 'Add Account',
				accountSave: 'Save',
				accountSaved: 'Account saved.',
				accountSaveFailed: 'Failed to save account',
				accountDelete: 'Delete',
				accountDeleted: 'Account deleted.',
				accountDeleteConfirm: 'Delete account %s?',
				accountSwitched: 'Active account switched.',
				accountSwitchFailed: 'Failed to switch account',
				accountNeedUsername: 'Please enter a username.',
				connectNow: 'Log In and Authenticate',
				connectNowDesc: 'Ensure a login exists and run the connectivity check; skipped when already logged in.',
				connectRunning: 'Authenticating...',
				connectDone: 'Logged in and connectivity check completed.',
				connectFailed: 'Login or authentication failed',
				connectStatus: 'Result',
				connectIdle: 'Not run',
				getAuthorize: 'Get Web Authorize URL',
				authorizeStatus: 'Web Authorize URL Status',
				authorizeIdle: 'Not requested',
				authorizeRunning: 'Requesting...',
				authorizeDone: 'Success',
				authorizeFailed: 'Request failed',
				cas: 'CAS Authentication',
				network: 'Network Check',
				auth: 'Authenticate',
				authStatus: 'Authentication Status',
				authIdle: 'Not authenticated',
				authTrace: 'Auth Diagnostics',
				showAuthTrace: 'Show Auth Diagnostics',
				authTraceLoading: 'Loading...',
				authTraceEmpty: 'No auth record yet - run authenticate first.',
				authTraceSummary: 'Status Log',
				authRunning: 'Authenticating...',
				authDone: 'Authentication executed.',
				authFailed: 'Authentication failed',
				enable: 'Enable Network Check',
				username: 'Username',
				password: 'Password',
				publicKey: 'CAS Public Key',
				publicKeyUrl: 'Public Key URL',
				updatePublicKey: 'Update Public Key',
				publicKeyStatus: 'Public Key Status',
				publicKeyIdle: 'Not updated',
				publicKeyUpdating: 'Updating...',
				publicKeyDone: 'Public key updated',
				publicKeyFailed: 'Public key update failed',
				publicKeyUpdatedAt: 'Public key updated: %s (%s)',
				casParams: 'CAS Login Parameters',
				fetchCasParams: 'Fetch CAS Parameters',
				casParamsStatus: 'CAS Parameter Status',
				casParamsIdle: 'Not fetched',
				casParamsFetching: 'Fetching...',
				casParamsFailed: 'Fetch CAS parameters failed',
				casParamsSaved: 'Saved params: currentMenu=%s, failN=%s, _eventId=%s (%s)',
				casLogin: 'CAS Login',
				doCasLogin: 'Get Cookie and Log In',
				casLoggingIn: 'Logging in...',
				casLoginDone: 'CAS login succeeded, cookie saved.',
				casLoginFailed: 'CAS login failed',
				casCookieStatus: 'Login Status',
				casCookieUnknown: 'Not checked',
				casSessionActive: 'Logged in (cookie valid: %s)',
				casSessionActiveRemote: 'Logged in (server session active)',
				casSessionInactive: 'Not logged in',
				casRefresh: 'Cookie Status',
				refreshCasStatus: 'Refresh Status',
				authDesc: 'Complete the full Dr.COM flow using the web authorize URL (fetch it first).',
				casEncryptedPassword: 'Encrypted Password',
				casHeaders: 'Request Headers',
				casRequestBody: 'Full Request Body',
				casResponse: 'Response',
				casResponsePreview: 'Response Preview',
				casRequestLine: 'Request Line',
				casCopy: 'Copy',
				casCopied: 'Copied to clipboard',
				casCopyFailed: 'Copy failed, select and copy manually',
				casLogout: 'Logout',
				doCasLogout: 'Clear Local Session',
				casLogoutDone: 'Local CAS session cleared.',
				wanPort: 'WAN Interface',
				wanIp: 'Interface IP',
				wanIpNone: 'No IP address',
				wanPortDesc: 'Pick the WAN network interface used for authentication.',
				deviceType: 'Device Type',
				deviceTypeDesc: 'Which device type to register when logging in to Dr.COM (PC or mobile).',
				pc: 'PC',
				mobile: 'Mobile Device',
				interval: 'Check Interval',
				intervalDesc: 'Seconds between connectivity checks.',
				pingHost: 'Ping Host',
				server: 'Server Settings',
				serverIp: 'Dr.COM Server IP',
				casUrl: 'CAS URL',
				userAgent: 'User-Agent',
				language: 'Language',
				langZh: 'Simplified Chinese',
				langZhTw: '繁體中文',
				langEn: 'English'
			}
		};

// Build a translator for the browser language, honouring the saved choice.
function makeTranslator() {
	var browserLang = (navigator.language || '').toLowerCase();
	var lang = window.localStorage.getItem('drcom-auth-lang') ||
		(/^zh-(tw|hk|mo)/.test(browserLang) ? 'zh-tw' : (browserLang.indexOf('zh') === 0 ? 'zh' : 'en'));
	if (!dict[lang])
		lang = 'en';

	function tr(key) {
		return dict[lang][key] || key;
	}
	tr.lang = lang;
	return tr;
}

// helpers that only need tr (no render context).
function makeBaseHelpers(tr) {
	function format(text) {
		var args = Array.prototype.slice.call(arguments, 1);
		var index = 0;
		return text.replace(/%s/g, function () { return args[index++] || ''; });
	}

	function htmlEscape(text) {
		return String(text || '').replace(/[&<>"']/g, function (ch) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
		});
	}

	function publicKeyStatusText(raw) {
		var text = (raw || '').trim();
		var parts, match;
		if (!text)
			return tr('publicKeyIdle');
		parts = text.split('\t');
		if (parts[0] === 'updated' && parts[1] && parts[2])
			return format(tr('publicKeyUpdatedAt'), parts[1], parts[2]);
		match = text.match(/^Public key updated:\s*(.+)\s+\((.+)\)$/);
		if (match)
			return format(tr('publicKeyUpdatedAt'), match[1], match[2]);
		return text;
	}

	function execMessage(obj) {
		return [
			obj && obj.stdout,
			obj && obj.stderr,
			obj && obj.message
		].filter(function (v) { return v; }).join('\n').trim();
	}

	function execFailed(obj, message) {
		return (obj && obj.code) || /(^|\n).*failed:/i.test(message || '');
	}

	// One label + read-only textarea + copy button.
	function casFieldRow(label, value) {
		var area = E('textarea', {
			'class': 'drcom-body-field',
			'readonly': 'readonly',
			'rows': String(Math.min(6, Math.max(1, Math.ceil(String(value).length / 60) || 1)))
		}, [ String(value) ]);
		var button = E('button', {
			'class': 'cbi-button cbi-button-action',
			'click': function (ev) {
				ev.preventDefault();
				copyToClipboard(String(value)).then(function (ok) {
					ui.addNotification(null, E('p', ok ? tr('casCopied') : tr('casCopyFailed')), ok ? undefined : 'error');
				});
			}
		}, [ tr('casCopy') ]);
		return E('div', { 'class': 'drcom-body-row' }, [
			E('div', { 'class': 'drcom-body-label' }, [ label ]),
			E('div', { 'class': 'drcom-body-value' }, [ area ]),
			button
		]);
	}

	function legacyCopy(text) {
		try {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			var ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch (e) {
			return false;
		}
	}

	function copyToClipboard(text) {
		if (navigator.clipboard && navigator.clipboard.writeText)
			return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
		return Promise.resolve(legacyCopy(text));
	}

	// Render a failure diagnosis in the shared detail box.
	function showDiag(title, text) {
		var box = document.getElementById('drcom-cas-body-box');
		if (box) {
			box.innerHTML = '';
			box.appendChild(E('div', { 'class': 'drcom-diag-title' }, [ title ]));
			box.appendChild(E('pre', { 'class': 'drcom-diag-pre' }, [ String(text || '') ]));
			box.style.display = '';
		}
		ui.addNotification(null, E('div', {}, [
			E('p', {}, [ title ]),
			E('pre', { 'class': 'drcom-diag-pre' }, [ String(text || '') ])
		]), 'error');
	}

	// Render the raw HTTP request (request line, headers, body) into rows.
	function renderCasRequest(raw) {
		var box = document.getElementById('drcom-cas-body-box');
		if (!box)
			return;
		var text = String(raw || '').replace(/\r/g, '');
		var idx = text.indexOf('\n\n');
		var head = idx >= 0 ? text.slice(0, idx) : text;
		var body = idx >= 0 ? text.slice(idx + 2) : '';
		var lines = head.split('\n');
		var requestLine = lines.shift() || '';
		var headers = lines.join('\n');
		var bodyParams = {};
		body.split('&').forEach(function (kv) {
			var eq = kv.indexOf('=');
			if (eq > 0)
				bodyParams[kv.slice(0, eq)] = kv.slice(eq + 1);
		});
		box.innerHTML = '';
		box.appendChild(casFieldRow(tr('casRequestLine'), requestLine));
		box.appendChild(casFieldRow(tr('casHeaders'), headers));
		if (bodyParams.password)
			box.appendChild(casFieldRow(tr('casEncryptedPassword'), bodyParams.password));
		box.appendChild(casFieldRow(tr('casRequestBody'), body));
		box.style.display = '';
	}

	// Render the last CAS login response: source code block plus a sandboxed
	// preview of the HTML page. Nothing is shown when there is no response.
	function renderCasResponse(raw) {
		var box = document.getElementById('drcom-cas-response-box');
		if (!box)
			return;
		var text = String(raw || '').trim();
		if (!text) {
			box.innerHTML = '';
			box.style.display = 'none';
			return;
		}
		box.innerHTML = '';
		box.appendChild(casFieldRow(tr('casResponse'), text));
		var frame = E('iframe', {
			'class': 'drcom-preview-frame',
			'sandbox': '',
			'srcdoc': text
		});
		box.appendChild(E('div', { 'class': 'drcom-body-row' }, [
			E('div', { 'class': 'drcom-body-label' }, [ tr('casResponsePreview') ]),
			E('div', { 'class': 'drcom-body-value' }, [ frame ])
		]));
		box.style.display = '';
	}

	// Render the Dr.COM auth chain trace: one copyable row per "===== stage ====="
	// block (status log plus each stage's response/headers).
	function renderAuthTrace(raw) {
		var box = document.getElementById('drcom-auth-trace-box');
		if (!box)
			return;
		var text = String(raw || '').replace(/\r/g, '').trim();
		if (!text) {
			box.innerHTML = '';
			box.style.display = 'none';
			return;
		}
		var header = '';
		var hIdx = text.indexOf('\n===== ');
		if (hIdx > 0) {
			header = text.slice(0, hIdx).trim();
			text = text.slice(hIdx + 1);
		}
		box.innerHTML = '';
		if (header)
			box.appendChild(casFieldRow(tr('authTraceSummary'), header));
		text.split(/^===== /m).forEach(function (block) {
			block = block.replace(/\n?=====$/, '').trim();
			if (!block)
				return;
			var nl = block.indexOf('\n');
			var title = nl >= 0 ? block.slice(0, nl).replace(/\s*=====\s*$/, '').trim() : block;
			var body = nl >= 0 ? block.slice(nl + 1).trim() : '';
			if (!title)
				return;
			box.appendChild(casFieldRow(title, body));
		});
		box.style.display = '';
	}

	// Shared account selector used by the Online Auth and Diagnostics tabs, so
	// both pages offer the same control bound to main.active_account. Returns the
	// HTML for the <select> (or an idle hint when there are no accounts).
	function accountSelectHtml(accounts) {
		if (!accounts || !accounts.length)
			return '<span class="drcom-result">' + htmlEscape(tr('noAccounts')) + '</span>';
		var html = '<select id="drcom-account-select" class="cbi-input-select">';
		accounts.forEach(function(a) {
			html += '<option value="' + htmlEscape(a.id) + '"' +
				(a.active ? ' selected="selected"' : '') + '>' +
				htmlEscape(a.username || a.id) + '</option>';
		});
		return html + '</select>';
	}

	// Bind the account selector inside `root`. Switching sets the active account
	// and then runs `afterSwitch` (e.g. refresh status/request and clear stale
	// output) so every caller stays consistent.
	function wireAccountSelect(root, opts) {
		opts = opts || {};
		var sel = root && root.querySelector('#drcom-account-select');
		if (!sel)
			return;
		sel.addEventListener('change', function() {
			var id = sel.value;
			sel.disabled = true;
			fs.exec('/etc/init.d/drcom_auth', [ 'account_set_active', id ]).then(function() {
				ui.addNotification(null, E('p', tr('accountSwitched')));
				if (opts.afterSwitch)
					return opts.afterSwitch(id);
			}).catch(function(e) {
				ui.addNotification(null, E('p', execMessage(e) || tr('accountSwitchFailed')), 'error');
			}).then(function() { sel.disabled = false; });
		});
	}

	// Empty the assembled request / response boxes (used when the active account
	// changes, so the previous account's output does not linger).
	function clearCasOutput() {
		[ 'drcom-cas-body-box', 'drcom-cas-response-box' ].forEach(function(id) {
			var box = document.getElementById(id);
			if (box) {
				box.innerHTML = '';
				box.style.display = 'none';
			}
		});
	}

	// Read the CAS status and update the params / cookie rows.
	function refreshCasStatus() {
		return fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).then(function (res) {
			var raw = (res && res.stdout ? res.stdout : '').trim();
			var values = {};
			raw.split('\n').forEach(function (line) {
				var eq = line.indexOf('=');
				if (eq > 0)
					values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
			});
			var paramsNode = document.getElementById('drcom-cas-params-status');
			if (paramsNode) {
				if (values.params === 'none')
					paramsNode.textContent = tr('casParamsIdle');
				else
					paramsNode.textContent = format(tr('casParamsSaved'),
						values.params_currentMenu || '?',
						values.params_failN || '?',
						values.params_eventId || '?',
						values.params_captured || '?');
			}
			var cookieNode = document.getElementById('drcom-cas-cookie-status');
			if (cookieNode) {
				var state = values.session || 'unknown';
				if (state === 'active')
					cookieNode.textContent = values.cookie === 'valid'
						? format(tr('casSessionActive'), values.COOKIE_MTIME || '?')
						: tr('casSessionActiveRemote');
				else if (state === 'inactive')
					cookieNode.textContent = tr('casSessionInactive');
				else
					cookieNode.textContent = tr('casCookieUnknown');
			}
			return values;
		}).catch(function () { return {}; });
	}

	// Refresh the top status card.
	function refreshDashboard() {
		return Promise.all([
			fs.exec('/etc/init.d/drcom_auth', [ 'overview' ]).catch(function () { return {}; }),
			fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).catch(function () { return {}; })
		]).then(function (res) {
			function st(r) { return ((r && r.stdout) || '').trim(); }
			var net = st(res[0]);
			var netNode = document.getElementById('drcom-status-network');
			if (netNode) {
				if (/^network=down/m.test(net) || /is down/i.test(net))
					netNode.textContent = tr('statusNetworkDown');
				else if (/^network=up/m.test(net) || /is up/i.test(net))
					netNode.textContent = tr('statusNetworkUp');
				else
					netNode.textContent = tr('statusUnknown');
			}
			var drcomNode = document.getElementById('drcom-status-drcom');
			if (drcomNode) {
				var mres = net.match(/drcom=(\w*)/);
				var ds = mres ? mres[1] : '';
				var account = net.match(/account=(\S+)/);
				// Do not claim online when the portal reported no account: that
				// combination is contradictory and means the state is unclear.
				if (ds === 'online' && account)
					drcomNode.textContent = format(tr('statusDrcomOnlineAcct'), account[1]);
				else if (ds === 'online')
					drcomNode.textContent = tr('statusUnknown');
				else if (ds === 'offline')
					drcomNode.textContent = tr('statusDrcomOffline');
				else
					drcomNode.textContent = tr('statusUnknown');
			}
			var cas = st(res[1]);
			var v = {};
			cas.split('\n').forEach(function (line) {
				var eq = line.indexOf('=');
				if (eq > 0) v[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
			});
			var casNode = document.getElementById('drcom-status-cas');
			if (casNode)
				casNode.textContent = (v.session === 'active') ? tr('statusCasOk') : tr('statusCasNo');
			var cookieNode = document.getElementById('drcom-status-cookie');
			if (cookieNode)
				cookieNode.textContent = (v.cookie === 'valid')
					? format(tr('statusCookiePresent'), v.COOKIE_MTIME || '?')
					: tr('statusCookieNone');

			// The Diagnostics tab's authenticate row shows the same real Dr.COM
			// state, so it is no longer a static "not authenticated".
			var authNode = document.getElementById('drcom-auth-status');
			if (authNode) {
				var am = net.match(/drcom=(\w*)/);
				var as = am ? am[1] : '';
				var acct = net.match(/account=(\S+)/);
				if (as === 'online')
					authNode.textContent = acct ? format(tr('statusDrcomOnlineAcct'), acct[1]) : tr('statusDrcomOnline');
				else if (as === 'offline')
					authNode.textContent = tr('statusDrcomOffline');
				else
					authNode.textContent = tr('authIdle');
			}
		});
	}

	// Render the request/response once, from the saved params.
	function loadCasRequest() {
		return fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).then(function (res) {
			var raw = (res && res.stdout ? res.stdout : '').trim();
			var marker = raw.indexOf('\n---request---\n');
			if (marker >= 0) {
				var rest = raw.slice(marker + '\n---request---\n'.length);
				var requestPart = rest.replace(/---end-request---[\s\S]*$/, '').trim();
				if (requestPart)
					renderCasRequest(requestPart);
			}
			var rStart = raw.indexOf('\n---response---\n');
			if (rStart >= 0) {
				var resp = raw.slice(rStart + '\n---response---\n'.length)
					.replace(/\n?---end-response---[\s\S]*$/, '').trim();
				renderCasResponse(resp);
			}
		}).catch(function () {});
	}

	return {
		format: format,
		htmlEscape: htmlEscape,
		publicKeyStatusText: publicKeyStatusText,
		execMessage: execMessage,
		execFailed: execFailed,
		casFieldRow: casFieldRow,
		copyToClipboard: copyToClipboard,
		showDiag: showDiag,
		accountSelectHtml: accountSelectHtml,
		wireAccountSelect: wireAccountSelect,
		clearCasOutput: clearCasOutput,
		renderAuthTrace: renderAuthTrace,
		renderCasRequest: renderCasRequest,
		renderCasResponse: renderCasResponse,
		refreshCasStatus: refreshCasStatus,
		refreshDashboard: refreshDashboard,
		loadCasRequest: loadCasRequest
	};
}

// Page CSS shared by every tab. Module level (exposed on the module) so views
// call common.style().
function style() {
	return E('style', {}, [
		'.drcom-auth-view .cbi-map-descr{margin-bottom:10px}',
		'.drcom-auth-view .cbi-section{margin:10px 0 14px 0;padding:0;overflow:hidden}',
		'.drcom-auth-view .cbi-section h3{margin:0;padding:14px 16px 8px 16px}',
		'.drcom-auth-view .cbi-section-descr{margin:0;padding:0 16px 10px 16px;font-size:13px;font-weight:400;opacity:.75;line-height:1.4}',
		'.drcom-auth-view .cbi-section-node{padding:12px 24px 18px 24px}',
		'.drcom-auth-view .cbi-value{clear:both;margin-bottom:8px!important;padding-top:1px!important;padding-bottom:1px!important}',
		'.drcom-auth-view .cbi-value:last-child{margin-bottom:0!important}',
		'.drcom-auth-view .cbi-value-field input,.drcom-auth-view .cbi-value-field select,.drcom-auth-view .cbi-value-field textarea,.drcom-auth-view .cbi-value-field .cbi-dropdown{margin-bottom:3px!important}',
		'.drcom-auth-view .cbi-value-field > *:last-child{margin-bottom:0!important}',
		'.drcom-auth-view .cbi-value-description{clear:both;margin-top:2px;margin-bottom:0}',
		'.drcom-auth-view .cbi-button{margin-bottom:3px}',
		'.drcom-auth-view .drcom-result{word-break:break-all;white-space:normal}',
		'.drcom-body-box{margin-top:8px}',
		'.drcom-body-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:6px}',
		'.drcom-body-label{flex:0 0 150px;font-weight:600;padding-top:6px}',
		'.drcom-body-value{flex:1 1 auto;min-width:0}',
		'.drcom-body-field{width:100%;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;resize:vertical}',
		'.drcom-body-row .cbi-button{flex:0 0 auto}',
		'.drcom-diag-title{font-weight:600;margin-bottom:4px}',
		'.drcom-diag-pre{background:rgba(0,0,0,.55);color:inherit;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;margin:0}',
		'.drcom-preview-frame{width:100%;height:160px;border:1px solid rgba(128,128,128,.4);border-radius:4px;background:#fff}',
		'#drcom-cas-response-box .drcom-body-field{max-height:200px;overflow:auto}',
		'.drcom-acc-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.25)}',
		'.drcom-acc-user{font-weight:600}',
		'.drcom-acc-id{opacity:.6;font-size:12px}',
		'.drcom-acc-row .cbi-button{margin-left:auto}',
		'.drcom-acc-add{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}',
		'.drcom-acc-add .drcom-body-label{flex:0 0 100%;padding:0}'
	].join('\n'));
}

return baseclass.extend({
	collectInterfaces: collectInterfaces,
	parseAccounts: parseAccounts,
	makeTranslator: makeTranslator,
	makeBaseHelpers: makeBaseHelpers,
	style: style
});

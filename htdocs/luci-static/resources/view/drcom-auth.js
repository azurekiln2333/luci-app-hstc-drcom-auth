'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require network';

// Collect candidate WAN interfaces: LuCI logical interfaces (with their device)
// plus raw system netdevs, so the dropdown matches what the router actually has.
function collectInterfaces() {
	var out = {};

	// Interfaces that can never be the WAN.
	function isVirtual(name) {
		return !name || name === 'lo' || name === 'docker0' || name === 'ip6tnl0';
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
		fs.exec_direct('/sbin/uci', [ '-q', 'get', 'drcom_auth.main.wan_port' ]).catch(function () { return ''; })
	]).then(function (res) {
		var uci = res[0] || '', ls = res[1] || '', current = (res[2] || '').trim();
		var logical = {};

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
		// devices such as loopback so they never enter the list.
		Object.keys(ifaces).forEach(function (lname) {
			var dev = ifaces[lname];
			if (isVirtual(dev))
				return;
			if (out[dev] === undefined)
				out[dev] = dev;
			logical[dev] = lname;
		});

		return { devices: Object.keys(out).sort(), logical: logical, current: current };
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'enabled' ]).catch(function() { return ''; }),
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'public_key_status' ]).catch(function(e) {
				return [
					e && e.stdout,
					e && e.stderr,
					e && e.message
				].filter(function(v) { return v; }).join('\n').trim();
			}),
			collectInterfaces(),
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'accounts_list' ]).catch(function() { return ''; })
		]);
	},

	render: function(data) {
		var m, s, o, compactStyle, lang, browserLang, tr;
		var isEnabled = (data[0] || '').trim() === 'enabled';
		var publicKeyStatus = (data[1] || '').trim();
		var ifaceInfo = data[2] || { devices: [], logical: {}, current: '' };
		var ifaceDevices = ifaceInfo.devices || [];
		var ifaceLogical = ifaceInfo.logical || {};
		var savedWanPort = ifaceInfo.current || '';

		// Parse `accounts_list`: one "<id>\t<username>\t<active|->" per line.
		var accounts = (data[3] || '').trim().split('\n').filter(function(l) { return l.indexOf('\t') > 0; })
			.map(function(l) {
				var p = l.split('\t');
				return { id: p[0], username: p[1] || '', active: p[2] === 'active' };
			});
		var activeAccount = null;
		accounts.forEach(function(a) { if (a.active) activeAccount = a; });
		if (!activeAccount && accounts.length)
			activeAccount = accounts[0];
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
				statusDrcomFail: '认证失败',
				statusCasOk: '已登录',
				statusCasNo: '未登录',
				statusCookiePresent: '存在（%s）',
				statusCookieNone: '不存在',
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
				accountIdHint: '账号标识（留空自动生成）',
				accountNeedUsername: '请填写用户名。',
				accountBadId: '账号标识无效。',
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
				authRunning: '认证中...',
				authDone: '已执行认证。',
				authFailed: '认证失败',
				enable: '启用联网检测',
				username: '账号',
				password: '密码',
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
				casUrlDesc: '基础地址或完整登录地址均可，例如 https://hscas.hstc.edu.cn 或 https://hscas.hstc.edu.cn/cas/login。',
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
				casRequestLine: '请求行',
				casCopy: '复制',
				casCopied: '已复制到剪贴板',
				casCopyFailed: '复制失败，请手动选择复制',
				casLogout: '退出登录',
				doCasLogout: '清除本地会话',
				casLogoutDone: '已清除本地 CAS 会话。',
				wanPort: 'WAN 接口',
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
				statusDrcomFail: '認證失敗',
				statusCasOk: '已登入',
				statusCasNo: '未登入',
				statusCookiePresent: '存在（%s）',
				statusCookieNone: '不存在',
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
				accountIdHint: '帳號識別（留空自動產生）',
				accountNeedUsername: '請填寫使用者名稱。',
				accountBadId: '帳號識別無效。',
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
				authRunning: '認證中...',
				authDone: '已執行認證。',
				authFailed: '認證失敗',
				enable: '啟用連網偵測',
				username: '帳號',
				password: '密碼',
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
				casUrlDesc: '基礎位址或完整登入位址均可，例如 https://hscas.hstc.edu.cn 或 https://hscas.hstc.edu.cn/cas/login。',
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
				casRequestLine: '請求行',
				casCopy: '複製',
				casCopied: '已複製到剪貼簿',
				casCopyFailed: '複製失敗，請手動選取複製',
				casLogout: '登出',
				doCasLogout: '清除本機會話',
				casLogoutDone: '已清除本機 CAS 工作階段。',
				wanPort: 'WAN 介面',
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
				statusDrcomFail: 'Failed',
				statusCasOk: 'Logged in',
				statusCasNo: 'Not logged in',
				statusCookiePresent: 'Present (%s)',
				statusCookieNone: 'Absent',
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
				accountIdHint: 'Account id (auto if blank)',
				accountNeedUsername: 'Please enter a username.',
				accountBadId: 'Invalid account id.',
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
				authRunning: 'Authenticating...',
				authDone: 'Authentication executed.',
				authFailed: 'Authentication failed',
				enable: 'Enable Network Check',
				username: 'Username',
				password: 'Password',
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
				casUrlDesc: 'Either the base host or the full login URL works, e.g. https://hscas.hstc.edu.cn or https://hscas.hstc.edu.cn/cas/login.',
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
				casRequestLine: 'Request Line',
				casCopy: 'Copy',
				casCopied: 'Copied to clipboard',
				casCopyFailed: 'Copy failed, select and copy manually',
				casLogout: 'Logout',
				doCasLogout: 'Clear Local Session',
				casLogoutDone: 'Local CAS session cleared.',
				wanPort: 'WAN Interface',
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

		browserLang = (navigator.language || '').toLowerCase();
		lang = window.localStorage.getItem('drcom-auth-lang') ||
			(/^zh-(tw|hk|mo)/.test(browserLang) ? 'zh-tw' : (browserLang.indexOf('zh') === 0 ? 'zh' : 'en'));
		if (!dict[lang])
			lang = 'en';
		tr = function(key) {
			return dict[lang][key] || key;
		};
		var format = function(text) {
			var args = Array.prototype.slice.call(arguments, 1);
			var index = 0;
			return text.replace(/%s/g, function() {
				return args[index++] || '';
			});
		};
		var htmlEscape = function(text) {
			return String(text || '').replace(/[&<>"']/g, function(ch) {
				return {
					'&': '&amp;',
					'<': '&lt;',
					'>': '&gt;',
					'"': '&quot;',
					"'": '&#39;'
				}[ch];
			});
		};
		var publicKeyStatusText = function(raw) {
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
		};
		var execMessage = function(obj) {
			return [
				obj && obj.stdout,
				obj && obj.stderr,
				obj && obj.message
			].filter(function(v) { return v; }).join('\n').trim();
		};
		var execFailed = function(obj, message) {
			return (obj && obj.code) || /(^|\n).*failed:/i.test(message || '');
		};
		// Render a failure diagnosis in the shared detail box so the raw output
		// (HTTP code, curl error, page head, saved paths) is visible to the user.
		var showDiag = function(title, text) {
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
		};

		// Render the raw HTTP request from `cas_params` (request line, headers
		// and body) into copyable rows.
		var renderCasRequest = function(raw) {
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
			body.split('&').forEach(function(kv) {
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
		};

		// One label + read-only textarea + copy button.
		var casFieldRow = function(label, value) {
			var area = E('textarea', {
				'class': 'drcom-body-field',
				'readonly': 'readonly',
				'rows': String(Math.min(6, Math.max(1, Math.ceil(String(value).length / 60) || 1)))
			}, [ String(value) ]);
			var button = E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					copyToClipboard(String(value)).then(function(ok) {
						ui.addNotification(null, E('p', ok ? tr('casCopied') : tr('casCopyFailed')), ok ? undefined : 'error');
					});
				}
			}, [ tr('casCopy') ]);
			return E('div', { 'class': 'drcom-body-row' }, [
				E('div', { 'class': 'drcom-body-label' }, [ label ]),
				E('div', { 'class': 'drcom-body-value' }, [ area ]),
				button
			]);
		};

		// Clipboard with a fallback to selecting the text.
		var copyToClipboard = function(text) {
			if (navigator.clipboard && navigator.clipboard.writeText)
				return navigator.clipboard.writeText(text).then(function() { return true; }).catch(function() { return legacyCopy(text); });
			return Promise.resolve(legacyCopy(text));
		};
		var legacyCopy = function(text) {
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
		};

		// Query the backend for current CAS params/cookie state and update the
		// status rows. Kept as a closure so both load() and the buttons use it.
		var refreshCasStatus = function() {
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).then(function(res) {
				var raw = (res && res.stdout ? res.stdout : '').trim();

				var values = {};
				raw.split('\n').forEach(function(line) {
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

				// NOTE: the request is intentionally NOT rendered here. Status
				// refreshes must not rebuild the request display; only the params
				// button (explicit refresh) and the initial page load do that.
				return values;
			}).catch(function() { return {}; });
		};

		// Refresh the top status card: network reachability plus the Dr.COM and
		// CAS/cookie states. Purely local apart from the ping and the CAS probe.
		var refreshDashboard = function() {
			return Promise.all([
				fs.exec('/etc/init.d/drcom_auth', [ 'overview' ]).catch(function() { return {}; }),
				fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).catch(function() { return {}; })
			]).then(function (res) {
				function st(r) { return ((r && r.stdout) || '').trim(); }

				// Network status: reachable / unreachable.
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

				// Dr.COM auth status: last login result.
				var drcomNode = document.getElementById('drcom-status-drcom');
				if (drcomNode) {
					var mres = net.match(/drcom=(\w+)/);
					if (mres && mres[1] === 'ok')
						drcomNode.textContent = tr('statusDrcomOk');
					else if (mres && mres[1] === 'rejected')
						drcomNode.textContent = tr('statusDrcomFail');
					else
						drcomNode.textContent = tr('statusUnknown');
				}

				// CAS + cookie status: from cas_status key=value output.
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
			});
		};

		// Render the request once, from the currently saved params. Used on page
		// load and after an explicit params fetch; never on status refreshes.
		var loadCasRequest = function() {
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_status' ]).then(function(res) {
				var raw = (res && res.stdout ? res.stdout : '').trim();
				var marker = raw.indexOf('\n---request---\n');
				if (marker < 0)
					return;
				var requestPart = raw.slice(marker + '\n---request---\n'.length)
					.replace(/---end-request---[\s\S]*$/, '').trim();
				if (requestPart)
					renderCasRequest(requestPart);
			}).catch(function() {});
		};

		// Render the accounts manager: a row per account (username, id, active
		// radio, delete) plus an add-account form. Reloads the page after a
		// change so every dependent field (dropdown, rendered config) is fresh.
		var renderAccountsEditor = function(host) {
			if (!host)
				return;
			host.innerHTML = '';

			var list = E('div', { 'class': 'drcom-acc-list' });
			accounts.forEach(function(a) {
				var activeRadio = E('input', {
					'type': 'radio', 'name': 'drcom-active-account', 'value': a.id,
					'checked': a.active ? 'checked' : null,
					'change': function() { setActive(a.id); }
				});
				list.appendChild(E('div', { 'class': 'drcom-acc-row' }, [
					activeRadio,
					E('span', { 'class': 'drcom-acc-user' }, [ a.username || ('(' + a.id + ')') ]),
					E('span', { 'class': 'drcom-acc-id' }, [ a.id ]),
					E('button', {
						'class': 'cbi-button cbi-button-negative', 'type': 'button',
						'click': function() { removeAccount(a.id); }
					}, [ tr('accountDelete') ])
				]));
			});
			if (!accounts.length)
				list.appendChild(E('div', { 'class': 'drcom-result' }, [ tr('noAccounts') ]));
			host.appendChild(list);

			var idInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': tr('accountIdHint') });
			var userInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '202400000000' });
			var passInput = E('input', { 'type': 'password', 'class': 'cbi-input-text', 'placeholder': tr('password') });
			host.appendChild(E('div', { 'class': 'drcom-acc-add' }, [
				E('div', { 'class': 'drcom-body-label' }, [ tr('accountAdd') ]),
				idInput, userInput, passInput,
				E('button', {
					'class': 'cbi-button cbi-button-action', 'type': 'button',
					'click': function() { addAccount(idInput, userInput, passInput); }
				}, [ tr('accountSave') ])
			]));
		};

		var reloadSoon = function() { window.setTimeout(function() { window.location.reload(); }, 600); };

		var setActive = function(id) {
			fs.exec('/etc/init.d/drcom_auth', [ 'account_set_active', id ]).then(function() {
				ui.addNotification(null, E('p', tr('accountSwitched')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', execMessage(e) || tr('accountSwitchFailed')), 'error');
			});
		};

		var removeAccount = function(id) {
			if (!window.confirm(tr('accountDeleteConfirm').replace('%s', id)))
				return;
			fs.exec('/etc/init.d/drcom_auth', [ 'account_delete', id ]).then(function() {
				ui.addNotification(null, E('p', tr('accountDeleted')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', execMessage(e) || tr('accountSaveFailed')), 'error');
			});
		};

		var addAccount = function(idInput, userInput, passInput) {
			var id = (idInput.value || '').trim();
			var user = (userInput.value || '').trim();
			var pass = passInput.value || '';
			if (!user) {
				ui.addNotification(null, E('p', tr('accountNeedUsername')), 'error');
				return;
			}
			// Derive a stable id when the user leaves it blank.
			if (!id)
				id = 'acc' + (accounts.length + 1);
			id = id.replace(/[^A-Za-z0-9_.-]/g, '');
			if (!id) {
				ui.addNotification(null, E('p', tr('accountBadId')), 'error');
				return;
			}
			fs.exec('/etc/init.d/drcom_auth', [ 'account_upsert', id, user, pass ]).then(function() {
				ui.addNotification(null, E('p', tr('accountSaved')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', execMessage(e) || tr('accountSaveFailed')), 'error');
			});
		};

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));
		compactStyle = E('style', {}, [
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
			// Tabs follow the active LuCI theme: prefer bootstrap's CSS variables,
			// then common aliases used by other themes, and finally currentColor so
			// the bar always matches the page palette whatever the theme.
			'.drcom-tabs-nav{--drcom-accent:var(--primary-color-medium,var(--primary,var(--main-color,currentColor)));--drcom-accent-fg:var(--on-primary-color,#fff);display:flex;gap:2px;border-bottom:2px solid var(--drcom-accent);margin:4px 0 12px 0}',
			'.drcom-tab-btn{background:transparent;color:inherit;border:1px solid var(--drcom-accent);border-bottom:none;padding:8px 18px;cursor:pointer;font-size:14px;border-radius:6px 6px 0 0;opacity:.7}',
			'.drcom-tab-btn:hover{opacity:1}',
			'.drcom-tab-btn.active{background:var(--drcom-accent);color:var(--drcom-accent-fg);font-weight:600;opacity:1}',
			'.drcom-tab-pane{padding-top:2px}',
			'.drcom-acc-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(128,128,128,.25)}',
			'.drcom-acc-user{font-weight:600}',
			'.drcom-acc-id{opacity:.6;font-size:12px}',
			'.drcom-acc-row .cbi-button{margin-left:auto}',
			'.drcom-acc-add{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}',
			'.drcom-acc-add .drcom-body-label{flex:0 0 100%;padding:0}'
		].join('\n'));

		// Status card (first card on the Online Auth tab).
		s = m.section(form.TypedSection, 'drcom_auth', tr('status'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_status_network', tr('statusNetwork'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-status-network" class="drcom-result">' + tr('statusUnknown') + '</span>';
		};

		o = s.option(form.DummyValue, '_status_drcom', tr('statusDrcom'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-status-drcom" class="drcom-result">' + tr('statusUnknown') + '</span>';
		};

		o = s.option(form.DummyValue, '_status_cas', tr('statusCas'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-status-cas" class="drcom-result">' + tr('casCookieUnknown') + '</span>';
		};

		o = s.option(form.DummyValue, '_status_cookie', tr('casCookieStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-status-cookie" class="drcom-result">' + tr('statusUnknown') + '</span>';
		};

		s = m.section(form.TypedSection, 'drcom_auth', tr('basic'));
		s.anonymous = true;
		s.addremove = false;

		// WAN interface: pick from the router's interfaces (logical name plus
		// device when they differ). The stored value stays the netdev name.
		o = s.option(form.ListValue, 'wan_port', tr('wanPort'));
		o.rmempty = false;
		o.description = tr('wanPortDesc');
		var wanDevices = ifaceDevices.slice();
		(function () {
			// Keep the currently configured value selectable even if the device is
			// not present right now (offline interface), so it is never lost.
			if (savedWanPort && wanDevices.indexOf(savedWanPort) < 0)
				wanDevices.push(savedWanPort);
		})();
		wanDevices.sort().forEach(function (dev) {
			var lname = ifaceLogical[dev];
			o.value(dev, (lname && lname !== dev) ? (lname + ' (' + dev + ')') : dev);
		});
		if (!wanDevices.length)
			o.placeholder = 'eth1';

		o = s.option(form.ListValue, 'mac_type', tr('deviceType'));
		o.value('1', tr('pc'));
		o.value('2', tr('mobile'));
		o.default = '2';
		o.description = tr('deviceTypeDesc');

		s = m.section(form.TypedSection, 'drcom_auth', tr('authorize'));
		s.anonymous = true;
		s.addremove = false;
		s.description = tr('authorizeStep');
		o = s.option(form.Button, '_authorize', tr('getAuthorize'));
		o.inputtitle = tr('getAuthorize');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-authorize-status');
			if (node)
				node.textContent = tr('authorizeRunning');

			return fs.exec('/etc/init.d/drcom_auth', [ 'authorize' ]).then(function(res) {
				var node = document.getElementById('drcom-authorize-status');
				var output = (res && (res.stdout || res.stderr)) ? (res.stdout || res.stderr).trim() : '';
				var urls = output.match(/https?:\/\/\S+/g);
				if (urls && urls.length)
					output = urls[urls.length - 1];
				if (node)
					node.textContent = output ? tr('authorizeDone') + ': ' + output : tr('authorizeIdle');
			}).catch(function(e) {
				var node = document.getElementById('drcom-authorize-status');
				var message = execMessage(e) || tr('authorizeFailed');
				if (node)
					node.textContent = tr('authorizeFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
			});
		};

		o = s.option(form.DummyValue, '_authorize_status', tr('authorizeStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-authorize-status" class="drcom-result">' + tr('authorizeIdle') + '</span>';
		};

		// Account card: pick the active account, run the one-click login and see
		// the result. Adding/managing accounts lives on the Accounts tab.
		s = m.section(form.TypedSection, 'drcom_auth', tr('account'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_account_select', tr('activeAccount'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			if (!accounts.length)
				return '<span class="drcom-result">' + tr('noAccounts') + '</span>';
			var html = '<select id="drcom-account-select" class="cbi-input-select">';
			accounts.forEach(function(a) {
				html += '<option value="' + htmlEscape(a.id) + '"' +
					(a.active ? ' selected="selected"' : '') + '>' +
					htmlEscape(a.username || a.id) + '</option>';
			});
			return html + '</select>';
		};

		o = s.option(form.DummyValue, '_account_hint', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span class="drcom-result">' + tr('accountHint') + '</span>';
		};

		// One-click action: ensure a CAS login exists (reusing saved params,
		// skipping when already logged in) and run the connectivity check.
		o = s.option(form.Button, '_connect_now', tr('connectNow'));
		o.inputtitle = tr('connectNow');
		o.inputstyle = 'apply';
		o.description = tr('connectNowDesc');
		o.onclick = function() {
			var node = document.getElementById('drcom-connect-status');
			if (node)
				node.textContent = tr('connectRunning');

			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_ensure' ]).then(function(res) {
				var node = document.getElementById('drcom-connect-status');
				var message = execMessage(res);
				var failed = execFailed(res, message);
				if (/^diagnosis=/m.test(message))
					failed = true;
				var text = failed ? tr('connectFailed') + (message ? ': ' + message : '')
					: tr('connectDone');
				if (node)
					node.textContent = text;
				if (failed)
					ui.addNotification(null, E('p', text), 'error');
				else
					ui.addNotification(null, E('p', text));
				return refreshCasStatus();
			}).catch(function(e) {
				var node = document.getElementById('drcom-connect-status');
				var message = execMessage(e) || tr('connectFailed');
				if (node)
					node.textContent = tr('connectFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
			});
		};

		o = s.option(form.DummyValue, '_connect_status', tr('connectStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-connect-status" class="drcom-result">' + tr('connectIdle') + '</span>';
		};

		s = m.section(form.TypedSection, 'drcom_auth', tr('cas'));
		s.anonymous = true;
		s.addremove = false;
		s.description = tr('casStep');

		o = s.option(form.Value, 'hscas_url', tr('casUrl'));
		o.placeholder = 'https://hscas.hstc.edu.cn';
		o.default = 'https://hscas.hstc.edu.cn';
		o.rmempty = false;
		o.description = tr('casUrlDesc');

		o = s.option(form.Value, 'hscas_public_key_url', tr('publicKeyUrl'));
		o.placeholder = 'https://hscas.hstc.edu.cn/cas/jwt/publicKey';
		o.default = 'https://hscas.hstc.edu.cn/cas/jwt/publicKey';
		o.rmempty = false;

		o = s.option(form.Button, '_public_key', tr('updatePublicKey'));
		o.inputtitle = tr('updatePublicKey');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-public-key-status');
			if (node)
				node.textContent = tr('publicKeyUpdating');

			return fs.exec('/etc/init.d/drcom_auth', [ 'public_key' ]).then(function(res) {
				var node = document.getElementById('drcom-public-key-status');
				var message = execMessage(res) || tr('publicKeyDone');
				var failed = execFailed(res, message);
				var displayMessage = failed ? tr('publicKeyFailed') + ': ' + message : publicKeyStatusText(message);
				if (node)
					node.textContent = displayMessage;
				ui.addNotification(null, E('p', displayMessage), failed ? 'error' : undefined);
			}).catch(function(e) {
				var node = document.getElementById('drcom-public-key-status');
				var message = execMessage(e) || tr('publicKeyFailed');
				if (node)
					node.textContent = tr('publicKeyFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
			});
		};

		o = s.option(form.DummyValue, '_public_key_status', tr('publicKeyStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-public-key-status" class="drcom-result">' + htmlEscape(publicKeyStatusText(publicKeyStatus)) + '</span>';
		};

		// --- standalone CAS: fetch server-issued params ---
		// On success this also assembles and shows the full request (headers +
		// body) immediately, so no second click is needed.
		o = s.option(form.Button, '_cas_params', tr('casParams'));
		o.inputtitle = tr('fetchCasParams');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-cas-params-status');
			if (node)
				node.textContent = tr('casParamsFetching');

			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_params' ]).then(function(res) {
				var node = document.getElementById('drcom-cas-params-status');
				var output = (res && res.stdout ? res.stdout : '').trim();
				if (/^diagnosis=/m.test(output) && !/\n---request---\n/.test(output)) {
					if (node)
						node.textContent = tr('casParamsFailed');
					showDiag(tr('casParamsFailed'), output);
					return;
				}
				if (execFailed(res, execMessage(res)) && !/\n---request---\n/.test(output)) {
					if (node)
						node.textContent = tr('casParamsFailed');
					showDiag(tr('casParamsFailed'), output || execMessage(res));
					return;
				}
				// Reflect the freshly captured params, then rebuild the request from
				// them. This is the ONLY place the request display is refreshed
				// (besides initial load); status refreshes never touch it.
				return refreshCasStatus().then(function() {
					return loadCasRequest();
				});
			}).catch(function(e) {
				var node = document.getElementById('drcom-cas-params-status');
				if (node)
					node.textContent = tr('casParamsFailed');
				showDiag(tr('casParamsFailed'), execMessage(e));
			});
		};

		o = s.option(form.DummyValue, '_cas_params_status', tr('casParamsStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-cas-params-status" class="drcom-result">' + tr('casParamsIdle') + '</span>';
		};

		// Inline container where the assembled request is rendered (no button:
		// it is filled by the fetch-params flow and on page load).
		o = s.option(form.DummyValue, '_cas_body_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="drcom-cas-body-box" class="drcom-body-box" style="display:none"></div>';
		};

		// --- standalone CAS: perform login and persist cookies ---
		o = s.option(form.Button, '_cas_login', tr('casLogin'));
		o.inputtitle = tr('doCasLogin');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-cas-cookie-status');
			if (node)
				node.textContent = tr('casLoggingIn');

			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_login' ]).then(function(res) {
				var output = (res && res.stdout ? res.stdout : '').trim();
				var message = execMessage(res);
				var failed = execFailed(res, message);
				var text = failed ? tr('casLoginFailed') + (message ? ': ' + message : '')
					: tr('casLoginDone');
				if (failed)
					showDiag(tr('casLoginFailed'), output || message);
				else
					ui.addNotification(null, E('p', text));
				return refreshCasStatus();
			}).catch(function(e) {
				var message = execMessage(e) || tr('casLoginFailed');
				showDiag(tr('casLoginFailed'), message);
				return refreshCasStatus();
			});
		};

		o = s.option(form.DummyValue, '_cas_cookie_status', tr('casCookieStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-cas-cookie-status" class="drcom-result">' + tr('casCookieUnknown') + '</span>';
		};

		o = s.option(form.Button, '_cas_refresh', tr('casRefresh'));
		o.inputtitle = tr('refreshCasStatus');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return refreshCasStatus();
		};

		// Clear the local CAS session so a fresh login page (with fm1 params)
		// can be fetched again.
		o = s.option(form.Button, '_cas_logout', tr('casLogout'));
		o.inputtitle = tr('doCasLogout');
		o.inputstyle = 'reset';
		o.onclick = function() {
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_logout' ]).then(function() {
				ui.addNotification(null, E('p', tr('casLogoutDone')));
				return refreshCasStatus();
			}).catch(function(e) {
				showDiag(tr('casLogout'), execMessage(e));
				return refreshCasStatus();
			});
		};

		// --- Dr.COM authentication (kept separate from the CAS card) ---
		s = m.section(form.TypedSection, 'drcom_auth', tr('auth'));
		s.anonymous = true;
		s.addremove = false;
		s.description = tr('authStep');

		o = s.option(form.Button, '_auth', tr('auth'));
		o.inputtitle = tr('auth');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-auth-status');
			if (node)
				node.textContent = tr('authRunning');

			return fs.exec('/etc/init.d/drcom_auth', [ 'ticket' ]).then(function() {
				var node = document.getElementById('drcom-auth-status');
				if (node)
					node.textContent = tr('authDone');
				ui.addNotification(null, E('p', tr('authDone')));
			}).catch(function(e) {
				var node = document.getElementById('drcom-auth-status');
				var message = execMessage(e) || tr('authFailed');
				if (node)
					node.textContent = tr('authFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
			});
		};

		o = s.option(form.DummyValue, '_auth_status', tr('authStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-auth-status">' + tr('authIdle') + '</span>';
		};

		s = m.section(form.TypedSection, 'drcom_auth', tr('network'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', tr('enable'));
		o.default = isEnabled ? '1' : '0';
		o.rmempty = false;

		o = s.option(form.Value, 'check_interval', tr('interval'));
		o.datatype = 'uinteger';
		o.default = '60';
		o.rmempty = false;
		o.description = tr('intervalDesc');

		o = s.option(form.Value, 'ping_host', tr('pingHost'));
		o.placeholder = 'baidu.com';
		o.rmempty = false;

		// Accounts tab: manage multiple accounts.
		s = m.section(form.TypedSection, 'drcom_auth', tr('accountsTab'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_accounts_editor', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="drcom-accounts-editor"></div>';
		};

		// Settings tab: language + server addresses.
		s = m.section(form.TypedSection, 'drcom_auth', tr('settings'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_language', tr('language'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<select id="drcom-lang-select" class="cbi-input-select">' +
				'<option value="zh"' + (lang === 'zh' ? ' selected="selected"' : '') + '>' + tr('langZh') + '</option>' +
				'<option value="zh-tw"' + (lang === 'zh-tw' ? ' selected="selected"' : '') + '>' + tr('langZhTw') + '</option>' +
				'<option value="en"' + (lang === 'en' ? ' selected="selected"' : '') + '>' + tr('langEn') + '</option>' +
				'</select>';
		};

		s = m.section(form.TypedSection, 'drcom_auth', tr('server'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'drcom_server_ip', tr('serverIp'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.2.34';
		o.rmempty = false;

		o = s.option(form.Value, 'user_agent', tr('userAgent'));
		o.rmempty = false;

		return m.render().then(function(map) {
			var viewNode = E('div', { 'class': 'drcom-auth-view' }, [ compactStyle, map ]);

			// Group the rendered sections into tabs. Sections are matched by
			// their heading text, which is stable per language via the dict.
			var tabs = [
				{ id: 'online', label: tr('tabOnline'), titles: [ tr('status'), tr('account'), tr('basic'), tr('network') ] },
				{ id: 'accounts', label: tr('tabAccounts'), titles: [ tr('accountsTab') ] },
				{ id: 'diag', label: tr('tabDiag'), titles: [ tr('authorize'), tr('cas'), tr('auth') ] },
				{ id: 'settings', label: tr('tabSettings'), titles: [ tr('settings'), tr('server') ] }
			];

			var sections = Array.prototype.slice.call(map.querySelectorAll('.cbi-section'));
			var nav = E('div', { 'class': 'drcom-tabs-nav' });
			var panes = [];

			tabs.forEach(function(tab, idx) {
				var pane = E('div', { 'class': 'drcom-tab-pane', 'data-tab': tab.id });
				if (idx > 0)
					pane.style.display = 'none';

				sections.forEach(function(sec) {
					var h = sec.querySelector('h3');
					var title = h ? h.textContent.trim() : '';
					if (tab.titles.indexOf(title) >= 0)
						pane.appendChild(sec);
				});

				panes.push(pane);

				var btn = E('button', {
					'type': 'button',
					'class': 'drcom-tab-btn' + (idx === 0 ? ' active' : ''),
					'data-tab': tab.id,
					'click': function() {
						nav.querySelectorAll('.drcom-tab-btn').forEach(function(b) {
							b.classList.toggle('active', b === btn);
						});
						panes.forEach(function(p) {
							p.style.display = (p === pane) ? '' : 'none';
						});
					}
				}, [ tab.label ]);
				nav.appendChild(btn);
			});

			var tabsRoot = E('div', { 'class': 'drcom-tabs' }, [ nav ].concat(panes));
			map.appendChild(tabsRoot);

			var select = viewNode.querySelector('#drcom-lang-select');
			if (select) {
				select.addEventListener('change', function() {
					window.localStorage.setItem('drcom-auth-lang', select.value);
					window.location.reload();
				});
			}
			// Account dropdown: switch the active account in place.
			var acctSel = viewNode.querySelector('#drcom-account-select');
			if (acctSel) {
				acctSel.addEventListener('change', function() {
					var id = acctSel.value;
					acctSel.disabled = true;
					fs.exec('/etc/init.d/drcom_auth', [ 'account_set_active', id ]).then(function() {
						ui.addNotification(null, E('p', tr('accountSwitched')));
						return refreshCasStatus();
					}).catch(function(e) {
						ui.addNotification(null, E('p', execMessage(e) || tr('accountSwitchFailed')), 'error');
					}).then(function() { acctSel.disabled = false; });
				});
			}

			renderAccountsEditor(document.getElementById('drcom-accounts-editor'));

			// Populate the status card, CAS rows, then the saved request once.
			refreshDashboard();
			refreshCasStatus();
			loadCasRequest();
			return viewNode;
		});
	}
});

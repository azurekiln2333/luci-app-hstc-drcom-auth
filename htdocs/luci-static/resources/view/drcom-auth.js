'use strict';
'require form';
'require fs';
'require view';
'require ui';

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
			})
		]);
	},

	render: function(data) {
		var m, s, o, compactStyle, lang, browserLang, tr;
		var isEnabled = (data[0] || '').trim() === 'enabled';
		var publicKeyStatus = (data[1] || '').trim();
		var dict = {
			zh: {
				title: 'Dr.COM 认证',
				desc: '配置校园网认证与自动重连。',
				basic: '基础设置',
				authorize: '网页授权链接获取',
				authorizeStep: '上网第一步',
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
				casParamsGot: '已获取 %s：currentMenu=%s，failN=%s，_eventId=%s，execution=%s',
				casParamsFailed: '获取 CAS 参数失败',
				casUrlDesc: '仅使用该地址进行独立 CAS 认证，不经过 Dr.COM。',
				casParamsSaved: '已保存参数：currentMenu=%s，failN=%s，_eventId=%s（%s）',
				casLogin: 'CAS 登录',
				doCasLogin: '获取 Cookie 并登录',
				casLoggingIn: '登录中...',
				casLoginDone: 'CAS 登录成功，Cookie 已保存。',
				casLoginFailed: 'CAS 登录失败',
				casCookieStatus: 'Cookie 状态',
				casCookieUnknown: '未检测',
				casCookieValid: '有效（%s）',
				casCookieInvalid: '无效或已过期，请重新登录',
				casRefresh: 'Cookie 状态',
				refreshCasStatus: '刷新状态',
				authDesc: '使用 Dr.COM 网页授权链接完成完整认证（需先获取授权链接）。',
				casBody: 'CAS 请求体',
				showCasBody: '查看/复制请求体',
				casBodyLoading: '生成中...',
				casBodyFailed: '生成请求体失败',
				casEncryptedPassword: '加密后密码',
				casPasswordPrefix: '密码前缀',
				casPasswordLength: '密码长度',
				casFieldOrder: '字段顺序',
				casUrlencoded: 'URL 编码',
				casRequestBody: '完整请求体',
				casCopy: '复制',
				casCopied: '已复制到剪贴板',
				casCopyFailed: '复制失败，请手动选择复制',
				wanPort: 'WAN 接口',
				deviceType: '设备类型',
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
				authorize: '網頁授權連結取得',
				authorizeStep: '上網第一步',
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
				casParamsGot: '已取得 %s：currentMenu=%s，failN=%s，_eventId=%s，execution=%s',
				casParamsFailed: '取得 CAS 參數失敗',
				casUrlDesc: '僅使用此位址進行獨立 CAS 認證，不經過 Dr.COM。',
				casParamsSaved: '已儲存參數：currentMenu=%s，failN=%s，_eventId=%s（%s）',
				casLogin: 'CAS 登入',
				doCasLogin: '取得 Cookie 並登入',
				casLoggingIn: '登入中...',
				casLoginDone: 'CAS 登入成功，Cookie 已儲存。',
				casLoginFailed: 'CAS 登入失敗',
				casCookieStatus: 'Cookie 狀態',
				casCookieUnknown: '未偵測',
				casCookieValid: '有效（%s）',
				casCookieInvalid: '無效或已過期，請重新登入',
				casRefresh: 'Cookie 狀態',
				refreshCasStatus: '重新整理狀態',
				authDesc: '使用 Dr.COM 網頁授權連結完成完整認證（需先取得授權連結）。',
				casBody: 'CAS 請求體',
				showCasBody: '檢視/複製請求體',
				casBodyLoading: '產生中...',
				casBodyFailed: '產生請求體失敗',
				casEncryptedPassword: '加密後密碼',
				casPasswordPrefix: '密碼前綴',
				casPasswordLength: '密碼長度',
				casFieldOrder: '欄位順序',
				casUrlencoded: 'URL 編碼',
				casRequestBody: '完整請求體',
				casCopy: '複製',
				casCopied: '已複製到剪貼簿',
				casCopyFailed: '複製失敗，請手動選取複製',
				wanPort: 'WAN 介面',
				deviceType: '裝置類型',
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
				authorize: 'Web Authorize URL',
				authorizeStep: 'Step 1: get online',
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
				casParamsGot: 'Got %s: currentMenu=%s, failN=%s, _eventId=%s, execution=%s',
				casParamsFailed: 'Fetch CAS parameters failed',
				casUrlDesc: 'Standalone CAS authentication uses this URL only; Dr.COM is not involved.',
				casParamsSaved: 'Saved params: currentMenu=%s, failN=%s, _eventId=%s (%s)',
				casLogin: 'CAS Login',
				doCasLogin: 'Get Cookie and Log In',
				casLoggingIn: 'Logging in...',
				casLoginDone: 'CAS login succeeded, cookie saved.',
				casLoginFailed: 'CAS login failed',
				casCookieStatus: 'Cookie Status',
				casCookieUnknown: 'Not checked',
				casCookieValid: 'Valid (%s)',
				casCookieInvalid: 'Invalid or expired; log in again',
				casRefresh: 'Cookie Status',
				refreshCasStatus: 'Refresh Status',
				authDesc: 'Complete the full Dr.COM flow using the web authorize URL (fetch it first).',
				casBody: 'CAS Request Body',
				showCasBody: 'Show / Copy Request Body',
				casBodyLoading: 'Generating...',
				casBodyFailed: 'Failed to build request body',
				casEncryptedPassword: 'Encrypted Password',
				casPasswordPrefix: 'Password Prefix',
				casPasswordLength: 'Password Length',
				casFieldOrder: 'Field Order',
				casUrlencoded: 'URL Encoded',
				casRequestBody: 'Full Request Body',
				casCopy: 'Copy',
				casCopied: 'Copied to clipboard',
				casCopyFailed: 'Copy failed, select and copy manually',
				wanPort: 'WAN Interface',
				deviceType: 'Device Type',
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
		// Turn the key=value dump from `cas_params` into a readable summary.
		var casParamsText = function(raw) {
			var values = {};
			String(raw || '').split('\n').forEach(function(line) {
				var eq = line.indexOf('=');
				if (eq > 0)
					values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
			});
			if (!values.execution)
				return raw;

			var exec = values.execution;
			var shortExec = exec.length > 24 ? exec.slice(0, 24) + '…' : exec;
			return format(tr('casParamsGot'),
				values.form || 'fm1',
				values.currentMenu || '?',
				values.failN || '?',
				values._eventId || '?',
				shortExec);
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

		// Render the `cas_body` key=value output: a copyable encrypted password
		// row and the full url-encoded request body.
		var renderCasBody = function(raw) {
			var box = document.getElementById('drcom-cas-body-box');
			if (!box)
				return;
			var values = {};
			String(raw || '').split('\n').forEach(function(line) {
				var eq = line.indexOf('=');
				if (eq > 0)
					values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
			});
			box.innerHTML = '';
			box.appendChild(casFieldRow(tr('casEncryptedPassword'), values.encrypted_password || ''));
			box.appendChild(casFieldRow(tr('casPasswordPrefix'), values.password_prefix || ''));
			box.appendChild(casFieldRow(tr('casPasswordLength'), values.password_length || ''));
			box.appendChild(casFieldRow(tr('casFieldOrder'), values.field_order || ''));
			box.appendChild(casFieldRow(tr('casUrlencoded'), values.urlencoded || ''));
			box.appendChild(casFieldRow(tr('casRequestBody'), values.body || ''));
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
					if (values.cookie === 'valid')
						cookieNode.textContent = format(tr('casCookieValid'), values.COOKIE_MTIME || '?');
					else
						cookieNode.textContent = tr('casCookieInvalid');
				}
				return values;
			}).catch(function() { return {}; });
		};

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));
		compactStyle = E('style', {}, [
			'.drcom-auth-view .cbi-map-descr{margin-bottom:10px}',
			'.drcom-auth-view .cbi-section{margin:10px 0 14px 0;padding:0;overflow:hidden}',
			'.drcom-auth-view .cbi-section h3{margin:0;padding:14px 16px 8px 16px}',
			'.drcom-auth-view .cbi-section-node{padding:20px 24px 22px 24px}',
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
			'.drcom-diag-pre{background:#2b2b2b;color:#eee;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;margin:0}'
		].join('\n'));

		s = m.section(form.TypedSection, 'drcom_auth', tr('basic'));
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

		o = s.option(form.Value, 'wan_port', tr('wanPort'));
		o.placeholder = 'eth1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'mac_type', tr('deviceType'));
		o.value('1', tr('pc'));
		o.value('2', tr('mobile'));
		o.default = '2';

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

		s = m.section(form.TypedSection, 'drcom_auth', tr('cas'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'username', tr('username'));
		o.placeholder = '202400000000';
		o.rmempty = false;

		o = s.option(form.Value, 'password', tr('password'));
		o.password = true;
		o.rmempty = false;

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
				// A diagnosis= line means the script reported a structured failure.
				if (/^diagnosis=/m.test(output)) {
					if (node)
						node.textContent = tr('casParamsFailed');
					showDiag(tr('casParamsFailed'), output);
					return;
				}
				var failed = execFailed(res, execMessage(res));
				var text = output ? casParamsText(output) : (execMessage(res) || tr('casParamsFailed'));
				if (node)
					node.textContent = text;
				if (failed)
					showDiag(tr('casParamsFailed'), output || execMessage(res));
			}).catch(function(e) {
				var node = document.getElementById('drcom-cas-params-status');
				var message = execMessage(e) || tr('casParamsFailed');
				if (node)
					node.textContent = tr('casParamsFailed');
				showDiag(tr('casParamsFailed'), message);
			});
		};

		o = s.option(form.DummyValue, '_cas_params_status', tr('casParamsStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-cas-params-status" class="drcom-result">' + tr('casParamsIdle') + '</span>';
		};

		// Show the assembled, url-encoded POST body (encrypted password +
		// session params) so it can be inspected and copied.
		o = s.option(form.Button, '_cas_body', tr('casBody'));
		o.inputtitle = tr('showCasBody');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var box = document.getElementById('drcom-cas-body-box');
			var status = document.getElementById('drcom-cas-body-status');
			if (status)
				status.textContent = tr('casBodyLoading');
			if (box)
				box.style.display = 'none';

			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_body' ]).then(function(res) {
				var output = (res && res.stdout ? res.stdout : '').trim();
				if (execFailed(res, execMessage(res)) || !output) {
					if (status)
						status.textContent = tr('casBodyFailed') + ': ' + (execMessage(res) || '');
					return;
				}
				if (status)
					status.textContent = '';
				renderCasBody(output);
			}).catch(function(e) {
				if (status)
					status.textContent = tr('casBodyFailed') + ': ' + (execMessage(e) || '');
			});
		};

		o = s.option(form.DummyValue, '_cas_body_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-cas-body-status" class="drcom-result"></span>' +
				'<div id="drcom-cas-body-box" class="drcom-body-box" style="display:none"></div>';
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

		o = s.option(form.Button, '_auth', tr('auth'));
		o.inputtitle = tr('auth');
		o.inputstyle = 'apply';
		o.description = tr('authDesc');
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
			var select = viewNode.querySelector('#drcom-lang-select');
			if (select) {
				select.addEventListener('change', function() {
					window.localStorage.setItem('drcom-auth-lang', select.value);
					window.location.reload();
				});
			}
			// Populate the CAS params/cookie status rows from the backend.
			refreshCasStatus();
			return viewNode;
		});
	}
});

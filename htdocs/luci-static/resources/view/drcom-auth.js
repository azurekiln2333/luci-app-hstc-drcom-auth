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
			'.drcom-auth-view .drcom-result{word-break:break-all;white-space:normal}'
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

		s = m.section(form.TypedSection, 'drcom_auth', tr('server'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'drcom_server_ip', tr('serverIp'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.2.34';
		o.rmempty = false;

		o = s.option(form.Value, 'hscas_url', tr('casUrl'));
		o.placeholder = 'https://hscas.hstc.edu.cn';
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
			return viewNode;
		});
	}
});

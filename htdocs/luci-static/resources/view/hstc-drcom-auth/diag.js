'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require hstc-drcom-auth.common as common';

// Diagnostics tab: the web authorize URL, the standalone CAS card (params,
// assembled request/response, login, logout) and the Dr.COM authenticate
// action, laid out as step 1 / step 2 / step 3.

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'public_key_status' ]).catch(function(e) {
				return [ e && e.stdout, e && e.stderr, e && e.message ]
					.filter(function(v) { return v; }).join('\n').trim();
			})
		]);
	},

	render: function(data) {
		var m, s, o, tr = common.makeTranslator();
		var h = common.makeBaseHelpers(tr);
		var publicKeyStatus = (data[0] || '').trim();

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));

		/* ---- step 1: web authorize URL ---- */
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
				var message = h.execMessage(e) || tr('authorizeFailed');
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

		/* ---- step 2: CAS ---- */
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
				var message = h.execMessage(res) || tr('publicKeyDone');
				var failed = h.execFailed(res, message);
				var displayMessage = failed ? tr('publicKeyFailed') + ': ' + message : h.publicKeyStatusText(message);
				if (node)
					node.textContent = displayMessage;
				ui.addNotification(null, E('p', displayMessage), failed ? 'error' : undefined);
			}).catch(function(e) {
				var node = document.getElementById('drcom-public-key-status');
				var message = h.execMessage(e) || tr('publicKeyFailed');
				if (node)
					node.textContent = tr('publicKeyFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
			});
		};

		o = s.option(form.DummyValue, '_public_key_status', tr('publicKeyStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-public-key-status" class="drcom-result">' + h.htmlEscape(h.publicKeyStatusText(publicKeyStatus)) + '</span>';
		};

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
					h.showDiag(tr('casParamsFailed'), output);
					return;
				}
				if (h.execFailed(res, h.execMessage(res)) && !/\n---request---\n/.test(output)) {
					if (node)
						node.textContent = tr('casParamsFailed');
					h.showDiag(tr('casParamsFailed'), output || h.execMessage(res));
					return;
				}
				return h.refreshCasStatus().then(function() {
					return h.loadCasRequest();
				});
			}).catch(function(e) {
				var node = document.getElementById('drcom-cas-params-status');
				if (node)
					node.textContent = tr('casParamsFailed');
				h.showDiag(tr('casParamsFailed'), h.execMessage(e));
			});
		};

		o = s.option(form.DummyValue, '_cas_params_status', tr('casParamsStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-cas-params-status" class="drcom-result">' + tr('casParamsIdle') + '</span>';
		};

		o = s.option(form.DummyValue, '_cas_body_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="drcom-cas-body-box" class="drcom-body-box" style="display:none"></div>' +
				'<div id="drcom-cas-response-box" class="drcom-body-box" style="display:none"></div>';
		};

		o = s.option(form.Button, '_cas_login', tr('casLogin'));
		o.inputtitle = tr('doCasLogin');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var node = document.getElementById('drcom-cas-cookie-status');
			if (node)
				node.textContent = tr('casLoggingIn');
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_login' ]).then(function(res) {
				var output = (res && res.stdout ? res.stdout : '').trim();
				var message = h.execMessage(res);
				var failed = h.execFailed(res, message);
				var text = failed ? tr('casLoginFailed') + (message ? ': ' + message : '')
					: tr('casLoginDone');
				if (failed)
					h.showDiag(tr('casLoginFailed'), output || message);
				else
					ui.addNotification(null, E('p', text));
				h.refreshDashboard();
				h.loadCasRequest();
				return h.refreshCasStatus();
			}).catch(function(e) {
				var message = h.execMessage(e) || tr('casLoginFailed');
				h.showDiag(tr('casLoginFailed'), message);
				h.refreshDashboard();
				return h.refreshCasStatus();
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
			return h.refreshCasStatus();
		};

		o = s.option(form.Button, '_cas_logout', tr('casLogout'));
		o.inputtitle = tr('doCasLogout');
		o.inputstyle = 'reset';
		o.onclick = function() {
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_logout' ]).then(function() {
				ui.addNotification(null, E('p', tr('casLogoutDone')));
				return h.refreshCasStatus();
			}).catch(function(e) {
				h.showDiag(tr('casLogout'), h.execMessage(e));
				return h.refreshCasStatus();
			});
		};

		/* ---- step 3: Dr.COM authenticate ---- */
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
				var message = h.execMessage(e) || tr('authFailed');
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

		return m.render().then(function(map) {
			var viewNode = E('div', { 'class': 'drcom-auth-view' }, [ common.style(), map ]);
			h.refreshCasStatus();
			h.loadCasRequest();
			return viewNode;
		});
	}
});

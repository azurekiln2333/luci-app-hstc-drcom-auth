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
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'accounts_list' ]).catch(function() { return ''; })
		]);
	},

	render: function(data) {
		var m, s, o, tr = common.makeTranslator();
		var h = common.makeBaseHelpers(tr);
		var accounts = common.parseAccounts(data[0]);

		// Query the Dr.COM portal state and render the decision details: the
		// connectivity probe result and the uid/ip/session fields that were read,
		// so it is visible how "authenticated" was decided.
		var runAuthCheck = function() {
			var status = document.getElementById('drcom-auth-status');
			var box = document.getElementById('drcom-auth-detail');
			if (status)
				status.textContent = tr('authChecking');
			if (box)
				box.style.display = 'none';
			return fs.exec('/etc/init.d/drcom_auth', [ 'portal_status' ]).then(function(res) {
				var raw = (res && res.stdout ? res.stdout : '').trim();
				var v = {};
				raw.split('\n').forEach(function(line) {
					var eq = line.indexOf('=');
					if (eq > 0) v[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
				});
				if (status) {
					// Defensive: an "online" verdict without an account is not a
					// usable state, so do not claim online with empty fields.
					if (v.portal === 'online' && v.portal_uid)
						status.textContent = h.format(tr('statusDrcomOnlineAcct'), v.portal_uid);
					else if (v.portal === 'online')
						status.textContent = tr('statusDrcomOnline');
					else if (v.portal === 'offline')
						status.textContent = tr('statusDrcomOffline');
					else
						status.textContent = tr('statusUnknown');
				}
				if (box) {
					box.innerHTML = '';
					box.appendChild(h.casFieldRow(tr('authDetailProbe'), v.portal_probe || '(none)'));
					box.appendChild(h.casFieldRow(tr('authDetailResult'), v.portal || 'unknown'));
					box.appendChild(h.casFieldRow('uid', v.portal_uid || '(none)'));
					box.appendChild(h.casFieldRow('ip', v.portal_ip || '(none)'));
					box.appendChild(h.casFieldRow('stime', v.portal_since || '(none)'));
					box.appendChild(h.casFieldRow('etime', v.portal_until || '(none)'));
					box.appendChild(h.casFieldRow(tr('authDetailRaw'), raw));
					box.style.display = '';
				}
				// Keep the Online Auth status card in sync as well.
				h.refreshDashboard();
			}).catch(function(e) {
				if (status)
					status.textContent = tr('authFailed');
				h.showDiag(tr('authDetail'), h.execMessage(e));
			});
		};

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

		// Active account: shared with the Online Auth tab (main.active_account).
		o = s.option(form.DummyValue, '_cas_account', tr('activeAccount'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return h.accountSelectHtml(accounts);
		};

		o = s.option(form.Value, 'hscas_url', tr('casUrl'));
		o.placeholder = 'https://hscas.hstc.edu.cn';
		o.default = 'https://hscas.hstc.edu.cn';
		o.rmempty = false;

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
			return fs.exec('/etc/init.d/drcom_auth', [ 'ticket' ]).then(function(res) {
				var node = document.getElementById('drcom-auth-status');
				var message = h.execMessage(res);
				var failed = h.execFailed(res, message);
				if (node)
					node.textContent = failed
						? (tr('authFailed') + (message ? ': ' + message : ''))
						: tr('authDone');
					ui.addNotification(null, E('p', failed ? tr('authFailed') : tr('authDone')), failed ? 'error' : undefined);
				// Auth changes the session/portal state: keep the status card and
				// the CAS rows in sync, like the CAS login button does.
				h.refreshDashboard();
				h.refreshCasStatus();
			}).catch(function(e) {
				var node = document.getElementById('drcom-auth-status');
				var message = h.execMessage(e) || tr('authFailed');
				if (node)
					node.textContent = tr('authFailed') + ': ' + message;
				ui.addNotification(null, E('p', message), 'error');
				h.refreshDashboard();
				h.refreshCasStatus();
			});
		};

		o = s.option(form.DummyValue, '_auth_status', tr('authStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-auth-status">' + tr('authIdle') + '</span>';
		};

		// Refresh the Dr.COM state and show how it was decided (the portal
		// probe plus the uid/ip/session fields it read).
		o = s.option(form.Button, '_auth_check', tr('authCheck'));
		o.inputtitle = tr('refreshStatus');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return runAuthCheck();
		};

		o = s.option(form.DummyValue, '_auth_detail', tr('authDetail'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="drcom-auth-detail" class="drcom-body-box" style="display:none"></div>';
		};

		// Trace of the Dr.COM auth chain (status log + each stage's response and
		// headers) so it is visible how the authentication was diagnosed.
		o = s.option(form.Button, '_auth_trace', tr('authTrace'));
		o.inputtitle = tr('showAuthTrace');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var box = document.getElementById('drcom-auth-trace-box');
			var status = document.getElementById('drcom-auth-trace-status');
			if (status)
				status.textContent = tr('authTraceLoading');
			if (box)
				box.style.display = 'none';
			return fs.exec('/etc/init.d/drcom_auth', [ 'auth_trace' ]).then(function(res) {
				var text = (res && res.stdout ? res.stdout : '').trim();
				if (status)
					status.textContent = '';
				if (text)
					h.renderAuthTrace(text);
				else
					h.showDiag(tr('authTrace'), h.execMessage(res) || tr('authTraceEmpty'));
			}).catch(function(e) {
				if (status)
					status.textContent = '';
				h.showDiag(tr('authTrace'), h.execMessage(e));
			});
		};

		o = s.option(form.DummyValue, '_auth_trace_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-auth-trace-status" class="drcom-result"></span>' +
				'<div id="drcom-auth-trace-box" class="drcom-body-box" style="display:none"></div>';
		};

		return m.render().then(function(map) {
			var viewNode = E('div', { 'class': 'drcom-auth-view' }, [ common.style(), map ]);

			// Active account: shared with the Online Auth tab. Switching clears the
			// previous account's request/response output before refreshing.
			h.wireAccountSelect(viewNode, {
				afterSwitch: function() {
					h.clearCasOutput();
					return Promise.all([ h.refreshCasStatus(), h.loadCasRequest(), h.refreshDashboard() ]);
				}
			});

			h.refreshDashboard();
			h.refreshCasStatus();
			h.loadCasRequest();
			return viewNode;
		});
	}
});

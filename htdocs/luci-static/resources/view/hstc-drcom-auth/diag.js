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
		var diagnosticAccount = (accounts.filter(function(a) { return a.active; })[0] || accounts[0] || {}).id || '';
		var casGeneration = 0;

		// Capture the selection generation at dispatch: A -> B -> A must still
		// discard responses from the first A selection.
		var captureCasAccount = function() {
			var id = diagnosticAccount, generation = casGeneration;
			return {
				id: id,
				isCurrent: function() { return generation === casGeneration; }
			};
		};
		var refreshDiagnosticCas = function(context) {
			context = context || captureCasAccount();
			if (!context.isCurrent())
				return Promise.resolve();
			return Promise.all([
				h.refreshCasStatus(context.id, context.isCurrent),
				h.loadCasRequest(context.id, context.isCurrent)
			]);
		};

		// Query the Dr.COM portal state and render the decision details: the
		// connectivity probe result and the uid/ip/session fields that were read,
		// so it is visible how "authenticated" was decided.
		var runAuthCheck = function(scope) {
			var status = scope ? scope.querySelector('#drcom-auth-status') : document.getElementById('drcom-auth-status');
			var box = scope ? scope.querySelector('#drcom-auth-detail') : document.getElementById('drcom-auth-detail');
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
					box.appendChild(h.textRow(tr('authDetailProbe'), v.portal_probe || '(none)'));
					box.appendChild(h.textRow(tr('authDetailResult'), v.portal || 'unknown'));
					box.appendChild(h.textRow('uid', v.portal_uid || '(none)'));
					box.appendChild(h.textRow('ip', v.portal_ip || '(none)'));
					box.appendChild(h.textRow('stime', v.portal_since || '(none)'));
					box.appendChild(h.textRow('etime', v.portal_until || '(none)'));
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
				var sentence = h.diagSentence(message);
				if (node)
					node.textContent = sentence;
				h.showDiag(tr('authorizeFailed'), message);
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

		// The initial selection follows Online Auth; later changes are local.
		o = s.option(form.DummyValue, '_cas_account', tr('diagnosticAccount'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return h.accountSelectHtml(accounts);
		};

		o = s.option(form.Button, '_cas_params', tr('casParams'));
		o.inputtitle = tr('fetchCasParams');
		o.inputstyle = 'apply';
		o.onclick = function() {
			var context = captureCasAccount();
			var node = document.getElementById('drcom-cas-params-status');
			if (node)
				node.textContent = tr('casParamsFetching');
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_params', context.id ]).then(function(res) {
				if (!context.isCurrent())
					return;
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
				return refreshDiagnosticCas(context);
			}).catch(function(e) {
				if (!context.isCurrent())
					return;
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
			var context = captureCasAccount();
			var node = document.getElementById('drcom-cas-cookie-status');
			if (node)
				node.textContent = tr('casLoggingIn');
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_login', context.id ]).then(function(res) {
				if (!context.isCurrent())
					return;
				var output = (res && res.stdout ? res.stdout : '').trim();
				var message = h.execMessage(res);
				var failed = h.execFailed(res, message);
				var text = failed ? tr('casLoginFailed') + (message ? ': ' + message : '')
					: tr('casLoginDone');
				if (failed)
					h.showDiag(tr('casLoginFailed'), output || message);
				else
					ui.addNotification(null, E('p', text));
				return refreshDiagnosticCas(context);
			}).catch(function(e) {
				if (!context.isCurrent())
					return;
				var message = h.execMessage(e) || tr('casLoginFailed');
				h.showDiag(tr('casLoginFailed'), message);
				return refreshDiagnosticCas(context);
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
			return refreshDiagnosticCas();
		};

		o = s.option(form.Button, '_cas_logout', tr('casLogout'));
		o.inputtitle = tr('doCasLogout');
		o.inputstyle = 'reset';
		o.onclick = function() {
			var context = captureCasAccount();
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_logout', context.id ]).then(function() {
				if (!context.isCurrent())
					return;
				ui.addNotification(null, E('p', tr('casLogoutDone')));
				h.clearCasOutput();
				return refreshDiagnosticCas(context);
			}).catch(function(e) {
				if (!context.isCurrent())
					return;
				h.showDiag(tr('casLogout'), h.execMessage(e));
				h.clearCasOutput();
				return refreshDiagnosticCas(context);
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
			var context = captureCasAccount();
			var node = document.getElementById('drcom-auth-status');
			if (node)
				node.textContent = tr('authRunning');
			return fs.exec('/etc/init.d/drcom_auth', [ 'ticket', context.id ]).then(function(res) {
				if (!context.isCurrent())
					return;
				var node = document.getElementById('drcom-auth-status');
				var output = (res && res.stdout ? res.stdout : '').trim();
				var message = h.execMessage(res);
				var failed = h.execFailed(res, message);
				var sentence = failed ? h.diagSentence(output || message) : tr('authDone');
				if (node)
					node.textContent = sentence;
				if (failed)
					h.showDiag(tr('authFailed'), output || message);
				else
					ui.addNotification(null, E('p', sentence));
				// Auth changes the session/portal state: keep the status card and
				// the CAS rows in sync, like the CAS login button does.
				return Promise.all([ h.refreshDashboard(context.id, context.isCurrent), refreshDiagnosticCas(context) ]);
			}).catch(function(e) {
				if (!context.isCurrent())
					return;
				var node = document.getElementById('drcom-auth-status');
				var message = h.execMessage(e) || tr('authFailed');
				if (node)
					node.textContent = h.diagSentence(message);
				h.showDiag(tr('authFailed'), message);
				return Promise.all([ h.refreshDashboard(context.id, context.isCurrent), refreshDiagnosticCas(context) ]);
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
			// Expanded by default: runAuthCheck() on load fills it.
			return '<div id="drcom-auth-detail" class="drcom-body-box"></div>';
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

			// Own selection here; the shared selector keeps Online Auth's default
			// persistence behavior for callers without selectAccount.
			h.wireAccountSelect(viewNode, {
				selectAccount: function(id) {
					diagnosticAccount = id;
					casGeneration++;
					h.clearCasOutput();
					var paramsNode = document.getElementById('drcom-cas-params-status');
					var cookieNode = document.getElementById('drcom-cas-cookie-status');
					var authNode = document.getElementById('drcom-auth-status');
					if (paramsNode)
						paramsNode.textContent = tr('casParamsIdle');
					if (cookieNode)
						cookieNode.textContent = tr('casCookieUnknown');
					if (authNode)
						authNode.textContent = tr('authIdle');
				},
				afterSwitch: function() {
					return refreshDiagnosticCas();
				}
			});

			h.refreshDashboard();
			refreshDiagnosticCas();
			// This tree is still detached here; use its nodes for the first check.
			runAuthCheck(viewNode);
			return viewNode;
		});
	}
});

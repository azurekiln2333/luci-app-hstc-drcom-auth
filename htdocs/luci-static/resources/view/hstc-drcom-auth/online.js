'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require hstc-drcom-auth.common as common';

// Online Auth tab: status card, account (with one-click login), basic settings
// and network check.

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'enabled' ]).catch(function() { return ''; }),
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'accounts_list' ]).catch(function() { return ''; }),
			common.collectInterfaces()
		]);
	},

	render: function(data) {
		var m, s, o, tr = common.makeTranslator();
		var h = common.makeBaseHelpers(tr);
		var isEnabled = (data[0] || '').trim() === 'enabled';
		var accounts = common.parseAccounts(data[1]);
		var ifaceInfo = data[2] || { devices: [], logical: {}, ips: {}, current: '' };
		var ifaceDevices = ifaceInfo.devices || [];
		var ifaceLogical = ifaceInfo.logical || {};
		var ifaceIps = ifaceInfo.ips || {};
		var savedWanPort = ifaceInfo.current || '';

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));

		/* ---- status card ---- */
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

		// Manual refresh: re-read the Dr.COM portal state, the CAS session and
		// the connectivity, so the rows above can be updated on demand.
		o = s.option(form.Button, '_status_refresh', tr('refreshStatus'));
		o.inputtitle = tr('refreshStatus');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return h.refreshDashboard().then(function() {
				ui.addNotification(null, E('p', tr('statusRefreshed')));
			});
		};

		/* ---- account card (dropdown + one-click login + result) ---- */
		s = m.section(form.TypedSection, 'drcom_auth', tr('account'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_account_select', tr('activeAccount'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return h.accountSelectHtml(accounts);
		};

		o = s.option(form.DummyValue, '_account_hint', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span class="drcom-result">' + tr('accountHint') + '</span>';
		};

		o = s.option(form.Button, '_connect_now', tr('connectNow'));
		o.inputtitle = tr('connectNow');
		o.inputstyle = 'apply';
		o.description = tr('connectNowDesc');
		o.onclick = function() {
			var node = document.getElementById('drcom-connect-status');
			if (node)
				node.textContent = tr('connectRunning');
			// Manual connect is an explicit action: drop the lockout marker first so
			// the login is actually attempted.
			return fs.exec('/etc/init.d/drcom_auth', [ 'cas_clear_bad_credentials' ]).catch(function() {}).then(function() {
				return fs.exec('/etc/init.d/drcom_auth', [ 'cas_ensure' ]);
			}).then(function(res) {
				var node = document.getElementById('drcom-connect-status');
				var message = h.execMessage(res);
				var failed = h.execFailed(res, message);
				if (/^diagnosis=/m.test(message))
					failed = true;
				// Only a short sentence here; the raw output lives on the
				// Diagnostics tab.
				var text = failed
					? h.diagSentence(message) + ' ' + tr('diagSeeDiagnostics')
					: tr('connectDone');
				if (node)
					node.textContent = text;
				ui.addNotification(null, E('p', text), failed ? 'error' : undefined);
				return h.refreshCasStatus();
			}).catch(function(e) {
				var node = document.getElementById('drcom-connect-status');
				var message = h.execMessage(e) || tr('connectFailed');
				var text = h.diagSentence(message) + ' ' + tr('diagSeeDiagnostics');
				if (node)
					node.textContent = text;
				ui.addNotification(null, E('p', text), 'error');
			});
		};

		o = s.option(form.DummyValue, '_connect_status', tr('connectStatus'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<span id="drcom-connect-status" class="drcom-result">' + tr('connectIdle') + '</span>';
		};

		/* ---- basic settings ---- */
		s = m.section(form.TypedSection, 'drcom_auth', tr('basic'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.ListValue, 'wan_port', tr('wanPort'));
		o.rmempty = false;
		o.description = tr('wanPortDesc');
		var wanDevices = ifaceDevices.slice();
		(function () {
			// Keep the currently configured value selectable even if the device
			// is not present right now (offline interface), so it is never lost.
			if (savedWanPort && wanDevices.indexOf(savedWanPort) < 0)
				wanDevices.push(savedWanPort);
		})();
		wanDevices.sort().forEach(function (dev) {
			var lname = ifaceLogical[dev];
			o.value(dev, (lname && lname !== dev) ? (lname + ' (' + dev + ')') : dev);
		});
		if (!wanDevices.length)
			o.placeholder = 'eth1';

		o = s.option(form.DummyValue, '_wan_ip', tr('wanIp'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			var cur = savedWanPort || (wanDevices[0] || '');
			var ip = ifaceIps[cur] || tr('wanIpNone');
			return '<span id="drcom-wan-ip" class="drcom-result">' + h.htmlEscape(ip) + '</span>';
		};

		o = s.option(form.ListValue, 'mac_type', tr('deviceType'));
		o.value('1', tr('pc'));
		o.value('2', tr('mobile'));
		o.default = '2';
		o.description = tr('deviceTypeDesc');

		/* ---- network check ---- */
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

		return m.render().then(function(map) {
			var viewNode = E('div', { 'class': 'drcom-auth-view' }, [ common.style(), map ]);

			// WAN dropdown: show the selected interface's IPv4 below it.
			var wanSel = viewNode.querySelector('[name="wan_port"]');
			if (wanSel) {
				wanSel.addEventListener('change', function() {
					var ipNode = document.getElementById('drcom-wan-ip');
					if (ipNode)
						ipNode.textContent = ifaceIps[wanSel.value] || tr('wanIpNone');
				});
			}

			// Account dropdown: switch the active account in place.
			h.wireAccountSelect(viewNode, {
				afterSwitch: function() {
					h.clearCasOutput();
					return Promise.all([ h.refreshCasStatus(), h.refreshDashboard() ]);
				}
			});

			h.refreshDashboard();
			h.refreshCasStatus();
			return viewNode;
		});
	}
});

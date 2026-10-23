'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require poll';
'require hstc-drcom-auth.common as common';

// Settings tab: UI language, server settings, CAS public key and plugin updates.

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec_direct('/etc/init.d/drcom_auth', [ 'public_key_status' ]).catch(function(e) {
				return [ e && e.stdout, e && e.stderr, e && e.message ]
					.filter(function(v) { return v; }).join('\n').trim();
			}),
			fs.exec('/etc/init.d/drcom_auth', [ 'update_status' ]).catch(function(e) {
				return { code: 1, stdout: e && e.stdout, stderr: e && e.stderr, message: e && e.message };
			})
		]);
	},

	render: function(data) {
		var m, s, o, tr = common.makeTranslator();
		var h = common.makeBaseHelpers(tr);
		var lang = tr.lang || 'zh';
		var publicKeyStatus = (data[0] || '').trim();
		var viewNode, updateAction = false, updateGeneration = 0, statusRequest = null, scheduleRequest = null;
		var updateFields = [ 'current_version', 'latest_version', 'message', 'checked_at', 'installed_at' ];
		var updateStates = {
			idle: 'updateIdle', checking: 'updateChecking', available: 'updateAvailable',
			up_to_date: 'updateUpToDate', installing: 'updateInstalling', installed: 'updateInstalled',
			error: 'updateError', unsupported: 'updateUnsupported'
		};
		var decodeUpdate = function(res) {
			var values = h.parseDiag(res && res.stdout);
			if (!Object.prototype.hasOwnProperty.call(updateStates, values.state)) {
				values.state = 'error';
				values.message = h.execMessage(res) || tr('updateInvalidStatus');
			}
			if (res && Number(res.code || 0) !== 0) {
				if (values.state !== 'unsupported')
					values.state = 'error';
				values.message = values.message || h.execMessage(res) || tr('updateFailed');
			}
			return values;
		};
		var updateStatus = decodeUpdate(data[1]);
		var updateBusy = function() {
			return updateAction || updateStatus.state === 'checking' || updateStatus.state === 'installing';
		};
		var renderUpdateStatus = function() {
			if (!viewNode)
				return;
			updateFields.concat([ 'state' ]).forEach(function(key) {
				var node = viewNode.querySelector('#drcom-update-' + key);
				if (node)
					node.textContent = key === 'state' ? tr(updateStates[updateStatus.state])
						: updateStatus[key] || tr(key === 'message' ? 'updateNoMessage' : 'updateUnknown');
			});
			viewNode.querySelector('#drcom-update-check').disabled = updateBusy();
			viewNode.querySelector('#drcom-update-install').disabled = updateBusy() || updateStatus.state !== 'available';
		};
		var acceptUpdate = function(res) {
			var values = decodeUpdate(res);
			updateFields.concat([ 'state' ]).forEach(function(key) {
				if (values[key] != null)
					updateStatus[key] = values[key];
			});
			renderUpdateStatus();
			return values;
		};
		var updateFailure = function(error) {
			updateStatus.state = 'error';
			updateStatus.message = h.execMessage(error) || tr('updateFailed');
			renderUpdateStatus();
		};
		var refreshUpdateStatus = function() {
			if (updateAction || statusRequest)
				return statusRequest || Promise.resolve();
			var generation = updateGeneration;
			statusRequest = fs.exec('/etc/init.d/drcom_auth', [ 'update_status' ]).then(function(res) {
				if (generation === updateGeneration)
					acceptUpdate(res);
			}).catch(function(e) {
				if (generation === updateGeneration)
					updateFailure(e);
			}).then(function() { statusRequest = null; });
			return statusRequest;
		};
		var launchUpdate = function(command) {
			if (updateBusy() || (command === 'update_install' && updateStatus.state !== 'available'))
				return Promise.resolve();
			updateAction = true;
			updateGeneration++;
			updateStatus.state = command === 'update_check' ? 'checking' : 'installing';
			updateStatus.message = '';
			renderUpdateStatus();
			return fs.exec('/etc/init.d/drcom_auth', [ command ]).then(function(res) {
				var values = acceptUpdate(res);
				if (values.state === 'error' || values.state === 'unsupported')
					ui.addNotification(null, E('p', values.message || tr(updateStates[values.state])), 'error');
			}).catch(function(e) {
				updateFailure(e);
				ui.addNotification(null, E('p', updateStatus.message), 'error');
			}).then(function() {
				updateAction = false;
				renderUpdateStatus();
			});
		};

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));

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

		/* ---- CAS server: base URL and public key (global, not per account) ---- */
		s = m.section(form.TypedSection, 'drcom_auth', tr('casServer'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'hscas_url', tr('casUrl'));
		o.placeholder = 'https://hscas.hstc.edu.cn';
		o.default = 'https://hscas.hstc.edu.cn';
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

		s = m.section(form.TypedSection, 'drcom_auth', tr('server'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'drcom_server_ip', tr('serverIp'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.2.34';
		o.rmempty = false;

		o = s.option(form.Value, 'user_agent', tr('userAgent'));
		o.rmempty = false;

		s = m.section(form.TypedSection, 'drcom_auth', tr('pluginUpdates'));
		s.anonymous = true;
		s.addremove = false;
		s.description = tr('pluginUpdatesDesc');

		[ [ 'current_version', 'updateCurrentVersion' ], [ 'latest_version', 'updateLatestVersion' ],
			[ 'state', 'updateStatus' ], [ 'checked_at', 'updateLastChecked' ],
			[ 'installed_at', 'updateLastInstalled' ], [ 'message', 'updateMessage' ] ].forEach(function(field) {
			o = s.option(form.DummyValue, '_update_' + field[0], tr(field[1]));
			o.rawhtml = true;
			o.cfgvalue = function() {
				var value = field[0] === 'state' ? tr(updateStates[updateStatus.state])
					: updateStatus[field[0]] || tr(field[0] === 'message' ? 'updateNoMessage' : 'updateUnknown');
				return '<span id="drcom-update-' + field[0] + '" class="drcom-result">' + h.htmlEscape(value) + '</span>';
			};
		});

		o = s.option(form.Flag, 'auto_update', tr('autoUpdate'));
		o.default = '0';
		o.rmempty = false;
		o.description = tr('autoUpdateDesc');

		o = s.option(form.Value, 'update_hour', tr('updateHour'));
		o.datatype = 'and(uinteger,range(0,23))';
		o.default = '4';
		o.rmempty = false;
		o.depends('auto_update', '1');

		o = s.option(form.Value, 'update_minute', tr('updateMinute'));
		o.datatype = 'and(uinteger,range(0,59))';
		o.default = '0';
		o.rmempty = false;
		o.depends('auto_update', '1');

		o = s.option(form.DummyValue, '_update_actions', tr('updateActions'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<button type="button" id="drcom-update-check" class="cbi-button cbi-button-action"' + (updateBusy() ? ' disabled="disabled"' : '') + '>' + h.htmlEscape(tr('updateCheckNow')) + '</button> ' +
				'<button type="button" id="drcom-update-install" class="cbi-button cbi-button-apply"' + (updateBusy() || updateStatus.state !== 'available' ? ' disabled="disabled"' : '') + '>' + h.htmlEscape(tr('updateInstallNow')) + '</button>';
		};

		return m.render().then(function(map) {
			viewNode = E('div', { 'class': 'drcom-auth-view' }, [ common.style(), map ]);
			var select = viewNode.querySelector('#drcom-lang-select');
			if (select) {
				select.addEventListener('change', function() {
					window.localStorage.setItem('drcom-auth-lang', select.value);
					window.location.reload();
				});
			}
			// Map.save() replaces its form controls. Delegate to the stable view
			// root so both buttons still work immediately after Save & Apply.
			viewNode.addEventListener('click', function(ev) {
				if (ev.target.id === 'drcom-update-check')
					return launchUpdate('update_check');
				if (ev.target.id === 'drcom-update-install')
					return launchUpdate('update_install');
			});
			renderUpdateStatus();

			// uci-applied fires after LuCI has committed and applied configuration.
			var applySchedule = function() {
				if (!viewNode.isConnected || scheduleRequest)
					return scheduleRequest || Promise.resolve();
				scheduleRequest = fs.exec('/etc/init.d/drcom_auth', [ 'update_schedule' ]).then(function(res) {
					if (h.execFailed(res, h.execMessage(res)))
						throw res;
				}).catch(function(e) {
					ui.addNotification(null, E('p', tr('updateScheduleFailed') + ': ' + (h.execMessage(e) || tr('updateFailed'))), 'error');
				}).then(function() { scheduleRequest = null; });
				return scheduleRequest;
			};
			document.addEventListener('uci-applied', applySchedule);
			var pollStarted = false;
			var pollUpdate = function() {
				if (!viewNode.isConnected) {
					if (pollStarted) {
						poll.remove(pollUpdate);
						document.removeEventListener('uci-applied', applySchedule);
					}
					pollStarted = true;
					return Promise.resolve();
				}
				pollStarted = true;
				return refreshUpdateStatus();
			};
			poll.add(pollUpdate, 5);
			return viewNode;
		});
	}
});

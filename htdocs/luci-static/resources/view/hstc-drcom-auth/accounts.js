'use strict';
'require form';
'require fs';
'require view';
'require ui';
'require hstc-drcom-auth.common as common';

// Accounts tab: manage multiple accounts (add, delete, pick the active one).

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

		function reloadSoon() {
			window.setTimeout(function() { window.location.reload(); }, 600);
		}

		function setActive(id) {
			fs.exec('/etc/init.d/drcom_auth', [ 'account_set_active', id ]).then(function() {
				ui.addNotification(null, E('p', tr('accountSwitched')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', h.execMessage(e) || tr('accountSwitchFailed')), 'error');
			});
		}

		function removeAccount(id) {
			if (!window.confirm(tr('accountDeleteConfirm').replace('%s', id)))
				return;
			fs.exec('/etc/init.d/drcom_auth', [ 'account_delete', id ]).then(function() {
				ui.addNotification(null, E('p', tr('accountDeleted')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', h.execMessage(e) || tr('accountSaveFailed')), 'error');
			});
		}

		function addAccount(userInput, passInput) {
			var user = (userInput.value || '').trim();
			var pass = passInput.value || '';
			if (!user) {
				ui.addNotification(null, E('p', tr('accountNeedUsername')), 'error');
				return;
			}
			// The id is generated; users never supply it.
			var n = accounts.length + 1;
			var id;
			do {
				id = 'acc' + n;
				n++;
			} while (accounts.some(function(a) { return a.id === id; }));
			fs.exec('/etc/init.d/drcom_auth', [ 'account_upsert', id, user, pass ]).then(function() {
				ui.addNotification(null, E('p', tr('accountSaved')));
				reloadSoon();
			}).catch(function(e) {
				ui.addNotification(null, E('p', h.execMessage(e) || tr('accountSaveFailed')), 'error');
			});
		}

		m = new form.Map('drcom_auth', tr('title'), tr('desc'));

		s = m.section(form.TypedSection, 'drcom_auth', tr('accountsTab'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.DummyValue, '_accounts_editor', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			// Build the manager inline so it does not depend on a later DOM lookup.
			var rows = '';
			if (!accounts.length) {
				rows = '<div class="drcom-result">' + h.htmlEscape(tr('noAccounts')) + '</div>';
			} else {
				accounts.forEach(function(a) {
					rows += '<div class="drcom-acc-row">' +
						'<input type="radio" name="drcom-active-account" value="' + h.htmlEscape(a.id) + '"' +
						(a.active ? ' checked="checked"' : '') + '/>' +
						'<span class="drcom-acc-user">' + h.htmlEscape(a.username || ('(' + a.id + ')')) + '</span>' +
						'<span class="drcom-acc-id">' + h.htmlEscape(a.id) + '</span>' +
						'<button type="button" class="cbi-button cbi-button-negative" data-acc-del="' + h.htmlEscape(a.id) + '">' +
						h.htmlEscape(tr('accountDelete')) + '</button>' +
						'</div>';
				});
			}
			return '<div id="drcom-accounts-editor">' + rows + '</div>' +
				'<div class="drcom-acc-add">' +
				'<div class="drcom-body-label">' + h.htmlEscape(tr('accountAdd')) + '</div>' +
				'<input type="text" id="drcom-acc-new-user" class="cbi-input-text" placeholder="202400000000"/>' +
				'<input type="password" id="drcom-acc-new-pass" class="cbi-input-text" placeholder="' + h.htmlEscape(tr('password')) + '"/>' +
				'<button type="button" class="cbi-button cbi-button-action" id="drcom-acc-save">' + h.htmlEscape(tr('accountSave')) + '</button>' +
				'</div>';
		};

		return m.render().then(function(map) {
			var viewNode = E('div', { 'class': 'drcom-auth-view' }, [ common.style(), map ]);

			var accEditor = viewNode.querySelector('#drcom-accounts-editor');
			if (accEditor) {
				accEditor.addEventListener('change', function(ev) {
					if (ev.target && ev.target.name === 'drcom-active-account')
						setActive(ev.target.value);
				});
				accEditor.addEventListener('click', function(ev) {
					var id = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-acc-del');
					if (id)
						removeAccount(id);
				});
			}
			var saveBtn = viewNode.querySelector('#drcom-acc-save');
			if (saveBtn) {
				saveBtn.addEventListener('click', function() {
					addAccount(viewNode.querySelector('#drcom-acc-new-user'),
						viewNode.querySelector('#drcom-acc-new-pass'));
				});
			}
			return viewNode;
		});
	}
});

// Offline behavior tests. Load real LuCI modules with the same factory/instance
// contract as test_modules.cjs; only form, DOM and router RPCs are stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RES = process.env.DRCOM_TEST_RESOURCES || path.resolve(__dirname, '../htdocs/luci-static/resources');
const ACCOUNTS = 'accA\tuserA\tactive\naccB\tuserB\t-';
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

function status(id, suffix = '') {
	return 'params_currentMenu=' + id + suffix + '\nparams_failN=0\nparams_eventId=submit\n' +
		'params_captured=' + id + suffix + '\nsession=active\ncookie=valid\nCOOKIE_MTIME=' + id + suffix + '\n' +
		'\n---request---\nPOST /cas/login HTTP/1.1\nHost: cas.test.invalid\n\nusername=' + id + suffix + '&password=mock\n---end-request---\n' +
		'\n---response---\n<html>' + id + suffix + '</html>\n---end-response---';
}

function runtime() {
	const nodes = new Map(), options = new Map(), calls = [], notifications = [], pending = [];
	let hold = null, response = null, globalAccount = 'accA';
	class Node {
		constructor(tag, attrs = {}, children = []) {
			this.tag = tag; this.attrs = attrs || {}; this.children = [];
			this.style = {}; this.listeners = {}; this.value = ''; this.disabled = false;
			this.appendChild(Array.isArray(children) ? children : [children]);
		}
		appendChild(child) { if (Array.isArray(child)) this.children.push(...child); else this.children.push(child); return child; }
		set innerHTML(value) { this.children = value ? [value] : []; }
		get innerHTML() { return this.textContent; }
		set textContent(value) { this.children = [String(value)]; }
		get textContent() { return this.children.map(c => c && typeof c === 'object' ? c.textContent : String(c ?? '')).join(''); }
		querySelector(selector) { return selector[0] === '#' ? nodes.get(selector.slice(1)) || null : null; }
		addEventListener(event, listener) { this.listeners[event] = listener; }
		change(value) { this.value = value; assert(this.listeners.change, 'select has a change handler'); return this.listeners.change({target: this}); }
	}
	const E = (tag, attrs, children) => typeof attrs === 'string' || Array.isArray(attrs)
		? new Node(tag, {}, attrs) : new Node(tag, attrs, children);
	function html(value) {
		for (const match of value.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
			const node = new Node(match[1]);
			if (match[0].includes('display:none')) node.style.display = 'none';
			if (match[1] === 'select') {
				const part = value.slice(match.index).split('</select>')[0];
				const choices = [...part.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
				const selected = choices.find(c => c[2].includes('selected')) || choices[0];
				node.value = selected ? selected[1] : '';
			}
			nodes.set(match[2], node);
		}
	}
	function FormMap() {}
	FormMap.prototype.section = () => ({ option(type, name, label) {
		const option = {label, value() {}}; options.set(name, option); return option;
	} });
	FormMap.prototype.render = () => {
		for (const option of options.values()) if (option.cfgvalue) html(String(option.cfgvalue() || ''));
		return Promise.resolve(new Node('map'));
	};
	function Base() {}
	Base.extend = props => { function Derived() {} Derived.prototype = props; return Derived; };
	const stubs = {
		baseclass: Base, form: { Map: FormMap, TypedSection: {}, DummyValue: {}, Button: {}, Value: {}, ListValue: {}, Flag: {} },
		view: { extend: props => props }, network: {},
		ui: { addNotification(...args) { notifications.push(args); } },
		fs: { exec(file, args) {
			assert.equal(file, '/etc/init.d/drcom_auth'); calls.push(args.slice());
			const stdout = args[0] === 'cas_status' ? status(args.length > 1 ? args[1] : globalAccount)
				: args[0] === 'overview' ? 'network=up\ndrcom=offline' : args[0] === 'portal_status' ? 'portal=offline'
				: args[0] === 'authenticate' ? 'authenticated=1\nstage=complete\nportal=online' : '';
			const result = hold && hold(args)
				? new Promise((resolve, reject) => pending.push({args: args.slice(), resolve, reject}))
				: Promise.resolve(response && response(args) || { code: 0, stdout });
			return result.then(res => {
				if (args[0] === 'account_set_active' && !res.code) globalAccount = args[1];
				return res;
			});
		} }
	};
	const document = { getElementById: id => nodes.get(id) || null };
	function load(name) {
		if (stubs[name]) return stubs[name];
		const filename = path.join(RES, name.replace(/\./g, '/') + '.js');
		const source = fs.readFileSync(filename, 'utf8');
		const deps = [...source.matchAll(/^'require\s+(\S+?)(?:\s+as\s+(\w+))?';$/gm)];
		const factory = new Function('window', 'document', 'L', 'E', ...deps.map(m => m[2] || m[1]), source);
		const result = factory({ localStorage: { getItem: () => 'en' } }, document, {}, E, ...deps.map(m => load(m[1])));
		return stubs[name] = typeof result === 'function' ? new result() : result;
	}
	return { nodes, options, calls, notifications, pending, load, setHold: value => hold = value,
		setResponse: value => response = value,
		globalAccount: () => globalAccount,
		async render(name) {
			const view = load('view/hstc-drcom-auth/' + name);
			await view.render(name === 'diag' ? [ACCOUNTS] : ['enabled', ACCOUNTS, {}]); await tick();
			return nodes.get('drcom-account-select');
		} };
}

async function localSelectionAndCommands() {
	const r = runtime(), select = await r.render('diag');
	assert.equal(select.value, 'accA', 'Diagnostics starts with the global selection');
	r.calls.length = 0;
	select.change('accB');
	assert.equal(r.globalAccount(), 'accA', 'diagnostic selection must not change the global account');
	for (const id of ['drcom-cas-body-box', 'drcom-cas-response-box']) {
		assert.equal(r.nodes.get(id).textContent, '', 'old CAS content clears synchronously');
		assert.equal(r.nodes.get(id).style.display, 'none');
	}
	await tick();
	assert.equal(r.globalAccount(), 'accA');
	assert(!r.calls.some(c => c[0] === 'account_set_active'), 'diagnostic selection never persists the global account');
	for (const name of ['_cas_params', '_cas_login', '_cas_refresh', '_cas_logout']) {
		r.calls.length = 0;
		await r.options.get(name).onclick(); await tick();
		const cas = r.calls.filter(c => /^cas_/.test(c[0]) && c.length > 1);
		assert(cas.length, name + ' dispatches an account-specific CAS operation');
		for (const call of cas) assert.equal(call[1], 'accB', name + ' uses B for operations and readers');
		const command = { _cas_params: 'cas_params', _cas_login: 'cas_login', _cas_refresh: 'cas_status', _cas_logout: 'cas_logout' }[name];
		assert(r.calls.some(c => c[0] === command && c[1] === 'accB'), name + ' routes the command to B');
		// refreshDashboard retains its global status reader; every other reader is explicit.
		const globalReads = r.calls.filter(c => c[0] === 'cas_status' && c.length === 1).length;
		assert.equal(globalReads, r.calls.filter(c => c[0] === 'overview').length, name + ' only dashboard reads global CAS state');
	}
	assert.equal(r.globalAccount(), 'accA');
	const online = runtime(), onlineSelect = await online.render('online');
	assert.equal(onlineSelect.value, 'accA', 'opening Online Auth keeps the global A selection');
	online.calls.length = 0; onlineSelect.change('accB'); await tick();
	assert(online.calls.some(c => c[0] === 'account_set_active' && c[1] === 'accB'), 'Online Auth persists its selection');
	assert.equal(online.globalAccount(), 'accB');
	console.log('OK: local Diagnostics selection, all CAS actions/readers, and global Online Auth compatibility');
}

async function staleReaders() {
	const r = runtime(), select = await r.render('diag');
	r.setHold(args => args[0] === 'cas_status' && args.length === 2);
	const oldRefresh = r.options.get('_cas_refresh').onclick();
	select.change('accB'); await tick();
	// A second programmatic change reproduces rapid A/B/A changes while old RPCs remain in flight.
	select.change('accA'); await tick();
	assert(r.pending.length >= 5, 'status and request readers started for each selection');
	const latest = r.pending.splice(-2);
	for (const p of latest) p.resolve({stdout: status('accA', '-NEW')});
	await tick();
	const ids = ['drcom-cas-params-status', 'drcom-cas-cookie-status', 'drcom-cas-body-box', 'drcom-cas-response-box'];
	const expected = ids.map(id => r.nodes.get(id).textContent);
	assert(expected.every(text => text.includes('accA-NEW')), 'current A responses update every CAS display');
	for (const p of r.pending.splice(0)) p.resolve({stdout: status(p.args[1], '-STALE')});
	await oldRefresh; await tick();
	assert.deepEqual(ids.map(id => r.nodes.get(id).textContent), expected, 'late A and B reader responses cannot overwrite the new A generation');
	console.log('OK: stale status/request/response results ignored across A/B/A changes');
}

async function staleActions() {
	for (const command of ['cas_params', 'cas_login', 'cas_logout', 'ticket']) {
		for (const reject of [false, true]) {
			const r = runtime(), select = await r.render('diag');
			r.setHold(args => args[0] === command);
			const name = {cas_params: '_cas_params', cas_login: '_cas_login', cas_logout: '_cas_logout', ticket: '_auth'}[command];
			const action = r.options.get(name).onclick();
			select.change('accB'); await tick(); select.change('accA'); await tick();
			const ids = ['drcom-cas-params-status', 'drcom-cas-cookie-status', 'drcom-cas-body-box', 'drcom-cas-response-box', 'drcom-auth-status'];
			const expected = ids.map(id => r.nodes.get(id).textContent), count = r.notifications.length;
			const callCount = r.calls.length, p = r.pending.shift();
			assert(p, command + ' is deferred');
			if (reject) p.reject({message: 'diagnosis=bad_credentials\ncas_message=OLD ACCOUNT'});
			else p.resolve({code: 0, stdout: status('OLD ACCOUNT')});
			await action; await tick();
			assert.deepEqual(ids.map(id => r.nodes.get(id).textContent), expected, command + ' late ' + (reject ? 'error' : 'success') + ' leaves current output intact');
			assert.equal(r.notifications.length, count, command + ' does not notify about a previous selection');
			assert.equal(r.calls.length, callCount, command + ' does not trigger readers after the selection changed');
		}
	}
	console.log('OK: stale CAS action success/error callbacks ignored across A/B/A changes');
}

async function diagnosticTicketAccount() {
	const r = runtime(), select = await r.render('diag');
	select.change('accB'); await tick(); r.calls.length = 0;
	await r.options.get('_auth').onclick(); await tick();
	assert.deepEqual(r.calls.find(c => c[0] === 'ticket'), ['ticket', 'accB'], 'Dr.COM uses the same diagnostic B account as CAS');
	assert.equal(r.globalAccount(), 'accA', 'diagnostic Dr.COM does not switch the global account');
	assert(r.calls.filter(c => c[0] === 'cas_status').every(c => c[1] === 'accB'), 'post-auth status readers keep diagnostic B');
	console.log('OK: diagnostic Dr.COM ticket and completion readers use the selected local account');
}

const authenticated = 'authenticated=1\nstage=complete\nportal=online';
const connectDone = 'Dr.COM authenticated and connectivity verified.';

async function oneclickFlow() {
	const r = runtime(), select = await r.render('online');
	r.setHold(args => ['account_set_active', 'authenticate'].includes(args[0]));
	r.calls.length = 0; select.change('accB'); await tick();
	assert.equal(r.globalAccount(), 'accA', 'active-account write is still pending');
	const button = {disabled: false}, action = r.options.get('_connect_now').onclick({currentTarget: button});
	await tick();
	assert.deepEqual(r.calls.filter(c => c[0] === 'authenticate'), [['authenticate', 'accB']], 'full flow captures B before the active-account write completes');
	assert(button.disabled, 'connect button is disabled while authentication runs');
	assert.equal(r.options.get('_connect_now').onclick(), action, 'duplicate clicks share one pending operation');
	assert(!r.calls.some(c => ['cas_ensure', 'cas_clear_bad_credentials'].includes(c[0])), 'frontend never substitutes a CAS-cookie shortcut for full authentication');
	r.pending.find(p => p.args[0] === 'authenticate').resolve({code: 0, stdout: 'diagnosis=already logged in\n' + authenticated});
	await action; await tick();
	assert.equal(r.nodes.get('drcom-connect-status').textContent, connectDone, 'complete Dr.COM protocol permits success even after an already-logged-in CAS message');
	assert(!button.disabled, 'connect button is restored after completion');
	assert(r.calls.some(c => c[0] === 'overview'), 'completion refreshes real Dr.COM/connectivity status');
	assert(r.calls.filter(c => c[0] === 'cas_status').every(c => c[1] === 'accB'), 'completion CAS reads capture B while global account is still A');
	r.pending.find(p => p.args[0] === 'account_set_active').resolve({code: 0, stdout: ''}); await tick();
	assert.equal(r.globalAccount(), 'accB');
	console.log('OK: one-click full backend flow, pending account switch, duplicate guard, exact success protocol and status refresh');
}

async function oneclickFailures() {
	for (const result of [
		{code: 1, stdout: 'stage=cas_login\ndiagnosis=bad_credentials'},
		{code: 1, stdout: authenticated},
		{code: 0, stdout: ''},
		{code: 0, stdout: 'authenticated=1\nportal=online'},
		{code: 0, stdout: 'authenticated=1\nportal=offline'},
		{code: 0, stdout: 'portal=online'}
	]) {
		const r = runtime(); await r.render('online'); r.calls.length = 0;
		r.setResponse(args => args[0] === 'authenticate' ? result : null);
		await r.options.get('_connect_now').onclick(); await tick();
		assert.notEqual(r.nodes.get('drcom-connect-status').textContent, connectDone, 'failed or incomplete protocol never reports connected');
		assert.equal(r.notifications.at(-1)[2], 'error', 'failure produces an error notification');
		assert(r.calls.some(c => c[0] === 'overview'), 'failure also refreshes real connectivity');
		assert(r.calls.some(c => c[0] === 'cas_status' && c[1] === 'accA'), 'failure refreshes the captured CAS account');
	}
	const r = runtime(); await r.render('online');
	r.setHold(args => args[0] === 'authenticate');
	const action = r.options.get('_connect_now').onclick(); await tick();
	r.pending[0].reject({message: 'RPC transport failed'});
	await action; await tick();
	assert.notEqual(r.nodes.get('drcom-connect-status').textContent, connectDone);
	assert.equal(r.notifications.at(-1)[2], 'error');
	console.log('OK: backend failure, empty/incomplete success, offline verdict and RPC errors cannot report one-click success');
}

async function staleOneclick() {
	for (const reject of [false, true]) {
		const r = runtime(), select = await r.render('online');
		r.setHold(args => args[0] === 'authenticate');
		const action = r.options.get('_connect_now').onclick();
		select.change('accB'); await tick(); select.change('accA'); await tick();
		const expected = r.nodes.get('drcom-connect-status').textContent, notificationCount = r.notifications.length, callCount = r.calls.length;
		if (reject) r.pending[0].reject({message: 'old account error'});
		else r.pending[0].resolve({code: 0, stdout: authenticated});
		await action; await tick();
		assert.equal(r.nodes.get('drcom-connect-status').textContent, expected, 'old one-click result does not overwrite the new selection');
		assert.equal(r.notifications.length, notificationCount, 'old one-click result does not notify the new selection');
		assert.equal(r.calls.length, callCount, 'old one-click result does not start stale status readers');
	}
	console.log('OK: one-click success and failure responses are ignored after A/B/A changes');
}

(async () => {
	await localSelectionAndCommands();
	await oneclickFlow();
	await staleReaders();
	await staleActions();
	await diagnosticTicketAccount();
	await oneclickFailures();
	await staleOneclick();
})().catch(error => { console.error(error); process.exitCode = 1; });

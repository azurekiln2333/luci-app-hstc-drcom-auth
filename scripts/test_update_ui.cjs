// Offline tests load the real LuCI views and shared module. Document lookups
// deliberately cannot see detached render trees, matching the browser lifecycle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RES = process.env.DRCOM_TEST_RESOURCES || path.resolve(__dirname, '../htdocs/luci-static/resources');
const tick = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const update = (state, extra = {}) => ({ code: 0, stdout: Object.entries({
	state, current_version: '2.3.1-1', latest_version: '2.4.0-1', message: '', checked_at: '2026-10-23 04:00:00 CST', installed_at: '', ...extra
}).map(([key, value]) => key + '=' + value).join('\n') });

function runtime(lang = 'en') {
	const options = new Map(), calls = [], notifications = [], replies = new Map(), polls = new Map(), listeners = new Map();
	let documentRoot, formMap;
	class Node {
		constructor(tag, attrs = {}, children = []) {
			this.tag = tag; this.attrs = attrs || {}; this.children = []; this.parentNode = null;
			this.style = {}; this.listeners = {}; this.disabled = attrs.disabled != null; this.value = attrs.value || '';
			this.appendChild(children);
		}
		appendChild(child) {
			if (Array.isArray(child)) child.forEach(value => this.appendChild(value));
			else if (child != null) { this.children.push(child); if (typeof child === 'object') child.parentNode = this; }
			return child;
		}
		set textContent(value) { this.children = [String(value)]; }
		get textContent() { return this.children.map(child => typeof child === 'object' ? child.textContent : String(child)).join(''); }
		set innerHTML(value) { this.children = []; if (value) this.appendChild(parseHtml(value).children); }
		get innerHTML() { return this.textContent; }
		get isConnected() { return this === documentRoot || !!(this.parentNode && this.parentNode.isConnected); }
		get id() { return this.attrs.id || ''; }
		querySelector(selector) {
			assert(selector.startsWith('#'), 'test selector is an id');
			for (const child of this.children) if (child instanceof Node) {
				if (child.attrs.id === selector.slice(1)) return child;
				const result = child.querySelector(selector); if (result) return result;
			}
			return null;
		}
		addEventListener(event, listener) { this.listeners[event] = listener; }
		click() {
			for (let node = this; node; node = node.parentNode) if (node.listeners.click) return node.listeners.click({target: this});
			assert.fail('button has a click listener on itself or an ancestor');
		}
	}
	const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"})[entity]);
	function parseHtml(source) {
		const root = new Node('fragment'), stack = [root];
		for (const token of String(source).match(/<[^>]*>|[^<]+/g) || []) {
			if (token.startsWith('</')) { stack.pop(); continue; }
			if (!token.startsWith('<')) { stack.at(-1).appendChild(decode(token)); continue; }
			const tag = token.match(/^<([\w-]+)/); if (!tag) continue;
			const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
			const node = new Node(tag[1], attrs);
			if (/display:\s*none/.test(attrs.style || '')) node.style.display = 'none';
			stack.at(-1).appendChild(node);
			if (!/^(input|br|hr|img)$/.test(tag[1])) stack.push(node);
		}
		return root;
	}
	documentRoot = new Node('document');
	const document = {
		getElementById: id => documentRoot.querySelector('#' + id),
		addEventListener(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
		removeEventListener(event, listener) { listeners.get(event)?.delete(listener); }
	};
	const E = (tag, attrs, children) => typeof attrs === 'string' || Array.isArray(attrs)
		? new Node(tag, {}, attrs) : new Node(tag, attrs, children);
	function FormMap() { formMap = this; }
	FormMap.prototype.section = () => ({ option(type, name, label) {
		const option = { type, label, dependencies: [], value() {}, depends(...args) { this.dependencies.push(args); } };
		options.set(name, option); return option;
	} });
	FormMap.prototype.render = () => {
		const map = new Node('map');
		for (const option of options.values()) if (option.cfgvalue) map.appendChild(parseHtml(option.cfgvalue()).children);
		return Promise.resolve(map);
	};
	function Base() {}
	Base.extend = props => { function Derived() {} Derived.prototype = props; return Derived; };
	const stubs = {
		baseclass: Base, form: { Map: FormMap, TypedSection: {}, DummyValue: {}, Button: {}, Value: {}, Flag: {} },
		view: { extend: props => props }, network: {},
		ui: { addNotification(...args) { notifications.push(args); } },
		poll: { add(fn, interval) { polls.set(fn, interval); }, remove(fn) { polls.delete(fn); } },
		fs: {
			exec_direct(file, args) { assert.equal(file, '/etc/init.d/drcom_auth'); return Promise.resolve(args[0] === 'accounts_list' ? 'accA\talice\tactive' : ''); },
			exec(file, args) {
				assert.equal(file, '/etc/init.d/drcom_auth'); calls.push(args.slice());
				if (replies.has(args[0])) { const reply = replies.get(args[0]); return typeof reply === 'function' ? reply(args) : Promise.resolve(reply); }
				return Promise.resolve(args[0] === 'update_status' ? update('idle') : {code: 0, stdout: args[0] === 'overview' ? 'network=up\ndrcom=offline' : ''});
			}
		}
	};
	function load(name) {
		if (stubs[name]) return stubs[name];
		const source = fs.readFileSync(path.join(RES, name.replace(/\./g, '/') + '.js'), 'utf8');
		const deps = [...source.matchAll(/^'require\s+(\S+?)(?:\s+as\s+(\w+))?';$/gm)];
		const factory = new Function('window', 'document', 'navigator', 'L', 'E', ...deps.map(match => match[2] || match[1]), source);
		const result = factory({localStorage: {getItem: () => lang}}, document, {language: lang}, {}, E, ...deps.map(match => load(match[1])));
		return stubs[name] = typeof result === 'function' ? new result() : result;
	}
	return {
		options, calls, notifications, replies, polls, listeners, load, document,
		async open(name) { const view = load('view/hstc-drcom-auth/' + name); return view.render(await view.load()); },
		attach(root) { documentRoot.appendChild(root); },
		detach(root) { documentRoot.children = documentRoot.children.filter(child => child !== root); root.parentNode = null; },
		async rerender(root) {
			const map = root.children.find(child => child.tag === 'map'), fresh = await formMap.render();
			for (const child of map.children) if (typeof child === 'object') child.parentNode = null;
			map.children = []; map.appendChild(fresh.children);
		},
		async poll() { await Promise.all([...polls.keys()].map(fn => fn())); await tick(); },
		async dispatch(event) { await Promise.all([...(listeners.get(event) || [])].map(fn => fn())); await tick(); }
	};
}

async function initialAndConfiguration() {
	for (const lang of ['zh', 'zh-tw', 'en']) {
		const r = runtime(lang);
		r.replies.set('update_status', update('available', {message: '<img src=x onerror=alert(1)>'}));
		const root = await r.open('settings'), node = key => root.querySelector('#drcom-update-' + key);
		assert.equal(r.document.getElementById('drcom-update-state'), null, 'rendered tree is detached');
		assert.equal(node('current_version').textContent, '2.3.1-1', 'initial data renders before attachment');
		assert.equal(node('latest_version').textContent, '2.4.0-1');
		assert.equal(node('message').textContent, '<img src=x onerror=alert(1)>', 'remote message remains text');
		assert.equal(node('message').children.some(child => child.tag === 'img'), false);
		assert.equal(node('install').disabled, false);
		assert.equal(r.options.get('auto_update').default, '0', 'automatic installation is opt in');
		assert.equal(r.options.get('update_hour').default, '4');
		assert.equal(r.options.get('update_hour').datatype, 'and(uinteger,range(0,23))');
		assert.equal(r.options.get('update_minute').default, '0');
		assert.equal(r.options.get('update_minute').datatype, 'and(uinteger,range(0,59))');
		assert.deepEqual(r.options.get('update_hour').dependencies, [['auto_update', '1']]);
		assert(!/^(updateAvailable|updateCheckNow|autoUpdate)$/.test(node('state').textContent), 'translated state is available');
		const count = r.calls.length; await r.poll(); assert.equal(r.calls.length, count, 'poll skips initial detached tree');
		r.attach(root); await r.poll(); assert.equal(r.calls.length, count + 1);
		assert.equal([...r.polls.values()][0], 5, 'progress polls use a bounded interval');
	}
	console.log('OK: initial update data, three languages, safe text and validated opt-in schedule');
}

async function actionAndProgress() {
	const r = runtime(), root = await r.open('settings'), node = key => root.querySelector('#drcom-update-' + key);
	r.attach(root);
	const check = deferred(); r.replies.set('update_check', () => check.promise);
	const checking = node('check').click();
	assert.match(node('state').textContent, /Checking/); assert(node('check').disabled && node('install').disabled);
	await node('check').click(); assert.equal(r.calls.filter(call => call[0] === 'update_check').length, 1, 'duplicate check does not launch');
	check.resolve(update('available')); await checking;
	assert.equal(node('install').disabled, false);
	const previousButton = node('install'); await r.rerender(root);
	assert.notEqual(node('install'), previousButton, 'Save & Apply replaces map controls');
	r.replies.set('update_install', update('installing'));
	await node('install').click();
	assert.match(node('state').textContent, /Installing/); assert(node('check').disabled && node('install').disabled);
	await node('install').click(); assert.equal(r.calls.filter(call => call[0] === 'update_install').length, 1, 'background install remains guarded');
	r.replies.set('update_status', update('installed', {current_version: '2.4.0-1', installed_at: '2026-10-23 04:01:00 CST'}));
	await r.poll();
	assert.match(node('state').textContent, /installed/); assert.equal(node('current_version').textContent, '2.4.0-1');
	assert.equal(node('installed_at').textContent, '2026-10-23 04:01:00 CST');
	assert.equal(node('check').disabled, false); assert.equal(node('install').disabled, true);
	console.log('OK: check, asynchronous install after form rerender, duplicate guards and polled completion');
}

async function failuresAndStaleReads() {
	const r = runtime(), root = await r.open('settings'), node = key => root.querySelector('#drcom-update-' + key);
	r.attach(root);
	const oldStatus = deferred(); r.replies.set('update_status', () => oldStatus.promise);
	const polling = r.poll(); r.replies.set('update_check', update('available'));
	await node('check').click(); oldStatus.resolve(update('up_to_date')); await polling;
	assert.match(node('state').textContent, /available/, 'old status response cannot overwrite a new action');
	r.replies.set('update_install', {...update('available', {message: 'download refused'}), code: 1});
	await node('install').click(); assert.match(node('state').textContent, /failed/);
	assert.equal(node('message').textContent, 'download refused', 'nonzero command code is an error');
	assert.equal(r.notifications.at(-1)[2], 'error');
	r.replies.set('update_check', () => Promise.reject({message: 'RPC disconnected'}));
	await node('check').click(); assert.equal(node('message').textContent, 'RPC disconnected');
	assert.equal(node('check').disabled, false, 'rejected check releases its action guard');
	r.replies.set('update_status', () => Promise.reject({message: 'status unavailable'}));
	const count = r.notifications.length; await r.poll();
	assert.equal(node('message').textContent, 'status unavailable'); assert.equal(r.notifications.length, count, 'poll failures do not spam notifications');
	for (const response of [{...update('unsupported', {message: 'opkg missing'}), code: 1}, {code: 0, stdout: ''}]) {
		const other = runtime(); other.replies.set('update_status', response); const tree = await other.open('settings');
		assert.equal(tree.querySelector('#drcom-update-install').disabled, true);
		assert.match(tree.querySelector('#drcom-update-state').textContent, /support|failed/);
	}
	console.log('OK: command and RPC errors, unsupported systems, malformed status and stale poll protection');
}

async function committedScheduleAndCleanup() {
	const r = runtime(), root = await r.open('settings'); r.attach(root); await r.poll();
	assert.equal(r.calls.filter(call => call[0] === 'update_schedule').length, 0, 'render and polling never apply a schedule');
	const schedule = deferred(); r.replies.set('update_schedule', () => schedule.promise);
	const first = r.dispatch('uci-applied'), second = r.dispatch('uci-applied');
	assert.equal(r.calls.filter(call => call[0] === 'update_schedule').length, 1, 'committed apply syncs once while pending');
	schedule.resolve({code: 1, stderr: 'cron write failed'}); await Promise.all([first, second]);
	assert.equal(r.notifications.at(-1)[2], 'error'); assert.match(r.notifications.at(-1)[1].textContent, /cron write failed/);
	r.detach(root); await r.poll();
	assert.equal(r.polls.size, 0); assert.equal(r.listeners.get('uci-applied').size, 0, 'leaving page removes update handlers');
	console.log('OK: schedule sync only after committed apply, failure reporting and page cleanup');
}

async function detachedVerdict() {
	for (const verdict of ['online', 'offline', 'error']) {
		const r = runtime(), initial = deferred();
		r.replies.set('portal_status', () => initial.promise);
		r.replies.set('overview', {code: 0, stdout: 'network=up\ndrcom=' + verdict + (verdict === 'online' ? '\naccount=alice' : '')});
		const root = await r.open('diag'), detail = root.querySelector('#drcom-auth-detail'), status = root.querySelector('#drcom-auth-status');
		assert.equal(r.document.getElementById('drcom-auth-detail'), null, 'initial verdict RPC dispatches before document attachment');
		r.attach(root); await tick();
		if (verdict === 'error') {
			initial.reject({message: 'portal RPC failed'}); await tick(); assert.match(status.textContent, /failed/);
			assert.match(root.querySelector('#drcom-cas-body-box').textContent, /portal RPC failed/, 'initial error keeps raw diagnostic details');
			assert(r.notifications.some(item => item[2] === 'error'), 'initial error path still notifies');
		} else {
			initial.resolve({code: 0, stdout: 'portal=' + verdict + '\nportal_probe=probe-' + verdict + '\nportal_uid=' + (verdict === 'online' ? 'alice' : '') + '\nportal_ip=192.0.2.1'});
			await tick();
			assert.equal(detail.style.display, '', 'initial detail opens'); assert.match(detail.textContent, new RegExp('probe-' + verdict));
			assert.match(detail.textContent, /192\.0\.2\.1/); assert.match(status.textContent, verdict === 'online' ? /alice/ : /Offline/);
		}
		r.replies.set('portal_status', {code: 0, stdout: 'portal=offline\nportal_probe=manual-refresh'});
		await r.options.get('_auth_check').onclick(); await tick();
		assert.match(detail.textContent, /manual-refresh/, 'manual refresh still uses the attached document'); assert.equal(detail.style.display, '');
	}
	console.log('OK: detached initial online/offline verdicts, initial RPC error and manual refresh');
}

(async () => {
	await initialAndConfiguration();
	await actionAndProgress();
	await failuresAndStaleReads();
	await committedScheduleAndCleanup();
	await detachedVerdict();
})().catch(error => { console.error(error); process.exitCode = 1; });

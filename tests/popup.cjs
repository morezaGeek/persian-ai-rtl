const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..', 'ai-rtl');
const hostsSource = fs.readFileSync(path.join(root, 'hosts.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

function openPopup(data = {}, url = 'https://gemini.google.com/app', errors = {}) {
  const elements = new Map();
  const writes = [];
  const messages = [];
  const runtime = { lastError: undefined };
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', checked: false, disabled: false, hidden: false,
      listeners: {}, attributes: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      emit(name) { if (!this.disabled && this.listeners[name]) this.listeners[name]({ target: this }); }
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    URL,
    document: { getElementById: element },
    chrome: {
      runtime,
      tabs: { query(options, callback) {
        runtime.lastError = errors.tab ? { message: 'Tab unavailable' } : undefined;
        callback(url ? [{ id: 23, url }] : []);
        runtime.lastError = undefined;
      }, sendMessage(id, message, callback) { messages.push({ id, ...structuredClone(message) }); callback(); } },
      storage: { sync: {
        get(defaults, callback) {
          runtime.lastError = errors.read ? { message: 'Read failed' } : undefined;
          callback({ ...defaults, ...structuredClone(data) });
          runtime.lastError = undefined;
        },
        set(patch, callback) {
          writes.push(structuredClone(patch));
          runtime.lastError = errors.write ? { message: 'Write failed' } : undefined;
          if (!errors.write) Object.assign(data, structuredClone(patch));
          callback();
          runtime.lastError = undefined;
        }
      } }
    }
  });
  vm.runInContext(hostsSource, context, { filename: 'hosts.js' });
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  return { element, writes, messages, context };
}

test('slider previews actual tab and all frames before committing; reset previews 100%', () => {
  const popup = openPopup({ fontSizes: { 'antigravity.google.com': 105 } }, 'https://antigravity.google.com/r/conversation');
  popup.element('fontSize').value = '165';
  popup.element('fontSize').emit('input');
  assert.deepEqual(popup.messages.at(-1), { id: 23, type: 'vzx-font-scale-preview', host: 'antigravity.google.com', value: 165 });
  assert.equal(popup.writes.length, 0);
  popup.element('fontSize').emit('change');
  assert.equal(popup.writes[0].fontSizes['antigravity.google.com'], 165);
  popup.element('resetFontSize').emit('click');
  assert.equal(popup.messages.at(-1).value, 100);
});

test('Google Search is a default site without enabling other Google pages or apps', () => {
  const data = {};
  const search = openPopup(data, 'https://www.google.com/search?q=sample');
  assert.match(search.element('status').textContent, /✓/);
  search.element('toggleSite').emit('click');
  assert.deepEqual(data.disabledHosts, ['google.com']);
  search.element('toggleSite').emit('click');
  assert.deepEqual(data.disabledHosts, []);
  assert.equal(data.customHosts?.includes('google.com') ?? false, false);
  for (const url of ['https://www.google.com/preferences', 'https://mail.google.com/mail/u/0/', 'https://drive.google.com/']) {
    assert.doesNotMatch(openPopup({}, url).element('status').textContent, /✓/);
  }
});

test('Gemini and Antigravity sizes persist independently across popup reopen', () => {
  const data = { fontSizes: { 'antigravity.google.com': 120 } };
  const gemini = openPopup(data, 'https://WWW.GEMINI.GOOGLE.COM/app');
  assert.equal(gemini.element('host').textContent, 'gemini.google.com');
  const slider = gemini.element('fontSize');
  for (let value = 60; value <= 85; value += 5) {
    slider.value = value;
    slider.emit('input');
  }
  assert.equal(gemini.element('fontSizeValue').textContent, '85%');
  assert.equal(gemini.writes.length, 0, 'dragging must not consume sync write quota');
  slider.emit('change');
  assert.equal(gemini.writes.length, 1);
  assert.equal(data.fontSizes['gemini.google.com'], 85);
  assert.equal(data.fontSizes['antigravity.google.com'], 120);
  assert.equal(openPopup(data).element('fontSize').value, '85');

  const antigravity = openPopup(data, 'https://antigravity.google.com/r/conversation');
  assert.equal(antigravity.element('fontSize').value, '120');
  assert.match(antigravity.element('status').textContent, /✓/);
  antigravity.element('fontSize').value = 135;
  antigravity.element('fontSize').emit('change');
  assert.equal(data.fontSizes['antigravity.google.com'], 135);
  assert.equal(data.fontSizes['gemini.google.com'], 85);

  const reopened = openPopup(data);
  reopened.element('resetFontSize').emit('click');
  assert.equal(Object.hasOwn(data.fontSizes, 'gemini.google.com'), false);
  assert.equal(data.fontSizes['antigravity.google.com'], 135);
  assert.equal(reopened.element('fontSizeValue').textContent, '100%');
  assert.equal(reopened.element('resetFontSize').disabled, true);
});

test('old settings without sizes still load and toggles preserve size entries', () => {
  const old = openPopup({ enabled: true, latinToo: true, customHosts: ['custom.example'] });
  assert.equal(old.element('fontSize').value, '100');
  assert.equal(old.element('latinToo').checked, true);
  const data = { fontSizes: { 'gemini.google.com': 90, 'antigravity.google.com': 125 } };
  const popup = openPopup(data);
  popup.element('latinToo').checked = true;
  popup.element('latinToo').emit('change');
  assert.equal(data.latinToo, true);
  assert.deepEqual(data.fontSizes, { 'gemini.google.com': 90, 'antigravity.google.com': 125 });
  assert.deepEqual(popup.writes[0], { latinToo: true });
});

test('unsupported or inaccessible tabs disable site controls but keep global controls', () => {
  for (const [url, errors] of [['chrome://extensions/', {}], [undefined, {}], ['https://gemini.google.com', { tab: true }]]) {
    const popup = openPopup({}, url || '', errors);
    assert.equal(popup.element('fontSize').disabled, true);
    assert.equal(popup.element('resetFontSize').disabled, true);
    assert.equal(popup.element('toggleSite').disabled, true);
    assert.equal(popup.element('enabled').disabled, false);
    for (const id of ['persianFont', 'englishFont']) assert.equal(popup.element(id).disabled, false);
  }
});

test('independent font choices persist across hosts and preserve per-site sizes', () => {
  const data = { fontSizes: { 'gemini.google.com': 90 }, latinToo: false };
  const popup = openPopup(data);
  assert.equal(popup.element('persianFont').value, 'vazirmatn');
  assert.equal(popup.element('englishFont').value, 'site');
  popup.element('persianFont').value = 'tahoma';
  popup.element('persianFont').emit('change');
  popup.element('englishFont').value = 'georgia';
  popup.element('englishFont').emit('change');
  assert.deepEqual(popup.writes, [{ persianFont: 'tahoma' }, { englishFont: 'georgia' }]);
  assert.deepEqual(data.fontSizes, { 'gemini.google.com': 90 });
  assert.equal(data.latinToo, false, 'legacy preference survives for older extension versions');
  const reopened = openPopup(data, 'https://antigravity.google.com/r/conversation');
  assert.equal(reopened.element('persianFont').value, 'tahoma');
  assert.equal(reopened.element('englishFont').value, 'georgia');
});

test('font controls migrate legacy Latin preference and show validated choices', () => {
  assert.equal(openPopup({ latinToo: true }).element('englishFont').value, 'vazirmatn');
  assert.equal(openPopup({ latinToo: false }).element('englishFont').value, 'site');
  assert.equal(openPopup({ latinToo: true, englishFont: 'site' }).element('englishFont').value, 'site');
  const invalid = openPopup({ persianFont: 'unknown', englishFont: 'unknown' });
  assert.equal(invalid.element('persianFont').value, 'vazirmatn');
  assert.equal(invalid.element('englishFont').value, 'site');
});

test('font storage failures restore dropdowns and display error; read failures disable both', () => {
  const data = { persianFont: 'arial', englishFont: 'georgia' };
  const popup = openPopup(data, undefined, { write: true });
  for (const id of ['persianFont', 'englishFont']) {
    popup.element(id).value = 'segoe-ui';
    popup.element(id).emit('change');
    assert.equal(popup.element(id).value, data[id]);
    assert.match(popup.element('error').textContent, /ذخیره نشد/);
  }
  const failedRead = openPopup(data, undefined, { read: true });
  for (const id of ['persianFont', 'englishFont']) assert.equal(failedRead.element(id).disabled, true);
});

test('sync write failure is visible and restores the persisted value', () => {
  const data = { fontSizes: { 'gemini.google.com': 90 } };
  const popup = openPopup(data, undefined, { write: true });
  popup.element('fontSize').value = 120;
  popup.element('fontSize').emit('change');
  assert.equal(popup.element('fontSize').value, '90');
  assert.equal(data.fontSizes['gemini.google.com'], 90);
  assert.equal(popup.element('error').hidden, false);
  assert.match(popup.element('error').textContent, /ذخیره نشد/);
});

test('sync read failure blocks changes instead of overwriting unknown settings', () => {
  const popup = openPopup({ fontSizes: { 'gemini.google.com': 90 } }, undefined, { read: true });
  assert.equal(popup.element('enabled').disabled, true);
  assert.equal(popup.element('fontSize').disabled, true);
  assert.equal(popup.element('error').hidden, false);
  assert.equal(popup.writes.length, 0);
});

test('size lookup validates values, clamps boundaries and never inherits parent or sibling hosts', () => {
  const { context } = openPopup();
  const lookup = (hostname, fontSizes) => {
    context.testHost = hostname;
    context.testSizes = fontSizes;
    return vm.runInContext('vzxFontScale(testHost, { fontSizes: testSizes })', context);
  };
  assert.equal(lookup(' WWW.GEMINI.GOOGLE.COM ', { 'gemini.google.com': 85 }), 85);
  assert.equal(lookup('antigravity.google.com', { 'google.com': 80, 'gemini.google.com': 90 }), 100);
  assert.equal(lookup('child.gemini.google.com', { 'gemini.google.com': 90 }), 100);
  for (const invalid of [null, '85', NaN, Infinity, {}, []]) {
    assert.equal(lookup('gemini.google.com', { 'gemini.google.com': invalid }), 100);
  }
  assert.equal(lookup('gemini.google.com', { 'gemini.google.com': 1 }), 60);
  assert.equal(lookup('gemini.google.com', { 'gemini.google.com': 999 }), 200);
  for (const invalidMap of [null, '85', []]) assert.equal(lookup('gemini.google.com', invalidMap), 100);
});

test('official Antigravity frame uses the outer site size and toggle settings', () => {
  const data = { fontSizes: { 'antigravity.google.com': 125, 'gemini.google.com': 85 } };
  const popup = openPopup(data, 'https://antigravity.static.usercontent.goog/web/cli-1.4.5/');
  assert.equal(popup.element('host').textContent, 'antigravity.google.com');
  assert.equal(popup.element('fontSize').value, '125');
  popup.element('toggleSite').emit('click');
  assert.deepEqual(data.disabledHosts, ['antigravity.google.com']);
  assert.equal(data.fontSizes['gemini.google.com'], 85);
  popup.element('fontSize').value = 130;
  popup.element('fontSize').emit('change');
  assert.equal(data.fontSizes['antigravity.google.com'], 130);
  assert.equal(data.fontSizes['antigravity.static.usercontent.goog'], undefined);
});

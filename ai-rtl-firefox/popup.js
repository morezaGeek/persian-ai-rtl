const $ = (id) => document.getElementById(id);
let settings = { ...VZX_DEFAULT_SETTINGS, fontSizes: {} };
let host = '';
let pathname = '';
let tabId = null;
let ready = false;
let saving = false;

function showError(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function isActive() {
  if (!settings.enabled || !host) return false;
  if (vzxMatch(host, settings.disabledHosts)) return false;
  return settings.allSites || vzxIsDefaultSite(host, pathname) || vzxMatch(host, settings.customHosts);
}

function save(patch) {
  if (!ready || saving) return;
  const previous = settings;
  settings = { ...settings, ...patch };
  saving = true;
  showError();
  render();
  const complete = (failed) => {
    if (failed) {
      settings = previous;
      previewScale(vzxFontScale(host, previous));
      showError('تنظیمات ذخیره نشد؛ دوباره تلاش کنید.');
    }
    saving = false;
    render();
  };
  try {
    chrome.storage.sync.set(patch, () => complete(!!chrome.runtime.lastError));
  } catch (e) {
    complete(true);
  }
}

function renderScale(value) {
  $('fontSize').value = String(value);
  $('fontSizeValue').textContent = `${value}%`;
  $('fontSize').setAttribute('aria-valuetext', `${value} درصد`);
}

function previewScale(value) {
  if (!host || !Number.isInteger(tabId) || !chrome.tabs.sendMessage) return;
  try {
    // With no frameId, Chrome delivers this to the tab's content-script frames,
    // including Antigravity's different-origin chat document.
    chrome.tabs.sendMessage(tabId, { type: 'vzx-font-scale-preview', host, value }, () => {
      if (chrome.runtime.lastError) showError('برای اعمال اندازه، صفحهٔ سایت را یک‌بار رفرش کنید.');
    });
  } catch (e) { /* Saving still works when the page cannot receive previews. */ }
}

function render() {
  const busy = !ready || saving;
  for (const id of ['enabled', 'latinToo', 'allSites']) {
    $(id).checked = !!settings[id];
    $(id).disabled = busy;
  }
  const fonts = vzxFontChoices(settings);
  for (const [id, value] of [['persianFont', fonts.persian], ['englishFont', fonts.english]]) {
    $(id).value = value;
    $(id).disabled = busy;
  }
  renderScale(vzxFontScale(host, settings));
  $('fontSize').disabled = busy || !host;
  $('resetFontSize').disabled = busy || !host || !Object.prototype.hasOwnProperty.call(settings.fontSizes, host);

  const btn = $('toggleSite');
  if (!host) {
    $('host').textContent = 'این صفحه پشتیبانی نمی‌شود';
    $('status').textContent = '';
    $('status').className = 'status';
    btn.disabled = true;
    btn.textContent = '—';
    return;
  }
  $('host').textContent = host;
  const active = isActive();
  $('status').textContent = !settings.enabled ? 'افزونه خاموش است' : active ? 'روی این سایت فعال است ✓' : 'روی این سایت غیرفعال است';
  $('status').className = 'status' + (active ? ' on' : '');
  btn.disabled = busy || !settings.enabled;
  btn.textContent = active ? 'غیرفعال کردن برای این سایت' : 'فعال کردن برای این سایت';
}

function toggleSite() {
  if (!host || !settings.enabled) return;
  const strip = (list) => list.filter((h) => vzxNormalizeHost(h) !== host);
  if (isActive()) {
    save({ disabledHosts: [...strip(settings.disabledHosts), host], customHosts: strip(settings.customHosts) });
  } else {
    const patch = { disabledHosts: strip(settings.disabledHosts) };
    if (!settings.allSites && !vzxIsDefaultSite(host, pathname)) patch.customHosts = [...strip(settings.customHosts), host];
    save(patch);
  }
}

function setFontScale(reset = false) {
  if (!host) return;
  const fontSizes = { ...settings.fontSizes };
  if (reset) {
    delete fontSizes[host];
  } else {
    const value = Math.round(Number($('fontSize').value) / 5) * 5;
    if (!Number.isFinite(value)) return;
    fontSizes[host] = Math.max(60, Math.min(200, value));
  }
  previewScale(reset ? 100 : fontSizes[host]);
  save({ fontSizes });
}

function loadTab() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      try {
        const u = new URL(tabs && tabs[0] && tabs[0].url);
        if (!error && /^https?:$/.test(u.protocol)) {
          host = vzxSiteHost(u.hostname);
          pathname = u.pathname;
          tabId = tabs[0].id;
        }
      } catch (e) { /* Internal and inaccessible browser pages have no site controls. */ }
      render();
    });
  } catch (e) {
    render();
  }
}

render();
try {
  chrome.storage.sync.get(VZX_DEFAULT_SETTINGS, (stored) => {
    if (chrome.runtime.lastError) {
      showError('خواندن تنظیمات ممکن نشد؛ پنجرهٔ افزونه را دوباره باز کنید.');
    } else {
      settings = { ...VZX_DEFAULT_SETTINGS, ...stored };
      for (const name of ['customHosts', 'disabledHosts']) {
        settings[name] = Array.isArray(settings[name]) ? settings[name].filter((h) => typeof h === 'string') : [];
      }
      if (!settings.fontSizes || typeof settings.fontSizes !== 'object' || Array.isArray(settings.fontSizes)) settings.fontSizes = {};
      ready = true;
    }
    loadTab();
  });
} catch (e) {
  showError('خواندن تنظیمات ممکن نشد؛ پنجرهٔ افزونه را دوباره باز کنید.');
  loadTab();
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('latinToo').addEventListener('change', (e) => save({ latinToo: e.target.checked }));
for (const id of ['persianFont', 'englishFont']) {
  $(id).addEventListener('change', (e) => save({ [id]: e.target.value }));
}
$('allSites').addEventListener('change', (e) => save({ allSites: e.target.checked }));
$('toggleSite').addEventListener('click', toggleSite);
// Preview the actual document while dragging, without consuming sync write quota.
$('fontSize').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  renderScale(value);
  previewScale(value);
});
$('fontSize').addEventListener('change', () => setFontScale());
$('resetFontSize').addEventListener('click', () => setFontScale(true));

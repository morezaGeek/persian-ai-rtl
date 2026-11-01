// Offline browser regressions. Run with Node.js, Playwright, and optionally CHROME_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const extension = path.resolve(__dirname, '..', 'ai-rtl');
const font = fs.readFileSync(path.join(extension, 'fonts', 'Vazirmatn-Variable.woff2'));
const sizes = { 'gemini.google.com': 80, 'antigravity.google.com': 120, 'google.com': 160 };
const results = [];
let browser;

// The body, heading, and nested relative size deliberately differ. Applying a
// percentage to both the paragraph and its child would compound the scale.
const fixture = `<!doctype html>
<html lang="en" dir="ltr"><meta charset="utf-8"><title>Offline AI RTL streaming regression</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; background:#101010; color:#ddd; font:20px/1.6 Arial,sans-serif; }
  nav { position:fixed; left:0; top:0; width:180px; height:100vh; background:#191919; }
  main { margin-left:180px; padding:24px 20px 120px; }
  .markdown-main-panel > :is(p,h2) { max-width:600px; margin-inline:auto; }
  h2 { font-size:1.5em; }
  p { text-align:left; }
  ul { max-width:600px; margin:12px 0; padding-left:32px; padding-right:0; }
  code { font-family:'Courier New',monospace; font-size:14px; }
  .katex { font-family:'Times New Roman',serif; font-size:18px; }
  .relative { font-size:.75em; }
  #composer { position:fixed; bottom:12px; left:220px; right:20px; display:flex; gap:10px; }
  textarea { flex:1; font:16px Arial,sans-serif; }
  button { font:14px Arial,sans-serif; }
  /* A conflicting Gemini list rule from the earlier regression fixture. */
  [id^="model-response-message-content"] ul[dir="rtl"] {
    margin-inline:0!important; margin-left:0!important; margin-right:0!important;
  }
</style>
<nav id="sidebar"><span>Conversation History</span><button>گفت‌وگوی جدید</button></nav>
<main id="main"><section class="markdown-main-panel" id="model-response-message-content-test">
  <h2 id="heading">عنوان فارسی پاسخ</h2>
  <p id="body" style="font-size:20px;--vzx-size:13px!important">NordVPN: توضیحات فارسی با <strong id="inherited">متن برجسته</strong> و <span class="relative" id="relative">متن کوچک‌تر</span>.</p>
  <p id="english">An entirely English paragraph retains the original font and size.</p>
  <p id="protected">نمونه فارسی با <code id="code">const value = 1;</code> و <span class="katex" id="math">x + y = 2</span>.</p>
  <p id="stream">پاسخ فارسی در حال تولید</p>
  <h2 id="list-heading">مراحل فارسی</h2>
  <ul id="list" dir="rtl"><li><p>مرحله نخست</p></li><li><p>مرحله دوم</p></li></ul>
</section></main>
<div id="composer"><textarea id="input"></textarea><button id="send">Send</button></div>
</html>`;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.06, `${message}: expected ${expected}, got ${actual}`);
}

async function check(name, callback) {
  await callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

async function measure(page) {
  return page.evaluate(() => Object.fromEntries(
    ['heading', 'body', 'inherited', 'relative', 'english', 'protected', 'code', 'math', 'sidebar', 'main', 'composer', 'send'].map((id) => {
      const el = document.getElementById(id), style = getComputedStyle(el), rect = el.getBoundingClientRect();
      const properties = Object.fromEntries(['font-size', '--vzx-size', '--vzx-fb'].map((property) =>
        [property, [el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]]));
      return [id, { size: parseFloat(style.fontSize), font: style.fontFamily, direction: style.direction,
        x: rect.x, width: rect.width, properties }];
    })
  ));
}

async function openFixture(host) {
  const origin = `https://${host}`;
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    if (route.request().url() === `${origin}/`) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
    } else if (route.request().url() === `${origin}/fonts/Vazirmatn-Variable.woff2`) {
      await route.fulfill({ contentType: 'font/woff2', body: font });
    } else await route.abort();
  });
  await page.goto(`${origin}/`);
  const before = await measure(page);
  await page.evaluate(({ origin, sizes }) => {
    const listeners = [];
    const state = { enabled: true, allSites: false, fontSizes: sizes };
    window.chrome = {
      runtime: { getURL: (resource) => `${origin}/${resource}` },
      storage: {
        sync: { get: (defaults, callback) => callback({ ...defaults, ...state }) },
        onChanged: { addListener: (listener) => listeners.push(listener) }
      }
    };
    window.patchSettings = (patch) => {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: state[key], newValue }]));
      Object.assign(state, patch);
      listeners.forEach((listener) => listener(changes, 'sync'));
    };
  }, { origin, sizes });
  await page.addScriptTag({ path: path.join(extension, 'hosts.js') });
  await page.addScriptTag({ path: path.join(extension, 'content.js') });
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await document.fonts.ready;
  });
  return { page, before, errors };
}

(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

  const gemini = await openFixture('gemini.google.com');
  const page = gemini.page;

  await check('Gemini replacement paragraphs have Persian font, RTL, and 80% size at their first frame', async () => {
    const frames = await page.evaluate(async () => {
      const frames = [];
      for (let index = 0; index < 12; index++) {
        document.getElementById('stream').outerHTML = `<p id="stream">پاسخ تازه در حال تولید ${index}</p>`;
        await new Promise(requestAnimationFrame);
        const el = document.getElementById('stream'), style = getComputedStyle(el);
        frames.push({ font: style.fontFamily, direction: style.direction, size: parseFloat(style.fontSize) });
      }
      return frames;
    });
    frames.forEach((frame, index) => {
      assert.ok(frame.font.includes('VzxFa'), `replacement ${index} painted in ${frame.font}`);
      assert.equal(frame.direction, 'rtl');
      near(frame.size, 16, `replacement ${index} size`);
    });
  });

  await check('nested streaming markdown retains its paragraph font anchor', async () => {
    const frames = await page.evaluate(async () => {
      const el = document.getElementById('stream'), frames = [];
      for (let index = 0; index < 8; index++) {
        el.innerHTML = index % 2
          ? 'متن فارسی به صورت ساده و مستقیم'
          : '<strong><span>پاسخ فارسی</span></strong> <a href="#">با پیوند فارسی</a>';
        await new Promise(requestAnimationFrame);
        frames.push({ marked: el.hasAttribute('data-vzx-f'), font: getComputedStyle(el).fontFamily,
          direction: getComputedStyle(el).direction, size: parseFloat(getComputedStyle(el).fontSize) });
      }
      return frames;
    });
    for (const frame of frames) {
      assert.equal(frame.marked, true, 'safe paragraph remains the font anchor');
      assert.ok(frame.font.includes('VzxFa'));
      assert.equal(frame.direction, 'rtl');
      near(frame.size, 16, 'nested markdown paragraph size');
    }
  });

  await check('English-first streaming switches to Persian and clears when emptied', async () => {
    const states = await page.evaluate(async () => {
      const el = document.getElementById('stream'), states = [];
      for (const text of ['NordVPN:', 'NordVPN: توضیح فارسی', 'English again.', '']) {
        el.textContent = text;
        await new Promise(requestAnimationFrame);
        const style = getComputedStyle(el);
        states.push({ marked: el.hasAttribute('data-vzx-f'), directed: el.hasAttribute('data-vzx-d'),
          font: style.fontFamily, size: parseFloat(style.fontSize), direction: style.direction });
      }
      return states;
    });
    assert.equal(states[0].marked, false);
    assert.equal(states[0].font, gemini.before.english.font);
    assert.equal(states[1].marked, true);
    assert.equal(states[1].direction, 'rtl');
    near(states[1].size, 16, 'English-first Persian size');
    for (const state of states.slice(2)) {
      assert.equal(state.marked, false);
      assert.equal(state.directed, false);
      near(state.size, 20, 'cleared original size');
    }
  });

  await check('new code inside streaming Persian text keeps the original code family', async () => {
    const result = await page.evaluate(async () => {
      const el = document.getElementById('stream');
      el.textContent = 'پاسخ فارسی همراه کد';
      await new Promise(requestAnimationFrame);
      const code = document.createElement('code');
      code.textContent = 'const answer = "سلام";';
      el.append(code);
      await new Promise(requestAnimationFrame);
      return { code: getComputedStyle(code).fontFamily, size: parseFloat(getComputedStyle(code).fontSize),
        direction: getComputedStyle(code).direction, parent: getComputedStyle(el).fontFamily };
    });
    assert.equal(result.code, gemini.before.code.font);
    near(result.size, gemini.before.code.size, 'inserted code size');
    assert.equal(result.direction, 'ltr');
    assert.ok(result.parent.includes('VzxFa'));
  });

  await check('repeated unrelated class mutations do not rewrite managed response attributes or styles', async () => {
    const mutations = await page.evaluate(async () => {
      const root = document.getElementById('model-response-message-content-test');
      const managed = [];
      const watcher = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === 'style' || record.attributeName.startsWith('data-vzx')) {
            managed.push({ id: record.target.id || record.target.tagName, attribute: record.attributeName });
          }
        }
      });
      watcher.observe(root, { attributes: true, subtree: true });
      for (let index = 0; index < 8; index++) {
        root.className = `markdown-main-panel generation-state-${index}`;
        await new Promise(requestAnimationFrame);
      }
      watcher.disconnect();
      return managed;
    });
    assert.deepEqual(mutations, [], 'unchanged RTL/font/list values should not be reapplied');
  });

  await check('replaced Gemini lists remain centered with prose at the first frame', async () => {
    const frames = await page.evaluate(async () => {
      const frames = [];
      for (let index = 0; index < 8; index++) {
        document.getElementById('list').outerHTML = `<ul id="list" dir="rtl"><li><p>مرحله فارسی ${index}</p></li><li><p>مرحله دوم فارسی</p></li></ul>`;
        await new Promise(requestAnimationFrame);
        const list = document.getElementById('list'), heading = document.getElementById('list-heading');
        const rect = list.getBoundingClientRect(), reference = heading.getBoundingClientRect();
        frames.push({ left: rect.left, right: rect.right, referenceLeft: reference.left,
          referenceRight: reference.right, direction: getComputedStyle(list).direction,
          textSize: parseFloat(getComputedStyle(list.querySelector('p')).fontSize) });
      }
      return frames;
    });
    for (const frame of frames) {
      near(frame.left, frame.referenceLeft, 'list left edge');
      near(frame.right, frame.referenceRight, 'list right edge');
      assert.equal(frame.direction, 'rtl');
      near(frame.textSize, 16, 'new list text size');
    }
  });

  for (const [host, scale] of [['gemini.google.com', 0.8], ['antigravity.google.com', 1.2], ['antigravity.static.usercontent.goog', 1.2], ['notebooklm.google.com', 1]]) {
    const session = host === 'gemini.google.com' ? gemini : await openFixture(host);
    await check(`${host} uses its own ${scale * 100}% size without compounding nested sizes`, async () => {
      const active = await measure(session.page);
      for (const id of ['heading', 'body', 'inherited', 'relative']) {
        near(active[id].size, session.before[id].size * scale, `${host} ${id}`);
        assert.ok(active[id].font.includes('VzxFa'), `${host} ${id} Persian font`);
      }
      assert.equal(active.body.direction, 'rtl', `${host} Persian text direction`);
      near(active.heading.size / active.body.size, session.before.heading.size / session.before.body.size, 'heading/body ratio');
      near(active.relative.size / active.body.size, 0.75, 'nested relative size ratio');
      for (const id of ['english', 'code', 'math', 'send']) {
        assert.equal(active[id].font, session.before[id].font, `${host} ${id} font`);
        near(active[id].size, session.before[id].size, `${host} ${id} original size`);
      }
      for (const id of ['sidebar', 'main', 'composer']) {
        assert.equal(active[id].direction, session.before[id].direction, `${id} layout direction`);
        near(active[id].x, session.before[id].x, `${id} horizontal position`);
        near(active[id].width, session.before[id].width, `${id} width`);
      }
      const firstFrame = await session.page.evaluate(async () => {
        document.getElementById('stream').outerHTML = '<p id="stream">پاسخ فارسی جدید برای این سایت</p>';
        await new Promise(requestAnimationFrame);
        const style = getComputedStyle(document.getElementById('stream'));
        return { size: parseFloat(style.fontSize), direction: style.direction, font: style.fontFamily };
      });
      near(firstFrame.size, 20 * scale, `${host} new response first-frame size`);
      assert.equal(firstFrame.direction, 'rtl');
      assert.ok(firstFrame.font.includes('VzxFa'));
    });
    await check(`${host} restores original sizes, styles, and fonts when disabled`, async () => {
      await session.page.evaluate(async () => {
        patchSettings({ enabled: false });
        await new Promise(requestAnimationFrame);
      });
      const restored = await measure(session.page);
      for (const id of Object.keys(session.before)) {
        near(restored[id].size, session.before[id].size, `${id} restored size`);
        assert.equal(restored[id].font, session.before[id].font, `${id} restored font`);
        assert.deepEqual(restored[id].properties, session.before[id].properties, `${id} restored inline properties`);
      }
      assert.equal(await session.page.locator('[data-vzx-f], [data-vzx-d], [data-vzx-item], [data-vzx-list], [data-vzx-align], [data-vzx-size], [data-vzx-protected-font]').count(), 0);
      assert.equal(await session.page.locator(':root[data-vzx-measure-size]').count(), 0);
      assert.equal(await session.page.locator('#vzx-style').count(), 0);
      assert.deepEqual(session.errors, []);
    });
    if (session !== gemini) await session.page.close();
  }

  await check('changing another site size leaves Gemini unchanged; changing Gemini updates existing and new prose', async () => {
    await page.evaluate(async () => {
      patchSettings({ enabled: true, fontSizes: { 'gemini.google.com': 80, 'antigravity.google.com': 150 } });
      await new Promise(requestAnimationFrame);
    });
    near((await measure(page)).body.size, 16, 'unrelated site setting');
    await page.evaluate(async () => {
      patchSettings({ fontSizes: { 'gemini.google.com': 90, 'antigravity.google.com': 150 } });
      await new Promise(requestAnimationFrame);
    });
    const active = await measure(page);
    near(active.body.size, 18, 'changed Gemini body size');
    near(active.heading.size, 27, 'changed Gemini heading size');
    near(active.relative.size, 13.5, 'changed Gemini nested size');
    const fresh = await page.evaluate(async () => {
      document.getElementById('stream').outerHTML = '<p id="stream">متن تازه پس از تغییر اندازه</p>';
      await new Promise(requestAnimationFrame);
      return parseFloat(getComputedStyle(document.getElementById('stream')).fontSize);
    });
    near(fresh, 18, 'fresh content after size setting');
    await page.evaluate(async () => {
      patchSettings({ fontSizes: {} });
      await new Promise(requestAnimationFrame);
    });
    const reset = await measure(page);
    for (const id of ['body', 'heading', 'inherited', 'relative']) near(reset[id].size, gemini.before[id].size, `${id} reset to site default`);
    assert.deepEqual(gemini.errors, []);
  });

  console.log(`\n${results.length} streaming and per-site size regression checks passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});

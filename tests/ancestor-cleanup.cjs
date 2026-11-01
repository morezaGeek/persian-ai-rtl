// Dynamic nested prose must revalidate its managed ancestors as it changes shape.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const extension = path.resolve(__dirname, '..', 'ai-rtl');
const font = fs.readFileSync(path.join(extension, 'fonts', 'Vazirmatn-Variable.woff2'));
const origin = 'https://gemini.google.com';
let browser;
let count = 0;

async function check(name, callback) {
  await callback();
  count++;
  console.log(`PASS ${name}`);
}

(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    if (route.request().url() === `${origin}/`) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
        <html dir="ltr"><meta charset="utf-8"><style>
          body { font:20px/1.6 Arial,sans-serif; } p { text-align:left; }
          code { font:14px/1.4 'Courier New',monospace; }
          .flex { display:flex; }
        </style>
        <p id="empty"><span id="empty-inner">متن فارسی</span></p>
        <div id="skip"><p id="skip-p"><span id="skip-inner">متن فارسی</span> <code id="skip-code">const x = 1;</code></p></div>
        <p id="layout">متن فارسی ساده</p>
        <div id="moving"><p id="moving-p">پاراگراف فارسی <code id="moving-code">const y = 2;</code></p></div>
        <div id="editor" class="cm-editor"></div>
        </html>` });
    } else if (route.request().url() === `${origin}/fonts/Vazirmatn-Variable.woff2`) {
      await route.fulfill({ contentType: 'font/woff2', body: font });
    } else await route.abort();
  });
  await page.goto(`${origin}/`);
  const original = await page.evaluate(() => Object.fromEntries(
    ['empty', 'skip-p', 'skip-code', 'layout', 'moving-p', 'moving-code'].map((id) => {
      const style = getComputedStyle(document.getElementById(id));
      return [id, { font: style.fontFamily, size: style.fontSize, direction: style.direction }];
    })
  ));
  await page.evaluate((origin) => {
    window.chrome = {
      runtime: { getURL: (resource) => `${origin}/${resource}` },
      storage: {
        sync: { get: (defaults, callback) => callback({ ...defaults,
          fontSizes: { 'gemini.google.com': 80 } }) },
        onChanged: { addListener() {} }
      }
    };
  }, origin);
  await page.addScriptTag({ path: path.join(extension, 'hosts.js') });
  await page.addScriptTag({ path: path.join(extension, 'content.js') });
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await document.fonts.ready; });
  assert.equal(await page.locator('#empty[data-vzx-f]').count(), 1, 'nested paragraph starts managed');
  assert.equal(await page.locator('#skip-code[data-vzx-protected-font]').count(), 1, 'code starts protected');

  const state = (id) => page.evaluate((id) => {
    const el = document.getElementById(id), style = getComputedStyle(el);
    return { font: style.fontFamily, size: style.fontSize, direction: style.direction,
      managed: [...el.attributes].filter((attr) => attr.name.startsWith('data-vzx')).map((attr) => attr.name),
      custom: [...el.style].filter((name) => name.startsWith('--vzx')) };
  }, id);
  const assertRestored = async (id) => {
    const value = await state(id);
    assert.deepEqual({ font: value.font, size: value.size, direction: value.direction }, original[id], `${id} original appearance`);
    assert.deepEqual(value.managed, [], `${id} no stale managed markers`);
    assert.deepEqual(value.custom, [], `${id} no stale custom properties`);
  };

  await check('emptying the only nested span clears its paragraph anchor before paint', async () => {
    await page.evaluate(async () => {
      document.getElementById('empty-inner').textContent = '';
      await new Promise(requestAnimationFrame);
    });
    await assertRestored('empty');
    const inner = await state('empty-inner');
    assert.deepEqual(inner.managed, []);
    assert.deepEqual(inner.custom, []);
  });

  await check('adding a skip class clears managed descendants and protected code fonts', async () => {
    await page.evaluate(async () => {
      document.getElementById('skip').className = 'monaco-editor';
      await new Promise(requestAnimationFrame);
    });
    await assertRestored('skip-p');
    await assertRestored('skip-code');
    assert.equal(await page.locator('#skip [data-vzx-f], #skip [data-vzx-d], #skip [data-vzx-size], #skip [data-vzx-protected-font]').count(), 0);
  });

  await check('changing prose into a flex container clears only its unsafe anchor', async () => {
    await page.evaluate(async () => {
      document.getElementById('layout').className = 'flex';
      await new Promise(requestAnimationFrame);
    });
    await assertRestored('layout');
    await page.evaluate(async () => {
      document.getElementById('layout').className = '';
      await new Promise(requestAnimationFrame);
    });
    const value = await state('layout');
    assert.ok(value.font.includes('VzxFa'));
    assert.equal(value.direction, 'rtl');
    assert.equal(value.size, '16px');
  });

  await check('moving a managed paragraph into an existing editor clears inherited font protection', async () => {
    await page.evaluate(async () => {
      document.getElementById('editor').append(document.getElementById('moving-p'));
      await new Promise(requestAnimationFrame);
    });
    await assertRestored('moving-p');
    await assertRestored('moving-code');
  });
  assert.deepEqual(errors, []);
  console.log(`\n${count} ancestor cleanup regression checks passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});

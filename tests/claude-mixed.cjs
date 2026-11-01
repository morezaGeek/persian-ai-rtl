const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const extension = path.resolve(__dirname, '../ai-rtl');
let browser;
(async () => {
  browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const page = await browser.newPage();
  const html = `<!doctype html><style>body{font:18px Arial} .standard-markdown{display:grid} li,p{text-align:start} .citation{display:inline-flex;font:12px Arial} .citation a{display:inline-flex} code{font-family:monospace}</style>
  <nav><ul><li id="nav">Sidebar <button>ابزار</button></li></ul></nav><div class="standard-markdown"><ul id="list"><li id="mixed">OpenAI متن فارسی با شروع انگلیسی <span data-not-prose class="citation"><a href="#">Source +2</a></span></li><li id="english">English only <span data-not-prose class="citation"><button>Reference</button></span></li></ul><p id="paragraph">Cloudflare متن فارسی با <strong>بخش برجسته</strong> و <span data-not-prose class="citation"><button>منبع فارسی</button></span></p><p>متن <code id="code">const x = 'سلام';</code></p></div>`;
  await page.route('**/*', route => route.request().url().endsWith('.woff2') ? route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))}) : route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  await page.goto('https://claude.ai/');
  const font = await page.locator('#code').evaluate(el=>getComputedStyle(el).fontFamily);
  await page.evaluate(()=>{
    const listeners=[];
    window.chrome={runtime:{getURL:r=>'https://claude.ai/'+r},storage:{sync:{get:(d,cb)=>cb(d)},onChanged:{addListener:l=>listeners.push(l)}}};
    window.patch=p=>listeners.forEach(l=>l(Object.fromEntries(Object.entries(p).map(([k,v])=>[k,{newValue:v}])),'sync'));
  });
  for(const file of ['hosts.js','content.js']) await page.addScriptTag({path:path.join(extension,file)});
  const frame=()=>page.evaluate(()=>new Promise(requestAnimationFrame)); await frame();
  for(const id of ['list','mixed','paragraph']) assert.equal(await page.locator('#'+id).evaluate(el=>getComputedStyle(el).direction),'rtl',id);
  for(const id of ['english','nav']) assert.equal(await page.locator('#'+id).evaluate(el=>getComputedStyle(el).direction),'ltr',id);
  assert.equal(await page.locator('#code').evaluate(el=>getComputedStyle(el).fontFamily),font);
  assert.ok((await page.locator('.citation').evaluateAll(els=>els.map(el=>getComputedStyle(el).direction))).every(d=>d==='ltr'));
  await page.locator('#mixed').evaluate(el=>{el.firstChild.nodeValue='English only now ';}); await frame();
  assert.equal(await page.locator('#mixed').evaluate(el=>getComputedStyle(el).direction),'ltr');
  await page.locator('#mixed').evaluate(el=>{el.firstChild.nodeValue='API متن فارسی دوباره ';}); await frame();
  assert.equal(await page.locator('#mixed').evaluate(el=>getComputedStyle(el).direction),'rtl');
  await page.evaluate(()=>patch({enabled:false})); await frame();
  assert.equal(await page.locator('[data-vzx-list],[data-vzx-item],[data-vzx-d],[data-vzx-f],[data-vzx-protected-font]').count(),0);
  assert.equal(await page.locator('#mixed').evaluate(el=>getComputedStyle(el).direction),'ltr');
  console.log('PASS Claude English-first Persian lists/paragraphs with citations, streaming language changes, English/UI/code preservation and disable cleanup');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});

// Google AI Overview typography, using DOM structures observed on the real page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const origin = 'https://www.google.com';
let browser;
let count = 0;
const overview = `<section data-scope-id="turn" id="overview">
  <div class="header"><svg id="icon" aria-hidden="true" width="24" height="24"><text x="0" y="20">✦</text></svg><h2>AI Overview</h2></div>
  <div class="answer" id="highlight-parent"><mark id="highlight" style="font-family:'Times New Roman'!important"><span id="marked-span">تاریخ امروز ایران</span> برابر با یک روز نمونه در تقویم است.</mark><button id="citation"><span>باحساب</span></button></div>
  <div class="answer" id="direct">برای مشاهده آنلاین تقویم می‌توانید به <span><a href="#reference" id="answer-link">سایت رسمی تقویم ایران</a></span> مراجعه کنید.<button id="other-citation">منبع</button></div>
  <ul><li id="list-item"><b>ماه شمسی جاری:</b> آبان</li></ul>
  <em id="note" style="font-family:'Times New Roman'!important;font-size:18px">توجه: عبارت انگلیسی MRE ممکن است معنای دیگری داشته باشد.</em>
  <p>کد و فرمول <code id="code">const متن = 1;</code> و <span class="katex" id="math">x + y</span></p>
  <div id="expanded"></div>
</section>`;
const html = `<!doctype html><meta charset="utf-8"><style>
  body{font:20px/1.6 Arial,sans-serif;margin:24px}main{max-width:820px}
  .header{display:flex;align-items:center;gap:12px}h2{font-size:20px}
  .answer{margin:20px 0}button{font:12px Arial,sans-serif}code{font:14px monospace}.katex{font-family:serif}
</style><header><input id="search" value="تقویم شمسی"><button id="outside-control">ابزارها</button></header><main id="main"><div id="mount"></div><p id="ordinary">نتیجهٔ معمولی جستجو و توضیح فارسی آن</p></main>`;
const frame = page => page.evaluate(() => new Promise(requestAnimationFrame));
const family = (page, id) => page.$eval(`#${id}`, el => getComputedStyle(el).fontFamily);
const near = (a,b) => assert.ok(Math.abs(a-b)<.05, `${a} should equal ${b}`);
async function check(name, callback) { await callback(); count++; console.log(`PASS ${name}`); }

(async () => {
  browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({viewport:{width:1000,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*', async route => {
    if(route.request().url().startsWith(`${origin}/search?`)) await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    else if(route.request().url()===`${origin}/fonts/Vazirmatn-Variable.woff2`) await route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))});
    else await route.abort();
  });
  await page.goto(`${origin}/search?q=sample`);
  await page.evaluate(() => {
    const listeners=[];
    const state={};
    window.chrome={runtime:{getURL:resource=>`${location.origin}/${resource}`},storage:{sync:{get:(defaults,callback)=>callback({...defaults,...state})},onChanged:{addListener:listener=>listeners.push(listener)}}};
    window.patchSettings=patch=>{Object.assign(state,patch);listeners.forEach(listener=>listener(Object.fromEntries(Object.entries(patch).map(([key,newValue])=>[key,{newValue}])),'sync'));};
  });
  for(const file of ['hosts.js','content.js']) await page.addScriptTag({path:path.join(extension,file)});
  await frame(page);
  const baseline={ordinary:await family(page,'ordinary'),control:await family(page,'outside-control')};
  await check('Google Search is active by default before the generated overview arrives',async()=>{
    assert.equal(await page.locator('#vzx-style').count(),1);
    assert.equal(await page.locator('[data-vzx-f]').count(),0);
  });
  await page.$eval('#mount',(el,markup)=>{el.innerHTML=markup;},overview);
  await frame(page);
  await page.evaluate(()=>document.fonts.ready);
  await check('late AI Overview direct text, highlight, link, list and italic note receive Vazirmatn',async()=>{
    for(const id of ['highlight','marked-span','direct','answer-link','list-item','note']) assert.match(await family(page,id),/VzxFa/,id);
    assert.equal(await page.$eval('#note',el=>getComputedStyle(el).fontStyle),'italic');
  });
  await check('content outside search scopes, navigation, citation controls, code and math keep native fonts',async()=>{
    assert.equal(await family(page,'ordinary'),baseline.ordinary);
    assert.equal(await family(page,'outside-control'),baseline.control);
    for(const id of ['citation','other-citation','code','math','icon']) assert.doesNotMatch(await family(page,id),/Vzx/);
    assert.equal(await page.locator('#ordinary[data-vzx-f],header [data-vzx-f]').count(),0);
    assert.equal(await page.$eval('.header',el=>getComputedStyle(el).direction),'ltr');
  });
  await check('expanded streamed text is styled on its first frame',async()=>{
    await page.$eval('#expanded',el=>{el.innerHTML='<div id="fresh">متن تکمیلی فارسی <button>منبع</button></div><mark id="fresh-mark">بخش برجستهٔ تازه</mark>';});
    await frame(page);
    assert.match(await family(page,'fresh'),/VzxFa/);
    assert.match(await family(page,'fresh-mark'),/VzxFa/);
  });
  await check('Google size and Latin-font settings also update important inline fonts',async()=>{
    await page.evaluate(()=>patchSettings({fontSizes:{'google.com':125},latinToo:true}));
    await frame(page);
    assert.match(await family(page,'highlight'),/VzxAll/);
    assert.match(await family(page,'note'),/VzxAll/);
    near(await page.$eval('#direct',el=>parseFloat(getComputedStyle(el).fontSize)),25);
    near(await page.$eval('#note',el=>parseFloat(getComputedStyle(el).fontSize)),22.5);
    assert.equal(await family(page,'ordinary'),baseline.ordinary);
  });
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results','google-overview-after.png'),fullPage:true});
  await check('turning off restores original important fonts and removes every managed marker',async()=>{
    await page.evaluate(()=>patchSettings({enabled:false}));
    await frame(page);
    for(const id of ['highlight','note']) {
      assert.equal(await page.$eval(`#${id}`,el=>el.style.getPropertyValue('font-family')),'"Times New Roman"');
      assert.equal(await page.$eval(`#${id}`,el=>el.style.getPropertyPriority('font-family')),'important');
    }
    assert.equal(await page.locator('[data-vzx-f],[data-vzx-size],[data-vzx-protected-font],[data-vzx-d]').count(),0);
  });
  assert.deepEqual(errors,[]);
  console.log(`\n${count} Google AI Overview checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});

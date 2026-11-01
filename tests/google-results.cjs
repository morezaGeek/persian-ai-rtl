// Offline Google result-column typography and layout regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const origin = 'https://www.google.com';
let browser;
let count = 0;
const frame = page => page.evaluate(() => new Promise(requestAnimationFrame));
async function check(name, run) { await run(); console.log(`PASS ${name}`); count++; }
const fixture = `<!doctype html><meta charset="utf-8"><style>
body{font:16px/1.7 Arial,sans-serif;margin:30px;color:#333}main{width:min(800px,100%)}
.result{margin-block:30px}.metadata{display:flex;align-items:center;gap:12px}
h3{font-size:24px;font-weight:normal;margin:8px 0}button{font:14px Arial}
cite{font-style:normal}a{color:#1a0dab}.snippet{color:#666;font-size:16px}.VuuXrf{display:block;width:220px}
</style><header><input value="تقویم شمسی"><button id="tools">ابزارها</button></header>
<main><section id="rso">
<div class="result" id="persian-result"><div class="metadata" id="metadata"><span id="icon" aria-hidden="true">◉</span><span id="site" class="VuuXrf"><span dir="rtl">باحساب</span></span><cite id="url">https://www.bahesab.ir › today</cite><button id="menu">⋮</button></div>
<a href="https://www.bahesab.ir/time/today/"><h3 id="title">تاریخ امروز (امروز چندمه)</h3></a>
<div class="snippet" id="snippet" style="font-family:'Times New Roman'!important">تاریخ امروز ایران، امروز چندمه، تقویم امروز جمعه ۱ آبان است. <em id="emphasis">تبدیل تاریخ شمسی</em> و میلادی. <a id="readmore" href="#more">Read more</a></div></div>
<div class="result" id="english-result"><h3 id="english-title">Iran calendar today</h3><p id="english-snippet">Today's date and calendar in English.</p></div>
</section><footer id="footer">متن فارسی خارج از ستون نتایج</footer></main>`;

(async () => {
  browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const page = await browser.newPage({viewport:{width:1000,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    if(route.request().url().startsWith(`${origin}/search?`)) await route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
    else if(route.request().url()===`${origin}/fonts/Vazirmatn-Variable.woff2`) await route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))});
    else await route.abort();
  });
  await page.goto(`${origin}/search?q=calendar`);
  const snapshot=()=>page.evaluate(()=>Object.fromEntries(['rso','persian-result','metadata','icon','site','url','menu','title','snippet','emphasis','readmore','english-title','english-snippet','tools','footer'].map(id=>{
    const el=document.getElementById(id),s=getComputedStyle(el),r=el.getBoundingClientRect();
    return[id,{font:s.fontFamily,size:parseFloat(s.fontSize),direction:s.direction,x:r.x,width:r.width,color:s.color,style:el.getAttribute('style')}];
  })));
  const before=await snapshot();
  await page.evaluate(()=>{
    const listeners=[];
    window.chrome={runtime:{getURL:resource=>`${location.origin}/${resource}`},storage:{sync:{get:(defaults,callback)=>callback(defaults)},onChanged:{addListener:listener=>listeners.push(listener)}}};
    window.patchSettings=patch=>listeners.forEach(listener=>listener(Object.fromEntries(Object.entries(patch).map(([key,newValue])=>[key,{newValue}])),'sync'));
  });
  for(const file of ['hosts.js','content.js']) await page.addScriptTag({path:path.join(extension,file)});
  await frame(page);
  await page.evaluate(()=>document.fonts.ready);
  const active=await snapshot();
  await check('Persian result title, snippet, emphasized words and site name receive Vazirmatn',async()=>{
    for(const id of ['title','snippet','emphasis','site']) assert.match(active[id].font,/VzxFa/,id);
    assert.equal(active.snippet.direction,'rtl');
    for(const id of ['title','site']) {
      assert.equal(active[id].direction,before[id].direction,`${id}: native heading direction`);
      assert.equal(await page.locator(`#${id}[data-vzx-align]`).count(),0);
    }
    assert.equal(active.title.color,before.title.color);
    assert.equal(active.snippet.color,before.snippet.color);
  });
  await check('real Google combined result link keeps nested site-name text on the left',async()=>{
    await page.$eval('#rso',el=>el.insertAdjacentHTML('beforeend','<a id="combined" href="#combined"><h3 id="combined-title"><span dir="rtl">عنوان نتیجهٔ گوگل</span></h3><br><div class="metadata"><span aria-hidden="true">◉</span><div><span class="VuuXrf" id="combined-site"><span dir="rtl">باحساب</span></span><cite>https://example.com</cite></div></div></a>'));
    await frame(page);
    for(const id of ['combined-title','combined-site']) {
      assert.match(await page.$eval(`#${id}`,el=>getComputedStyle(el).fontFamily),/VzxFa/);
      assert.equal(await page.$eval(`#${id}`,el=>getComputedStyle(el).direction),'ltr');
      assert.equal(await page.locator(`#${id}[data-vzx-align]`).count(),0);
    }
    const offset=await page.$eval('#combined-site',el=>{
      const range=document.createRange(); range.selectNodeContents(el);
      return range.getBoundingClientRect().left-el.getBoundingClientRect().left;
    });
    assert.ok(offset<2,`site text must stay at left edge; got ${offset}px`);
  });
  await check('metadata row, URLs, icons, controls and English results retain original behavior',async()=>{
    for(const id of ['url','icon','menu','english-title','english-snippet','tools','footer']) {
      assert.equal(active[id].font,before[id].font,id);
      assert.equal(active[id].direction,before[id].direction,id);
    }
    // Inline English inside a Persian snippet uses VzxFa's original Latin
    // fallback; it is not independently marked as Persian text.
    assert.equal(await page.locator('#readmore[data-vzx-f]').count(),0);
    assert.match(active.readmore.font,/Times New Roman/);
    for(const id of ['rso','persian-result','metadata']) {
      assert.equal(active[id].x,before[id].x,id);
      assert.equal(active[id].width,before[id].width,id);
      assert.equal(active[id].direction,before[id].direction,id);
    }
  });
  await check('per-site size applies to Persian result text without resizing English results',async()=>{
    await page.evaluate(()=>patchSettings({fontSizes:{'google.com':120}}));
    await frame(page);
    const scaled=await snapshot();
    for(const id of ['title','snippet','emphasis']) assert.ok(Math.abs(scaled[id].size-before[id].size*1.2)<.05,id);
    for(const id of ['url','menu','english-title','english-snippet']) assert.equal(scaled[id].size,before[id].size,id);
  });
  await check('new search results are styled on the first frame after insertion',async()=>{
    await page.$eval('#rso',el=>el.insertAdjacentHTML('beforeend','<div class="result"><a href="#new"><h3 id="new-title">نتیجهٔ فارسی تازه</h3></a><div id="new-snippet">توضیح فارسیِ نتیجهٔ تازه</div></div>'));
    await frame(page);
    for(const id of ['new-title','new-snippet']) assert.match(await page.$eval(`#${id}`,el=>getComputedStyle(el).fontFamily),/VzxFa/);
  });
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results','google-results-after.png'),fullPage:true});
  await check('disable restores original result fonts, sizes, directions and important styles',async()=>{
    await page.evaluate(()=>patchSettings({enabled:false}));
    await frame(page);
    const restored=await snapshot();
    for(const id of Object.keys(before)) for(const key of ['font','size','direction','color']) assert.equal(restored[id][key],before[id][key],`${id}.${key}`);
    assert.equal(await page.$eval('#snippet',el=>el.style.getPropertyValue('font-family')),'"Times New Roman"');
    assert.equal(await page.$eval('#snippet',el=>el.style.getPropertyPriority('font-family')),'important');
    assert.equal(await page.locator('[data-vzx-f],[data-vzx-d],[data-vzx-size]').count(),0);
  });
  assert.deepEqual(errors,[]);
  console.log(`\n${count} Google Search results checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});

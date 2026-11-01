const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const fixture = fs.readFileSync(path.join(__dirname, 'gemini-fixture.html'), 'utf8');
let browser;
const pause = (page) => page.waitForTimeout(180);

(async () => {
  browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport:{width:1536,height:1000} });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === 'https://gemini.google.com/') await route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
    else if (url === 'https://gemini.google.com/fonts/Vazirmatn-Variable.woff2') await route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))});
    else await route.abort();
  });
  await page.goto('https://gemini.google.com/');
  const measure = () => page.evaluate(() => Object.fromEntries(['intro','list-heading','response-list','numbered-heading','numbered-list','comparison','composer','sublist'].map(id => {
    const el=document.getElementById(id),r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return [id,{x:r.x,right:r.right,width:r.width,direction:s.direction,margin:el.style.getPropertyValue('margin-inline'),priority:el.style.getPropertyPriority('margin-inline')}];
  })));
  const before = await measure();
  assert.ok(before['response-list'].x - before['list-heading'].x > 300, 'fixture must reproduce the real right-edge displacement');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results','gemini-before.png'),fullPage:true});
  await page.evaluate(() => {
    const listeners=[];
    window.chrome={runtime:{getURL:(resource)=>`https://gemini.google.com/${resource}`},storage:{sync:{get:(defaults,callback)=>callback(defaults)},onChanged:{addListener:(listener)=>listeners.push(listener)}}};
    window.patchSettings=(patch)=>listeners.forEach(listener=>listener(Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,{newValue:value}])),'sync'));
  });
  await page.addScriptTag({path:path.join(extension,'hosts.js')});
  await page.addScriptTag({path:path.join(extension,'content.js')});
  await pause(page);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1536,1920,760,430]) {
    await page.setViewportSize({width,height:1000});
    await pause(page);
    const active=await measure();
    for(const [list,heading] of [['response-list','list-heading'],['numbered-list','numbered-heading']]) {
      assert.ok(Math.abs(active[list].x-active[heading].x)<1, `${list}: left edge at ${width}px`);
      assert.ok(Math.abs(active[list].right-active[heading].right)<1, `${list}: right edge at ${width}px`);
      assert.equal(active[list].direction,'rtl');
    }
    assert.equal(active['response-list'].margin,'auto');
    assert.equal(active['response-list'].priority,'important');
    assert.equal(active.sublist.margin,'', 'nested lists must keep their own indentation');
    assert.equal(active.comparison.direction,before.comparison.direction);
    assert.equal(active.composer.direction,before.composer.direction);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(width===1536) {
      for(const id of ['intro','comparison','composer']) {
        assert.ok(Math.abs(active[id].x-before[id].x)<1, `${id} must not move`);
        assert.ok(Math.abs(active[id].width-before[id].width)<1, `${id} must not resize`);
      }
      await page.screenshot({path:path.join(root,'test-results','gemini-after.png'),fullPage:true});
    }
    console.log(`PASS Gemini list/prose alignment and UI bounds at ${width}px`);
  }
  await page.$eval('#response-list li p', el=>{el.firstChild.after(document.createTextNode(' ادامه‌ی پاسخ در حال تولید.'));});
  await pause(page);
  const streamed=await measure();
  assert.ok(Math.abs(streamed['response-list'].x-streamed['list-heading'].x)<1);
  console.log('PASS Gemini streamed list remains aligned');
  await page.setViewportSize({width:1536,height:1000});
  await pause(page);
  await page.evaluate(()=>patchSettings({enabled:false}));
  const disabled=await measure();
  assert.deepEqual(disabled,before,'turning off must restore the original margins and horizontal layout');
  assert.equal(await page.locator('[data-vzx-list], [data-vzx-item], [data-vzx-d]').count(),0);
  console.log('PASS Gemini original margins and layout restored when disabled');
  await page.$eval('#response-list', el=>{
    el.style.setProperty('margin-inline-start','7px','important');
    el.style.setProperty('margin-inline-end','11px');
  });
  await page.evaluate(()=>patchSettings({enabled:true}));
  await pause(page);
  await page.evaluate(()=>patchSettings({enabled:false}));
  assert.deepEqual(await page.$eval('#response-list', el=>['margin-inline-start','margin-inline-end'].map(property=>[el.style.getPropertyValue(property),el.style.getPropertyPriority(property)])),[['7px','important'],['11px','']]);
  console.log('PASS Gemini existing margin values and priorities are preserved');
  assert.deepEqual(errors,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});

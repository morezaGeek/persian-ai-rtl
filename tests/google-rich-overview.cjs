// Rich AI Overview paragraphs and UL > DIV > LI wrappers observed on Google.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const extension=path.join(root,'ai-rtl');
const origin='https://www.google.com';
let browser;
const html=`<!doctype html><meta charset="utf-8"><style>
body{font:18px/1.8 Arial;margin:30px;background:#fff}main{max-width:820px}
.citation{display:inline}button{display:inline-flex;gap:6px;font:12px Arial;vertical-align:middle}
button svg{width:14px;height:14px}ul{padding-left:18px;padding-right:0}
li{display:list-item}.intro{margin:20px 0}mark{background:#d9e8ff}
</style><main><section data-scope-id="turn"><h2>AI Overview</h2>
<div id="intro" class="intro"><span id="lead">رابط فارسی </span><span style="display:contents"><span><a id="api" href="#api">Gemini API</a></span></span> <mark id="highlight">ابزار گوگل است.</mark> در برنامه استفاده کنید.<span class="citation"><button id="source"><b id="source-word">Source</b><svg id="source-icon" aria-hidden="true"><circle cx="7" cy="7" r="5"/></svg></button></span></div>
<ul id="wrapped"><div data-bfc><li id="item"><span><strong>پردازش چندوجهی:</strong> متن، تصویر و صدا.</span><span class="citation"><button id="list-source"><b id="list-word">Source</b><svg id="list-icon" aria-hidden="true"><circle cx="7" cy="7" r="5"/></svg></button></span></li></div><div data-bfc><li>زبان‌های Python و JavaScript / TypeScript و Go. <code id="code">generateContent()</code></li></div></ul>
<div id="dynamic"></div></section></main>`;
const frame=page=>page.evaluate(()=>new Promise(requestAnimationFrame));
(async()=>{
browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1000,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
 if(route.request().url()===origin+'/search?q=api')await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
 else if(route.request().url().endsWith('/fonts/Vazirmatn-Variable.woff2'))await route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))});
 else await route.abort();
});
await page.goto(origin+'/search?q=api');
const before=await page.evaluate(()=>({source:getComputedStyle(document.getElementById('source')).fontFamily,code:getComputedStyle(document.getElementById('code')).fontFamily,introDir:getComputedStyle(document.getElementById('intro')).direction}));
await page.evaluate(()=>{const listeners=[];window.chrome={runtime:{getURL:p=>location.origin+'/'+p},storage:{sync:{get:(defaults,cb)=>cb(defaults)},onChanged:{addListener:fn=>listeners.push(fn)}}};window.patchSettings=p=>listeners.forEach(fn=>fn(Object.fromEntries(Object.entries(p).map(([k,newValue])=>[k,{newValue}])),'sync'));});
for(const f of ['hosts.js','content.js'])await page.addScriptTag({path:path.join(extension,f)});
await frame(page);await page.evaluate(()=>document.fonts.ready);
assert.equal(await page.$eval('#intro',el=>getComputedStyle(el).direction),'rtl');
assert.equal(await page.locator('#lead[data-vzx-d],#highlight[data-vzx-d]').count(),0,'inline fragments must not be isolated as separate paragraphs');
const order=await page.evaluate(()=>['lead','api','highlight'].map(id=>{const r=document.createRange();r.selectNodeContents(document.getElementById(id));return r.getBoundingClientRect().left;}));
assert.ok(order[0]>order[1]&&order[1]>order[2],`mixed sentence should read in RTL order: ${order}`);
console.log('PASS rich Persian sentence has one RTL paragraph and correct mixed-script order');
assert.equal(await page.$eval('#wrapped',el=>getComputedStyle(el).direction),'rtl');
assert.equal(await page.locator('#wrapped li[data-vzx-item="rtl"]').count(),2);
assert.equal(await page.$eval('#item',el=>getComputedStyle(el).direction),'rtl');
console.log('PASS Google wrapped list items and markers use RTL');
for(const prefix of ['source','list']){
 const ids=prefix==='source'?['source-word','source-icon']:['list-word','list-icon'];
 const positions=await page.evaluate(ids=>ids.map(id=>document.getElementById(id).getBoundingClientRect().left),ids);
 assert.ok(positions[0]<positions[1],`${prefix} control order`);
}
assert.equal(await page.$eval('#source',el=>getComputedStyle(el).fontFamily),before.source);
assert.equal(await page.$eval('#code',el=>getComputedStyle(el).fontFamily),before.code);
console.log('PASS citation controls preserve fonts and child order; code remains protected');
await page.$eval('#dynamic',el=>el.innerHTML='<ul id="fresh"><div data-bfc><li>متن تازه <span class="citation"><button>Source</button></span></li></div></ul>');
await frame(page);
assert.equal(await page.locator('#fresh li[data-vzx-item="rtl"]').count(),1);
console.log('PASS newly streamed wrapped lists are handled before their first frame');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
await page.screenshot({path:path.join(root,'test-results','google-rich-after.png'),fullPage:true});
await page.evaluate(()=>patchSettings({enabled:false}));await frame(page);
assert.equal(await page.$eval('#intro',el=>getComputedStyle(el).direction),before.introDir);
assert.equal(await page.locator('[data-vzx-d],[data-vzx-list],[data-vzx-item],[data-vzx-layout-direction],[data-vzx-protected-font]').count(),0);
assert.deepEqual(errors,[]);console.log('PASS rich overview cleanup restores the original page');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});

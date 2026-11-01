// Script-specific font choices, migration, live changes, and restoration.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const extension=path.join(root,'ai-rtl');
const origin='https://gemini.google.com';
let browser;
const frame=page=>page.evaluate(async()=>{await new Promise(requestAnimationFrame);await document.fonts.ready;});
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  if(route.request().url()===origin+'/')await route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><style>body{font:20px/1.7 Arial}code{font:14px monospace}.katex{font:18px serif}</style><p id="mixed">متن فارسی با <span id="latin">HelloWorld</span> و نمونه.</p><p id="english">English only paragraph.</p><p id="important" style="font-family:'Times New Roman'!important">فونت صریح فارسی با English</p><p>نمونه <code id="code">const x = 1;</code> و <span class="katex" id="math">x + y</span></p>`});
  else if(route.request().url().endsWith('/fonts/Vazirmatn-Variable.woff2'))await route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(extension,'fonts/Vazirmatn-Variable.woff2'))});
  else await route.abort();
 });
 await page.goto(origin+'/');
 const fonts=()=>page.evaluate(()=>Object.fromEntries(['mixed','english','important','code','math'].map(id=>[id,getComputedStyle(document.getElementById(id)).fontFamily])));
 const before=await fonts();
 await page.evaluate(()=>{const listeners=[];window.chrome={runtime:{getURL:p=>location.origin+'/'+p},storage:{sync:{get:(defaults,cb)=>cb(defaults)},onChanged:{addListener:fn=>listeners.push(fn)}}};window.patchSettings=p=>listeners.forEach(fn=>fn(Object.fromEntries(Object.entries(p).map(([k,newValue])=>[k,{newValue}])),'sync'));});
 for(const f of ['hosts.js','content.js'])await page.addScriptTag({path:path.join(extension,f)});
 await frame(page);
 assert.match((await fonts()).mixed,/VzxFa/);assert.equal((await fonts()).english,before.english);
 console.log('PASS default Persian font and native English are retained');
 const measure=()=>page.evaluate(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='20px '+getComputedStyle(document.getElementById('mixed')).fontFamily;return{persian:ctx.measureText('فارسی').width,english:ctx.measureText('HelloWorld').width};});
 let persianWidth;
 for(const englishFont of ['vazirmatn','arial','segoe-ui','georgia','times-new-roman']){
  await page.evaluate(englishFont=>patchSettings({englishFont}),englishFont);await frame(page);
  const active=await fonts();
  assert.match(active.english,/VzxAll/);assert.match(active.mixed,/VzxFa.*VzxAll/);
  assert.match(active.important,/VzxFa.*VzxAll/);
  assert.equal(active.code,before.code);assert.equal(active.math,before.math);
  const width=(await measure()).persian;
  if(persianWidth!==undefined)assert.ok(Math.abs(width-persianWidth)<.05,'English selection must not change Persian glyphs');
  persianWidth=width;
 }
 console.log('PASS independent English options apply to mixed and English-only prose without changing Persian glyphs');
 await page.evaluate(()=>patchSettings({englishFont:'arial'}));await frame(page);
 const englishWidth=(await measure()).english;
 for(const persianFont of ['vazirmatn','tahoma','arial','segoe-ui','system']){
  await page.evaluate(persianFont=>patchSettings({persianFont}),persianFont);await frame(page);
  assert.ok(Math.abs((await measure()).english-englishWidth)<.05,'Persian selection must not change Latin glyphs');
  assert.match((await fonts()).mixed,/VzxFa/);
 }
 console.log('PASS Persian options do not override the selected Latin face');
 await page.evaluate(()=>patchSettings({englishFont:'site'}));await frame(page);
 assert.equal((await fonts()).english,before.english);
 assert.doesNotMatch((await fonts()).important,/VzxAll/);
 console.log('PASS switching English back to site restores native English text and important mixed font stack');
 await page.evaluate(()=>patchSettings({englishFont:null,latinToo:true}));await frame(page);
 assert.match((await fonts()).mixed,/VzxAll/);assert.equal((await fonts()).english,before.english);
 await page.evaluate(()=>patchSettings({englishFont:'bad";font-size:200px',persianFont:'bad";color:red'}));await frame(page);
 const choices=await page.evaluate(()=>vzxFontChoices({persianFont:'bad',englishFont:'bad'}));
 assert.deepEqual(choices,{persian:'vazirmatn',english:'site'});
 assert.doesNotMatch(await page.$eval('#vzx-style',el=>el.textContent),/font-size:200px|color:red/);
 console.log('PASS legacy Latin setting migrates and unknown font choices cannot inject CSS');
 await page.evaluate(()=>patchSettings({enabled:false}));await frame(page);
 assert.deepEqual(await fonts(),before);
 assert.equal(await page.$eval('#important',el=>el.style.getPropertyPriority('font-family')),'important');
 assert.equal(await page.locator('[data-vzx-f],[data-vzx-protected-font]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS disabling restores original fonts and inline priorities');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});

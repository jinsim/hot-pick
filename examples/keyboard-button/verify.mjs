import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const cases=[];
try {
for(const variant of ['before','after']){
 const page=await browser.newPage();
 await page.goto(new URL(`${variant}.html`,import.meta.url).href);
 await page.keyboard.press('Tab');
 const tab_reachable=await page.locator('.save').evaluate(e=>e===document.activeElement);
 const visible_focus=tab_reachable && await page.locator('.save').evaluate(e=>getComputedStyle(e).outlineStyle!=='none');
 await page.keyboard.press('Enter');
 const enter_activates=await page.locator('#result').innerText()==='Saved';
 await page.locator('#result').evaluate(e=>e.textContent='');
 await page.keyboard.press('Space');
 const space_activates=await page.locator('#result').innerText()==='Saved';
 const native_button=await page.locator('.save').evaluate(e=>e.tagName==='BUTTON' && e.type==='button');
 const persistent_status_region=await page.locator('#result').getAttribute('role')==='status';
 const checks={tab_reachable,visible_focus,enter_activates,space_activates,native_button,persistent_status_region};
 cases.push({variant,checks,passed:Object.values(checks).filter(Boolean).length,total:6});
 await page.close();
}
}finally{await browser.close()}
if(cases[1].passed!==6)throw Error(JSON.stringify(cases));
console.log(JSON.stringify({cases,limitations:['Constructed fixture; not independent no-skill agent comparison','Screen reader speech not verified']},null,2));

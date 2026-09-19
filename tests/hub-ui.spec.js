import {test,expect} from '@playwright/test';
test('ordinary visits start with Steam sign-in, without demo cards or an automatic dialog',async({page})=>{
 await page.goto('http://localhost:4317');await expect(page.getByRole('link',{name:'Sign in with Steam'})).toHaveAttribute('href','/auth/steam');
 await expect(page.locator('.game-card')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.landing-tiles article')).toHaveCount(3);
 await page.screenshot({path:'test-results/landing-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('Language / Sprache').selectOption('de');await expect(page.getByRole('link',{name:'Mit Steam anmelden'})).toBeVisible();
});
test('signed-in hub separates areas, shows discovery reasons, and refreshes ownership explicitly',async({page})=>{
 const game={appid:1,name:'Owned game',genres:['Action'],lastPlayed:1700000000,minutes:60,events:[{id:'1',title:'Major update is live',kind:'major',date:1750000000}]};let force=false;
 await page.route('**/api/session',r=>r.fulfill({json:{user:{name:'Test player'},keyConfigured:true,hasKey:true}}));
 await page.route('**/api/preferences',r=>r.fulfill({json:{preferences:[]}}));await page.route('**/api/friends',r=>r.fulfill({json:{friends:[]}}));
 await page.route('**/api/scan',r=>{if(r.request().method()==='POST'){force=r.request().postDataJSON().force;return r.fulfill({json:{status:'running',done:0,total:12,games:[]}});}return r.fulfill({json:{status:'complete',games:[game],finishedAt:100,startedAt:100}});});
 await page.route('**/api/discover',r=>r.fulfill({json:{status:'complete',games:[{appid:2,name:'New game',match:80,reasons:[{appid:1,name:'Owned game',affinity:0.734},{name:'Older cached game'}]}],profile:[{appid:1,name:'Owned game',hours:10,usable:true}]}}));
 await page.route('**/api/discover/exclusions',r=>r.fulfill({json:{games:[]}}));await page.route('**/api/discover/hidden',r=>r.fulfill({json:{games:[]}}));
 await page.goto('http://localhost:4317');await expect(page.locator('#radar')).toBeVisible();await expect(page.locator('#coop')).toBeHidden();
 await page.getByRole('button',{name:/Discover Find new games/}).click();await expect(page.locator('#discover')).toBeVisible();await expect(page.locator('#radar')).toBeHidden();await expect(page.locator('.discover-comparison')).toContainText('Owned game');
 await expect(page.locator('.discover-similarity')).toHaveText('73% tag similarity');
 await expect(page.locator('.discover-comparison li')).toHaveCount(2);
 await page.getByText('What does this mean?',{exact:true}).click();
 await expect(page.locator('.discover-comparison details')).toContainText('not genre shares');
 await page.getByLabel('Language / Sprache').selectOption('de');
 await expect(page.locator('.discover-comparison h4')).toHaveText('Ähnlich wie deine Spiele');
 await expect(page.locator('.discover-similarity')).toHaveText('73% Tag-Ähnlichkeit');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/discover-comparison-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.getByLabel('Language / Sprache').selectOption('en');
 await expect(page.getByRole('link',{name:'View on Steam'})).toHaveAttribute('href','https://store.steampowered.com/app/2/');
 await page.screenshot({path:'test-results/hub-discover.png',fullPage:true});
 await page.getByRole('button',{name:/Replay Radar Return/}).click();await page.getByRole('button',{name:'Refresh library'}).click();expect(force).toBe(true);
 await expect(page.locator('#radar .scan-status')).toBeVisible();await expect(page.locator('#radar .game-card')).toHaveCount(1);
});
test('initial radar scan has its own loading overlay',async({page})=>{
 await page.route('**/api/session',r=>r.fulfill({json:{user:{name:'Test'},keyConfigured:true,hasKey:true}}));await page.route('**/api/preferences',r=>r.fulfill({json:{preferences:[]}}));await page.route('**/api/friends',r=>r.fulfill({json:{friends:[]}}));await page.route('**/api/scan',r=>r.fulfill({json:{status:'running',done:0,total:30,games:[]}}));
 await page.goto('http://localhost:4317');await expect(page.locator('.radar-first-loading')).toBeVisible();await expect(page.locator('.radar-first-loading')).toContainText('Updating your radar');
 await page.getByRole('button',{name:/Co-op Shuffle Pick/}).click();await expect(page.locator('#coop')).toBeVisible();await expect(page.locator('#radar')).toBeHidden();
});

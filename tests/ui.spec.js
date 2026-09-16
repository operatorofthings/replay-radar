import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{if(!sessionStorage.getItem('rr_test_boot')){localStorage.setItem('rr_intro_seen','1');sessionStorage.setItem('rr_test_boot','1');}});});
test('dashboard filters, ranking controls, detail dialog, friend switch and wheel work',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:4317');
 await expect(page.getByRole('heading',{name:/Gute Spiele verdienen/})).toBeVisible();
 await expect(page.locator('.game-card')).toHaveCount(3);
 await page.getByLabel('Genre',{exact:true}).selectOption('Simulation');
 await expect(page.locator('.game-card')).toHaveCount(1);
 await expect(page.locator('.game-card h3')).toHaveText('Satisfactory');
 await page.getByLabel('Genre',{exact:true}).selectOption('Alle Genres');
 await page.getByRole('button',{name:'Gewichtung anpassen'}).click();
 await page.getByLabel('Gewichtung 1.0 / Vollversion').fill('0');
 await page.getByRole('button',{name:'Übernehmen'}).click();
 await expect(page.locator('.game-card h3').first()).toHaveText('Risk of Rain 2');
 await page.getByRole('button',{name:'Updates für Risk of Rain 2 ansehen'}).click();
 await expect(page.getByRole('dialog')).toContainText('Beispielmeldungen');
 await page.keyboard.press('Escape');
 await page.getByLabel('Dein Koop-Partner').selectOption('demo-3');
 await expect(page.locator('.wheel-caption')).toContainText('3 GEMEINSAME');
 await page.getByRole('button',{name:'Rad drehen',exact:true}).click();
 await expect(page.getByRole('button',{name:'Noch eine Runde'})).toBeVisible({timeout:7000});
 await expect(page.getByRole('link',{name:'In Steam starten'})).toHaveAttribute('href',/^steam:\/\/run\/(548430|892970|632360)$/);
 expect(errors).toEqual([]);
});
test('mobile layout fits the viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:4317');
 await expect(page.locator('.game-card').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});
test('desktop cover assets load and screenshot',async({page})=>{
 await page.setViewportSize({width:1440,height:1200});await page.goto('http://localhost:4317');
 await expect(page.locator('.game-cover img')).toHaveCount(3);
 await expect.poll(()=>page.locator('.game-cover img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
 await page.screenshot({path:'test-results/desktop.png',fullPage:true});
});
test('API requires authentication and rejects cross-origin writes and forged login',async({request})=>{
 const session=await request.get('http://localhost:4317/api/session');expect((await session.json()).user).toBeNull();
 expect((await request.get('http://localhost:4317/api/friends')).status()).toBe(401);
 expect((await request.post('http://localhost:4317/api/scan',{headers:{Origin:'https://example.org'}})).status()).toBe(403);
 const forged=await request.get('http://localhost:4317/auth/callback?state=forged&openid.mode=id_res',{maxRedirects:0});expect(forged.headers().location).toBe('/?authError=invalid');
 const auth=await request.get('http://localhost:4317/auth/steam',{maxRedirects:0});expect(auth.headers().location).toMatch(/^https:\/\/steamcommunity.com\/openid\/login/);
 expect(auth.headers()['set-cookie']).toContain('HttpOnly');
});
test('signed-in workflow shows real scan data, partial failures and friend privacy errors',async({page})=>{
 const record={appid:548430,name:'Fixture: Deep Rock Galactic',genres:['Action'],minutes:300,lastPlayed:1700000000,events:[{id:'news1',title:'Major update available now',date:1750000000,kind:'major',url:'https://steamcommunity.com/'}]};
 await page.route('**/api/session',r=>r.fulfill({json:{user:{name:'Testspieler',steamid:'test'},keyConfigured:true,hasKey:true}}));
 await page.route('**/api/preferences',r=>r.fulfill({json:{preferences:[]}}));
 await page.route('**/api/scan',r=>r.fulfill({json:{status:'complete',games:[record],done:4,total:4,failed:1,truncated:1,metadataFailed:0,unknownCount:2}}));
 await page.route('**/api/friends',r=>r.fulfill({json:{friends:[{steamid:'friend1',name:'Freund Eins'},{steamid:'friend2',name:'Freund Zwei'}]}}));
 await page.route('**/api/coop',r=>r.fulfill({json:{status:'error',games:[],error:'Spieledetails sind nicht sichtbar.'}}));
 await page.goto('http://localhost:4317');
 await expect(page.locator('.mode-pill')).toContainText('Deine Steam-Bibliothek');
 await expect(page.locator('.game-card h3')).toHaveText(record.name);
 await expect(page.locator('.notice')).toContainText('1 News-Abfragen fehlgeschlagen');
 await page.getByRole('button',{name:'Gemeinsame Spiele prüfen'}).click();
 await expect(page.getByRole('alert')).toContainText('Spieledetails sind nicht sichtbar');
 await expect(page.getByRole('button',{name:'Rad drehen',exact:true})).toBeDisabled();
});
test('WebMCP genre tool updates the same state and rejects unknown input',async({page})=>{
 await page.addInitScript(()=>{window.registeredTools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool,{signal}){window.registeredTools[tool.name]=tool;signal.addEventListener('abort',()=>delete window.registeredTools[tool.name]);}}});});
 await page.goto('http://localhost:4317');
 await expect.poll(()=>page.evaluate(()=>Boolean(window.registeredTools.filter_replay_games))).toBe(true);
 const result=await page.evaluate(()=>window.registeredTools.filter_replay_games.execute({genre:'Simulation'}));
 expect(result.genre).toBe('Simulation');await expect(page.locator('.game-card')).toHaveCount(1);
 expect(await page.evaluate(async()=>{try{await window.registeredTools.filter_replay_games.execute({genre:'invalid'});return false;}catch{return true;}})).toBe(true);
 await expect(page.getByLabel('Genre',{exact:true})).toHaveValue('Simulation');
});
test('dismiss, snooze, reload persistence and restore leave the coop pool unchanged',async({page})=>{
 await page.goto('http://localhost:4317');
 await page.getByRole('button',{name:'Keine Lust auf Satisfactory',exact:true}).click();
 await expect(page.locator('.game-card h3').filter({hasText:'Satisfactory'})).toHaveCount(0);
 await expect(page.locator('.wheel-caption')).toContainText('6 GEMEINSAME');
 await page.reload();
 await expect(page.getByRole('button',{name:'1 zurückgestellt'})).toBeVisible();
 await page.getByRole('button',{name:'Risk of Rain 2 später zeigen',exact:true}).click();
 await page.getByRole('button',{name:'3 Tage',exact:true}).click();
 await expect(page.getByRole('button',{name:'2 zurückgestellt'})).toBeVisible();
 await page.getByRole('button',{name:'Rückgängig',exact:true}).click();
 await expect(page.getByRole('button',{name:'1 zurückgestellt'})).toBeVisible();
 await page.getByRole('button',{name:'1 zurückgestellt'}).click();
 await page.getByRole('button',{name:'Wieder zeigen'}).click();
 await page.keyboard.press('Escape');
 await expect(page.locator('.game-card h3').first()).toHaveText('Satisfactory');
});
test('expired snooze reappears on reload',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('rr_demo_preferences',JSON.stringify({526870:{appid:526870,name:'Satisfactory',action:'snooze',until:Date.now()-1}})));
 await page.goto('http://localhost:4317');await expect(page.locator('.game-card h3').first()).toHaveText('Satisfactory');
 await expect(page.getByRole('button',{name:/zurückgestellt/})).toHaveCount(0);
});

test('first visit introduction persists and remains available from footer',async({page})=>{
 await page.goto('http://localhost:4317');await page.evaluate(()=>localStorage.removeItem('rr_intro_seen'));await page.reload();
 await expect(page.getByRole('dialog')).toContainText('Worum geht');
 await expect(page.getByRole('link',{name:/Quellcode/})).toHaveAttribute('href','https://github.com/operatorofthings/replay-radar');
 await page.getByRole('button',{name:'Los geht’s'}).click();await page.reload();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'So funktioniert’s'}).click();await expect(page.getByRole('dialog')).toBeVisible();
});
test('score explanation, quick action and separate coop preferences work',async({page})=>{
 await page.goto('http://localhost:4317');
 await page.getByLabel('Score für Satisfactory erklären').click();await expect(page.locator('.score-breakdown').first()).toContainText('Abwechslung');await page.getByLabel('Score für Satisfactory erklären').click();await page.locator('h1').click();
 await page.getByRole('button',{name:'Satisfactory sofort bis morgen ausblenden'}).click();await expect(page.locator('.game-card h3').filter({hasText:'Satisfactory'})).toHaveCount(0);
 await page.locator('.coop-library summary').click();
 await page.getByRole('button',{name:'Satisfactory im Koop für 3 Tage ausblenden',exact:true}).click();await expect(page.locator('.wheel-caption')).toContainText('5 GEMEINSAME');
 await page.reload();await expect(page.locator('.wheel-caption')).toContainText('5 GEMEINSAME');
 await page.getByLabel('Replay-Score gewichten').check();await page.locator('.coop-library summary').click();
 await page.getByLabel('Koop-Spiel suchen').fill('Risk of Rain');await expect(page.locator('.coop-library-row')).toHaveCount(1);
 await expect(page.locator('.coop-library-row')).toContainText('Gewinnchance');
});
test('large coop libraries keep every candidate accessible',async({page})=>{
 const games=Array.from({length:250},(_,i)=>({appid:i+1,name:`Coop title ${i+1}`,genres:['Action']}));
 await page.route('**/api/session',r=>r.fulfill({json:{user:{name:'Test'},hasKey:true}}));
 await page.route('**/api/preferences',r=>r.fulfill({json:{preferences:[]}}));
 await page.route('**/api/scan',r=>r.fulfill({json:{status:'complete',games:[]}}));
 await page.route('**/api/friends',r=>r.fulfill({json:{friends:[{steamid:'friend',name:'Friend'}]}}));
 await page.route('**/api/coop',r=>r.fulfill({json:{status:'complete',games}}));
 await page.goto('http://localhost:4317');await page.getByRole('button',{name:'Gemeinsame Spiele prüfen'}).click();
 await expect(page.locator('.wheel-caption')).toContainText('250 GEMEINSAME');await page.locator('.coop-library summary').click();await expect(page.locator('.coop-library-row')).toHaveCount(250);
 await page.getByLabel('Koop-Spiel suchen').fill('title 250');await expect(page.locator('.coop-library-row')).toHaveCount(1);
});

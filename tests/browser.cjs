// npm run build && node tests/browser.cjs [--before=path/to/old/dist]
// Local fixture API: no production credentials or writes. Chromium must be installed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const vm=require('node:vm'),zlib=require('node:zlib'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const before=process.argv.find(arg=>arg.startsWith('--before='))?.slice(9);
const responsiveOnly=process.argv.includes('--responsive-only');
const plainRegression=process.argv.includes('--plain-regression');
const root=path.resolve(before||'dist');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync('reviewer-data.js','utf8'),sandbox);
const starter=JSON.parse(JSON.stringify(sandbox.window.RECALL_STARTER_REVIEWER));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const output=path.resolve('output/performance');fs.mkdirSync(output,{recursive:true});
let reviewers=[],requests=[],bytes=0,owner=false,failMedia=false;
function project(reviewer){return {...reviewer,questions:reviewer.questions.map(q=>{
  const replace=source=>source?.startsWith('data:image/')?`/api/library?id=${reviewer.id}&media=${hash(source)}&v=v1`:source;
  return {...q,...(q.images?{images:q.images.map(replace)}:{}),...(q.image?{image:replace(q.image)}:{})};
})};}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(req.url);
  let content,type='application/json',cache='no-store';
  if(url.pathname==='/api/auth'){
    if(req.method==='POST'){let data='';for await(const chunk of req)data+=chunk;owner=JSON.parse(data).action!=='logout';}
    content=JSON.stringify({owner,username:'fixture-owner',configured:true});
  }
  else if(url.pathname==='/api/library'){
    const id=url.searchParams.get('id');
    if(!id)content=JSON.stringify({initialized:true,revision:'library-v1',entries:reviewers.map(r=>({id:r.id,title:r.title,questionCount:r.questions.length,updatedAt:1,reviewerRevision:'v1'}))});
    else {
      const reviewer=reviewers.find(r=>r.id===id);
      if(!reviewer){res.writeHead(404);return res.end('{}');}
      if(url.searchParams.has('media')){
        if(failMedia){failMedia=false;res.writeHead(503,{'Cache-Control':'no-store'});return res.end();}
        const source=reviewer.questions.flatMap(q=>[...(q.images||[]),q.image].filter(Boolean)).find(s=>hash(s)===url.searchParams.get('media'));
        if(!source){res.writeHead(404);return res.end('{}');}
        type=source.slice(5,source.indexOf(';'));content=Buffer.from(source.split(',')[1],'base64');cache='private, max-age=31536000, immutable';
      }else{
        const data=JSON.stringify(url.searchParams.has('v')&&!url.searchParams.has('raw')?project(reviewer):reviewer);
        const size=600000;
        content=data.length<=size?JSON.stringify({reviewer:JSON.parse(data)}):url.searchParams.has('part')?JSON.stringify({data:data.slice(Number(url.searchParams.get('part'))*size,(Number(url.searchParams.get('part'))+1)*size)}):JSON.stringify({chunks:Math.ceil(data.length/size)});
      }
    }
  }else{
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    content=fs.readFileSync(file);type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
    cache=url.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache';
  }
  const raw=Buffer.isBuffer(content)?content:Buffer.from(content);
  const etag='"'+hash(raw)+'"';
  if(req.headers['if-none-match']===etag){res.writeHead(304,{ETag:etag});return res.end();}
  const body=zlib.gzipSync(raw);bytes+=body.length;
  res.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Content-Length':body.length,'Cache-Control':cache,ETag:etag});res.end(body);
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.REV_BROWSER_EXECUTABLE?{executablePath:process.env.REV_BROWSER_EXECUTABLE}:{})});
    const results=[];
    for(const heavy of responsiveOnly||plainRegression?[]:[false,true])for(const plain of before?[false]:[false,true]){
      reviewers=Array.from({length:4},(_,i)=>({...starter,id:'fixture-'+i,title:(heavy?'Image-heavy':'Small')+' reviewer '+(i+1),
        questions:heavy?[starter.questions[5],...starter.questions.filter((_,i)=>i!==5)]:starter.questions.slice(0,12).map(q=>{const {image,images,...rest}=q;return rest;})}));
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,reducedMotion:'reduce'});
      if(plain)await context.addInitScript(()=>localStorage.setItem('rev-plain-mode','true'));
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      const cdp=await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      for(const warm of [false,true]){
        requests=[];bytes=0;
        const started=Date.now();await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelectorAll('[data-reviewer]').length===4&&!document.querySelector('#boot-screen'));
        const listMs=Date.now()-started;
        const startupRequests=[...requests];
        if(!before){
          assert.equal(startupRequests.some(url=>url.includes('/api/library?id=')),false,'catalog startup must not download question data');
          assert.equal(startupRequests.some(url=>/pdf|reviewer-data|exhibit-alts/.test(url)),false,'heavy tools and bundled fallback stay deferred');
          if(plain)assert.equal(startupRequests.some(url=>/\/styles-/.test(url)),false,'saved plain mode must not download normal decoration');
        }
        if(plain)await page.locator('#plain-reviewers').click();
        else await page.locator('#mobile-nav-toggle').click();
        await page.locator('[data-reviewer="fixture-0"]').click();
        await page.locator('#start-quiz').click();
        await page.locator('.answer-option').first().waitFor({state:'visible'});
        if(heavy)await page.waitForFunction(()=>[...document.querySelectorAll('.question-image')].every(img=>img.complete&&img.naturalWidth>0));
        const questionMs=Date.now()-started;
        const answerPaintMs=await page.evaluate(()=>new Promise(resolve=>{
          const start=performance.now();document.querySelector('[data-option="0"]').click();
          requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Math.round(performance.now()-start))));
        }));
        await page.waitForFunction(()=>document.querySelector('[data-option="0"]')?.getAttribute('aria-pressed')==='true');
        if(!before){
          assert.equal(requests.some(url=>/id=fixture-[123]/.test(url)),false,'unselected reviewers stay unloaded');
          if(warm)assert.equal(requests.some(url=>url.includes('/api/library?id=fixture-0')&&!url.includes('media=')),false,'repeat visits reuse IndexedDB reviewer content');
        }
        const vitals=await page.evaluate(()=>({resources:performance.getEntriesByType('resource').reduce((sum,item)=>sum+item.transferSize,0),animations:document.getAnimations().filter(a=>a.playState==='running').length}));
        const result={build:before?'before':'after',deck:heavy?'image-heavy':'small',mode:plain?'plain':'normal',visit:warm?'repeat':'cold',listMs,questionMs,answerPaintMs,gzipBodyBytes:bytes,resourceTransferBytes:vitals.resources};
        results.push(result);console.log(JSON.stringify(result));
        if(plain){
          assert.equal(await page.locator('.question-deck,#read-question,#copy-question,#shuffle-questions,#undo-answer,#print-review,#show-answer,#dont-know').count(),0);
          assert.equal(vitals.animations,0,'plain mode has no running decorative animation');
          await page.locator('#next-question').click();
          await page.locator('.feedback-area').filter({hasText:/Correct|Incorrect/}).waitFor();
          assert.match(await page.locator('.progress-copy').innerText(),/1 \/ 170|1 \/ 12/);
          await page.locator('#theme-toggle').click();
          await page.screenshot({path:path.join(output,`plain-${heavy?'heavy':'small'}-${warm?'repeat':'cold'}.png`),fullPage:true});
          // Switching layout must retain the checked answer and session position.
          await page.locator('#plain-mode-toggle').click();
          assert.equal(await page.locator('[data-option="0"]').getAttribute('aria-pressed'),'true');
          assert.match(await page.locator('.feedback-area').innerText(),/Correct|Incorrect/);
          await page.locator('#mobile-nav-toggle').click();
          await page.locator('#plain-mode-toggle').click();
        }
        await page.locator('#exit-quiz').click();
        assert.deepEqual(errors,[],'no browser errors');
      }
      await context.close();
    }
    if(!before&&!responsiveOnly&&!plainRegression){
      // Functional checks use the built app and fixture server without throttling.
      const context=await browser.newContext({viewport:{width:1280,height:900}});
      await context.addInitScript(()=>localStorage.setItem('rev-plain-mode','true'));
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.waitForFunction(()=>document.querySelectorAll('[data-reviewer]').length===4);
      failMedia=true;
      await page.locator('#plain-reviewers').click();await page.locator('[data-reviewer="fixture-0"]').click();await page.locator('#start-quiz').click();
      await page.locator('.exhibit-error').waitFor();await page.getByRole('button',{name:'Retry exhibit'}).click();
      await page.waitForFunction(()=>document.querySelector('.question-image')?.naturalWidth>0);
      await page.locator('[data-option="0"]').click();await page.locator('#next-question').click();
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rev-quiz-session-v1')));
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('[data-option="0"]')?.getAttribute('aria-pressed')==='true');
      assert.match(await page.locator('.feedback-area').innerText(),/Correct|Incorrect/);
      const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('rev-quiz-session-v1')));
      assert.deepEqual(restored.answers,saved.answers);assert.equal(restored.position,saved.position);
      await page.locator('#plain-mode-toggle').click();
      const downloadPromise=page.waitForEvent('download');await page.locator('#backup-library').click();
      const download=await downloadPromise;
      const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
      assert.equal(backup.reviewers.length,4,'backup includes unloaded reviewers');
      assert.ok(backup.reviewers.every(r=>r.questions.some(q=>(q.images||[]).some(src=>src.startsWith('data:image/')))),'backup contains portable original image bytes');
      // Owner import loads the actual bundled PDF engine and worker only on demand.
      await page.locator('#account-button').click();await page.locator('#account-username').fill('fixture-owner');await page.locator('#account-password').fill('fixture-password');
      await page.locator('#account-submit').click();await page.locator('#account-dialog').waitFor({state:'hidden'});
      await page.locator('#new-reviewer').click();await page.locator('[data-tab="file"]').click();
      const text='BT /F1 12 Tf 30 760 Td (Question 1) Tj 0 -22 Td (Which answer is right?) Tj 0 -22 Td (Choice A: one) Tj 0 -22 Td (Correct! Choice B: two) Tj ET';
      const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
      let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
      const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      requests=[];
      await page.locator('#file-input').setInputFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});
      await page.locator('#import-submit').click();await page.locator('.preview-question').waitFor({timeout:30000});
      assert.ok(requests.some(url=>/\/pdf-/.test(url)),'PDF code loads for an explicit PDF import');
      assert.ok(requests.some(url=>/pdf.worker.min.*\.mjs/.test(url)),'the real PDF worker loads');
      await page.locator('#cancel-import').click();
      await page.locator('#data-link').click();
      page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-local-data').click();
      await page.waitForFunction(()=>[...document.querySelectorAll('.toast')].some(el=>el.textContent==='Local study data deleted.'));
      assert.equal(await page.evaluate(()=>new Promise((resolve,reject)=>{
        const open=indexedDB.open('revvy-reviewers-v1');open.onerror=reject;
        open.onsuccess=()=>{const database=open.result;const query=database.transaction('reviewers').objectStore('reviewers').count();query.onsuccess=()=>{database.close();resolve(query.result);};};
      })),0,'device-data deletion clears the IndexedDB cache');
      assert.deepEqual(errors,[]);await context.close();owner=false;
      const blocked=await browser.newContext();
      await blocked.addInitScript(()=>{
        localStorage.setItem('rev-plain-mode','true');
        Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('Storage unavailable');}}});
      });
      const blockedPage=await blocked.newPage();await blockedPage.goto('http://127.0.0.1:'+server.address().port);
      await blockedPage.waitForFunction(()=>document.querySelectorAll('[data-reviewer]').length===4);
      await blockedPage.locator('#plain-reviewers').click();await blockedPage.locator('[data-reviewer="fixture-0"]').click();await blockedPage.locator('#start-quiz').click();
      await blockedPage.locator('.answer-option').first().waitFor();await blocked.close();
      // The existing file:// distribution still starts and can change layout.
      const offline=await browser.newContext();
      await offline.addInitScript(()=>localStorage.setItem('rev-plain-mode','true'));
      const filePage=await offline.newPage();await filePage.goto(require('node:url').pathToFileURL(path.resolve('index.html')).href);
      await filePage.locator('#plain-reviewers').click();await filePage.locator('[data-reviewer]').first().click();await filePage.locator('#start-quiz').click();await filePage.locator('[data-option="1"]').click();
      await filePage.locator('#plain-mode-toggle').click();await filePage.waitForFunction(()=>Boolean(document.querySelector('#normal-styles')?.sheet));
      assert.equal(await filePage.locator('[data-option="1"]').getAttribute('aria-pressed'),'true');
      await offline.close();console.log('Browser functional checks passed: restoration, image retry, portable backup, PDF import, cache deletion, blocked-storage fallback, and file:// layout switching.');
    }
    if(!before&&!responsiveOnly){
      reviewers=Array.from({length:4},(_,i)=>({...starter,id:'fixture-'+i,title:'Plain layout reviewer '+(i+1),questions:[starter.questions[5],...starter.questions.slice(0,3)]}));
      for(const width of [390,1280,1920])for(const dark of [false,true]){
        const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
        await context.addInitScript(()=>localStorage.setItem('rev-motion','off'));
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.waitForFunction(()=>document.querySelectorAll('[data-reviewer]').length===4);
        if(width<=760)await page.locator('#mobile-nav-toggle').click();
        await page.locator('[data-reviewer="fixture-0"]').click();await page.locator('#start-quiz').click();
        await page.locator('[data-option="0"]').click();
        if(width<=760)await page.locator('#mobile-nav-toggle').click();
        if(dark)await page.locator('#theme-toggle').click();
        await page.locator('#plain-mode-toggle').click();
        const verify=async expectedWidth=>{
          const layout=await page.evaluate(()=>{
            const body=getComputedStyle(document.body),main=document.querySelector('.main-area').getBoundingClientRect();
            const colors=[...document.querySelectorAll('body,#main-panel,.study-head,.study-chip,.question-card,.question-text,.answer-option,#next-question,#plain-header')].map(el=>{
              const style=getComputedStyle(el);return {name:el.id||el.className,color:style.color,background:style.backgroundColor};
            });
            return {display:body.display,background:body.backgroundColor,color:body.color,main:{left:main.left,width:main.width},colors,
              columns:getComputedStyle(document.querySelector('.answer-list')).gridTemplateColumns.split(' ').length,
              normalDisabled:!document.querySelector('#normal-styles')||document.querySelector('#normal-styles').disabled,
              scrollWidth:document.documentElement.scrollWidth};
          });
          assert.equal(layout.display,'block','Plain mode must not inherit the normal flex body');
          assert.equal(layout.background,dark?'rgb(0, 0, 0)':'rgb(255, 255, 255)','plain background is pure black or white');
          assert.equal(layout.color,dark?'rgb(255, 255, 255)':'rgb(0, 0, 0)');
          assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'),dark?'#000':'#fff');
          assert.equal(layout.normalDisabled,true,'normal stylesheet must be inactive after switching to Plain mode');
          for(const color of layout.colors){
            assert.ok(['rgb(0, 0, 0)','rgb(255, 255, 255)'].includes(color.color),`${color.name} has a non-monochrome foreground: ${color.color}`);
            assert.ok(['rgb(0, 0, 0)','rgb(255, 255, 255)','rgba(0, 0, 0, 0)'].includes(color.background),`${color.name} has a tinted background: ${color.background}`);
          }
          assert.equal(layout.columns,expectedWidth>=1024?2:1,'desktop and mobile must have different answer layouts');
          if(expectedWidth>=1024)assert.ok(layout.main.width>=1000,'desktop must use a wide quiz workspace');
          assert.ok(Math.abs(layout.main.left+layout.main.width/2-expectedWidth/2)<2,'workspace is centered');
          assert.ok(layout.scrollWidth<=expectedWidth+1);
          assert.equal(await page.locator('[data-option="0"]').getAttribute('aria-pressed'),'true','switching layouts retains the answer');
        };
        await verify(width);
        await page.keyboard.press('2');
        assert.equal(await page.locator('[data-option="1"]').getAttribute('aria-pressed'),'true','mobile menu state must not block Plain-mode keyboard shortcuts');
        await page.keyboard.press('1');
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:path.join(output,`plain-switch-${width}-${dark?'dark':'light'}.png`),fullPage:true});
        await page.reload();await page.waitForFunction(()=>document.querySelector('[data-option="0"]')?.getAttribute('aria-pressed')==='true');
        await verify(width);
        const rotatedWidth=width<1024?1280:390;
        await page.setViewportSize({width:rotatedWidth,height:900});await verify(rotatedWidth);
        await page.locator('#plain-mode-toggle').click();await page.locator('.question-deck').waitFor();
        assert.equal(await page.locator('[data-option="0"]').getAttribute('aria-pressed'),'true');
        if(rotatedWidth<=760&&!await page.locator('body').evaluate(el=>el.classList.contains('mobile-nav-open')))await page.locator('#mobile-nav-toggle').click();
        await page.locator('#plain-mode-toggle').click();await verify(rotatedWidth);
        assert.deepEqual(errors,[]);await context.close();
        console.log(`Plain mode regression passed: ${width}px ${dark?'dark':'light'}, normal-to-plain, reload, resize, and repeated switching.`);
      }
    }
    if(!before&&!plainRegression){
      reviewers=Array.from({length:4},(_,i)=>({...starter,id:'fixture-'+i,title:'Responsive reviewer '+(i+1),questions:[starter.questions[5],...starter.questions.slice(0,3)]}));
      for(const viewport of [{width:320,height:640},{width:390,height:844},{width:768,height:1024},{width:1280,height:900},{width:1920,height:1080}])for(const plain of [false,true]){
        const context=await browser.newContext({viewport,reducedMotion:'reduce'});
        await context.addInitScript(plain=>{localStorage.setItem('rev-plain-mode',String(plain));localStorage.setItem('rev-motion','off');},plain);
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.waitForFunction(()=>document.querySelectorAll('[data-reviewer]').length===4);
        if(plain){
          await page.locator('#plain-reviewers').click();
          const header=await page.locator('#plain-header').boundingBox(),drawer=await page.locator('#sidebar').boundingBox();
          assert.ok(drawer.y>=header.y+header.height-1,'reviewer drawer starts below the responsive plain header');
        }else if(viewport.width<=760)await page.locator('#mobile-nav-toggle').click();
        await page.locator('[data-reviewer="fixture-0"]').click();await page.locator('#start-quiz').click();
        await page.waitForFunction(()=>document.querySelector('.question-image')?.naturalWidth>0);
        for(const theme of ['light','dark']){
          if(theme==='dark'){
            if(!plain&&viewport.width<=760)await page.locator('#mobile-nav-toggle').click();
            await page.locator('#theme-toggle').click();
            if(!plain&&viewport.width<=760)await page.locator('#mobile-nav-toggle').click();
          }
          const layout=await page.evaluate(()=>{
            const visible=selector=>[...document.querySelectorAll(selector)].filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height).map(el=>{
              const rect=el.getBoundingClientRect();return {name:el.id||el.className,left:rect.left,right:rect.right,width:rect.width,height:rect.height};
            });
            return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:visible('#main-panel .answer-option,#next-question,#prev-question,.question-image,.plain-header button')};
          });
          assert.ok(layout.scrollWidth<=layout.width+1,`${viewport.width}px ${plain?'plain':'normal'} ${theme}: horizontal overflow (${layout.scrollWidth})`);
          for(const control of layout.controls){
            assert.ok(control.left>=-1&&control.right<=layout.width+1,`${viewport.width}px ${plain?'plain':'normal'} ${theme}: ${control.name} extends outside the screen`);
            if(!String(control.name).includes('question-image'))assert.ok(control.height>=43,`${control.name} needs a usable touch target`);
          }
          await page.locator('[data-option="0"]').click();
          assert.equal(await page.locator('[data-option="0"]').getAttribute('aria-pressed'),'true');
          await page.evaluate(()=>scrollTo(0,0));
          await page.screenshot({path:path.join(output,`responsive-${plain?'plain':'normal'}-${viewport.width}-${theme}.png`),fullPage:true});
        }
        assert.deepEqual(errors,[]);await context.close();
        console.log(`Responsive checks passed: ${viewport.width}x${viewport.height}, ${plain?'plain':'normal'}, light and dark.`);
      }
    }
    if(!responsiveOnly&&!plainRegression)fs.writeFileSync(path.join(output,before?'before.json':'after.json'),JSON.stringify({profile:{latencyMs:80,downloadBytesPerSecond:200000,cpuSlowdown:4,viewport:'390x844'},results},null,2));
  }finally{await browser?.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});

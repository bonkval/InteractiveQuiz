const test=require('node:test');
const assert=require('node:assert/strict');
const {createClient}=require('../reviewer-client.js');

test('reviewer downloads deduplicate concurrent callers, pin every chunk, and tolerate unavailable storage',async()=>{
  const reviewer={id:'one',title:'Reviewer',questions:[{text:'Question?',options:[]}]};
  const data=JSON.stringify(reviewer),requests=[];
  const client=createClient({indexedDB:{open(){throw new Error('Storage blocked');}},fetch:async url=>{
    requests.push(url);
    const part=new URL(url,'https://study.test').searchParams.get('part');
    return {ok:true,json:async()=>part===null?{chunks:2}:{data:part==='0'?data.slice(0,30):data.slice(30)}};
  }});
  const [a,b]=await Promise.all([client.load({id:'one',reviewerRevision:'v1'}),client.load({id:'one',reviewerRevision:'v1'})]);
  assert.deepEqual(a,reviewer);assert.deepEqual(b,reviewer);
  assert.equal(requests.length,3);
  assert.ok(requests.every(url=>url.includes('&v=v1')));
});

test('failed downloads can be retried and invalid reviewers are never accepted',async()=>{
  let calls=0;
  const client=createClient({indexedDB:null,fetch:async()=>({ok:true,json:async()=>++calls===1?{reviewer:{id:'wrong',questions:[]}}:{reviewer:{id:'one',questions:[]}}})});
  await assert.rejects(client.load({id:'one'}),/invalid/);
  assert.equal((await client.load({id:'one'})).id,'one');
});

test('mixed-review and backup downloads have bounded concurrency and preserve source order',async()=>{
  const client=createClient({indexedDB:null,fetch:async()=>{}});
  let active=0,max=0;
  const result=await client.map([1,2,3,4,5,6],async item=>{
    active++;max=Math.max(active,max);
    await new Promise(resolve=>setTimeout(resolve,2));active--;return item*2;
  });
  assert.equal(max,3);assert.deepEqual(result,[2,4,6,8,10,12]);
});

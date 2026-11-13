/* Public reviewer cache. No cookies, account details or study answers are stored here. */
(function(root) {
  function createClient({fetch:request=root.fetch.bind(root),indexedDB=root.indexedDB}={}) {
    const inflight=new Map();
    let cacheEpoch=0;
    let database;
    function db() {
      return database ||= new Promise(resolve=>{
        if(!indexedDB)return resolve(null);
        let open;
        try{open=indexedDB.open('revvy-reviewers-v1',1);}catch{return resolve(null);}
        open.onupgradeneeded=()=>open.result.createObjectStore('reviewers',{keyPath:'id'});
        open.onsuccess=()=>{open.result.onversionchange=()=>open.result.close();resolve(open.result);};
        open.onerror=open.onblocked=()=>resolve(null);
      });
    }
    async function cache(action,id,value) {
      const connection=await db();if(!connection)return null;
      return new Promise(resolve=>{
        try{
          const transaction=connection.transaction('reviewers',action==='get'?'readonly':'readwrite');
          const store=transaction.objectStore('reviewers');
          const operation=action==='get'?store.get(id):action==='clear'?store.clear():action==='delete'?store.delete(id):store.put(value);
          let result=null;operation.onsuccess=()=>{result=operation.result;};
          transaction.oncomplete=()=>resolve(result);
          transaction.onerror=transaction.onabort=()=>resolve(null);
        }catch{resolve(null);}
      });
    }
    async function json(url) {
      const response=await request(url,{cache:'no-store',credentials:'same-origin'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Reviewer could not load. Try again.');
      return body;
    }
    async function load(entry,{raw=false}={}) {
      const revision=entry.reviewerRevision||'';
      const key=JSON.stringify([entry.id,revision,raw]);
      if(inflight.has(key))return inflight.get(key);
      const operation=(async()=>{
        const epoch=cacheEpoch;
        if(!raw&&revision){const saved=await cache('get',entry.id);if(saved?.revision===revision)return saved.reviewer;}
        const url=`/api/library?id=${encodeURIComponent(entry.id)}${revision?`&v=${encodeURIComponent(revision)}`:''}${raw?'&raw=1':''}`;
        const detail=await json(url);
        let reviewer=detail.reviewer;
        if(!reviewer&&Number.isInteger(detail.chunks)&&detail.chunks>0){
          const parts=[];
          for(let part=0;part<detail.chunks;part++){
            const item=await json(`${url}&part=${part}`);
            if(typeof item.data!=='string')throw new Error('Reviewer download was incomplete. Try again.');
            parts.push(item.data);
          }
          reviewer=JSON.parse(parts.join(''));
        }
        if(!reviewer||reviewer.id!==entry.id||!Array.isArray(reviewer.questions))throw new Error('Reviewer data is invalid. Try again.');
        if(!raw&&revision&&epoch===cacheEpoch)await cache('put',entry.id,{id:entry.id,revision,reviewer});
        return reviewer;
      })();
      inflight.set(key,operation);
      try{return await operation;}finally{inflight.delete(key);}
    }
    async function map(items,fn) {
      const results=new Array(items.length);let next=0;
      await Promise.all(Array.from({length:Math.min(3,items.length)},async()=>{
        while(next<items.length){const i=next++;results[i]=await fn(items[i]);}
      }));
      return results;
    }
    return {load,map,clear:()=>{cacheEpoch++;return cache('clear');},remove:id=>{cacheEpoch++;return cache('delete',id);}};
  }
  root.RevReviewerClient={createClient};
  if(typeof module!=='undefined')module.exports={createClient};
})(typeof window==='undefined'?globalThis:window);

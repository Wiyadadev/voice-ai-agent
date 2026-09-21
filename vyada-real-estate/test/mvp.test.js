import test from 'node:test';
import assert from 'node:assert/strict';
import { CallService, MemoryStore, validateUpdates } from '../core.js';
import { MockBrain, TelegramNotifier, CompatibleBrain, configuredServiceOptions } from '../providers.js';
import { createServer } from '../server.js';
const make = () => new CallService(new MockBrain(), new TelegramNotifier());

test('complete fictional rental call, summary, and idempotent finish', async () => {
  let sends = 0;
  const s = new CallService(new MockBrain(), { send: async () => { sends++; return { status: 'sent' }; } });
  const c = s.start();
  for (const text of ['rent','villa','Bophut','THB 40–50k/month','2 bedrooms','October','6 months','pet friendly','Saturday']) await s.turn(c.id,text);
  const [a,b] = await Promise.all([s.end(c.id), s.end(c.id)]);
  assert.equal(sends,1); assert.equal(a.summary,b.summary);
  assert.match(a.summary,/High intent/); assert.match(a.summary,/No booking made/);
  assert.equal(a.lead.lease_duration,'6 months'); assert.equal(a.delivery.status,'sent');
  await assert.rejects(s.turn(c.id,'change'),/ended/);
});
test('unknowns, skips, buy path, corrections and retractions', async () => {
  const s = make(), c = s.start();
  await s.turn(c.id,'buy'); await s.turn(c.id,'skip');
  assert.equal(s.store.get(c.id).pending,'location');
  await s.turn(c.id,'location: Bophut; budget: THB 8m total; bedrooms: 2; timeline: December');
  assert.equal(s.store.get(c.id).pending,'special_requirements');
  await s.turn(c.id,'bedrooms: 3; budget: clear');
  const ended = await s.end(c.id);
  assert.equal(ended.lead.bedrooms,'3'); assert.equal(ended.lead.budget,'Missing');
  assert.equal(ended.lead.lease_duration,'Missing'); assert.match(ended.summary,/Needs clarification/);
});
test('separate call memory and empty call', async () => {
  const s = make(), a = s.start(), b = s.start(); await s.turn(a.id,'rent');
  assert.equal((await s.end(b.id)).lead.intent,'Missing');
  assert.equal(s.store.get(a.id).lead.intent.value,'rent');
});
test('unquoted hallucinations rejected and failed turns preserve history', async () => {
  assert.throws(() => validateUpdates({ bedrooms: { value:'3', evidence:'3' } },'hello'),/Ungrounded/);
  const s = new CallService({ respond: async () => ({ updates:{ budget:{value:'100k',evidence:'100k'} },reply:'Hi' }) },new TelegramNotifier());
  const c = s.start(); await assert.rejects(s.turn(c.id,'hello'),/Ungrounded/);
  assert.equal(s.store.get(c.id).history.length,1); assert.equal(s.store.get(c.id).busy,false);
});
test('ending request stops questions and short tone adapts', async () => {
  const s = make(), c = s.start();
  assert.match((await s.turn(c.id,"I'm in a hurry")).reply,/Understood/);
  const end = await s.turn(c.id,'goodbye'); assert.equal(end.status,'ready_to_end'); assert.doesNotMatch(end.reply,/\?/);
});
test('Telegram dry run, request contract and failure preservation', async () => {
  assert.equal((await new TelegramNotifier({},()=>assert.fail('network')).send('test')).status,'dry-run');
  const sender = new TelegramNotifier({ enabled:true,token:'fake',chat:'sandbox' },async (url,options) => { assert.equal(url,'https://api.telegram.org/botfake/sendMessage'); assert.equal(JSON.parse(options.body).chat_id,'sandbox'); return { ok:true,json:async()=>({ok:true}) }; });
  assert.equal((await sender.send('fictional')).status,'sent');
  const s = new CallService(new MockBrain(),{send:async()=>{throw new Error('private credential');}});
  const ended = await s.end(s.start().id); assert.equal(ended.delivery.status,'failed'); assert.ok(ended.summary); assert.doesNotMatch(JSON.stringify(ended),/private credential/);
  await assert.rejects(new TelegramNotifier({enabled:true,token:'fake',chat:'sandbox'},async()=>({ok:true,json:async()=>({ok:false})})).send('test'));
});
test('compatible LLM request includes current call history and rejects malformed JSON', async () => {
  const s = make(), c = s.start(); await s.turn(c.id,'rent');
  const brain = new CompatibleBrain({base:'https://example.invalid/v1',key:'fake',model:'test'},async (url,options)=>{ const body = JSON.parse(options.body); assert.equal(body.messages[1].role,'assistant'); assert.ok(body.messages.some(m=>m.content==='rent')); assert.equal(body.response_format.type,'json_object'); return {ok:true,json:async()=>({choices:[{message:{content:'bad json'}}]})}; });
  await assert.rejects(brain.respond(s.store.get(c.id),'villa'));
  assert.throws(()=>configuredServiceOptions({LLM_PROVIDER:'openai'}));
});
test('HTTP startup, static UI, full API flow and origin protection', async t => {
  const server = createServer(make()); await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path,body={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/health')).status,200);
  assert.match(await (await fetch(base)).text(),/VYADA/);
  const c = await (await post('/api/calls')).json();
  assert.equal((await post(`/api/calls/${c.id}/turn`,{text:'rent'})).status,200);
  assert.equal((await (await post(`/api/calls/${c.id}/end`)).json()).delivery.status,'dry-run');
  assert.equal((await fetch(base+'/api/calls',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await post(`/api/calls/${c.id}/turn`,{text:'more'})).status,409);
});
test('expired call unavailable', () => { const store = new MemoryStore(); const c = store.create(); c.updated = 0; assert.throws(()=>store.get(c.id),/expired/); });

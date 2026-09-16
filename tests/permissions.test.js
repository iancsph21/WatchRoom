import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {request} from 'node:http';
import {createWatchRoom,validInput} from '../server.js';

async function setup(t, options={}) {
  const service=createWatchRoom({demo:true,...options});
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
  t.after(()=>service.close());
  const base=`http://127.0.0.1:${service.server.address().port}`;
  const post=async(path,body,token)=>{const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  const socket=async hello=>{
    const ws=new WebSocket(base.replace('http','ws')+'/ws'),messages=[];
    ws.on('message',(d,binary)=>messages.push(binary?{type:'binary',data:d}:JSON.parse(d)));
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    ws.send(JSON.stringify(hello));
    const next=async type=>{const until=Date.now()+2000;while(Date.now()<until){const i=messages.findIndex(m=>m.type===type);if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error(`Missing ${type}`);};
    return {ws,messages,next,send:m=>ws.send(JSON.stringify(m))};
  };
  const owner=await post('login',{name:'Owner'}),friend=await post('login',{name:'Friend'});
  const {code}=await post('rooms',{},owner.token);
  const a=await socket({type:'join',token:owner.token,room:code});await a.next('joined');
  const b=await socket({type:'join',token:friend.token,room:code});await b.next('joined');
  const pair=await post('pair',{room:code},owner.token);
  const host=await socket({type:'host',code:pair.code});await host.next('paired');
  return {post,socket,owner,friend,code,a,b,host,pair,base};
}
const settle=()=>new Promise(r=>setTimeout(r,80));
const videoPacket=(epoch,key=true)=>{const p=Buffer.alloc(18);p[0]=1;p[1]=key?1:0;p.writeUInt32LE(epoch,2);p.writeDoubleLE(123456,6);return p;};
test('browser host requires owner-issued one-use ticket, relays packets and supports late viewers',async t=>{
  const {post,socket,owner,friend,code,a}=await setup(t);
  assert.equal((await post('broadcast',{room:code},friend.token)).status,403);
  const link=await post('broadcast',{room:code},owner.token),ticket=new URL(link.url).hash.slice(1);
  const broadcaster=await socket({type:'broadcast',ticket});await broadcaster.next('host-ready');
  const replay=await socket({type:'broadcast',ticket});await new Promise(resolve=>replay.ws.once('close',resolve));
  broadcaster.send({type:'stream-start',codec:'vp8',width:1280,height:720,fps:30,epoch:5,audio:false});assert.equal((await a.next('stream-start')).fps,30);
  broadcaster.ws.send(videoPacket(5));assert.deepEqual((await a.next('binary')).data,videoPacket(5));
  const late=await socket({type:'join',token:friend.token,room:code});await late.next('joined');await late.next('stream-start');assert.equal((await late.next('binary')).data[1],1);
  broadcaster.ws.close();await a.next('stream-stop');
});
test('normal viewer cannot inject binary video',async t=>{
  const {b}=await setup(t);const closed=new Promise(resolve=>b.ws.once('close',(code)=>resolve(code)));b.ws.send(videoPacket(1));assert.equal(await closed,1008);
});
test('stale stream epochs cannot be injected',async t=>{
  const {post,socket,owner,code}=await setup(t);const link=await post('broadcast',{room:code},owner.token);
  const b=await socket({type:'broadcast',ticket:new URL(link.url).hash.slice(1)});await b.next('host-ready');b.send({type:'stream-start',codec:'vp8',width:1280,height:720,fps:30,epoch:2});await settle();
  const closed=new Promise(resolve=>b.ws.once('close',(code)=>resolve(code)));b.ws.send(videoPacket(1));assert.equal(await closed,1008);
});
test('room list requires sign-in and shows creator without pairing secrets',async t=>{
  const {base,owner}=await setup(t);
  assert.equal((await fetch(base+'/api/rooms')).status,401);
  const r=await fetch(base+'/api/rooms',{headers:{Authorization:`Bearer ${owner.token}`}});const data=await r.json();
  assert.equal(data.rooms[0].creator,'Owner');assert.equal(data.rooms[0].members,2);assert.equal(data.rooms[0].host,true);
  assert.equal('pair' in data.rooms[0],false);
});
test('host download is single-use and does not consume pairing; room close is owner-only',async t=>{
  const {base,owner,friend,post,socket}=await setup(t);
  const {code}=await post('rooms',{},owner.token);const p=await post('pair',{room:code},owner.token);
  const response=await fetch(base+'/host-file/'+p.download);assert.equal(response.status,200);
  const file=await response.json();assert.equal(file.code,p.code);assert.equal(file.server,base);
  assert.equal((await fetch(base+'/host-file/'+p.download)).status,410);
  const host=await socket({type:'host',code:file.code});await host.next('paired');
  assert.equal((await post(`rooms/${code}/close`,{},friend.token)).status,403);
  assert.equal((await post(`rooms/${code}/close`,{},owner.token)).status,200);
  const list=await (await fetch(base+'/api/rooms',{headers:{Authorization:`Bearer ${owner.token}`}})).json();assert.equal(list.rooms.some(r=>r.code===code),false);
});
test('host approval gates input, cannot be forged by viewers, revocation stops input',async t=>{
  const {a,b,host}=await setup(t);
  b.send({type:'input',kind:'key',key:'Space'});await settle();assert.equal(host.messages.some(m=>m.type==='input'),false);
  b.send({type:'request'});const request=await host.next('request');
  b.send({type:'decision',request:request.request,allow:true});
  b.send({type:'input',kind:'key',key:'Space'});await settle();assert.equal(host.messages.some(m=>m.type==='input'),false);
  host.send({type:'decision',request:request.request,allow:true});await host.next('grant');
  b.send({type:'input',kind:'key',key:'Space'});assert.equal((await host.next('input')).key,'Space');
  a.send({type:'input',kind:'key',key:'Enter'});await settle();assert.equal(host.messages.some(m=>m.type==='input'),false);
  host.send({type:'revoke'});await host.next('revoke');
  b.send({type:'input',kind:'key',key:'Space'});await settle();assert.equal(host.messages.some(m=>m.type==='input'),false);
});
test('pairing is owner-only and one-use; host connection cannot be replaced',async t=>{
  const {post,code,friend,pair,socket}=await setup(t);
  assert.equal((await post('pair',{room:code},friend.token)).status,403);
  const replay=await socket({type:'host',code:pair.code});
  await new Promise(resolve=>{if(replay.ws.readyState===WebSocket.CLOSED)resolve();else replay.ws.once('close',resolve);});
  assert.equal(replay.messages.some(m=>m.type==='paired'),false);
});
test('controller disconnect revokes; host disconnect clears preview',async t=>{
  const {a,b,host}=await setup(t);
  b.send({type:'request'});const request=await host.next('request');host.send({type:'decision',request:request.request,allow:true});await host.next('grant');
  b.ws.close();await host.next('revoke');host.ws.close();await a.next('clear');
});
test('expired control grants cannot send input',async t=>{
  const {b,host}=await setup(t,{grantMs:20});
  b.send({type:'request'});const request=await host.next('request');host.send({type:'decision',request:request.request,allow:true});await host.next('grant');await settle();
  b.send({type:'input',kind:'key',key:'Space'});await settle();assert.equal(host.messages.some(m=>m.type==='input'),false);
});
test('only paired host can publish frames',async t=>{
  const {a,b,host}=await setup(t);b.send({type:'frame',jpeg:'YWJj'});await settle();assert.equal(a.messages.some(m=>m.type==='frame'),false);
  host.send({type:'frame',jpeg:'YWJj'});assert.equal((await a.next('frame')).jpeg,'YWJj');
});
test('demo rejects public hosts and forwarded requests',async t=>{
  const {base}=await setup(t);
  const status=await new Promise((resolve,reject)=>{const req=request(base+'/api/config',{headers:{Host:'public.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(status,403);
  assert.equal((await fetch(base+'/api/config',{headers:{'X-Forwarded-For':'1.2.3.4'}})).status,403);
});
test('remote input has bounded coordinates, text, URLs and timing',()=>{
  for(const m of [{kind:'click',x:-1,y:0,button:'left'},{kind:'key',key:'F8'},{kind:'open',url:'file:///C:/Windows'},{kind:'open',url:'https://youtube.com.evil.example/'},{kind:'open',url:'https://user@youtube.com/'},{kind:'text',text:'hi\nrun'},{kind:'auto',seconds:1},{kind:'exec',command:'anything'}])assert.equal(validInput(m),false);
  assert.equal(validInput({kind:'open',url:'https://www.youtube.com/watch?v=abc'}),true);
  assert.equal(validInput({kind:'click',x:.5,y:.8,button:'left'}),true);
});

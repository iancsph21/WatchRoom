import express from 'express';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WebSocketServer, WebSocket} from 'ws';
import {readPacket,validStream} from './stream-protocol.js';

const id = (n = 24) => randomBytes(n).toString('hex');
const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const local = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function validInput(m) {
  if (m.kind === 'click') return [m.x, m.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) && ['left','right'].includes(m.button);
  if (m.kind === 'scroll') return Number.isInteger(m.amount) && Math.abs(m.amount) <= 5;
  if (m.kind === 'key') return ['Space','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Escape','Backspace','Tab','Home','End'].includes(m.key);
  if (m.kind === 'text') return typeof m.text === 'string' && m.text.length > 0 && m.text.length <= 200 && !/[\x00-\x1f\x7f]/.test(m.text);
  if (m.kind === 'auto') return Number.isInteger(m.seconds) && (m.seconds === 0 || (m.seconds >= 5 && m.seconds <= 60));
  if (m.kind === 'open') {
    try { const u = new URL(m.url); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['youtube.com','www.youtube.com','youtu.be','instagram.com','www.instagram.com'].includes(u.hostname); } catch { return false; }
  }
  return false;
}

export function createWatchRoom({demo = false, clientId = '', clientSecret = '', grantMs = 600000, publicOrigin = ''} = {}) {
  const app = express(), server = createServer(app);
  const sessions = new Map(), rooms = new Map(), pairs = new Map(), limits = new Map(), downloads = new Map(), broadcasts=new Map();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (demo && (!local(req.hostname) || req.headers['x-forwarded-host'] || req.headers['x-forwarded-for'])) return res.status(403).json({error:'Demo mode is local only. Disable it before tunnelling.'});
    next();
  });
  app.use(express.json({limit:'8kb'}));
  app.use('/api', (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    const bearer=(req.headers.authorization || '').replace(/^Bearer /,'');
    const key = sessions.has(bearer) ? bearer : req.socket.remoteAddress, now = Date.now();
    let b = limits.get(key); if (!b || b.until < now) {b = {count:0,until:now+60000}; limits.set(key,b);}
    if (++b.count > 120) return res.status(429).json({error:'Too many requests. Try again in a minute.'});
    next();
  });
  app.get('/api/config', (req,res) => res.json({demo,clientId,publicOrigin}));
  app.get('/healthz',(req,res)=>res.json({ok:true}));
  const login = (user, res, accessToken) => {const token=id(); sessions.set(token,{user,expires:Date.now()+3600000}); res.json({token,user,accessToken});};
  app.post('/api/login', async (req,res) => {
    if (demo) return login({id:id(8),username:String(req.body.name || 'Local tester').slice(0,40)},res);
    if (!clientId || !clientSecret) return res.status(503).json({error:'Configure Discord credentials on the server first.'});
    if (typeof req.body.code !== 'string' || req.body.code.length > 2048) return res.status(400).json({error:'Missing authorization code.'});
    try {
      const r = await fetch('https://discord.com/api/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code:req.body.code}),signal:AbortSignal.timeout(10000)});
      if (!r.ok) throw Error(); const t=await r.json();
      const u=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:`Bearer ${t.access_token}`},signal:AbortSignal.timeout(10000)});
      if (!u.ok) throw Error(); const user=await u.json(); login({id:user.id,username:user.username},res,t.access_token);
    } catch {res.status(401).json({error:'Discord sign-in failed. Relaunch the Activity and try again.'});}
  });
  const auth = (req,res,next) => {const s=sessions.get((req.headers.authorization || '').replace(/^Bearer /,'')); if (!s || s.expires < Date.now()) return res.status(401).json({error:'Session expired. Reload to sign in.'}); req.session=s; next();};
  app.get('/api/rooms',auth,(req,res)=>res.json({rooms:[...rooms.values()].filter(r=>r.host || r.broadcaster || r.viewers.size).map(r=>({code:r.code,creator:r.creator,host:!!(r.stream||r.host),members:r.viewers.size,full:r.viewers.size>=12}))}));
  app.post('/api/rooms',auth,(req,res) => {
    if (rooms.size >= 100 || [...rooms.values()].filter(r=>r.owner===req.session.user.id).length >= 3) return res.status(429).json({error:'Room limit reached.'});
    const code=id(8); rooms.set(code,{code,owner:req.session.user.id,creator:req.session.user.username,viewers:new Set(),host:null,pending:null,controller:null,until:0,created:Date.now()}); res.json({code});
  });
  app.post('/api/rooms/:code/close',auth,(req,res)=>{
    const r=rooms.get(req.params.code); if(!r || r.owner!==req.session.user.id)return res.status(403).json({error:'Only the host can close this room.'});
    rooms.delete(r.code);for(const [key,p] of pairs)if(p.room===r)pairs.delete(key);
    r.host?.close(1000,'Host ended the room');r.broadcaster?.close(1000,'Host ended the room');for(const v of r.viewers)v.close(1000,'Host ended the room');res.json({ok:true});
  });
  app.post('/api/broadcast',auth,(req,res)=>{
    const r=rooms.get(req.body.room);if(!r||r.owner!==req.session.user.id)return res.status(403).json({error:'Only the room creator can share a screen.'});
    if(r.broadcaster)return res.status(409).json({error:'Your browser host is already open. Use that tab or close it first.'});
    for(const [key,t] of broadcasts)if(t.room===r)broadcasts.delete(key);
    const ticket=id();broadcasts.set(ticket,{room:r,expires:Date.now()+120000,session:req.session});
    const origin=demo?`http://${req.headers.host}`:publicOrigin;
    if(!origin)return res.status(503).json({error:'Set the public server address first.'});
    res.json({url:`${origin}/host.html#${ticket}`});
  });
  app.post('/api/pair',auth,(req,res) => {
    const r=rooms.get(req.body.room); if (!r || r.owner!==req.session.user.id) return res.status(403).json({error:'Only the room creator can pair a computer.'});
    if (r.host) return res.status(409).json({error:'Disconnect the current companion first.'});
    for (const [key,p] of pairs) if (p.room===r) pairs.delete(key);
    const code=id(12),download=id(); pairs.set(code,{room:r,expires:Date.now()+120000}); downloads.set(download,{code,expires:Date.now()+120000}); res.json({code,download,expiresIn:120});
  });
  app.get('/host-file/:ticket',(req,res)=>{
    const d=downloads.get(req.params.ticket);if(!d || d.expires<Date.now() || !pairs.has(d.code))return res.status(410).send('Host file expired. Click Download host file again in TALWATCH.');
    const origin=demo?`http://${req.headers.host}`:publicOrigin;
    if(!origin)return res.status(503).send('Set PUBLIC_ORIGIN on the server first.');
    downloads.delete(req.params.ticket);res.setHeader('Cache-Control','no-store');res.attachment('WATCH-TALIM-host.talim');res.type('application/json').send(JSON.stringify({version:1,server:origin,code:d.code}));
  });
  app.get('/downloads/WATCH-TALIM-Companion.zip',(req,res)=>res.download(fileURLToPath(new URL('./dist/downloads/WATCH-TALIM-Companion.zip',import.meta.url)),'WATCH-TALIM-Companion.zip'));
  app.use(express.static(fileURLToPath(new URL('./dist',import.meta.url))));
  app.use((err,req,res,next) => res.status(400).json({error:'Invalid request.'}));
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:800000});
  const broadcast=(r,m)=>r.viewers.forEach(v=>send(v,m));
  const state=r=>broadcast(r,{type:'state',creator:r.creator,host:!!r.host,browserHost:!!r.broadcaster,streaming:!!r.stream,members:r.viewers.size,controller:r.controller?.user || null,until:r.until,pending:!!r.pending});
  const stopStream=r=>{r.stream=null;r.cache=[];r.cacheBytes=0;broadcast(r,{type:'stream-stop'});state(r);};
  const revoke=r=>{r.controller=null; r.until=0; r.pending=null; send(r.host,{type:'revoke'}); state(r);};
  wss.on('connection',(ws,req)=>{
    if (demo && (!local(new URL(`http://${req.headers.host}`).hostname) || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'])) return ws.close(1008,'Local demo only');
    ws.alive=true; ws.count=0; ws.window=Date.now();
    const authTimer=setTimeout(()=>{if (!ws.room) ws.close(1008,'Authenticate first');},5000);
    ws.on('pong',()=>ws.alive=true);
    ws.on('error',()=>{});
    ws.on('message',(data,isBinary)=>{
      if(isBinary){
        const r=ws.room;if(ws.role!=='broadcast'||!r)return ws.close(1008,'Only the active browser host can send video');
        if(!r.stream)return;
        if(ws.session.expires<Date.now())return ws.close(1008,'Session expired; reopen host from TALWATCH');
        const packet=readPacket(data,r.stream.epoch);if(!packet)return ws.close(1008,'Invalid video packet');
        const now=Date.now();if(now-(ws.mediaWindow||0)>1000){ws.mediaWindow=now;ws.mediaBytes=0;ws.mediaCount=0;}
        ws.mediaBytes=(ws.mediaBytes||0)+data.length;ws.mediaCount=(ws.mediaCount||0)+1;
        if(ws.mediaBytes>2000000||ws.mediaCount>160)return ws.close(1008,'Stream exceeds bandwidth limit');
        if(packet.kind===1){
          if(packet.key){r.cache=[];r.cacheBytes=0;}
          if(packet.key || r.cache?.length){r.cache.push(data);r.cacheBytes+=data.length;if(r.cacheBytes>2000000){r.cache=[];r.cacheBytes=0;}}
        }
        for(const v of r.viewers){
          if(v.readyState!==WebSocket.OPEN)continue;
          if(v.bufferedAmount>500000){v.waitKey=true;continue;}
          if(v.waitKey){if(packet.kind!==1||!packet.key)continue;send(v,r.stream);v.waitKey=false;}
          v.send(data,{binary:true});
        }
        return;
      }
      let m; try {m=JSON.parse(data.toString());} catch {return ws.close(1008,'Invalid JSON');}
      if (!m || typeof m!=='object') return ws.close(1008,'Invalid message');
      if (Date.now()-ws.window>1000) {ws.count=0;ws.window=Date.now();}
      if (++ws.count>80) return ws.close(1008,'Rate limit');
      if (!ws.room) {
        if(m.type==='broadcast'){
          const t=broadcasts.get(m.ticket);if(!t||t.expires<Date.now()||!rooms.has(t.room.code)||t.room.broadcaster||t.session.expires<Date.now())return ws.close(1008,'Host link expired or already used. Open a new host link from TALWATCH.');
          broadcasts.delete(m.ticket);ws.role='broadcast';ws.room=t.room;ws.session=t.session;t.room.broadcaster=ws;
          send(ws,{type:'host-ready',creator:t.room.creator,demo});state(t.room);
        } else if (m.type==='host') {
          const p=pairs.get(m.code); if (!p || p.expires<Date.now() || p.room.host) return ws.close(1008,'Invalid or expired pairing code');
          pairs.delete(m.code); ws.role='host';ws.room=p.room;p.room.host=ws;
          send(ws,{type:'paired',room:p.room.code,members:p.room.viewers.size}); state(p.room);
        } else if (m.type==='join') {
          const s=sessions.get(m.token),r=rooms.get(m.room);
          if (!s || s.expires<Date.now() || !r || r.viewers.size>=12) return ws.close(1008,'Invalid session or room; rooms allow 12 viewers');
          ws.role='viewer';ws.user=s.user;ws.session=s;ws.room=r;r.viewers.add(ws);
          send(ws,{type:'joined',user:s.user,owner:r.owner===s.user.id}); state(r);
          if(r.stream){send(ws,r.stream);if(r.cache?.length){for(const packet of r.cache)ws.send(packet,{binary:true});}else ws.waitKey=true;}
        } else return ws.close(1008,'Authenticate first');
        clearTimeout(authTimer); return;
      }
      const r=ws.room;
      if (ws.role==='viewer' && ws.session.expires<Date.now()) return ws.close(1008,'Session expired');
      if (m.type==='heartbeat') return send(ws,{type:'heartbeat'});
      if(ws.role==='broadcast'){
        if(m.type==='stream-start'&&validStream(m)){
          r.stream={type:'stream-start',codec:'vp8',epoch:m.epoch,width:m.width,height:m.height,fps:30,audio:m.audio===true};r.cache=[];r.cacheBytes=0;
          for(const v of r.viewers){v.waitKey=true;send(v,r.stream);}state(r);
        }else if(m.type==='stream-stop')stopStream(r);
        return;
      }
      if (ws.role==='host') {
        if (m.type==='frame' && typeof m.jpeg==='string' && m.jpeg.length<750000 && /^[A-Za-z0-9+/=]+$/.test(m.jpeg)) {
          const now=Date.now(); if (now-(r.lastFrame||0)<180) return; r.lastFrame=now;
          for (const v of r.viewers) if (v.bufferedAmount<800000) send(v,{type:'frame',jpeg:m.jpeg});
        } else if (m.type==='decision' && r.pending && m.request===r.pending.id) {
          const p=r.pending; r.pending=null;
          if (m.allow===true && p.expires>Date.now() && r.viewers.has(p.ws)) {r.controller=p.ws;r.until=Date.now()+grantMs;send(ws,{type:'grant',request:p.id,until:r.until});}
          else send(p.ws,{type:'notice',message:'The host declined or the request expired.'}); state(r);
        } else if (m.type==='revoke') revoke(r);
        else if (m.type==='notice' && typeof m.message==='string') broadcast(r,{type:'notice',message:m.message.slice(0,160)});
        return;
      }
      if (m.type==='request') {
        if (!r.host || r.controller || r.pending) return send(ws,{type:'notice',message:'Wait until the host is connected and control is free.'});
        if (Date.now()-(ws.lastRequest||0)<10000) return send(ws,{type:'notice',message:'Wait a few seconds before requesting again.'});
        ws.lastRequest=Date.now();r.pending={id:id(12),ws,expires:Date.now()+30000};
        send(r.host,{type:'request',request:r.pending.id,user:ws.user,expires:r.pending.expires});state(r);
      } else if (m.type==='release' && r.controller===ws) revoke(r);
      else if(m.type==='stop-browser'&&r.owner===ws.user.id){send(r.broadcaster,{type:'stop-sharing'});stopStream(r);}
      else if (m.type==='stop' && r.owner===ws.user.id) {revoke(r);r.host?.close(1000,'Room owner stopped sharing');}
      else if (m.type==='input' && r.controller===ws && r.until>Date.now() && validInput(m)) send(r.host,{...m,type:'input'});
    });
    ws.on('close',()=>{
      clearTimeout(authTimer);const r=ws.room;if (!r) return;
      if(ws.role==='broadcast'){r.broadcaster=null;stopStream(r);}
      else if (ws.role==='host') {r.host=null;revoke(r);broadcast(r,{type:'clear'});}
      else {r.viewers.delete(ws);if (r.controller===ws || r.pending?.ws===ws) revoke(r);}
      state(r);
      if (!r.host && !r.broadcaster && !r.viewers.size) {
        rooms.delete(r.code);
        for (const [key,p] of pairs) if (p.room===r) pairs.delete(key);
      }
    });
  });
  const timer=setInterval(()=>{
    const now=Date.now();
    for (const r of rooms.values()) {
      if ((r.until && r.until<now) || (r.pending && r.pending.expires<now)) revoke(r);
      if (!r.host && !r.broadcaster && !r.viewers.size && now-r.created>3600000) rooms.delete(r.code);
    }
    for (const [k,p] of pairs) if (p.expires<now) pairs.delete(k);
    for (const [k,d] of downloads) if (d.expires<now) downloads.delete(k);
    for (const [k,t] of broadcasts) if (t.expires<now) broadcasts.delete(k);
    for (const [k,s] of sessions) if (s.expires<now) sessions.delete(k);
    for (const [k,l] of limits) if (l.until<now) limits.delete(k);
    for (const ws of wss.clients) {if (!ws.alive) ws.terminate();else {ws.alive=false;ws.ping();}}
  },5000); timer.unref();
  return {server,close:async()=>{clearInterval(timer);for(const ws of wss.clients) ws.terminate();await new Promise(resolve=>server.close(resolve));wss.close();}};
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const demo=process.env.DEMO_MODE==='true';
  if (demo && !['127.0.0.1','localhost'].includes(process.env.HOST || '127.0.0.1')) throw Error('Demo mode must bind to localhost.');
  createWatchRoom({demo,clientId:process.env.DISCORD_CLIENT_ID,clientSecret:process.env.DISCORD_CLIENT_SECRET,publicOrigin:process.env.PUBLIC_ORIGIN||''}).server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`WATCH TALIM: http://localhost:${process.env.PORT||3000} (${demo?'LOCAL DEMO':'Discord authentication'})`));
}

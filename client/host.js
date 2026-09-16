import './style.css';
const $=s=>document.querySelector(s);
let ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);
let socket,stream,encoder,reader,audioContext,sampleAudio,epoch=0,generation=0,active=false,ready=false,frames=0,bytes=0,dropped=0,animation;
const status=t=>$('#host-status').textContent=t;
const send=m=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(m));};
function packet(kind,key,timestamp,length){const data=new Uint8Array(14+length),view=new DataView(data.buffer);data[0]=kind;data[1]=key?1:0;view.setUint32(2,epoch,true);view.setFloat64(6,timestamp,true);return data;}
function stop(message='Sharing stopped. You can choose another screen.'){
  active=false;generation++;clearInterval(animation);animation=null;
  reader?.cancel().catch(()=>{});reader=null;
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  if(encoder?.state!=='closed')try{encoder?.close();}catch{}encoder=null;
  audioContext?.close().catch(()=>{});audioContext=null;
  sampleAudio?.close().catch(()=>{});sampleAudio=null;
  $('#local-video').srcObject=null;$('#share').disabled=!ready;$('#sample').disabled=!ready;$('#stop-share').disabled=true;
  $('#metrics').textContent='Not streaming · target 720p / 30 FPS';
  send({type:'stream-stop'});status(message);
}
async function begin(source){
  if(active){source.getTracks().forEach(t=>t.stop());return;}
  stream=source;active=true;const run=++generation;epoch=(epoch+1)>>>0||1;frames=bytes=dropped=0;
  const track=stream.getVideoTracks()[0];track.addEventListener('ended',()=>{if(run===generation)stop();});
  $('#local-video').srcObject=stream;await $('#local-video').play();
  if(run!==generation)return;
  const settings=track.getSettings(),srcW=settings.width||$('#local-video').videoWidth,srcH=settings.height||$('#local-video').videoHeight;
  const scale=Math.min(1,1280/srcW,720/srcH),width=Math.max(16,Math.floor(srcW*scale/2)*2),height=Math.max(16,Math.floor(srcH*scale/2)*2);
  const options={codec:'vp8',width,height,bitrate:2000000,framerate:30,latencyMode:'realtime',hardwareAcceleration:'no-preference'};
  if(!globalThis.VideoEncoder || !(await VideoEncoder.isConfigSupported(options)).supported)throw Error('This browser cannot encode the live stream. Open this host link in current Chrome or Edge.');
  if(run!==generation)return;
  encoder=new VideoEncoder({output:chunk=>{
    if(run!==generation||socket.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>1500000){stop('Upload is too slow. Try sharing a smaller window or check the connection.');return;}
    const p=packet(1,chunk.type==='key',chunk.timestamp,chunk.byteLength);chunk.copyTo(p.subarray(14));socket.send(p);frames++;bytes+=p.length;
  },error:e=>stop(`Video encoder stopped: ${e.message}`)});encoder.configure(options);
  send({type:'stream-start',codec:'vp8',epoch,width,height,fps:30,audio:stream.getAudioTracks().length>0});
  $('#share').disabled=true;$('#sample').disabled=true;$('#stop-share').disabled=false;status('Live! Friends can watch inside TALWATCH. Use the browser’s Stop sharing button anytime.');
  const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',{alpha:false});let last=0,lastKey=-Infinity;
  function encode(image){
    if(run!==generation||!active)return;const now=performance.now();
    if(encoder.encodeQueueSize>2 || socket.bufferedAmount>400000){dropped++;return;}
    last=now;context.drawImage(image,0,0,width,height);const frame=new VideoFrame(canvas,{timestamp:Math.round(now*1000)});const key=now-lastKey>=1000;if(key)lastKey=now;
    try{encoder.encode(frame,{keyFrame:key});}finally{frame.close();}
  }
  if(globalThis.MediaStreamTrackProcessor){
    reader=new MediaStreamTrackProcessor({track}).readable.getReader();const current=reader;
    (async()=>{try{while(run===generation){const {value,done}=await current.read();if(done)break;try{encode(value);}finally{value.close();}}}catch(e){if(run===generation)stop(`Capture stopped: ${e.message}`);}})();
  }else{
    const video=$('#local-video');const tick=()=>{if(run!==generation)return;encode(video);video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);
  }
  if(stream.getAudioTracks().length){
    try{
      audioContext=new AudioContext();await audioContext.audioWorklet.addModule('/pcm-worklet.js');if(run!==generation){audioContext?.close();return;}
      const input=audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));const worklet=new AudioWorkletNode(audioContext,'talim-pcm');const mute=audioContext.createGain();mute.gain.value=0;
      worklet.port.onmessage=({data})=>{if(run!==generation||socket.readyState!==WebSocket.OPEN||socket.bufferedAmount>400000)return;const samples=new Int16Array(data);const p=packet(2,false,Math.round(performance.now()*1000),samples.byteLength);p.set(new Uint8Array(samples.buffer),14);socket.send(p);bytes+=p.length;};input.connect(worklet);worklet.connect(mute).connect(audioContext.destination);await audioContext.resume();
    }catch{status('Video is live. Audio was unavailable; try sharing a browser tab with “Share tab audio” enabled.');}
  }
}
$('#share').onclick=async()=>{
  if(!ready||active)return;
  try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Open this host page in desktop Chrome or Edge over HTTPS.');
    // Keep this call directly on the user gesture so the browser can show its picker.
    const source=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30},width:{ideal:1280},height:{ideal:720}},audio:true});
    await begin(source);
  }catch(e){stop(e.name==='NotAllowedError'?'Sharing cancelled. Click Share screen when ready.':e.message);}
};
$('#stop-share').onclick=()=>stop();
$('#sample').onclick=async()=>{
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');let n=0;
  animation=setInterval(()=>{n++;c.fillStyle='#131820';c.fillRect(0,0,1280,720);c.fillStyle='#d4fc84';c.fillRect((n*9)%1100,270,160,160);c.font='bold 48px sans-serif';c.fillText('WATCH TALIM · 30 FPS test',65,110);c.font='28px sans-serif';c.fillText(`Frame ${n} · synthetic pixels only`,65,180);},1000/30);
  try{const sample=canvas.captureStream(30);sampleAudio=new AudioContext();const tone=sampleAudio.createOscillator(),gain=sampleAudio.createGain(),dest=sampleAudio.createMediaStreamDestination();tone.frequency.value=440;gain.gain.value=.025;tone.connect(gain).connect(dest);tone.start();await sampleAudio.resume();sample.addTrack(dest.stream.getAudioTracks()[0]);await begin(sample);}catch(e){stop(e.message);}
};
setInterval(()=>{if(active){$('#metrics').textContent=`${frames} FPS sent · ${(bytes*8/1000000).toFixed(2)} Mbps · target 30 FPS`;frames=bytes=dropped=0;}},1000);
if(!/^[a-f0-9]{48}$/.test(ticket)){status('Open this page with Share screen in your TALWATCH room. Host links expire after two minutes.');}
else{
  socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
  socket.onopen=()=>{send({type:'broadcast',ticket});ticket='';};
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='host-ready'){ready=true;$('#share').disabled=false;$('#sample').hidden=!m.demo;status(`Ready to share in ${m.creator}’s room. Choose a tab, window, or screen below.`);}if(m.type==='stop-sharing')stop('Sharing stopped from your TALWATCH room.');};
  socket.onclose=e=>{ready=false;stop(e.reason||'Connection lost. Reopen Share screen from your TALWATCH room.');};
  socket.onerror=()=>status('Cannot connect to the server. Check that it is online.');
}
window.addEventListener('pagehide',()=>{stop();socket?.close();});

export class LivePlayer {
  constructor(canvas,status){this.canvas=canvas;this.status=status;this.context=canvas.getContext('2d',{alpha:false});this.epoch=0;this.frames=0;this.sources=new Set();this.onFrame=()=>{};}
  start(m){
    this.stop();this.epoch=m.epoch;this.waitKey=true;this.canvas.width=m.width;this.canvas.height=m.height;
    if(!globalThis.VideoDecoder){this.status('Live video needs desktop Chrome, Edge, or a recent Discord desktop client.');return;}
    try{this.decoder=new VideoDecoder({output:frame=>{try{this.context.drawImage(frame,0,0,this.canvas.width,this.canvas.height);this.frames++;this.lastFrame=Date.now();this.onFrame();}finally{frame.close();}},error:()=>{this.waitKey=true;this.status('Reconnecting video at the next keyframe…');}});this.decoder.configure({codec:'vp8',codedWidth:m.width,codedHeight:m.height,optimizeForLatency:true});}catch{this.status('This client cannot decode VP8 video. Try updating Discord or use Chrome.');}
  }
  receive(buffer){
    if(buffer.byteLength<14)return;const header=new DataView(buffer);if(header.getUint32(2,true)!==this.epoch)return;
    const type=header.getUint8(0),key=header.getUint8(1)===1,timestamp=header.getFloat64(6,true);
    if(type===2){if(this.audio?.state!=='running')return;const samples=new Int16Array(buffer.slice(14));const audio=this.audio.createBuffer(1,samples.length,24000);const channel=audio.getChannelData(0);for(let i=0;i<samples.length;i++)channel[i]=samples[i]/32768;
      const now=this.audio.currentTime;if(this.nextAudio>now+.4){for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();this.nextAudio=now+.06;}
      this.nextAudio=Math.max(this.nextAudio||0,now+.03);const source=this.audio.createBufferSource();source.buffer=audio;source.connect(this.audio.destination);source.onended=()=>this.sources.delete(source);this.sources.add(source);source.start(this.nextAudio);this.nextAudio+=audio.duration;return;
    }
    if(type!==1||!this.decoder)return;
    if(this.decoder.state!=='configured'||this.decoder.decodeQueueSize>5){this.waitKey=true;if(this.decoder.state==='configured')this.decoder.reset();}
    if(this.waitKey&&!key)return;
    if(key&&this.waitKey){if(this.decoder.state==='closed'){this.status('Decoder stopped. Leave and rejoin the room.');return;}if(this.decoder.state!=='configured')this.decoder.configure({codec:'vp8',codedWidth:this.canvas.width,codedHeight:this.canvas.height,optimizeForLatency:true});this.waitKey=false;}
    try{this.decoder.decode(new EncodedVideoChunk({type:key?'key':'delta',timestamp,data:new Uint8Array(buffer,14)}));}catch{this.waitKey=true;}
  }
  async toggleAudio(){if(!this.audio){this.audio=new AudioContext();this.nextAudio=0;await this.audio.resume();return true;}if(this.audio.state==='running'){await this.audio.suspend();return false;}this.nextAudio=0;await this.audio.resume();return true;}
  stop(){if(this.decoder?.state!=='closed')try{this.decoder?.close();}catch{}this.decoder=null;this.epoch=0;this.lastFrame=0;this.frames=0;for(const s of this.sources)try{s.stop();}catch{}this.sources.clear();this.nextAudio=0;this.context.clearRect(0,0,this.canvas.width,this.canvas.height);}
}

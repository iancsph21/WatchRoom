class TalimPCM extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Int16Array(1024);this.offset=0;this.phase=0;}
  process(inputs){
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      this.phase+=24000;
      if(this.phase>=sampleRate){this.phase-=sampleRate;let sample=0;for(const channel of channels)sample+=channel[i]||0;sample/=channels.length;
        this.buffer[this.offset++]=Math.round(Math.max(-1,Math.min(1,sample))*32767);
        if(this.offset===this.buffer.length){this.port.postMessage(this.buffer.buffer,[this.buffer.buffer]);this.buffer=new Int16Array(1024);this.offset=0;}
      }
    }
    return true;
  }
}
registerProcessor('talim-pcm',TalimPCM);

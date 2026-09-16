// Binary packets: kind (1=VP8, 2=24kHz mono PCM16), key flag, epoch u32, timestamp f64.
export const HEADER_BYTES=14;
export function readPacket(data,epoch){
  if(data.length<=HEADER_BYTES || data.length>600000)return null;
  const kind=data[0],key=data[1]===1;
  if(![1,2].includes(kind)||data[1]>1||data.readUInt32LE(2)!==epoch)return null;
  const timestamp=data.readDoubleLE(6);
  if(!Number.isFinite(timestamp)||timestamp<0)return null;
  if(kind===2 && (data.length>HEADER_BYTES+8192||(data.length-HEADER_BYTES)%2))return null;
  return {kind,key,timestamp};
}
export function validStream(m){return m.codec==='vp8'&&Number.isInteger(m.epoch)&&m.epoch>0&&m.epoch<=0xffffffff&&Number.isInteger(m.width)&&m.width>=16&&m.width<=1920&&Number.isInteger(m.height)&&m.height>=16&&m.height<=1080&&m.fps===30;}

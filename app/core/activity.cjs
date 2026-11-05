'use strict';
let Vad, loading;
async function prepareActivityDetector() {
  loading ||= import('@ozymandiasthegreat/vad').then(module => module.default()).then(value => { Vad = value; });
  await loading;
}
class ActivityDetector {
  constructor(rate, channels) {
    if (!Vad) throw new Error('The local voice detector is not ready.');
    this.rate=rate; this.channels=channels; this.windowFrames=Math.round(rate*.03); this.pending=[]; this.voicedFrames=0; this.voice=false; this.detector=new Vad(3,16000);
  }
  analyze(samples) {
    for(let i=0;i<samples.length;i+=this.channels){let mono=0;for(let c=0;c<this.channels;c++)mono+=samples[i+c]/this.channels;this.pending.push(mono);}
    let any=this.voice;
    while(this.pending.length>=this.windowFrames){
      const input=this.pending.splice(0,this.windowFrames), frame=new Int16Array(480); let energy=0;
      for(const x of input)energy+=x*x;
      const rms=Math.sqrt(energy/input.length),gain=4;
      for(let i=0;i<480;i++){const first=i*input.length/480,last=(i+1)*input.length/480;let sum=0,weight=0;for(let j=Math.floor(first);j<Math.ceil(last);j++){const w=Math.max(0,Math.min(j+1,last)-Math.max(j,first));sum+=(input[j]||0)*w;weight+=w;}frame[i]=Math.round(Math.max(-1,Math.min(1,sum/weight*gain))*32767);}
      const speech=this.detector.processFrame(frame)===1&&rms>=Math.pow(10,-66/20);
      this.voicedFrames=speech?this.voicedFrames+1:0;
      this.voice=speech&&this.voicedFrames>=3; any ||=this.voice;
    }
    return any;
  }
  destroy(){this.detector.destroy();}
}
function createActivityDetector(rate,channels){return Vad?new ActivityDetector(rate,channels):null;}
module.exports={prepareActivityDetector,ActivityDetector,createActivityDetector};

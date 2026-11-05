'use strict';
const LETTERS = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z','-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','-..-.':'/','.-.-.-':'.'};
class MorseDetector {
  constructor(rate, channels, emit) { this.rate=rate;this.channels=channels;this.emit=emit;this.on=false;this.edge=null;this.dot=.08;this.durations=[];this.symbol='';this.text='';this.startFrame=null;this.lastToneEnd=0;this.toneHz=0;this.pending=new Float32Array(0);this.pendingFrame=0; }
  ingest(samples,sourceFrame,thresholdDB=-55) {
    const mono=new Float32Array(samples.length/this.channels);for(let i=0;i<mono.length;i++)for(let c=0;c<this.channels;c++)mono[i]+=samples[i*this.channels+c]/this.channels;
    // Fixed 10 ms windows maintain timing across worklet batch boundaries.
    const joined=new Float32Array(this.pending.length+mono.length);joined.set(this.pending);joined.set(mono,this.pending.length);
    const origin=this.pending.length?this.pendingFrame:sourceFrame, size=Math.round(this.rate*.01);let offset=0;
    for(;offset+size<=joined.length;offset+=size){const block=joined.subarray(offset,offset+size);let energy=0;for(const x of block)energy+=x*x;energy/=size;let best=0,hz=0;
      for(let f=400;f<=1400;f+=50){const k=2*Math.cos(2*Math.PI*f/this.rate);let a=0,b=0;for(const x of block){const v=x+k*a-b;b=a;a=v;}const p=(a*a+b*b-k*a*b)*2/(size*size);if(p>best){best=p;hz=f;}}
      const tone=energy>Math.pow(10,Math.max(-65,thresholdDB)/10)&&best/Math.max(1e-12,energy)>.65;
      if(tone)this.toneHz=hz;this.step(tone,origin+offset);
    }
    this.pending=joined.slice(offset);this.pendingFrame=origin+offset;
  }
  step(tone,frame) {
    if(this.edge===null){this.edge=frame;this.on=tone;if(tone)this.startFrame=frame;return;}
    if(tone!==this.on){const duration=(frame-this.edge)/this.rate;
      if(this.on){if(duration>=.025&&duration<=1){this.symbol+=duration>this.dot*2?'-':'.';this.durations.push(duration);if(this.durations.length>30)this.durations.shift();const sorted=[...this.durations].sort((a,b)=>a-b);const shortest=sorted[Math.floor((sorted.length-1)*.2)];if(shortest<.15)this.dot=Math.min(.2,Math.max(.035,this.dot*.7+shortest*.3));}this.lastToneEnd=frame;}
      else if(tone){if(duration>this.dot*6&&this.text&&!this.text.endsWith(' '))this.text+=' ';if(this.startFrame===null)this.startFrame=frame;}
      this.on=tone;this.edge=frame;
    }
    if(!tone){const gap=(frame-this.edge)/this.rate;if(gap>=this.dot*2.3&&this.symbol){this.text+=LETTERS[this.symbol]||'?';this.symbol='';}if(gap>Math.max(1.2,this.dot*10)&&this.text)this.flush();}
  }
  flush(){if(this.symbol){this.text+=LETTERS[this.symbol]||'?';this.symbol='';}const text=this.text.trim();const candidate=text.match(/\b[A-Z0-9]{1,3}\d[A-Z]{1,4}(?:\/[A-Z0-9]+)?\b/);if(candidate&&text.length>=3&&!text.includes('?'))this.emit({text:candidate[0],decodedText:text,sourceStart:this.startFrame,sourceEnd:this.lastToneEnd,toneHz:this.toneHz,confidence:'candidate',method:'narrowband tone timing; verify against audio'});this.text='';this.startFrame=null;}
}
module.exports={MorseDetector,LETTERS};

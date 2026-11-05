'use strict';
const LETTERS = {'.-':'A','-...':'B','-.-.':'C','-..':'D','.':'E','..-.':'F','--.':'G','....':'H','..':'I','.---':'J','-.-':'K','.-..':'L','--':'M','-.':'N','---':'O','.--.':'P','--.-':'Q','.-.':'R','...':'S','-':'T','..-':'U','...-':'V','.--':'W','-..-':'X','-.--':'Y','--..':'Z','-----':'0','.----':'1','..---':'2','...--':'3','....-':'4','.....':'5','-....':'6','--...':'7','---..':'8','----.':'9','-..-.':'/','.-.-.-':'.'};
class MorseDetector {
  constructor(rate, channels, emit) { this.rate=rate;this.channels=channels;this.emit=emit;this.on=false;this.edge=null;this.dot=.08;this.pulses=[];this.lastToneEnd=0;this.toneHz=0;this.pending=new Float32Array(0);this.pendingFrame=0; }
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
    if(this.edge===null){this.edge=frame;this.on=tone;return;}
    if(tone!==this.on){const duration=(frame-this.edge)/this.rate;
      if(this.on){if(duration>=.025&&duration<=1)this.pulses.push({start:this.edge,end:frame,duration,hz:this.toneHz});this.lastToneEnd=frame;}
      this.on=tone;this.edge=frame;
    }
    if(!tone&&(frame-this.edge)/this.rate>1.3&&this.pulses.length)this.flush();
  }
  flush(){
    const pulses=this.pulses;this.pulses=[];if(pulses.length<5)return;
    // Infer speed from the complete train so an initial dash is not decoded
    // using an arbitrary default speed. Keep individual character boundaries.
    const candidates=new Set();for(const p of pulses)for(const unit of[p.duration,p.duration/3])if(unit>=.025&&unit<=.2)candidates.add(Math.round(unit*1000)/1000);
    let best;
    for(const dot of candidates){
      let text='',symbol='',first=null,last=null,cost=0,count=0;const characters=[];
      const commit=()=>{if(!symbol)return;text+=LETTERS[symbol]||'?';characters.push({start:first,end:last});symbol='';first=null;};
      for(let n=0;n<pulses.length;n++){
        const p=pulses[n],units=p.duration/dot,target=units>2?3:1;cost+=Math.min(4,(units-target)**2);count++;
        if(first===null)first=p.start;last=p.end;symbol+=target===3?'-':'.';
        if(n+1<pulses.length){const gap=(pulses[n+1].start-p.end)/this.rate/dot;cost+=Math.min(4,Math.min(...[1,3,7].map(x=>(gap-x)**2)));count++;if(gap>=2)commit();if(gap>=5){text+=' ';characters.push(null);}}
      }
      commit();const match=text.match(/\b[A-Z0-9]{1,3}\d[A-Z]{1,4}(?:\/[A-Z0-9]+)?\b/);const score=cost/count+(text.match(/\?/g)||[]).length;
      if(match&&!text.includes('?')&&(!best||score<best.score))best={dot,text,match,characters,score};
    }
    if(!best||best.score>.55)return;this.dot=best.dot;
    const first=best.characters[best.match.index],last=best.characters[best.match.index+best.match[0].length-1];
    if(first&&last)this.emit({text:best.match[0],decodedText:best.text.trim(),sourceStart:first.start,sourceEnd:last.end,toneHz:this.toneHz,confidence:'candidate',timingFit:best.score,method:'adaptive narrowband CW timing; verify against audio'});
  }
}
module.exports={MorseDetector,LETTERS};

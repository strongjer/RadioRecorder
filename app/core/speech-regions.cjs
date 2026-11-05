'use strict';
const {ActivityDetector,prepareActivityDetector}=require('./activity.cjs');
const {readMono16k}=require('./wav.cjs');
async function speechRegions(file,begin,end){
 await prepareActivityDetector();const detector=new ActivityDetector(16000,1),regions=[];let first=null,lastVoice=begin;
 try{for(let offset=begin;offset<end;offset+=3){const audio=readMono16k(file,offset,Math.min(3,end-offset));for(let n=0;n<audio.length;n+=480){const chunk=audio.subarray(n,Math.min(n+480,audio.length)),time=offset+n/16000;if(detector.analyze(chunk)){if(first===null)first=time;lastVoice=time+chunk.length/16000;}else if(first!==null&&time-lastVoice>.5){if(lastVoice-first>=.12)regions.push({start:Math.max(begin,first-.18),end:Math.min(end,lastVoice+.2)});first=null;}}}if(first!==null&&lastVoice-first>=.12)regions.push({start:Math.max(begin,first-.18),end:Math.min(end,lastVoice+.2)});}
 finally{detector.destroy();}
 return regions;
}
module.exports={speechRegions};

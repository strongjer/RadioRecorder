import wav from './wav.cjs';
import audio from './audio.cjs';
import captionsModule from './captions.cjs';
import speechRegionModule from './speech-regions.cjs';
import {transcribe} from './speech.mjs';
export async function transcribeRecording(pipe,metadata,file,{rangeStart=0,rangeEnd=metadata.duration,onProgress=()=>{}}={}){
 const captions=[],rate=metadata.format.sampleRate;
 for(const span of metadata.spans){const sourceBegin=Math.max(span.outputStart/rate,rangeStart),sourceEnd=Math.min(span.outputEnd/rate,rangeEnd);if(sourceBegin>=sourceEnd)continue;const regions=await speechRegionModule.speechRegions(file,sourceBegin,sourceEnd);
 for(const region of regions){const spanBegin=region.start,spanEnd=region.end,begin=spanBegin,end=spanEnd;
  for(let offset=begin;offset<end;offset+=24){const coreEnd=Math.min(end,offset+24),readStart=Math.max(spanBegin,offset-2),readEnd=Math.min(spanEnd,coreEnd+2),duration=readEnd-readStart;if(duration<.15)continue;
   const samples=wav.readMono16k(file,readStart,duration),result=await transcribe(pipe,samples,metadata.format.language||'auto');
   const words=(result.chunks||[]).map(word=>({text:word.text,timestamp:[readStart+Math.max(0,word.timestamp?.[0]||0),Math.min(spanEnd,readStart+(word.timestamp?.[1]??duration))]})).filter(word=>{const midpoint=(word.timestamp[0]+word.timestamp[1])/2;return midpoint>=offset&&midpoint<coreEnd;});
   for(const cue of captionsModule.groupAlignedWords(words,metadata.duration)){
    const start=cue.timestamp[0],end=cue.timestamp[1];if(end<=start)continue;
    captions.push({text:cue.text,language:result.language,languageConfidence:result.languageConfidence,timing:'word-aligned',words:cue.words,start,end,startUTC:audio.frameToUTC(metadata.spans,start*rate,rate),endUTC:audio.frameToUTC(metadata.spans,end*rate,rate,'end')});
   }
   onProgress(Math.min(100,Math.round(coreEnd/Math.max(.001,rangeEnd)*100)));
  }
 }
 }
 return captions;
}

import wav from './wav.cjs';
import audio from './audio.cjs';
import captionsModule from './captions.cjs';
import speechRegionModule from './speech-regions.cjs';
import { transcribe } from './speech.mjs';
export async function transcribeRecording(pipe, metadata, file, {rangeStart=0,rangeEnd=metadata.duration,onProgress=()=>{}}={}) {
 const captions=[], rate=metadata.format.sampleRate;
 const cw=(metadata.stationIdentifiers||[]).filter(id=>Number.isFinite(id.start)&&Number.isFinite(id.end));
 // One continuous VAD pass avoids false starts from resetting on each noise-only
 // chunk. Live batches retain a bounded amount of earlier detector context.
 const speech=await speechRegionModule.speechRegions(file,Math.max(0,rangeStart-30),rangeEnd);
 // VOX spans map UTC; they are not independent language contexts.
 for(let offset=rangeStart;offset<rangeEnd;offset+=24){
  const coreEnd=Math.min(rangeEnd,offset+24), windowStart=Math.max(0,offset-2), windowEnd=Math.min(rangeEnd,coreEnd+2);
  const evidence=speech.filter(region=>region.end>windowStart&&region.start<windowEnd);if(!evidence.length)continue;
  // Preserve normal acoustic context. Trim only a long leading silence, which
  // otherwise consumes the model's attention before the spoken phrase starts.
  const readStart=evidence[0].start-windowStart>8?Math.max(windowStart,evidence[0].start-2):windowStart;
  const readEnd=windowEnd,duration=readEnd-readStart;
  if(duration<.15)continue;
  const samples=wav.readMono16k(file,readStart,duration);
  // CW remains audible in the recording; only its speech-model input is muted.
  for(const id of cw){const from=Math.max(0,Math.floor((id.start-readStart)*16000)),to=Math.min(samples.length,Math.ceil((id.end-readStart)*16000));if(to>from)samples.fill(0,from,to);}
  const result=await transcribe(pipe,samples,metadata.format.language||'auto');
  const words=(result.chunks||[]).map(word=>({text:word.text,timestamp:[readStart+Math.max(0,word.timestamp?.[0]||0),Math.min(readEnd,readStart+(word.timestamp?.[1]??duration))]})).filter(word=>{
   const midpoint=(word.timestamp[0]+word.timestamp[1])/2;
   return midpoint>=offset&&midpoint<coreEnd&&!cw.some(id=>midpoint>=id.start-.1&&midpoint<=id.end+.1);
  });
  // Independent neural VAD evidence rejects invented words over tones/noise.
  const accepted=words.flatMap(word=>{
   const region=speech.find(r=>Math.min(r.end,word.timestamp[1])-Math.max(r.start,word.timestamp[0])>=.02);
   return region?[{...word,timestamp:[Math.max(region.start,word.timestamp[0]),Math.min(region.end,word.timestamp[1])]}]:[];
  });
  for(const cue of captionsModule.groupAlignedWords(accepted,metadata.duration)){
   const [start,end]=cue.timestamp;if(end<=start)continue;
   captions.push({text:cue.text,language:result.language,languageConfidence:result.languageConfidence,noSpeechProbability:result.noSpeechProbability,timing:'word-aligned',words:cue.words,start,end,startUTC:audio.frameToUTC(metadata.spans,start*rate,rate),endUTC:audio.frameToUTC(metadata.spans,end*rate,rate,'end')});
  }
  onProgress(Math.min(100,Math.round((coreEnd-rangeStart)/Math.max(.001,rangeEnd-rangeStart)*100)));
 }
 return captions;
}

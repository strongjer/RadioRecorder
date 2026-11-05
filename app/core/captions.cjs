'use strict';
// Build short readable cues from model-aligned words. Never distribute words
// uniformly across a coarse segment: timing comes from the audio alignment.
function groupAlignedWords(words, duration) {
 const result=[];let group=null;
 function finish(){if(group){group.timestamp[1]=Math.max(group.timestamp[0]+.02,Math.min(duration,group.timestamp[1]));result.push(group);group=null;}}
 for(const word of words||[]){if(!word.text?.trim())continue;const start=Math.max(0,Math.min(duration,Number(word.timestamp?.[0])||0)),end=Math.max(start,Math.min(duration,Number(word.timestamp?.[1])||start+.15));
  if(group&&(start-group.timestamp[1]>.5||end-group.timestamp[0]>2.5||group.count>=7))finish();
  if(!group)group={text:'',timestamp:[start,end],count:0,words:[]};
  group.text+=word.text;group.timestamp[1]=end;group.count++;group.words.push({text:word.text.trim(),start,end});
  if(/[.!?。！？]$/.test(word.text.trim()))finish();
 }
 finish();return result.map(({count,...cue})=>({...cue,text:cue.text.trim()}));
}
module.exports={groupAlignedWords};

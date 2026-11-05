import { Tensor } from '@huggingface/transformers';
// The runtime currently defaults to English when no language is supplied.
// Inspect Whisper's first decoder-token distribution to implement real language
// detection, then explicitly request transcription in the detected language.
export async function detectLanguage(pipe, audio) {
 const features = await pipe.processor(audio);
 const start = pipe.model.generation_config.decoder_start_token_id;
 const ids = new Tensor('int64', BigInt64Array.of(BigInt(start)), [1,1]);
 const output = await pipe.model({ input_features:features.input_features, decoder_input_ids:ids });
 const logits = output.logits.data, languages = pipe.model.generation_config.lang_to_id;
 let best=-Infinity, token='<|en|>', total=0;
 for(const [language,id]of Object.entries(languages))if(logits[id]>best){best=logits[id];token=language;}
 for(const id of Object.values(languages))total+=Math.exp(logits[id]-best);
 const result={language:token.slice(2,-2),confidence:1/total};
 const visited=new Set();function dispose(value){if(!value||typeof value!=='object'||visited.has(value))return;visited.add(value);if(value instanceof Tensor)value.dispose();else for(const child of Object.values(value))dispose(child);}
 dispose(output);dispose(features);dispose(ids);
 return result;
}
export async function transcribe(pipe,audio,language='auto'){
 let energy=0;for(const sample of audio)energy+=sample*sample;
 if(energy/Math.max(1,audio.length)<Math.pow(10,-65/10))return{text:'',chunks:[],language:null,languageConfidence:0};
 const detected=language==='auto'?await detectLanguage(pipe,audio):{language,confidence:1};
 const output=await pipe(audio,{language:detected.language,task:'transcribe',return_timestamps:'word',chunk_length_s:30,stride_length_s:0,max_length:448,no_repeat_ngram_size:8});
 return{...output,timing:'word-aligned',language:detected.language,languageConfidence:detected.confidence};
}

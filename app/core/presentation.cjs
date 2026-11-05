'use strict';
const fs=require('node:fs');
async function createPlaybackCard(file,data){
 const escape=value=>String(value||'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1e3026"/><stop offset="1" stop-color="#101719"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><rect x="44" y="44" width="1192" height="632" rx="24" fill="none" stroke="#384c3a"/><g stroke="#d2f784" stroke-width="7" stroke-linecap="round"><path d="M88 99v22m18-37v52m18-43v34m18-23v12"/></g><text x="167" y="119" fill="#d2f784" font-family="Arial,sans-serif" font-size="26" font-weight="bold">RadioRecorder</text><text x="88" y="216" fill="#9bb991" font-family="Arial,sans-serif" font-size="15" letter-spacing="4">RECORDED TRANSMISSION</text><text x="88" y="278" fill="#eef5e7" font-family="Arial,sans-serif" font-size="42" font-weight="bold">${escape((data.name||'Radio recording').slice(0,48))}</text><text x="88" y="319" fill="#91aaa0" font-family="Arial,sans-serif" font-size="21">${escape(data.frequency||'Audio archive')}</text><path d="M88 368h1104" stroke="#3d533d"/><text x="88" y="646" fill="#768e82" font-family="Arial,sans-serif" font-size="13">${data.captions?.length?'TRANSCRIPT · MACHINE GENERATED · VERIFY AGAINST AUDIO':'AUDIO ARCHIVE · NO TRANSCRIPT AVAILABLE'}</text></svg>`;
 await require('sharp')(Buffer.from(svg)).png().toFile(file);
}
module.exports={createPlaybackCard};

'use strict';
// Publishes native build artifacts only after the platform checks have passed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const version=require('../package.json').version,tag='v'+version,repo=process.env.GITHUB_REPOSITORY;
if(!process.env.GITHUB_ACTIONS||process.env.GITHUB_REF_NAME!==tag)throw new Error('Run this publisher in GitHub Actions on the matching version tag.');
const names=[`RadioRecorder-${version}-Windows-x64-Portable.exe`,`RadioRecorder-${version}-arm64-mac.zip`,`RadioRecorder-${version}-arm64.dmg`];
const discovered=[];function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())walk(file);else discovered.push(file);}}walk('.build/release-builds');
const files=names.map(name=>{const found=discovered.filter(file=>path.basename(file)===name);if(found.length!==1)throw new Error('Expected one native build: '+name);return found[0];});
const lines=[],manifest=new Map();
for(const file of files){const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');manifest.set(path.basename(file),hash);lines.push(hash+'  '+path.basename(file));}
fs.mkdirSync('.build/release',{recursive:true});const sums='.build/release/SHA256SUMS.txt';fs.writeFileSync(sums,lines.join('\n')+'\n');
const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
let existing;try{existing=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${tag}`]));}catch(error){if(!String(error.stderr).includes('HTTP 404'))throw error;}
if(existing&&!existing.draft){
 for(const file of files){const asset=existing.assets.find(a=>a.name===path.basename(file));if(!asset||asset.digest!=='sha256:'+manifest.get(asset.name))throw new Error('A different published release already exists; refusing to overwrite it.');}
 console.log(existing.html_url);process.exit(0);
}
if(!existing)gh(['release','create',tag,'--repo',repo,'--verify-tag','--draft','--prerelease','--title',`RadioRecorder ${version} — clearer transcripts and CW recovery`,'--notes-file',`docs/releases/${tag}.md`]);
gh(['release','upload',tag,'--repo',repo,...files,sums,'--clobber']);
gh(['release','edit',tag,'--repo',repo,'--draft=false','--prerelease']);
console.log(`https://github.com/${repo}/releases/tag/${tag}`);

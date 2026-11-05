'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), asar = require('@electron/asar');
const root = path.resolve(process.argv[2] || 'dist/windows-portable/win-unpacked');
const archive = path.join(root, 'resources/app.asar');
process.argv[2] = archive; require('./verify-package.cjs');
const entries = asar.listPackage(archive);
assert.ok(!entries.some(name => /onnxruntime-node\/bin\/napi-v6\/(darwin|linux)|win32\/arm64/.test(name)), 'Foreign transcription binaries');
assert.ok(!entries.some(name => /@img\/sharp-(darwin|linux)/.test(name)), 'Foreign image binaries');
const unpacked = path.join(root, 'resources/app.asar.unpacked/node_modules');
for (const name of ['ffmpeg-static/ffmpeg.exe', 'onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node', 'onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll', '@img/sharp-win32-x64/lib/libvips-42.dll']) assert.ok(fs.existsSync(path.join(unpacked, name)), 'Missing unpacked runtime: ' + name);
const natives = [];
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(exe|dll|node)$/.test(entry.name)) natives.push(file);
    else assert.ok(!/\.(dylib|so)$/.test(entry.name), 'Foreign runtime: ' + file);
  }
}
walk(root);
for (const file of natives) {
  const bytes = fs.readFileSync(file), pe = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.subarray(pe, pe + 4).toString('hex'), '50450000', 'Invalid PE: ' + file);
  // electron-builder includes its unused 32-bit elevation helper even for
  // a user-level portable target. The application and native libraries are x64.
  assert.equal(bytes.readUInt16LE(pe + 4), file === path.join(root, 'resources/elevate.exe') ? 0x14c : 0x8664, 'Wrong PE architecture: ' + file);
}
const crt = JSON.parse(fs.readFileSync(path.join(root, 'runtime-provenance.json')));
for (const name of crt.files) assert.ok(fs.existsSync(path.join(root, name)), 'Missing app-local Microsoft runtime: ' + name);
assert.ok(fs.existsSync(path.join(root, 'Microsoft-VC-Runtime-License.rtf')));
const model = path.join(root, 'resources/bundled-models/Xenova/whisper-tiny');
const provenance = JSON.parse(fs.readFileSync(path.join(model, 'provenance.json')));
for (const [name, hash] of Object.entries(provenance.sha256)) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(model, name))).digest('hex'), hash, 'Corrupt model file: ' + name);
for (const name of ['MODEL_CARD.md', 'LICENSE-APACHE-2.0.txt', 'LICENSE-WHISPER.txt']) assert.ok(fs.existsSync(path.join(model, name)));
assert.ok(asar.extractFile(archive, 'app/main.cjs').toString().includes('hasBundledModel'), 'Bundled model startup support');
console.log(`PASS Windows package: ${natives.length} PE files with expected architectures, bundled model checksums, native audio/image/inference dependencies and app-local Microsoft DLLs.`);

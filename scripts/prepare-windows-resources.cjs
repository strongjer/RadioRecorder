'use strict';
// Build-time only: no installer or redistributable is executed on the user's PC.
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const { MODEL_ID, MODEL_REVISION: revision } = require('../app/core/model.cjs');
const modelFiles = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const runtimeSHA = 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b';
const runtimeURL = 'https://download.visualstudio.microsoft.com/download/pr/990c720a-46ce-4dc7-87b9-c2eb615d34b9/' + runtimeSHA.toUpperCase() + '/VC_redist.x64.exe';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function download(url, file) {
  if (await exists(file)) return;
  const response = await fetch(url); if (!response.ok) throw new Error(`${response.status}: ${url}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.download';
  await fs.writeFile(temp, Buffer.from(await response.arrayBuffer()));
  await fs.rename(temp, file);
}
async function model() {
  const destination = path.join(root, 'bundled-models', ...MODEL_ID.split('/'));
  const source = process.argv[2] && path.resolve(process.argv[2]);
  for (const name of modelFiles) {
    const file = path.join(destination, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (source) await fs.copyFile(path.join(source, name), file);
    else await download(`https://huggingface.co/${MODEL_ID}/resolve/${revision}/${name}`, file);
  }
  await download(`https://huggingface.co/${MODEL_ID}/raw/${revision}/README.md`, path.join(destination, 'MODEL_CARD.md'));
  await fs.copyFile(path.join(root, 'node_modules/@huggingface/transformers/LICENSE'), path.join(destination, 'LICENSE-APACHE-2.0.txt'));
  await download('https://raw.githubusercontent.com/openai/whisper/main/LICENSE', path.join(destination, 'LICENSE-WHISPER.txt'));
  const sha256 = {};
  for (const name of modelFiles) sha256[name] = digest(await fs.readFile(path.join(destination, name)));
  await fs.writeFile(path.join(destination, 'provenance.json'), JSON.stringify({ model: MODEL_ID, revision, sha256 }, null, 2) + '\n');
  console.log('Bundled multilingual speech model: ' + MODEL_ID);
}
async function runtime() {
  const work = path.join(root, '.build', 'windows-runtime-source');
  const destination = path.join(root, 'windows-runtime');
  const exe = path.join(work, 'VC_redist.x64.exe');
  await download(runtimeURL, exe);
  const bytes = await fs.readFile(exe);
  if (digest(bytes) !== runtimeSHA) throw new Error('Microsoft runtime checksum mismatch.');
  const sevenZip = await getPath7za();
  const containers = [];
  for (let offset = 0; (offset = bytes.indexOf('MSCF', offset)) !== -1; offset += 4) {
    const size = bytes.readUInt32LE(offset + 8);
    if (size < 36 || offset + size > bytes.length || bytes[offset + 24] !== 3 || bytes[offset + 25] !== 1) continue;
    const cab = path.join(work, `container-${offset}.cab`), folder = cab + '-files';
    await fs.writeFile(cab, bytes.subarray(offset, offset + size));
    await run(sevenZip, ['x', cab, '-o' + folder, '-y']);
    containers.push(folder);
  }
  let runtimeFolder, license;
  for (const folder of containers) {
    // The checksum-pinned Microsoft 14.44.35211 package identifies its payloads.
    if (await exists(path.join(folder, 'a12'))) {
      runtimeFolder = path.join(work, 'dlls');
      await run(sevenZip, ['x', path.join(folder, 'a12'), '-o' + runtimeFolder, '-y']);
    }
    if (await exists(path.join(folder, 'u4'))) license = path.join(folder, 'u4');
  }
  if (!runtimeFolder || !license) throw new Error('Missing runtime payload or license.');
  await fs.mkdir(destination, { recursive: true });
  const names = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcruntime140_threads.dll', 'concrt140.dll'];
  for (const name of names) await fs.copyFile(path.join(runtimeFolder, name + '_amd64'), path.join(destination, name));
  await fs.copyFile(license, path.join(destination, 'Microsoft-VC-Runtime-License.rtf'));
  await fs.writeFile(path.join(destination, 'runtime-provenance.json'), JSON.stringify({ version: '14.44.35211', source: runtimeURL, sha256: runtimeSHA, files: names }, null, 2) + '\n');
  console.log('Prepared app-local Microsoft x64 runtime DLLs.');
}
Promise.all([model(), runtime()]).catch(error => { console.error(error); process.exitCode = 1; });

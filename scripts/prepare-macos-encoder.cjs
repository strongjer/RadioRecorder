'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const run = promisify(execFile), root = path.resolve(__dirname, '..');
const builds = {
  arm64: ['arm64/1789931890_9.0.2', 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924'],
  x64: ['amd64/1789931006_9.0.2', '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4'],
};
(async () => {
  if (process.platform !== 'darwin' || !builds[process.arch]) throw new Error('Build macOS packages on a supported Mac.');
  const [release, sha256] = builds[process.arch];
  const url = `https://ffmpeg.martin-riedl.de/download/macos/${release}/ffmpeg.zip`;
  const work = path.join(root, '.build', 'macos-encoder-' + process.arch);
  const zip = path.join(work, 'ffmpeg.zip');
  await fs.mkdir(work, { recursive: true });
  let bytes; try { bytes = await fs.readFile(zip); } catch {}
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) {
    const response = await fetch(url); if (!response.ok) throw new Error(`Encoder download: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Encoder checksum mismatch.');
    await fs.writeFile(zip, bytes);
  }
  await run('/usr/bin/unzip', ['-oq', zip, '-d', work]);
  const executable = path.join(work, 'ffmpeg');
  await fs.chmod(executable, 0o755);
  const { stdout: version } = await run(executable, ['-version']);
  if (version.includes('--enable-nonfree') || !version.includes('--enable-libx264') || !version.includes('--enable-libass')) throw new Error('Unsuitable macOS encoder configuration.');
  const { stdout: libraries } = await run('/usr/bin/otool', ['-L', executable]);
  if (/\/(opt|usr\/local)\//.test(libraries)) throw new Error('Encoder requires third-party shared libraries.');
  const destination = path.join(root, 'node_modules/ffmpeg-static');
  await fs.copyFile(executable, path.join(destination, 'ffmpeg'));
  await fs.copyFile(path.join(destination, 'LICENSE'), path.join(destination, 'ffmpeg.LICENSE'));
  await fs.writeFile(path.join(destination, 'ffmpeg.README'), `FFmpeg 9.0.2, GPL-3.0-or-later.\nBinary: ${url}\nArchive SHA-256: ${sha256}\nFFmpeg source: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz\nBuild scripts and dependency sources: https://git.martin-riedl.de/ffmpeg/build-script\n\n${version}`);
  console.log('Prepared redistributable static macOS FFmpeg 9.0.2.');
})().catch(error => { console.error(error); process.exitCode = 1; });

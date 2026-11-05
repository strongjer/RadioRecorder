'use strict';
// Stage Windows dependencies separately, including when building on a Mac.
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), stage = path.join(root, '.build/windows-x64');
function run(file, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited with ${code}`)));
  });
}
(async () => {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this build using npm run dist:win.');
  await run(process.execPath, ['scripts/prepare-windows-resources.cjs']);
  fs.mkdirSync(stage, { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, name), path.join(stage, name));
  await run(process.execPath, [npm, 'ci', '--prefix', stage, '--omit=dev', '--ignore-scripts', '--include=optional', '--os=win32', '--cpu=x64']);
  await run(process.execPath, [path.join(stage, 'node_modules/ffmpeg-static/install.js')], { npm_config_platform: 'win32', npm_config_arch: 'x64' });
  // Positive allowlist: no development fixtures, recordings, or user preferences.
  for (const name of ['app', 'resources', 'bundled-models', 'windows-runtime', 'THIRD_PARTY_NOTICES.md']) {
    const target = path.join(stage, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(root, name), target, { recursive: true });
  }
  const output = path.join(root, 'dist/windows-portable');
  await run(process.execPath, ['node_modules/electron-builder/cli.js', '--projectDir', stage, '--win', 'portable', '--x64',
    '--config.electronVersion=' + require('electron/package.json').version, '--config.directories.output=' + output, '--publish', 'never']);
  await run(process.execPath, ['scripts/verify-windows.cjs', path.join(output, 'win-unpacked')]);
})().catch(error => { console.error(error); process.exitCode = 1; });

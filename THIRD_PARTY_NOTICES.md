# Third-party components

RadioRecorder is a new implementation. The supplied original Scanner Recorder installer and proprietary assets are not redistributed.

- libfvad-wasm / WebRTC VAD: MIT/BSD-derived code with included LICENSE, AUTHORS and PATENTS notices in the dependency. Runs locally; no model download or audio upload.
- Electron: MIT, plus Chromium and its third-party licenses included with Electron.
- Transformers.js: Apache-2.0. ONNX Runtime: MIT. Their installed packages retain license files.
- OpenAI Whisper base weights: MIT; Xenova multilingual Whisper Tiny ONNX export: Apache-2.0 according to its model card. The Windows portable build bundles this model with its model card, licenses and SHA-256 manifest under resources/bundled-models. Other builds download it from https://huggingface.co/Xenova/whisper-tiny and cache it locally. Upstream: https://github.com/openai/whisper.
- Windows portable builds include app-local Microsoft Visual C++ 2015–2022 x64 runtime 14.44.35211 DLLs. The Microsoft license and source/checksum record accompany the application. No runtime installer is run.
- ffmpeg-static: GPL-3.0-or-later package; the bundled FFmpeg binary's license/build details are included in its package. Sources, build scripts, and corresponding FFmpeg source download links are provided by https://github.com/eugeneware/ffmpeg-static and https://ffmpeg.org/download.html. Review and satisfy the corresponding binary's complete license/source distribution obligations before redistribution.
- The published macOS package replaces the upstream ARM64 binary configured with `--enable-nonfree` with Martin Riedl's static GPL-3.0-or-later FFmpeg 9.0.2 build. `scripts/prepare-macos-encoder.cjs` pins its URL and SHA-256 and rejects nonfree or externally linked builds. Its source is https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz; dependency build/source scripts are https://git.martin-riedl.de/ffmpeg/build-script. Windows uses Gyan's FFmpeg 6.1.1 GPLv3 essentials build from ffmpeg-static b6.1.1, with exact build configuration and source commit in the bundled ffmpeg.exe.README. See third_party/ffmpeg for source references and notices.
- Other transitive dependencies retain their included licenses. Development dependencies are not shipped as app runtime code.

This local development build is not a distribution licensing audit and does not include an automatic updater or external publishing integration.

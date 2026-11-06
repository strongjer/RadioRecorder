# Maintenance and recovery

The project can be restored from [strongjer/RadioRecorder](https://github.com/strongjer/RadioRecorder). Current macOS Apple Silicon and Windows x64 portable executables are in [release 1.0.2](https://github.com/strongjer/RadioRecorder/releases/tag/v1.0.2), together with SHA256SUMS.txt. Downloading an application does not require cloning the runtime archive history.

## Restore a working checkout without large runtime downloads

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/strongjer/RadioRecorder.git
cd RadioRecorder
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm test
npm start
```

Use Node.js 22.12 or newer. The checked-in lockfile records dependency versions. Skipping the optional ONNX installer download avoids fetching CUDA libraries; the CPU runtime packaged by the dependency is used. Electron and the platform encoder are downloaded during setup. Git LFS is needed only to materialize the archived runtime binaries; for example, git lfs pull retrieves them when Git LFS is installed. Avoid that extra download when the source or current GitHub Release is all that is needed.

The model identity and pinned revision are in app/core/model.cjs. Windows preparation verifies its model assets; normal application inference uses a local cache after first use. See the README for build commands and third_party/ffmpeg for encoder provenance. Do not substitute a nonfree encoder into a public package.

## Reprocess a saved RadioRecorder MP4 while keeping the original

```sh
SCANNER_MODEL_CACHE="/path/to/RadioRecorder/models" \
  node scripts/reprocess-recording.mjs "/path/to/original.mp4" "/path/to/new-copies"
```

The cache must already contain Xenova/whisper-base; this CLI deliberately loads it with remote downloads disabled. On macOS the application cache normally lives under ~/Library/Application Support/RadioRecorder/models. A first recording or the transcription check script can prepare the model. The output folder must have sufficient space for a new MP4 and sidecars.

The script decodes a temporary 16 kHz mono inference WAV, scans CW, generates speech captions, adds candidate captions, and rebuilds the visible-caption MP4 and embedded metadata. The original MP4 is read only. Copies have a unique reprocessed suffix, a visible “(reprocessed)” name, and derivedFrom provenance. Existing AAC is copied without recompression; original sample/UTC spans remain the capture-time authority. Temporary inference WAVs are removed on exit.

Check source and copy metadata, cue bounds, span-derived UTC values, and subtitle text. Compare audio packets with the packaged FFmpeg or a compatible installation:

```sh
ffmpeg -v error -i original.mp4 -map 0:a:0 -c:a copy -f hash -hash sha256 -
ffmpeg -v error -i new-copy.mp4 -map 0:a:0 -c:a copy -f hash -hash sha256 -
```

Matching hashes establish unchanged AAC packet payloads. Also compare original file checksums before/after processing. Listen to uncertain words/CW candidates; successful processing is not an accuracy certification. Import the new MP4 in RadioRecorder, or copy its MP4/JSON/SRT files together into a configured library folder without overwriting originals. Sidecar-only edits are not merged by this developer CLI; it starts from the embedded metadata.

## Release and validation record

The [1.0.2 native CI run](https://github.com/strongjer/RadioRecorder/actions/runs/42130195433) passed on macOS, Windows, and Ubuntu, then published the macOS/Windows assets. Ubuntu AppImage/DEB artifacts were built but are not published as release downloads. CI artifacts can expire; the tagged source, workflow, and release assets are the durable restoration path. See [validation](validation.md) for scope and remaining hardware checks.

For a new release, update the version and release notes, run the relevant checks, and push a new matching version tag. The build workflow runs engine tests and platform packaging, verifies the Mac signature/contents and packaged Windows inference/MP4-only retry, then publishes native artifacts with checksums. Review every required job and release asset before announcing the release; do not treat existence of a release as a substitute for checking CI. Never move a published version tag to reuse its version.

## What is retained outside a disposable checkout

Recordings normally live in Music/RadioRecorder. macOS preferences and cached models normally live in ~/Library/Application Support/RadioRecorder; Windows uses its user-profile application-data location. Those are independent of the source checkout and must not be removed during source cleanup. Back up valuable recordings separately; public GitHub is not their backup destination.

Source, tests, icons, lockfile, build scripts, notices, architecture, design decisions, validation, and release notes belong in Git. node_modules, dist, .build, model caches, test profiles, and generated output are disposable/rebuildable or private and are intentionally ignored. Do not force-add them. Preserve any unique private recordings and batch audit reports outside the checkout before deleting it. A running app inside dist must be stopped before removing the folder; download a release later to run it again.

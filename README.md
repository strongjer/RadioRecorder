# RadioRecorder

A local desktop radio recording console for macOS, Windows 10/11 (64-bit), and Ubuntu. One shared Electron interface and platform-independent JavaScript audio engine. This is an independent implementation inspired by the publicly described Scanner Recorder workflow; it does not contain or execute the original Windows binary.

## Download

- **[Windows 10/11 · portable EXE](https://github.com/strongjer/RadioRecorder/releases/download/v1.0.1/RadioRecorder-1.0.1-Windows-x64-Portable.exe)** — runs without an installer.
- **[macOS · Apple Silicon ZIP](https://github.com/strongjer/RadioRecorder/releases/download/v1.0.1/RadioRecorder-1.0.1-arm64-mac.zip)** or **[DMG](https://github.com/strongjer/RadioRecorder/releases/download/v1.0.1/RadioRecorder-1.0.1-arm64.dmg)** — includes RadioRecorder.app.

All downloads are also in the public [macOS](runtimes/macos) and [Windows](runtimes/windows) runtime folders, stored with Git LFS. [Release notes and checksums](https://github.com/strongjer/RadioRecorder/releases/tag/v1.0.1) describe validation and platform limitations. Ubuntu builds are configured but a Linux download is not published yet.

## Use

Open **RadioRecorder**, then click **Record all**. Allow microphone access when the operating system asks. The system default input, 16 kHz mono capture, local speech and radio-tone detection, speech leveling, peak protection, and silence removal are ready without setup. The Windows portable build includes the multilingual Whisper model and works offline immediately. Other builds prepare it from Hugging Face on the first real recording; subsequent transcription runs offline. Captions are machine-generated and can contain errors.

On **64-bit Windows 10/11**, copy `RadioRecorder-1.0.1-Windows-x64-Portable.exe` to your computer and double-click it. No installer, administrator access, Node.js, FFmpeg installation, or separate Visual C++ runtime installation is required. It extracts its bundled application to a temporary directory while running and removes that directory on normal exit. Recordings remain in your Music/RadioRecorder folder; preferences remain in your user profile. Moving the executable does not move these files. This development build is unsigned, so Windows may show an unrecognized-app warning. Windows microphone privacy settings must allow desktop applications to access your input.

Optionally name a channel and enter its frequency or talkgroup before recording. Add inputs for additional physical devices (up to eight independently captured inputs; practical capacity depends on hardware). A single device cannot be opened twice accidentally. Use **Test signal** to explore the console without microphone access.

**Playback** includes a waveform, seek bar, 15-second skips, speed/volume controls, clickable captions, bookmarks, and original capture times. **Rewind live recording** opens a recording before it has stopped. **Go live** follows the latest captured audio; silence skipped by VOX does not occupy playback time. Playback continues independently of capture. Times always use the playback computer's current time zone and the offset applicable at the recorded instant.

**Settings** contains optional location, transcription, storage, and advanced capture settings. Location defaults off. Locale/ZIP mode stores only the label entered by the user; it never stores coordinates. Approximate coordinates are rounded in both UI and main process before being persisted. Device location requires supported OS services; manual entry works without them. A successful device-location request updates the stored, rounded location about once per minute while the app stays open. The locale is the receiver's location, not the location of an incident described over the radio.

## Develop / build

Requires Node.js 22.12 or newer. Run `npm ci`, `npm test`, then `npm start`. Audio capture uses Chromium AudioWorklet/getUserMedia, not platform-specific plugins. The runtime downloads during installation. No API key is needed.

- `npm run pack`: unpacked application for the current OS/architecture.
- `npm run dist:mac`: macOS DMG and ZIP.
- `npm run dist:win`: Windows x64 portable executable under `dist/windows-portable`; works on Windows or macOS. Uses an isolated Windows dependency tree and bundles the speech model, FFmpeg, and app-local Microsoft runtime DLLs.
- `npm run dist:linux`: x64 AppImage and DEB, built on Linux.
- `npm run test:app`: macOS UI/integration smoke test using two synthetic inputs.
- `npm run test:captions`: synthetic-microphone test of live captions, rewind, time-zone changes and MP4 finalization; requires the model fixtures created by the next command. Its fake input requires a test-only `--no-sandbox` Chromium flag; normal app launches retain the renderer sandbox.
- `node scripts/transcription-check.mjs`: optional macOS English/Spanish inference check; downloads the model and synthesizes test speech locally.

The GitHub Actions workflow builds on each target OS. Windows packaging is checked for x64 native dependencies, model checksums and clean contents. Windows and Ubuntu packages still need real microphone/device and permission testing there. The locally built Mac app is for Apple Silicon. Signing/notarization credentials are not included. Developer ID signing/notarization and Windows code signing should be configured for public distribution.

## Files and portability

Names include channel, frequency/talkgroup, UTC start time, and a random suffix, for example `County-Dispatch__154-430-MHz__2026-11-05T19-31-28-359Z__0cf38093.mp4`.

Active recordings stream to a recoverable PCM WAV and a JSON sidecar. The WAV header is checkpointed at least once per second and when a player requests it. On stopping, the encoder creates AAC plus a compact H.264 playback panel in an MP4 container (64 kbps mono / 128 kbps stereo). The playback panel renders available captions directly, so QuickTime shows them without subtitle setup. MP4 also contains a selectable `mov_text` caption track and complete JSON metadata in its `comment` tag, including UTC capture spans, source/output sample positions, processing settings, channel identity, location samples, bookmarks, and CW candidates. Precise coordinate fields are absent in locale mode. Approximate coordinates retain their precision label. A standard location tag contains only the approved, rounded coordinates.

Metadata is also retained in a readable JSON sidecar and events in a JSON-lines `.log`. WAV is deleted only after successful MP4 creation and after pending transcription has finished, or when transcription was not requested. Failed encoding/transcription leaves the recovery audio intact. Export MP4 for a self-contained recording; export the transcript for UTC-tagged text. Remove a configured input with the × button on its card; active audio is stopped and saved, and existing recordings are kept. Saved recordings have a separate **Move recording to Trash** action with confirmation. Restore their files from the system Trash to recover them.

Copy an MP4 into the application with **Import recording** to recover its embedded metadata.

The MP4 includes visible generated captions available at finalization; adding bookmarks or retrying transcription refreshes the caption video and metadata without recompressing AAC. Other players may ignore the application-specific JSON tag; standard subtitle playback depends on that player's support. Avoid changing recordings in another application while RadioRecorder is finalizing them.

## Timing and limitations

UTC is anchored to each input's AudioContext sample clock; capture spans explicitly map the compacted output back to original time. Device and driver latency is not calibrated, and independently clocked devices are not hardware-synchronized. Captions use model-estimated word alignment with short readable cues; these are not forensic timestamps. System time must be correct. Audio discontinuities, pauses, starts/stops, setting changes, location changes, and decoded IDs are logged. Closing the application saves recoverable audio; pending processing can be resumed on the next launch.

Transcription runs in an isolated utility process with bounded 28-second excerpts. Live inference is queued after roughly six seconds of captured speech, plus scheduling/inference time; multiple inputs may increase latency. Quiet gaps are removed, so six seconds of captured speech may span a longer wall-clock interval. Automatic language detection inspects Whisper's language-token probabilities. Short or noisy speech, radio jargon, code-switching, and overlapping speakers can reduce accuracy. Saved recordings receive a final pass with word-aligned timings before MP4 finalization. Whisper Tiny is a compact baseline, not a guarantee of accuracy. Raw audio remains available for review.

CW identification is experimental narrowband tone/timing detection (400–1400 Hz), tested with clean synthetic callsigns. Candidates appear in captions and structured metadata; noise, fading, voice overlap, tone frequencies outside this band, or unusual sending speeds may prevent a decode. Verify a candidate by listening. RadioRecorder does not infer a transmitter's physical location from its callsign.

The live recovery WAV has a 4 GB RIFF limit; the channel stops safely with a message at that limit. Long-running continuous capture should be split into sessions. The app prevents idle app suspension while recording, but system sleep or device removal stops the session. USB/microphone input is supported; direct scanner tuning, SDR demodulation, public streaming services, and system-audio loopback drivers are not bundled.

## Design and implementation references

- [Original Scanner Recorder feature listing](https://www.softpedia.com/get/Multimedia/Audio/Other-AUDIO-Tools/Scanner-Recorder-Scanrec.shtml): VOX, pre-roll, DC correction, recording logs.
- [Voice Shaper](https://dxatlas.com/VShaper/): speech processing reference. RadioRecorder uses its own leveler, soft-knee compressor, and peak limiter with simple defaults.
- [Zello replay/history](https://support.zello.com/zw/windows-pc-zellowork-start-guide): channel-centered replay and time-stamped history.
- [Broadcastify Calls](https://support.broadcastify.com/hc/en-us/articles/18460873419675-Broadcastify-Calls-Listening): individual transmissions and archive playback.
- [Citizen incident timeline](https://support.citizen.com/hc/en-us/articles/34348472620695-Incidents): searchable time-centered activity. No Citizen or Broadcastify account, data, or service is integrated.

Third-party components retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [docs/architecture.md](docs/architecture.md) for module boundaries.

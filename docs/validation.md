# Validation — November 5, 2026

The Apple Silicon macOS development build was exercised locally. The tests use synthetic radio tones and locally synthesized speech; no user microphone audio was captured for testing.

| Area | Evidence |
|---|---|
| Audio and storage engine | 12 passing Node tests: sample-accurate pre-roll/release, VOX gap mapping, DC correction, linked dynamics, peak protection, location quantization, 16/24-bit WAV, resampling, two concurrent recorders, CW detection/rejection, MP4 metadata/subtitles/re-import, metadata-write failure recovery |
| Desktop workflow | Two simultaneous synthetic input streams, independent named recordings, live rewind, stop/save, and library playback |
| Local speech | Synthesized English and Spanish detected and transcribed in their original languages; timestamped model segments returned |
| Live captions | Captions appeared while capture remained active using a synthetic microphone fixture |
| Time-shift playback | A growing WAV was played and sought using byte ranges, with finite duration and no media decoder error |
| Playback time zone | Changing the playback renderer to Europe/Madrid displayed original UTC capture times using UTC+01:00 |
| Portable archive | AAC/MP4 carried mov_text captions and embedded channel/frequency, UTC/sample mapping and approved location metadata; sidecars remained readable |
| Transcription retry | Recovery PCM was removed after finalization; captions were regenerated from MP4 and remuxed without recompressing AAC |
| Packaged app | The locally signed app ran live capture, captions, rewind, time-zone display, FFmpeg archival, and MP4-only transcription retry |
| Dependencies | Compatible updates and overrides cleared the npm audit findings at build time |

The Mac bundle is locally ad-hoc signed, not Developer ID notarized. The Windows x64 portable executable is cross-built and unsigned; it has not been launched on a Windows machine. Windows and Ubuntu physical-device/permission testing remains outstanding. Device geolocation depends on OS services and available hardware. CW detection has synthetic-signal coverage and remains experimental on real-world RF audio. Caption accuracy and latency depend on signal quality, language and hardware; no accuracy guarantee is made. See the README for clock and recovery-spool limits.

## Update 1.0.1

17 core regression tests pass, including sustained ambient-noise rejection at every capture rate, faint spoken-word retention, one connection under concurrent Monitor/Record requests, and precise caption grouping. An inference regression confirms word timings after 2 seconds and 22 seconds of leading silence, including a transcription-window boundary. QuickTime was visually checked with the new captioned H.264 presentation panel. The new package allowlist is verified to exclude workspace recordings, output folders and test fixtures. Saved MP4s now receive a complete word-alignment pass, not only the live batch captions.

## Windows portable build

The standalone EXE contains a complete Electron application, Windows x64 FFmpeg, Sharp/libvips, ONNX Runtime, app-local Microsoft runtime DLLs and multilingual Whisper Tiny weights. The model transcribed the synthetic fixture with remote downloads disabled. PE architecture checks, model SHA-256 verification, clean ASAR contents, extraction of the outer executable, and testing the complete embedded 7z archive all passed. The launcher manifest requests `asInvoker`; no installation or administrator access is required. The Windows binaries cannot be executed natively on this Apple Silicon build host, so Windows microphone access, actual playback/encoding and live inference still require testing on Windows.

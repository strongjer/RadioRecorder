# Product and engineering decisions

This records the requirements and rationale behind the 1.0.2 implementation. Read it with [architecture](architecture.md), [validation](validation.md), and the [maintenance guide](maintenance.md).

## Product scope and interface

RadioRecorder is an independent implementation of a scanner recording workflow. The supplied proprietary Scanner Recorder executable is a reference, not a dependency or redistributable asset. No original program code or binary is included.

One Electron application shares the interface and audio engine across macOS, Windows 10/11 x64, and Ubuntu. Chromium's audio capture and playback APIs avoid separate native capture implementations. OS permissions, dialogs, packaging, native inference libraries, and encoder binaries still need platform-specific handling and testing. Linux packages build in CI; no Linux release download is currently published.

The interface centers on a live console, recording library, and listening room. Waveforms, clickable captions, recording identity, and local capture times make finding a moment the primary playback task. Default-input capture, automatic silence detection, and automatic speech processing keep first use simple. Advanced controls remain optional. The default recording quality is 16 kHz mono, appropriate for narrowband radio speech and compact storage; it is not a high-fidelity music preset.

Zello informed channel history and replay, Broadcastify Calls informed transmission-oriented archives, and Citizen informed time-centered navigation. These are design references, not integrations or permission to collect their data. RadioRecorder does not tune scanners, demodulate SDR signals, publish a feed, or infer incident locations.

## Multiple inputs and continuous playback

Each configured input has independent capture, sample clock, recorder, signal meter, settings, and channel/frequency identity. Up to eight inputs are exposed; hardware and CPU capacity determine usable concurrency. Duplicate capture of one physical device is prevented. Removing an input stops and saves its session without deleting existing recordings.

Capture streams to a checkpointed PCM WAV with a JSON sidecar instead of buffering a whole session in memory. Byte-range playback allows seeking an already captured prefix while recording continues. This provides local DVR behavior without requiring a streaming server. WAV is retained until encoding and transcription complete successfully. The current single-file RIFF spool has a 4 GB limit; a segmented spool is a future improvement, not an implemented feature.

## Timing and silence removal

UTC capture time is anchored to each AudioContext sample clock. Every retained audio span records both original source-frame boundaries and compacted output-frame boundaries. This mapping is essential because VOX removes quiet gaps: playback elapsed time alone cannot reconstruct capture time. Boundary-aware mapping chooses the next retained span for a caption start and the preceding span for an end.

Store UTC in metadata and convert it in the player using the playback machine's current time zone, including the offset at the recorded instant. Do not bake the recorder's time zone into the timing model. Channel/frequency, UTC start, and a random suffix make filenames meaningful and collision resistant.

Sample clocks are independent across devices. Hardware/driver latency is uncalibrated, the system clock must be correct, and model alignment is estimated. These are reviewable recording timestamps, not a claim of forensic synchronization.

## Voice clarity without setup

Gating evaluates the signal before gain processing, so an amplified noise floor does not trigger recording. Speech detection is supplemented by a radio-tone preservation path so CW is not discarded as non-speech. Pre-roll and release retain phrase edges.

An automatic leveler raises weak speech within a boost limit, followed by soft-knee compression and peak limiting for strong signals. Gain is held below the noise floor to reduce noise pumping. Zero-delay processing avoids an extra timing offset. The approach is inspired by the goal of VShaper, with automated defaults instead of a technical tuning workflow. It cannot recover information absent from the source or guarantee broadcast-standard loudness/true-peak compliance.

## Transcription and CW

Whisper Base replaces Tiny because the smaller baseline produced unreliable radio transcripts. Inference stays on the user's machine in an isolated utility process; capture remains responsive and no transcription service receives audio. Windows bundles the multilingual model for offline first use. macOS/Linux obtain it on first use and then use the local cache. Short/noisy transmissions, jargon, accents, overlapping speech, and code-switching remain difficult.

Whisper language-token probabilities select the spoken language and transcription preserves that language instead of translating it. Continuous Silero VAD supplies independent speech evidence to suppress hallucinations over silence, noise, and tones. Bounded inference windows preserve context across VOX spans, trim excessive leading silence, and map word-aligned cues back to original UTC. Live captions are provisional; a final pass refines the saved recording. Multiple streams share the inference queue, so near-real-time does not mean zero latency.

CW uses a separate narrowband tone/keying detector rather than asking a speech model to interpret Morse. A final saved-audio scan catches candidates missed live. Adaptive pulse-train timing accommodates sending speed and derives candidate times from actual pulses. Candidates are stored in both captions and structured metadata and explicitly labeled for listening verification. The current 400–1400 Hz range and real-world noise/fading limit coverage. A callsign is not proof of transmitter location.

## MP4, captions, and privacy

AAC in MP4 saves space; a small H.264 playback panel burns captions visibly into the video because QuickTime did not reliably display the selectable subtitle track by default. A standard mov_text track is also retained. Rich JSON in the MP4 comment stores channel identity, UTC/sample spans, processing settings, approved location samples, bookmarks, transcript, and CW candidates. JSON/SRT sidecars make inspection and recovery easier. Other players may ignore the application-specific JSON.

Retry/reprocessing stream-copies existing AAC while rebuilding captions and metadata, avoiding another lossy audio encode. Reprocessing creates a new recording identity with derivedFrom provenance; keeping originals makes the results reversible and comparable. The developer CLI reads embedded MP4 metadata, so synchronize sidecar-only changes before using it; it is not an arbitrary-media importer.

Location is optional and defaults off. Locale/ZIP mode stores a user-entered label without coordinates; approximate modes round coordinates before persistence. Coordinates describe the receiving device, not an incident or transmitter. Recordings, private transcripts, preferences, keys, and model caches do not belong in the public source repository or packages.

## Builds and distribution

GitHub Releases are the canonical current application downloads. The public runtime folders retain the original 1.0.1 Git LFS files and link to 1.0.2 releases. The 1.0.2 release was built and checked on native macOS/Windows runners; this avoids relying on cross-built native dependencies. Local build hashes can differ from CI output, so use the release's own SHA256SUMS.txt.

The Windows portable EXE runs as the current user without an installer or administrator access. It extracts its application temporarily and stores recordings/preferences outside the executable. Portable does not mean that all user data travels with the EXE. macOS is ad-hoc signed, not notarized; Windows is unsigned. Production distribution still needs signing and real-device validation.

A superseded local packaging branch held local 1.0.2 binary pointers and an older publication workflow. Its application implementation is present on main; its packaging approach was replaced by the native CI release workflow. Re-uploading those obsolete binary pointers would confuse the authoritative release and is unnecessary to restore the current project.

## Remaining work

- Exercise physical audio devices, permissions, playback, and sustained multi-input recording on Windows and Ubuntu; CI inference/encoding does not establish hardware usability.
- Evaluate transcription and CW against representative, consented radio fixtures, with listening review and measured error rates.
- Replace the 4 GB recovery spool with segments for very long sessions, and consider clock/latency calibration where stronger synchronization is needed.
- Configure production signing/notarization and review third-party source/license obligations for each distributed encoder build.
- Consider larger/optional speech providers and incremental caption refinements while preserving local-first operation and timestamp provenance.

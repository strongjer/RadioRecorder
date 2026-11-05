# Bundled FFmpeg

RadioRecorder invokes an unmodified, separate FFmpeg executable. GPLv3 terms are in [COPYING.GPLv3](COPYING.GPLv3). Exact configurations accompany the binaries and are copied here.

| Platform | Binary build | FFmpeg source | Build and dependency sources |
| --- | --- | --- | --- |
| macOS | Martin Riedl 9.0.2, static GPLv3+, no `--enable-nonfree` | [9.0.2 source archive](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz) | [Build scripts, dependency download URLs and versions](https://git.martin-riedl.de/ffmpeg/build-script), [published versions](https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/versions.txt) |
| Windows | Gyan 6.1.1 essentials, GPLv3, distributed by ffmpeg-static b6.1.1 | [Exact upstream commit e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93), [6.1.1 source archive](https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz) | [Gyan build and source information](https://www.gyan.dev/ffmpeg/builds/), [binary packaging/build scripts](https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1) |

[macOS build information](macos-build-info.txt) includes the pinned binary URL and SHA-256. [Windows build information](windows-build-info.txt) lists its external libraries and exact configuration. The macOS download script verifies the archive and rejects `--enable-nonfree` builds. No proprietary Scanner Recorder binary or assets are included.

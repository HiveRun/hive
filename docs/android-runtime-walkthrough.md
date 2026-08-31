# Android Runtime Walkthrough

This guide explains how Hive runs one Android emulator per cell, displays it in the web or desktop viewer, moves audio in both directions, and recovers safely after stops or crashes.

It is written for two audiences:

- Operators who need to configure, run, and troubleshoot Android cells.
- Maintainers who need to understand ownership, process, media, and security boundaries.

## Quick Mental Model

An Android cell normally has two Hive services:

```text
app service                                      android service
--------------------------------------------     ---------------------------------
hive android emulator                            hive android viewer
  --grpc-port <allocated TCP port>                 --port <viewer HTTP port>
  -- <product command>                             --grpc-port <same TCP port>

owns:                                            owns:
- host-global emulator lease                     - Stream Droid viewer server
- cell-local AVD                                 - browser video/control connection
- emulator process                               - browser microphone bridge
- product process group                          - optional host audio playback
- authenticated emulator gRPC endpoint
```

The app service owns the device lifecycle. The viewer service finds that ownership record, verifies the exact device and gRPC endpoint, and then exposes a loopback HTTP viewer.

The two services can start concurrently. The viewer waits until the app service has allocated a lease and booted its emulator.

## Example Configuration

```json
{
  "services": {
    "app": {
      "type": "process",
      "run": "\"$HIVE_CLI_BIN\" android emulator --grpc-port \"$APP_ANDROID_GRPC_PORT\" -- <workspace product command>",
      "ports": {
        "http": { "primary": true, "protocol": "http" },
        "android-grpc": { "protocol": "tcp", "viewer": false }
      }
    },
    "android": {
      "type": "process",
      "run": "\"$HIVE_CLI_BIN\" android viewer --port \"$PORT\" --grpc-port \"${PORT:app:android-grpc}\"",
      "audio": { "input": true, "output": true },
      "ports": {
        "viewer": {
          "primary": true,
          "protocol": "http",
          "viewer": true
        }
      },
      "readiness": {
        "checks": [{ "type": "http", "port": "viewer", "path": "/api/health" }]
      },
      "readyTimeoutMs": 360000
    }
  }
}
```

Important details:

- `HIVE_CLI_BIN` selects the exact source or installed Hive executable managing the cell. It does not depend on another `hive` in `PATH`.
- The app's primary HTTP port belongs to the product command.
- `android-grpc` is a non-viewer TCP port used only between Hive and the emulator.
- The viewer port is HTTP and therefore appears as a viewer tab.
- Audio input is opt-in. Audio output defaults to enabled but is explicit here.
- `<workspace product command>` is a placeholder for a command defined by the workspace. It normally starts the Android app tooling and any product endpoint expected on `$PORT`.
- Dynamically allocated viewer ports allow parallel cells. An exact `port` gives the browser a stable permission origin but allows only one service to own that host port.

## Startup Sequence

### 1. Hive starts ordinary process services

The service supervisor allocates named ports, injects cell environment variables, and starts services in dependency waves. Every service receives values such as:

| Variable | Purpose |
|---|---|
| `HIVE_CELL_ID` | Cell ownership identity |
| `HIVE_CLI_BIN` | Exact Hive executable or source entry |
| `HIVE_CELL_RUNTIME_DIR` | Durable runtime state for this cell |
| `HIVE_CELL_ARTIFACTS_DIR` | Artifacts preserved after deletion |
| `HIVE_HOME` | Cell-local Hive home |
| `APP_ANDROID_GRPC_PORT` | Named app gRPC port |
| `HIVE_SERVICE_AUDIO_INPUT` | `1` when microphone input is enabled |
| `HIVE_SERVICE_AUDIO_OUTPUT` | `1` unless audio output is disabled |

Hive invokes the Android commands before its general CLI parser. Linux and macOS are supported; Windows fails immediately instead of starting a partial runtime.

### 2. The app service prepares Android SDK state

`hive android emulator` resolves `adb`, `emulator`, and `avdmanager`. It removes inherited alternate ADB server routing variables before any Hive-owned ADB call:

```text
ADB_SERVER_SOCKET
ANDROID_ADB_SERVER_ADDRESS
ANDROID_ADB_SERVER_PORT
```

This prevents the service environment from redirecting Hive's allocation, identity, readiness, or cleanup operations to another ADB server.

The cell gets a deterministic AVD name:

```text
Hive_Pixel_7_<sanitized-cell-id>
```

Its AVD files live under:

```text
$HIVE_CELL_RUNTIME_DIR/android-avd/
```

If the AVD does not exist, Hive creates a Pixel 7 profile using an Android 34 Google APIs image for the host architecture.

### 3. Hive allocates a host-global emulator lease

All Hive processes on the host coordinate through:

```text
~/.hive/runtime/android-v2/
├── allocation/
└── slots/
    ├── 5554/
    │   ├── owner.json
    │   └── token
    ├── 5556/
    └── ...
```

Each slot represents an emulator console/ADB port pair. Hive allocates even console ports from `5554` through `5584`, excluding the migration-reserved `5580` slot.

The ownership record includes:

```text
cell ID
wrapper PID and process-start fingerprint
random lease token
AVD name
console port and emulator serial
gRPC port
product guardian PID, marker, and fingerprint after publication
```

The process-start fingerprint protects against PID reuse. A PID that now belongs to a different process is not treated as the original owner.

### 4. Hive starts and verifies the emulator

The emulator starts with the leased console port and supervisor-allocated gRPC port. Snapshot loading/saving is disabled so each lifecycle is explicit.

```text
Hive wrapper
  |
  +-- emulator -avd <cell AVD>
                -port <leased console port>
                -grpc <allocated gRPC port>
                -grpc-use-token
                -no-snapshot-load
                -no-snapshot-save
```

Hive waits for both:

1. The expected serial to enter ADB's `device` state.
2. Android's `sys.boot_completed` property to become `1`.

It then asks that serial for its running AVD name and verifies it matches the lease. A matching serial alone is not enough.

### 5. Hive publishes product ownership before starting the product

The product command runs under a small `/bin/sh` guardian in its own process group.

```text
Hive Android wrapper
  |
  +-- product guardian process group
      |
      +-- product command
      +-- product descendants
      +-- control-pipe monitor
```

The guardian waits behind a private start gate. Hive first records the guardian PID, random command marker, and process-start fingerprint in the lease. Only then does it send `start` through the control pipe.

This closes a publication race: stale recovery always has durable ownership evidence before product code can run.

The guardian preserves stdin, stdout, stderr, and the product's exit status. When the product exits or ownership is lost, it sends `SIGTERM` to its process group, waits up to ten seconds, then sends `SIGKILL` to remaining group members and reaps the direct product.

### 6. Hive gives the product guarded Android tools

The product receives an SDK overlay under:

```text
$HIVE_CELL_RUNTIME_DIR/product-android-sdk/
```

Most SDK files are linked from the real SDK, but `adb` and `emulator` are wrappers. The wrappers check the immutable lease token on every invocation.

The guarded `adb` wrapper:

- Forces commands onto the leased serial.
- Verifies the serial still runs the expected AVD.
- Filters `adb devices` to the leased device.
- Rejects alternate serial, transport, host, port, socket, and ADB-server options.
- Rejects shared server and transport mutation commands.
- Rejects command-chaining forms such as `wait-for-*` and raw host services.

The guarded `emulator` wrapper:

- Lists only the leased AVD.
- Rejects another AVD or console port.
- Forces the leased console port and headless operation.

## Viewer Sequence

The viewer service does not allocate a device. It proves that the app service already owns the expected one.

```text
hive android viewer
  |
  +-- find live lease for HIVE_CELL_ID
  +-- require lease gRPC port == CLI gRPC port
  +-- wait for leased serial
  +-- verify running AVD name
  +-- discover emulator gRPC token and endpoint
  +-- probe authenticated screenshot
  +-- start Stream Droid on exact loopback HTTP port
```

The screenshot probe verifies that the discovered token and endpoint work before the viewer becomes ready. The viewer then watches and polls the lease. If the token changes, the owner dies, or the lease disappears, the viewer terminates rather than continuing against a reassigned slot.

In a packaged release, the layout is:

```text
<release>/
├── hive
├── hive-android-viewer-server
└── android-runtime/stream-droid/
    ├── emulator_controller.proto
    └── public/
```

## Video and Control Flow

```text
Android display
  |
  | authenticated EmulatorController screenshots over gRPC
  v
Stream Droid server
  |
  | PNG frames over WebSocket
  v
Stream Droid browser client
  |
  +-- web: sandboxed iframe inside Hive
  |
  +-- desktop: dedicated Electron BrowserView

Pointer/keyboard control travels back over the same WebSocket and then to the emulator gRPC controller.
```

The viewer binds to `127.0.0.1` and strict port mode prevents Stream Droid from silently moving to a different port. The web app accepts viewer URLs only when they are loopback HTTP/HTTPS endpoints without credentials.

## Emulator Audio Output

Audio output does not travel through the browser viewer.

```text
Guest AudioTrack / Android mixer
  |
  | 48 kHz signed 16-bit stereo PCM over emulator gRPC
  v
Hive Android viewer
  |
  +-- Linux: pw-cat -> PipeWire -> host speakers
  |
  +-- optional raw PCM capture file for tests/evidence
```

Platform behavior:

| Host | Emulator output |
|---|---|
| Linux | Host playback through `pw-cat`; capture is also supported |
| macOS | Capture is supported; Hive does not provide host playback |
| Windows | Android runtime unsupported |

Missing `pw-cat` is non-fatal. Video and microphone input continue, and a diagnostic is written.

## Browser Microphone Input

Microphone input is demand-driven by the guest. Opening the viewer does not immediately start capture.

```text
Guest starts AudioRecord
  |
  | Stream Droid polls Android audio state
  v
Viewer sends audio-ready state
  |
  v
Browser requests microphone permission
  |
  | selected track -> mono -> resample to 48 kHz -> signed 16-bit PCM
  | 20 ms frames over viewer WebSocket
  v
Stream Droid paced queue
  |
  | client-streaming injectAudio gRPC
  v
Emulator virtual microphone
  |
  v
Guest AudioRecord
```

Input is available only when all of these conditions hold:

- The viewer service declares `audio.input: true`.
- The WebSocket client has local control of the device.
- The viewer WebSocket origin matches its HTTP origin.
- The capture backend is authenticated emulator gRPC.
- Android reports an active guest `AudioRecord` consumer.

Only one browser connection can own microphone injection for a serial. The queue is intentionally short; old frames are dropped instead of allowing latency to grow. Injection stops when guest capture ends, the browser track fails, the WebSocket closes, or PCM becomes idle.

## Preferred Microphone

Hive's Settings page stores the preferred microphone by label:

```text
hive.audio-input.v1 = "USB Microphone"
```

A label is used rather than a device ID because browser device IDs vary by origin. Hive adds the label only to viewer services that enable audio input:

```text
http://127.0.0.1:42861/?hiveMicrophone=USB%20Microphone
```

The viewer resolves that label within its own origin, requests a mono track, and resamples it when necessary. Missing or ambiguous labels are surfaced as microphone errors rather than silently choosing a different device.

## Browser and Electron Permissions

### Web browser

An Android viewer with `audio.input: true` runs in a sandboxed iframe with:

```text
allow="autoplay; microphone"
sandbox="allow-same-origin allow-scripts"
referrerPolicy="no-referrer"
```

The browser controls permission for the viewer's loopback origin. Stream Droid reports microphone readiness or errors to Hive with `postMessage`. Hive accepts the message only when its origin and source match the active iframe.

When audio input is omitted or false, Hive delegates only `autoplay`; the iframe cannot request microphone access.

### Electron desktop

Electron uses a dedicated BrowserView rather than the iframe. For services with audio input enabled, Hive registers the exact loopback origin for that BrowserView and denies requests that do not match its current committed URL. Input-disabled viewers are not registered for media access and cannot trigger a Hive or OS microphone prompt.

Microphone approval requires:

1. An audio-only request from the registered loopback viewer.
2. A Hive confirmation dialog naming the requesting origin.
3. On macOS, OS-level microphone approval through `askForMediaAccess`.

Approval is bound to that BrowserView's `WebContents`. Recreating or unregistering the view revokes it. Video and display capture remain denied.

## Stop, Restart, and Recovery

### Normal stop

```text
service stop
  |
  +-- product guardian stops product group
  +-- adb emu kill after serial/AVD verification
  +-- emulator process-group fallback if needed
  +-- wait until serial disappears
  +-- release lease only after all cleanup succeeds
```

If cleanup fails, Hive intentionally keeps the lease. A retained lease is safer than making a possibly live emulator look available to another cell.

### Viewer-only restart

A viewer-only restart keeps the app process, emulator, serial, lease token, ports, and gRPC endpoint. It replaces only the Stream Droid/viewer process and reconnects the UI.

### App/emulator restart

Restarting the app service tears down and recreates the emulator lifecycle. The existing viewer sees lease loss and exits. Restart the full service set when both app and viewer should return automatically.

### Stale-owner recovery

When Hive encounters a dead lease owner, it verifies ownership before destructive actions:

- Product guardian command line contains the random marker.
- Product process-start fingerprint still matches.
- Emulator serial still reports the recorded AVD name.

It then stops the product group and emulator. If any verification or cleanup step fails, the slot remains quarantined instead of being reassigned.

## Security Boundary

Hive provides policy and lifecycle isolation, not an operating-system sandbox.

Concrete guarantees include:

- Per-cell AVD files and deterministic AVD identity.
- Atomic host-global slot ownership with random tokens and PID fingerprints.
- Identity checks before destructive emulator or product cleanup.
- Guarded default `adb` and `emulator` tooling bound to one lease.
- Authenticated emulator gRPC discovery and probing.
- Loopback-only viewer binding and strict port ownership.
- Explicit browser/Electron microphone permission handling.
- Ownership evidence retained after failed cleanup.

The product command remains an arbitrary same-user host process. Hive does not claim that it is containerized or jailed. Deliberate product code can use host permissions available to the Hive user, including finding other installed executables or opening accessible files and sockets.

The accurate boundary is:

> Hive provides lifecycle ownership, collision avoidance, identity-checked cleanup, and guarded default Android tooling around unsandboxed same-user host processes.

## Runtime State Reference

```text
~/.hive/runtime/android-v2/                  host-global lease registry

$HIVE_CELL_RUNTIME_DIR/
├── android-avd/                             cell-local AVD
├── product-android-sdk/                     product SDK overlay
├── viewer-android-sdk/                      viewer SDK overlay
└── emulator-crash-<pid>.db/                 emulator crash reports

$HIVE_CELL_ARTIFACTS_DIR/                    preserved cell artifacts
```

Useful variables:

| Variable | Meaning |
|---|---|
| `ANDROID_SERIAL` | Leased `emulator-<console-port>` serial |
| `ANDROID_AVD` | Cell-specific AVD name |
| `ANDROID_AVD_HOME` | Cell-local AVD directory |
| `ANDROID_EMULATOR_GRPC_PORT` | Supervisor-allocated gRPC port |
| `ANDROID_EMULATOR_GPU_MODE` | Optional GPU override; otherwise Hive selects `host` when safe and `auto` as fallback |
| `HIVE_ANDROID_DEVICE_START_TIMEOUT_MS` | Emulator boot timeout |
| `HIVE_ANDROID_AUDIO_CAPTURE_PATH` | Optional raw output PCM capture |
| `HIVE_SERVICE_AUDIO_INPUT` | Viewer microphone authorization flag |
| `HIVE_SERVICE_AUDIO_OUTPUT` | Emulator output bridge flag |

## Troubleshooting

### Android command fails immediately

Hive supports x64 and arm64 Linux/macOS hosts. Resolve the SDK from the configured environment or the standard host path, then check its tools:

```bash
if [ "$(uname -s)" = "Darwin" ]; then
  DEFAULT_ANDROID_SDK="$HOME/Library/Android/sdk"
else
  DEFAULT_ANDROID_SDK="$HOME/Android/Sdk"
fi
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$DEFAULT_ANDROID_SDK}}"
test -x "$SDK_ROOT/platform-tools/adb"
test -x "$SDK_ROOT/emulator/emulator"
test -x "$SDK_ROOT/cmdline-tools/latest/bin/avdmanager"
```

Required packages include platform tools, emulator, latest command-line tools, and the Android 34 Google APIs system image for the host ABI. For example on x64:

```bash
"$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" \
  "emulator" \
  "system-images;android-34;google_apis;x86_64"
```

### Viewer never becomes ready

Check, in order:

1. The app service is still running.
2. Its emulator reached `sys.boot_completed=1`.
3. The viewer gRPC port matches the app's `android-grpc` port.
4. The viewer HTTP port is free.
5. The lease still belongs to the same cell.

### Microphone does not start

Check:

1. The viewer service has `audio.input: true`.
2. The guest app has started `AudioRecord`.
3. Browser or Electron permission was approved.
4. The preferred microphone label still exists and is unique.
5. The viewer shows no microphone error notice.
6. Other viewer tabs or desktop windows for this emulator are closed.

### Emulator audio is silent on the host

On Linux, verify PipeWire and `pw-cat`:

```bash
command -v pw-cat
test -n "$XDG_RUNTIME_DIR" || test -d "/run/user/$(id -u)"
```

Host playback is not implemented on macOS. Raw output capture can still be used for verification.

### A slot remains after a crash

Inspect:

```text
~/.hive/runtime/android-v2/slots/<console-port>/owner.json
```

Do not delete a retained slot until confirming its serial, emulator, and product process group are gone. Retention usually means Hive could not prove cleanup was safe.

## Verification

The production boundary is exercised with:

```bash
bun run test:e2e:android-service-audio
```

Local prerequisites are JDK 17 (`javac` and `keytool`), `zip`, Playwright Chromium, a compatible Android SDK with platform/build tools, and `ffmpeg` with `flite`, `drawtext`, H.264, and AAC support. Linux additionally requires working `/dev/kvm` access.

This builds a packaged Hive distribution and verifies:

- Concurrent cells receive distinct emulator leases and ports.
- Browser microphone PCM reaches guest `AudioRecord`.
- Guest `AudioTrack` PCM reaches the emulator gRPC output stream.
- Viewer-only restart preserves the emulator and works in both directions afterward.
- Deletion cleans only owned emulators.
- A synchronized evidence MP4 contains both audio directions before and after restart.

Reports are written to:

```text
apps/e2e/reports/latest/
```

The evidence MP4 uses:

- Left channel: browser-to-emulator microphone input.
- Right channel: guest-to-host emulator audio output.
- H.264 video and 48 kHz stereo AAC.

The hardware-backed suite runs on Linux CI for merge queue, `main`, and manual dispatch, not on ordinary pull-request events. macOS runtime support should be verified locally when changing platform-specific behavior.

## Key Implementation Files

| File | Responsibility |
|---|---|
| `packages/android-runtime/src/command.ts` | CLI parsing and host support checks |
| `packages/android-runtime/src/emulator.ts` | AVD preparation, emulator/product lifecycle, guardian |
| `packages/android-runtime/src/lease.ts` | Host-global slot ownership and stale recovery |
| `packages/android-runtime/src/policy.ts` | SDK, AVD, GPU, flags, and environment policy |
| `packages/android-runtime/src/viewer.ts` | Guarded SDK overlays, viewer, gRPC, audio output |
| `patches/stream-droid@0.5.0.patch` | Video, microphone injection, status bridge, strict ports |
| `apps/web/src/lib/audio-input.ts` | Preferred microphone persistence and status messages |
| `apps/web/src/routes/cells/$cellId/viewer.tsx` | Browser iframe integration |
| `apps/desktop-electron/src/media-permissions.ts` | Electron media permission boundary |
| `apps/e2e/specs/android-service-audio.android.e2e.ts` | Packaged hardware behavior proof |
| `packages/android-runtime/e2e/audio-video.ts` | Evidence audio/video assembly and validation |

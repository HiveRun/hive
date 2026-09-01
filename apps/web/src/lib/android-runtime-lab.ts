import {
  HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ,
  HIVE_ANDROID_CONSOLE_PORT_MIN,
  HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS,
  HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES,
  resolveHiveAndroidAvdName,
  resolveHiveAndroidSerial,
} from "@hive/android-runtime/facts";

export const RUNTIME_NODE_IDS = [
  "supervisor",
  "lease",
  "emulator",
  "guardian",
  "product",
  "guest",
  "grpc",
  "viewer",
  "browser",
] as const;

export type RuntimeNodeId = (typeof RUNTIME_NODE_IDS)[number];

export const RUNTIME_EDGE_IDS = [
  "supervisor-lease",
  "lease-emulator",
  "supervisor-guardian",
  "guardian-product",
  "product-guest",
  "emulator-guest",
  "emulator-grpc",
  "grpc-viewer",
  "viewer-browser",
  "browser-viewer",
  "viewer-grpc",
  "grpc-emulator",
] as const;

export type RuntimeEdgeId = (typeof RUNTIME_EDGE_IDS)[number];
export type RuntimeLabNodeState =
  | "active"
  | "failed"
  | "guarded"
  | "idle"
  | "stopped"
  | "verified"
  | "waiting";

type RuntimeNode = {
  id: RuntimeNodeId;
  label: string;
  shortLabel: string;
  role: string;
  x: number;
  y: number;
};

export type RuntimeEdge = {
  from: RuntimeNodeId;
  id: RuntimeEdgeId;
  label: string;
  to: RuntimeNodeId;
};

type RuntimeTelemetry = {
  grpc: string;
  lease: string;
  serial: string;
  viewer: string;
};

type RuntimeStep = {
  activeEdges: RuntimeEdgeId[];
  activeNodes: RuntimeNodeId[];
  checks: string[];
  detail: string;
  event: string;
  id: string;
  nodeStates?: Partial<Record<RuntimeNodeId, RuntimeLabNodeState>>;
  source: string;
  telemetry: RuntimeTelemetry;
  title: string;
  why: string;
};

type RuntimeFault = {
  activeEdges: RuntimeEdgeId[];
  blockedEdges: RuntimeEdgeId[];
  detail: string;
  event: string;
  label: string;
  nodeStates: Partial<Record<RuntimeNodeId, RuntimeLabNodeState>>;
  source: string;
  step: number;
  title: string;
  why: string;
};

export type RuntimeScenario = {
  accent: "amber" | "teal" | "violet";
  fault: RuntimeFault;
  id: RuntimeScenarioId;
  kicker: string;
  shortLabel: string;
  steps: RuntimeStep[];
  summary: string;
  title: string;
};

const telemetry = (
  lease: string,
  serial: string,
  grpc: string,
  viewer: string
): RuntimeTelemetry => ({ grpc, lease, serial, viewer });

const LAB_CELL_ID = "cell-a";
const LAB_CONSOLE_PORT = HIVE_ANDROID_CONSOLE_PORT_MIN;
const LAB_SERIAL = resolveHiveAndroidSerial(LAB_CONSOLE_PORT);
const LAB_AVD_NAME = resolveHiveAndroidAvdName(LAB_CELL_ID);
const LAB_GRPC_PORT = "<allocated-grpc-port>";
const LAB_VIEWER_PORT = "<allocated-viewer-port>";
const LAB_LEASE_TOKEN = "<lease-token>";
const HERTZ_PER_KILOHERTZ = 1000;
const LAB_AUDIO_SAMPLE_RATE_KHZ =
  HIVE_ANDROID_AUDIO_SAMPLE_RATE_HZ / HERTZ_PER_KILOHERTZ;

export const RUNTIME_NODES: RuntimeNode[] = [
  {
    id: "supervisor",
    label: "Hive supervisor",
    shortLabel: "HIVE",
    role: "Allocates service ports and owns the wrapper lifecycle.",
    x: 12,
    y: 44,
  },
  {
    id: "lease",
    label: "Lease registry",
    shortLabel: "LEASE",
    role: "Atomically assigns one host console pair to one cell.",
    x: 28,
    y: 14,
  },
  {
    id: "guardian",
    label: "Product guardian",
    shortLabel: "GUARD",
    role: "Publishes product identity, forwards I/O, and reaps the process group.",
    x: 28,
    y: 74,
  },
  {
    id: "emulator",
    label: "Android emulator",
    shortLabel: "EMU",
    role: "Runs the leased cell AVD and authenticated controller endpoint.",
    x: 50,
    y: 14,
  },
  {
    id: "guest",
    label: "Android guest",
    shortLabel: "GUEST",
    role: "The app inside Android consumes microphone input and renders audio.",
    x: 50,
    y: 44,
  },
  {
    id: "product",
    label: "Product command",
    shortLabel: "PRODUCT",
    role: "Workspace tooling that builds, installs, and serves the Android product.",
    x: 50,
    y: 74,
  },
  {
    id: "grpc",
    label: "Emulator gRPC",
    shortLabel: "gRPC",
    role: "Token-authenticated screenshots, controls, audio stream, and injection.",
    x: 70,
    y: 14,
  },
  {
    id: "viewer",
    label: "Viewer service",
    shortLabel: "VIEWER",
    role: "Verifies the lease and exposes Stream Droid on one loopback port.",
    x: 70,
    y: 44,
  },
  {
    id: "browser",
    label: "Browser or Electron",
    shortLabel: "CLIENT",
    role: "Displays video, sends controls, and captures approved microphone PCM.",
    x: 88,
    y: 44,
  },
];

export const RUNTIME_EDGES: RuntimeEdge[] = [
  {
    from: "supervisor",
    id: "supervisor-lease",
    label: "claims slot",
    to: "lease",
  },
  {
    from: "lease",
    id: "lease-emulator",
    label: "binds identity",
    to: "emulator",
  },
  {
    from: "supervisor",
    id: "supervisor-guardian",
    label: "spawns gate",
    to: "guardian",
  },
  {
    from: "guardian",
    id: "guardian-product",
    label: "starts command",
    to: "product",
  },
  {
    from: "product",
    id: "product-guest",
    label: "installs product",
    to: "guest",
  },
  {
    from: "emulator",
    id: "emulator-guest",
    label: "hosts Android",
    to: "guest",
  },
  {
    from: "emulator",
    id: "emulator-grpc",
    label: "publishes endpoint",
    to: "grpc",
  },
  {
    from: "grpc",
    id: "grpc-viewer",
    label: "video and audio output",
    to: "viewer",
  },
  {
    from: "viewer",
    id: "viewer-browser",
    label: "HTTP and WebSocket",
    to: "browser",
  },
  {
    from: "browser",
    id: "browser-viewer",
    label: "microphone PCM",
    to: "viewer",
  },
  {
    from: "viewer",
    id: "viewer-grpc",
    label: "injectAudio stream",
    to: "grpc",
  },
  {
    from: "grpc",
    id: "grpc-emulator",
    label: "virtual microphone",
    to: "emulator",
  },
];

const VIEWER_CLIENT_NODES: RuntimeNodeId[] = [
  "emulator",
  "grpc",
  "viewer",
  "browser",
  "guest",
];
const VIEWER_CLIENT_EDGES: RuntimeEdgeId[] = [
  "emulator-grpc",
  "grpc-viewer",
  "viewer-browser",
  "emulator-guest",
];

const COLD_START_STEPS: RuntimeStep[] = [
  {
    id: "allocate-service-ports",
    title: "Allocate service ports",
    event: "Supervisor reserves product, gRPC, and viewer ports.",
    detail:
      "Named ports are persisted before either Android service starts. Independent services may start concurrently, while configured dependsOn edges create readiness-ordered waves.",
    why: "Stable ownership begins before process creation. Port references allocate addresses but do not secretly create dependency edges.",
    source: "apps/server/src/services/supervisor.ts",
    activeNodes: ["supervisor"],
    activeEdges: [],
    checks: ["All requested ports are available", "gRPC is marked non-viewer"],
    telemetry: telemetry(
      "unclaimed",
      "pending",
      LAB_GRPC_PORT,
      LAB_VIEWER_PORT
    ),
  },
  {
    id: "claim-emulator-slot",
    title: "Claim emulator slot",
    event: `Cell claims host slot ${LAB_CONSOLE_PORT} with a random lease token.`,
    detail:
      "The host-global allocation lock serializes concurrent claims. The owner record binds cell ID, wrapper PID fingerprint, AVD, serial, and gRPC port.",
    why: "A device is safe to use only when every Hive process agrees who owns its console pair.",
    source: "packages/android-runtime/src/lease.ts",
    activeNodes: ["supervisor", "lease"],
    activeEdges: ["supervisor-lease"],
    nodeStates: { lease: "verified" },
    checks: [
      `Console pair ${LAB_CONSOLE_PORT}/${LAB_CONSOLE_PORT + 1} is free`,
      "No live same-cell owner exists",
    ],
    telemetry: telemetry(
      `${LAB_CELL_ID} · ${LAB_LEASE_TOKEN}`,
      LAB_SERIAL,
      LAB_GRPC_PORT,
      LAB_VIEWER_PORT
    ),
  },
  {
    id: "boot-cell-avd",
    title: "Boot cell AVD",
    event: `Hive starts ${LAB_AVD_NAME} on the leased console port.`,
    detail:
      "The emulator uses the cell-local AVD, disables snapshots, enables token-authenticated gRPC, and waits for both ADB device state and sys.boot_completed.",
    why: "A serial becoming visible is not enough. Hive also verifies the live AVD name before trusting the device.",
    source: "packages/android-runtime/src/emulator.ts",
    activeNodes: ["lease", "emulator"],
    activeEdges: ["lease-emulator"],
    nodeStates: { emulator: "waiting", lease: "verified" },
    checks: [
      "ADB state is device",
      "sys.boot_completed is 1",
      "AVD identity matches",
    ],
    telemetry: telemetry(
      "held",
      `${LAB_SERIAL} · booting`,
      `${LAB_GRPC_PORT} · token`,
      LAB_VIEWER_PORT
    ),
  },
  {
    id: "publish-product-owner",
    title: "Publish guardian identity",
    event: "Guardian waits while Hive persists its marker and fingerprint.",
    detail:
      "The product process cannot run until its durable recovery identity is written to owner.json. Hive then opens the private control gate.",
    why: "If Hive dies one instruction later, stale recovery still knows exactly which process group it may terminate.",
    source: "packages/android-runtime/src/emulator.ts",
    activeNodes: ["supervisor", "lease", "guardian"],
    activeEdges: ["supervisor-guardian", "supervisor-lease"],
    nodeStates: { guardian: "guarded", lease: "verified" },
    checks: ["Random marker recorded", "Process-start fingerprint recorded"],
    telemetry: telemetry(
      "guardian published",
      `${LAB_SERIAL} · ready`,
      `${LAB_GRPC_PORT} · ready`,
      LAB_VIEWER_PORT
    ),
  },
  {
    id: "start-product",
    title: "Start product command",
    event: "Guardian releases the product command with guarded Android tools.",
    detail:
      "The workspace command inherits normal I/O but resolves adb and emulator through a token-checking SDK overlay bound to this lease.",
    why: "Normal product tooling stays convenient while accidental cross-cell and shared-server operations fail closed.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["guardian", "product", "guest"],
    activeEdges: ["guardian-product", "product-guest"],
    nodeStates: { guardian: "guarded", guest: "waiting" },
    checks: ["Lease token still matches", "Alternate ADB routing is removed"],
    telemetry: telemetry(
      "held",
      `${LAB_SERIAL} · ready`,
      `${LAB_GRPC_PORT} · ready`,
      LAB_VIEWER_PORT
    ),
  },
  {
    id: "verify-viewer",
    title: "Verify and expose viewer",
    event:
      "Viewer proves lease, AVD, gRPC token, and screenshot before serving.",
    detail:
      "Stream Droid starts on the exact loopback viewer port only after an authenticated screenshot succeeds. The browser can now attach.",
    why: "The viewer proves the complete identity chain before opening its port. When HTTP readiness is configured, the supervisor checks that separately.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: VIEWER_CLIENT_NODES,
    activeEdges: VIEWER_CLIENT_EDGES,
    nodeStates: {
      browser: "verified",
      emulator: "verified",
      grpc: "verified",
      guest: "active",
      viewer: "verified",
    },
    checks: [
      "gRPC port equals lease",
      "Screenshot probe succeeds",
      "Configured HTTP readiness passes",
    ],
    telemetry: telemetry(
      "held",
      `${LAB_SERIAL} · ready`,
      `${LAB_GRPC_PORT} · verified`,
      `${LAB_VIEWER_PORT} · ready`
    ),
  },
];

const MICROPHONE_STEPS: RuntimeStep[] = [
  {
    id: "guest-records",
    title: "Guest opens AudioRecord",
    event: "Android reports an active recording consumer.",
    detail:
      "Stream Droid polls Android audio state. Merely opening the viewer does not trigger browser capture or a permission prompt.",
    why: "Microphone access follows product intent instead of viewer presence.",
    source: "patches/stream-droid@0.5.0.patch",
    activeNodes: ["guest", "emulator", "viewer"],
    activeEdges: ["emulator-guest", "grpc-viewer"],
    nodeStates: { guest: "waiting", viewer: "active" },
    checks: ["audio.input is enabled", "Guest capture is active"],
    telemetry: telemetry("held", LAB_SERIAL, "capture detected", "audio ready"),
  },
  {
    id: "request-permission",
    title: "Request microphone",
    event: "Viewer requests the approved browser or Electron audio track.",
    detail:
      "The preferred label is resolved inside the viewer origin. Electron additionally verifies the registered BrowserView origin and asks through a Hive dialog.",
    why: "Permission and device IDs belong to origins, so Hive stores a human-readable label and re-resolves it safely.",
    source: "apps/desktop-electron/src/media-permissions.ts",
    activeNodes: ["browser", "viewer"],
    activeEdges: ["browser-viewer"],
    nodeStates: { browser: "waiting", viewer: "verified" },
    checks: [
      "Audio-only request",
      "Exact loopback origin",
      "Unique preferred label",
    ],
    telemetry: telemetry(
      "held",
      LAB_SERIAL,
      "capture detected",
      "permission pending"
    ),
  },
  {
    id: "encode-browser-pcm",
    title: "Frame browser PCM",
    event: `Browser emits ${HIVE_ANDROID_MICROPHONE_FRAME_DURATION_MS} ms mono PCM frames at ${LAB_AUDIO_SAMPLE_RATE_KHZ} kHz.`,
    detail:
      "The selected track is resampled when needed. Queue depth stays bounded and old frames are dropped rather than accumulating conversational latency.",
    why: "Live voice quality depends more on bounded latency than preserving stale audio.",
    source: "patches/stream-droid@0.5.0.patch",
    activeNodes: ["browser", "viewer"],
    activeEdges: ["browser-viewer"],
    nodeStates: { browser: "active", viewer: "active" },
    checks: [
      `${HIVE_ANDROID_MICROPHONE_FRAME_SAMPLES} samples per frame`,
      "Signed 16-bit mono",
      "Queue remains bounded",
    ],
    telemetry: telemetry(
      "held",
      LAB_SERIAL,
      "inject stream open",
      `PCM ${LAB_AUDIO_SAMPLE_RATE_KHZ} kHz`
    ),
  },
  {
    id: "inject-microphone",
    title: "Inject virtual microphone",
    event: "Viewer streams PCM through authenticated injectAudio gRPC.",
    detail:
      "Only one browser owns injection for the serial. The viewer paces frames and inserts silence when the browser briefly underruns.",
    why: "Single ownership prevents two tabs from mixing unrelated microphones into one Android device.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["browser", "viewer", "grpc", "emulator"],
    activeEdges: ["browser-viewer", "viewer-grpc", "grpc-emulator"],
    nodeStates: {
      browser: "active",
      emulator: "active",
      grpc: "active",
      viewer: "active",
    },
    checks: [
      "Same-origin WebSocket",
      "One owner per serial",
      "gRPC token accepted",
    ],
    telemetry: telemetry(
      "held",
      LAB_SERIAL,
      `injecting ${LAB_AUDIO_SAMPLE_RATE_KHZ} kHz`,
      "microphone live"
    ),
  },
  {
    id: "guest-receives",
    title: "Guest receives speech",
    event: "AudioRecord consumes the browser speech inside Android.",
    detail:
      "When guest recording stops, the browser track and gRPC injection stream close automatically. There is no separate Hive microphone toggle.",
    why: "The guest remains the source of truth for when capture is useful.",
    source: "apps/e2e/specs/android-service-audio.android.e2e.ts",
    activeNodes: ["browser", "viewer", "grpc", "emulator", "guest"],
    activeEdges: [
      "browser-viewer",
      "viewer-grpc",
      "grpc-emulator",
      "emulator-guest",
    ],
    nodeStates: {
      browser: "verified",
      guest: "verified",
      grpc: "verified",
      viewer: "verified",
    },
    checks: [
      "Guest PCM contains speech",
      "Pilot frequency matches input fixture",
    ],
    telemetry: telemetry("held", LAB_SERIAL, "injection verified", "ready"),
  },
];

const VIEWER_RESTART_STEPS: RuntimeStep[] = [
  {
    id: "steady-viewer",
    title: "Observe steady state",
    event: "Viewer and emulator are healthy on their allocated ports.",
    detail:
      "The app service owns the emulator. The viewer owns only Stream Droid and its loopback HTTP surface.",
    why: "Separating ownership lets the viewing layer restart without disturbing a cold Android build.",
    source: "apps/server/src/services/supervisor.ts",
    activeNodes: [
      "lease",
      "emulator",
      "grpc",
      "viewer",
      "browser",
      "guardian",
      "product",
    ],
    activeEdges: [
      "lease-emulator",
      "emulator-grpc",
      "grpc-viewer",
      "viewer-browser",
      "guardian-product",
    ],
    nodeStates: {
      browser: "verified",
      emulator: "verified",
      lease: "verified",
      viewer: "verified",
    },
    checks: ["Lease token stable", "Viewer health ready"],
    telemetry: telemetry(
      LAB_LEASE_TOKEN,
      LAB_SERIAL,
      LAB_GRPC_PORT,
      `${LAB_VIEWER_PORT} · <viewer-pid>`
    ),
  },
  {
    id: "stop-viewer",
    title: "Stop viewer process",
    event: "Supervisor terminates only the viewer process group.",
    detail:
      "The browser detaches and gRPC streams close. App, guardian, product, emulator, serial, and lease continue running.",
    why: "Viewer failure should not convert into an expensive device restart.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["viewer", "browser"],
    activeEdges: ["viewer-browser", "grpc-viewer"],
    nodeStates: { browser: "stopped", viewer: "stopped" },
    checks: ["Viewer process group exits", "Audio writers close"],
    telemetry: telemetry(
      "unchanged",
      `${LAB_SERIAL} · ready`,
      `${LAB_GRPC_PORT} · alive`,
      `${LAB_VIEWER_PORT} · stopped`
    ),
  },
  {
    id: "prove-lease-continuity",
    title: "Prove lease continuity",
    event: "App PID, serial, token, and gRPC endpoint remain unchanged.",
    detail:
      "The lease belongs to the app wrapper, not the viewer. No ownership mutation is needed during a viewer-only restart.",
    why: "Stable identity makes reconnection deterministic and prevents a restart from masking emulator churn.",
    source: "packages/android-runtime/src/lease.ts",
    activeNodes: ["lease", "emulator", "guardian", "product", "grpc"],
    activeEdges: ["lease-emulator", "guardian-product", "emulator-grpc"],
    nodeStates: { emulator: "verified", grpc: "verified", lease: "verified" },
    checks: ["Token unchanged", "App PID unchanged", "Serial unchanged"],
    telemetry: telemetry(
      LAB_LEASE_TOKEN,
      LAB_SERIAL,
      LAB_GRPC_PORT,
      `${LAB_VIEWER_PORT} · reserved`
    ),
  },
  {
    id: "start-new-viewer",
    title: "Start replacement viewer",
    event: "New viewer re-verifies the existing lease and exact port.",
    detail:
      "The replacement process performs the full AVD identity and authenticated screenshot probe before reporting ready.",
    why: "Restart does not inherit trust from the old viewer process.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["lease", "emulator", "grpc", "viewer"],
    activeEdges: ["lease-emulator", "emulator-grpc", "grpc-viewer"],
    nodeStates: { grpc: "verified", lease: "verified", viewer: "waiting" },
    checks: ["Exact HTTP port available", "Screenshot probe succeeds"],
    telemetry: telemetry(
      LAB_LEASE_TOKEN,
      LAB_SERIAL,
      LAB_GRPC_PORT,
      `${LAB_VIEWER_PORT} · <replacement-pid>`
    ),
  },
  {
    id: "reconnect-client",
    title: "Reconnect client",
    event: "Hive mounts a fresh iframe or BrowserView against the same origin.",
    detail:
      "Video, controls, microphone injection, and audio output work again while the underlying Android session remains continuous.",
    why: "The user sees a viewer refresh, not a device reboot.",
    source: "apps/e2e/specs/android-service-audio.android.e2e.ts",
    activeNodes: VIEWER_CLIENT_NODES,
    activeEdges: VIEWER_CLIENT_EDGES,
    nodeStates: {
      browser: "verified",
      emulator: "verified",
      viewer: "verified",
    },
    checks: [
      "Old frame detached",
      "New viewer PID",
      "Both audio directions pass",
    ],
    telemetry: telemetry(
      "unchanged",
      LAB_SERIAL,
      LAB_GRPC_PORT,
      `${LAB_VIEWER_PORT} · ready`
    ),
  },
];

const STALE_RECOVERY_STEPS: RuntimeStep[] = [
  {
    id: "find-stale-owner",
    title: "Find stale owner",
    event: "Allocator finds a lease whose wrapper PID is no longer alive.",
    detail:
      "The slot is not immediately deleted. Hive treats every retained ownership record as evidence of a potentially live host resource.",
    why: "Reassigning first and cleaning later could give two cells the same device.",
    source: "packages/android-runtime/src/lease.ts",
    activeNodes: ["supervisor", "lease"],
    activeEdges: ["supervisor-lease"],
    nodeStates: { lease: "waiting", supervisor: "active" },
    checks: ["Owner process is dead", "Slot shape is valid"],
    telemetry: telemetry(
      `stale · ${LAB_LEASE_TOKEN}`,
      LAB_SERIAL,
      LAB_GRPC_PORT,
      "unknown"
    ),
  },
  {
    id: "verify-product-owner",
    title: "Verify product identity",
    event: "Hive compares guardian marker and process-start fingerprint.",
    detail:
      "A live process group is terminated only if its command includes the random marker and its start fingerprint matches the persisted owner.",
    why: "A reused PID must never turn stale cleanup into termination of an unrelated process.",
    source: "packages/android-runtime/src/emulator.ts",
    activeNodes: ["lease", "guardian"],
    activeEdges: ["supervisor-guardian"],
    nodeStates: { guardian: "waiting", lease: "guarded" },
    checks: ["Random marker matches", "Fingerprint matches"],
    telemetry: telemetry("recovery lock", LAB_SERIAL, LAB_GRPC_PORT, "offline"),
  },
  {
    id: "stop-product-group",
    title: "Stop product group",
    event: "Verified guardian group receives TERM, then bounded KILL fallback.",
    detail:
      "Hive waits for cooperative shutdown, kills remaining members when needed, and reaps the direct product before moving to the emulator.",
    why: "Recovery must remove workspace tooling without hanging forever on a resistant child.",
    source: "packages/android-runtime/src/process.ts",
    activeNodes: ["guardian", "product"],
    activeEdges: ["guardian-product"],
    nodeStates: { guardian: "active", product: "stopped" },
    checks: ["Process group is verified", "No group members remain"],
    telemetry: telemetry("recovery lock", LAB_SERIAL, LAB_GRPC_PORT, "offline"),
  },
  {
    id: "verify-emulator-owner",
    title: "Verify emulator identity",
    event: "Live serial must report the AVD recorded by the stale lease.",
    detail: `Hive asks ${LAB_SERIAL} for its running AVD name before sending adb emu kill. A serial number by itself is not trusted.`,
    why: "The console port may now belong to a different emulator or user process.",
    source: "packages/android-runtime/src/android-device.ts",
    activeNodes: ["lease", "emulator"],
    activeEdges: ["lease-emulator"],
    nodeStates: { emulator: "waiting", lease: "guarded" },
    checks: ["Serial is present", "Live AVD equals recorded AVD"],
    telemetry: telemetry(
      "recovery lock",
      `${LAB_SERIAL} · verified`,
      LAB_GRPC_PORT,
      "offline"
    ),
  },
  {
    id: "release-recovered-slot",
    title: "Release recovered slot",
    event: "Serial disappears and Hive removes the stale lease directory.",
    detail:
      "Only successful product and emulator cleanup makes the console pair available to another cell.",
    why: "Cleanup completion, not intent, is the point where ownership can safely change.",
    source: "packages/android-runtime/src/lease.ts",
    activeNodes: ["supervisor", "lease"],
    activeEdges: ["supervisor-lease"],
    nodeStates: { lease: "verified", supervisor: "verified" },
    checks: [
      "Serial absent",
      "Console pair bindable",
      "Lease directory removed",
    ],
    telemetry: telemetry("available", "absent", "available", "offline"),
  },
];

const ADB_ISOLATION_STEPS: RuntimeStep[] = [
  {
    id: "resolve-overlay",
    title: "Resolve guarded adb",
    event: "Product PATH resolves adb from its cell SDK overlay.",
    detail:
      "The overlay preserves ordinary Android SDK content but replaces adb and emulator with wrappers carrying lease identity.",
    why: "Common workspace commands remain unchanged while their default device scope becomes explicit.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["guardian", "product", "lease"],
    activeEdges: ["guardian-product", "supervisor-lease"],
    nodeStates: { lease: "guarded", product: "active" },
    checks: [
      "Real SDK directories removed from PATH",
      "Overlay wrapper is executable",
    ],
    telemetry: telemetry(LAB_LEASE_TOKEN, LAB_SERIAL, "local server", "ready"),
  },
  {
    id: "check-token",
    title: "Check immutable token",
    event:
      "Wrapper compares its expected token with the live lease token file.",
    detail:
      "Mutable owner metadata can change as lifecycle details are published; the separate token file remains the ownership authority.",
    why: "A stale wrapper must stop working immediately after lease replacement.",
    source: "packages/android-runtime/src/lease.ts",
    activeNodes: ["product", "lease"],
    activeEdges: ["supervisor-lease"],
    nodeStates: { lease: "verified", product: "waiting" },
    checks: ["Token file readable", "Expected token equals live token"],
    telemetry: telemetry("token match", LAB_SERIAL, "local server", "ready"),
  },
  {
    id: "parse-command",
    title: "Parse command boundary",
    event: "Wrapper rejects alternate transports and shared ADB operations.",
    detail:
      "Attached selectors, alternate servers, raw host services, chained wait commands, server control, pairing, and transport mutation fail before real adb executes.",
    why: "Injecting -s later is not enough because ADB accepts multiple parser forms that can override or escape device scope.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["product", "lease", "emulator"],
    activeEdges: ["lease-emulator"],
    nodeStates: { emulator: "guarded", lease: "verified", product: "active" },
    checks: [
      "No alternate selector",
      "No shared command",
      "No routing environment override",
    ],
    telemetry: telemetry(
      "token match",
      `forced ${LAB_SERIAL}`,
      "local server",
      "ready"
    ),
  },
  {
    id: "verify-avd",
    title: "Verify live AVD",
    event: `Wrapper confirms ${LAB_SERIAL} still runs the leased AVD.`,
    detail:
      "Even a valid-looking serial cannot receive the command until its running AVD name agrees with the lease.",
    why: "Identity verification protects against stale serial reuse and cross-wired emulator state.",
    source: "packages/android-runtime/src/viewer.ts",
    activeNodes: ["lease", "emulator", "product"],
    activeEdges: ["lease-emulator", "product-guest"],
    nodeStates: { emulator: "verified", lease: "verified", product: "waiting" },
    checks: ["Serial is online", "AVD name equals lease owner"],
    telemetry: telemetry(
      "token match",
      `${LAB_SERIAL} · AVD match`,
      "local server",
      "ready"
    ),
  },
  {
    id: "execute-scoped-command",
    title: "Execute scoped command",
    event: "Real adb receives the command with the leased serial.",
    detail:
      "Normal device operations such as shell, install, push, pull, reverse, logcat, and bugreport continue through the verified boundary.",
    why: "The guardrail constrains ownership without replacing Android's normal developer workflow.",
    source: "packages/android-runtime/src/viewer.test.ts",
    activeNodes: ["product", "emulator", "guest"],
    activeEdges: ["product-guest", "emulator-guest"],
    nodeStates: { emulator: "verified", guest: "active", product: "verified" },
    checks: ["Command is device-scoped", "Real adb exit status is preserved"],
    telemetry: telemetry("held", LAB_SERIAL, "local server", "ready"),
  },
];

export const RUNTIME_SCENARIOS = [
  {
    id: "cold-start",
    shortLabel: "START",
    title: "Cold start",
    kicker: "Lifecycle 01",
    summary: "From named ports to an identity-verified browser viewer.",
    accent: "amber",
    steps: COLD_START_STEPS,
    fault: {
      label: "Boot timeout",
      step: 2,
      title: "Emulator never completes boot",
      event: "Boot deadline expires before sys.boot_completed reaches 1.",
      detail:
        "The product gate never opens. Hive terminates the emulator process group and retains the lease if it cannot prove the serial disappeared.",
      why: "A partial Android runtime must not look ready or become available to another cell.",
      source: "packages/android-runtime/src/emulator.ts",
      activeEdges: ["lease-emulator"],
      blockedEdges: ["supervisor-guardian"],
      nodeStates: { emulator: "failed", guardian: "stopped", lease: "guarded" },
    },
  },
  {
    id: "microphone",
    shortLabel: "MIC",
    title: "Browser microphone",
    kicker: "Media 02",
    summary:
      "Demand-driven speech injection from browser to guest AudioRecord.",
    accent: "violet",
    steps: MICROPHONE_STEPS,
    fault: {
      label: "Deny permission",
      step: 1,
      title: "Microphone approval denied",
      event: "Browser or Electron returns no approved audio track.",
      detail:
        "The viewer reports a microphone error, closes the prepared injectAudio stream with a short silence flush, and never substitutes another microphone.",
      why: "Permission failure remains visible and cannot silently select a different device.",
      source: "apps/web/src/lib/audio-input.ts",
      activeEdges: ["browser-viewer"],
      blockedEdges: ["viewer-grpc"],
      nodeStates: { browser: "failed", guest: "waiting", viewer: "guarded" },
    },
  },
  {
    id: "viewer-restart",
    shortLabel: "RESTART",
    title: "Viewer restart",
    kicker: "Recovery 03",
    summary: "Replace the viewing layer without rebooting Android.",
    accent: "teal",
    steps: VIEWER_RESTART_STEPS,
    fault: {
      label: "Occupy port",
      step: 3,
      title: "Exact viewer port is occupied",
      event:
        "Replacement viewer refuses to walk away from its allocated origin.",
      detail:
        "The viewer exits with an explicit port error. The app, lease, emulator, and gRPC endpoint remain healthy for a later retry.",
      why: "Changing ports would break browser permission origin and supervisor ownership.",
      source: "packages/android-runtime/src/viewer.ts",
      activeEdges: ["grpc-viewer"],
      blockedEdges: ["viewer-browser"],
      nodeStates: {
        browser: "stopped",
        emulator: "verified",
        viewer: "failed",
      },
    },
  },
  {
    id: "stale-recovery",
    shortLabel: "RECOVER",
    title: "Stale recovery",
    kicker: "Ownership 04",
    summary:
      "Recover host resources without killing a reused PID or wrong AVD.",
    accent: "amber",
    steps: STALE_RECOVERY_STEPS,
    fault: {
      label: "Mismatch identity",
      step: 1,
      title: "Guardian fingerprint does not match",
      event: "Hive refuses to terminate the live process group.",
      detail:
        "The slot remains retained and startup fails. An operator can inspect the owner instead of Hive guessing about a potentially reused PID.",
      why: "Quarantine is safer than destructive recovery when identity evidence disagrees.",
      source: "packages/android-runtime/src/emulator.ts",
      activeEdges: ["supervisor-guardian"],
      blockedEdges: ["guardian-product", "lease-emulator"],
      nodeStates: { guardian: "failed", lease: "guarded", product: "active" },
    },
  },
  {
    id: "adb-isolation",
    shortLabel: "ADB",
    title: "ADB isolation",
    kicker: "Boundary 05",
    summary: "Watch normal device commands pass and shared-host escapes stop.",
    accent: "violet",
    steps: ADB_ISOLATION_STEPS,
    fault: {
      label: "Attempt escape",
      step: 2,
      title: "Product attempts a shared ADB escape",
      event: "adb wait-for-device kill-server is rejected before execution.",
      detail:
        "The parser identifies chained, raw host, server, transport, and alternate-selector forms. Real adb is never invoked for this request.",
      why: "The shared host daemon and every other device stay outside this cell's guarded default tooling.",
      source: "packages/android-runtime/src/viewer.test.ts",
      activeEdges: ["lease-emulator"],
      blockedEdges: ["product-guest"],
      nodeStates: { emulator: "guarded", product: "failed" },
    },
  },
] as const satisfies readonly RuntimeScenario[];

export type RuntimeScenarioId =
  | "adb-isolation"
  | "cold-start"
  | "microphone"
  | "stale-recovery"
  | "viewer-restart";

export const DEFAULT_RUNTIME_SCENARIO_ID: RuntimeScenarioId = "cold-start";

export const getRuntimeScenario = (id: RuntimeScenarioId) =>
  RUNTIME_SCENARIOS.find((scenario) => scenario.id === id) ??
  RUNTIME_SCENARIOS[0];

export const clampRuntimeStep = (scenario: RuntimeScenario, step: number) =>
  Math.min(Math.max(0, step), scenario.steps.length - 1);

export const getRuntimeStep = (
  scenario: RuntimeScenario,
  stepIndex: number
): RuntimeStep => {
  const step = scenario.steps[clampRuntimeStep(scenario, stepIndex)];
  if (!step) {
    throw new Error(`Runtime scenario ${scenario.id} has no steps`);
  }
  return step;
};

export const getRuntimeNodeStates = (
  scenario: RuntimeScenario,
  stepIndex: number,
  faultEnabled: boolean
): Record<RuntimeNodeId, RuntimeLabNodeState> => {
  const step = getRuntimeStep(scenario, stepIndex);
  const states = Object.fromEntries(
    RUNTIME_NODE_IDS.map((id) => [id, "idle"])
  ) as Record<RuntimeNodeId, RuntimeLabNodeState>;
  for (const id of step.activeNodes) {
    states[id] = "active";
  }
  Object.assign(states, step.nodeStates);
  if (faultEnabled && stepIndex >= scenario.fault.step) {
    Object.assign(states, scenario.fault.nodeStates);
  }
  return states;
};

export const isRuntimeFaultActive = (
  scenario: RuntimeScenario,
  stepIndex: number,
  faultEnabled: boolean
) => faultEnabled && stepIndex >= scenario.fault.step;

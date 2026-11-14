// Miroir des types Rust (src-tauri/src/model.rs).
export interface ProcStats {
  workingSet: number;
  privateBytes: number;
  cpuPct: number;
}

export interface SessionInfo {
  sessionId: string;
  pid: number;
  name: string | null;
  nameSource: string | null;
  agent: string | null;
  cwd: string | null;
  kind: string | null;
  entrypoint: string | null;
  status: string | null;
  statusSince: number | null;
  startedAt: number | null;
  version: string | null;
  identityVerified: boolean;
  proc: ProcStats | null;
}

export interface SystemSample {
  memTotal: number;
  memAvailable: number;
  memUsed: number;
  cpuPct: number;
  cpuCount: number;
  appPrivateBytes: number;
  appCpuPct: number;
  appProcessCount: number;
}

export interface Snapshot {
  ts: number;
  sessions: SessionInfo[];
  system: SystemSample;
  unattributed: { pid: number; name: string; workingSet: number }[];
  health: {
    registry: "ok" | "missing" | "error";
    registryDetail: string | null;
    registryDir: string;
    staleEntries: number;
  };
}

/** Vue d'un agent pour la scène et l'UI. Indépendante de la source de collecte. */
export interface AgentView {
  key: string;
  sessionId: string;
  displayName: string;
  /** Nom fiable (choisi par l'utilisateur ou agent --agent) vs nom générique dérivé. */
  identityCertain: boolean;
  role: "leader" | "agent";
  theme: "cyber" | "art" | "water" | "default";
  project: string;
  status: "busy" | "idle" | "waiting" | "unknown";
  rawStatus: string | null;
  session: SessionInfo;
}

import type { AgentView, SessionInfo } from "./types";

const basename = (p: string | null) => (p ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : "—");

function themeOf(name: string): AgentView["theme"] {
  const n = name.toLowerCase();
  if (n.includes("ultra") || n.includes("secu") || n.includes("cyber")) return "cyber";
  if (n.includes("artist") || n.includes("art")) return "art";
  if (n.includes("water")) return "water";
  return "default";
}

/** Construit les vues d'agents. Clé stable = identité logique (agent / nom utilisateur), sinon session. */
export function toAgentViews(sessions: SessionInfo[]): AgentView[] {
  const used = new Map<string, number>();
  return sessions.map((s) => {
    const userName = s.nameSource === "user" ? s.name : null;
    const certain = !!(s.agent || userName);
    const displayName = s.agent ?? userName ?? s.name ?? `Session ${s.sessionId.slice(0, 8)}`;
    let key = s.agent ?? userName ?? `session:${s.sessionId}`;
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    if (n > 1) key = `${key}#${n}`;
    const st = s.status === "busy" || s.status === "idle" || s.status === "waiting" ? s.status : "unknown";
    return {
      key,
      sessionId: s.sessionId,
      displayName,
      identityCertain: certain,
      role: /leader/i.test(displayName) && n === 1 ? "leader" : "agent",
      theme: themeOf(displayName),
      project: basename(s.cwd),
      status: st,
      rawStatus: s.status,
      session: s,
    };
  });
}

export const STATUS_LABEL: Record<AgentView["status"], string> = {
  busy: "Occupé",
  idle: "Disponible",
  waiting: "En attente",
  unknown: "Inconnu",
};

export const STATUS_COLOR: Record<AgentView["status"], string> = {
  busy: "#4fb3ff",
  idle: "#4cd08a",
  waiting: "#f2b84b",
  unknown: "#8a93a6",
};

export const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} Go` : `${Math.round(b / 1024 ** 2)} Mo`;

export function fmtAgo(ms: number | null, now: number) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} j`;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "./types";
import { toAgentViews, STATUS_COLOR, STATUS_LABEL, fmtBytes, fmtAgo } from "./agents";
import { OfficeScene } from "./office/scene";
import "./App.css";

const STALE_MS = 6000;

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lastRx, setLastRx] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onTop, setOnTop] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);

  // Flux de monitoring
  useEffect(() => {
    invoke<Snapshot | null>("get_snapshot").then((s) => {
      if (s) {
        setSnap(s);
        setLastRx(Date.now());
      }
    });
    const subs = [
      listen<Snapshot>("monitor://snapshot", (e) => {
        setSnap(e.payload);
        setLastRx(Date.now());
      }),
      listen<boolean>("app://visible", (e) => scene.current?.setVisible(e.payload)),
      listen<boolean>("app://focused", (e) => scene.current?.setFocus(e.payload)),
      listen<boolean>("app://always-on-top", (e) => setOnTop(e.payload)),
    ];
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
      subs.forEach((p) => p.then((u) => u()));
    };
  }, []);

  // Scène Pixi
  useEffect(() => {
    if (!host.current) return;
    const s = new OfficeScene((k) => setSelected(k));
    scene.current = s;
    s.init(host.current).then(() => agentsRef.current && s.setAgents(agentsRef.current));
    const onVis = () => s.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      s.destroy();
      scene.current = null;
    };
  }, []);

  const agents = useMemo(() => toAgentViews(snap?.sessions ?? []), [snap]);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  useEffect(() => scene.current?.setAgents(agents), [agents]);
  useEffect(() => scene.current?.select(selected), [selected]);

  const connected = snap && now - lastRx < STALE_MS && snap.health.registry === "ok";
  const busy = agents.filter((a) => a.status === "busy").length;
  const sys = snap?.system;
  const sel = agents.find((a) => a.key === selected) ?? null;
  const q = query.trim().toLowerCase();
  const listed = agents.filter((a) => !q || a.displayName.toLowerCase().includes(q) || a.project.toLowerCase().includes(q));
  const memPct = sys && sys.memTotal ? (sys.memUsed / sys.memTotal) * 100 : 0;

  const toggleTop = () => {
    const v = !onTop;
    invoke("set_always_on_top", { value: v }).then(() => setOnTop(v));
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">AgenticLab</span>
        <Stat label="Monitoring">
          <span className={connected ? "ok" : "bad"}>
            {connected ? "● Connecté" : snap ? `● ${snap.health.registryDetail ?? "Perdu"}` : "● Démarrage…"}
          </span>
        </Stat>
        <Stat label="Sessions">{agents.length}</Stat>
        <Stat label="Occupés">{busy}</Stat>
        <Stat label="RAM" title="Utilisée / disponible réelle (cache standby inclus)">
          {sys ? (
            <span className={memPct > 90 ? "bad" : memPct > 80 ? "warn" : ""}>
              {fmtBytes(sys.memUsed)} · {fmtBytes(sys.memAvailable)} dispo
            </span>
          ) : "—"}
        </Stat>
        <Stat label="CPU">{sys ? `${sys.cpuPct.toFixed(0)} %` : "—"}</Stat>
        <Stat label="Quota Claude" title="Source officielle : statusLine (rate_limits). Non configurée — nécessite votre accord.">
          <span className="muted">Indisponible</span>
        </Stat>
        <span className="spacer" />
        <Stat label="AgenticLab" title="Mémoire privée cumulée (app + WebView2) / CPU">
          {sys ? `${fmtBytes(sys.appPrivateBytes)} · ${sys.appCpuPct.toFixed(1)} %` : "—"}
        </Stat>
        <button className={onTop ? "btn on" : "btn"} onClick={toggleTop} title="Toujours au premier plan">
          📌
        </button>
      </header>

      <main className="main">
        <div className="office" ref={host} />
        <aside className="inspector">
          {sel ? (
            <Inspector a={sel} now={now} onBack={() => setSelected(null)} />
          ) : (
            <>
              <input className="search" placeholder="Rechercher un agent ou un projet…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <ul className="list">
                {listed.map((a) => (
                  <li key={a.key} onClick={() => setSelected(a.key)}>
                    <span className="dot" style={{ background: STATUS_COLOR[a.status] }} />
                    <span className="name">{a.displayName}{!a.identityCertain && <em> ?</em>}</span>
                    <span className="proj">{a.project}</span>
                  </li>
                ))}
                {!listed.length && <li className="muted">Aucune session détectée</li>}
              </ul>
              {snap && snap.unattributed.length > 0 && (
                <p className="note">
                  {snap.unattributed.length} processus claude.exe non attribué(s) à une session :{" "}
                  {snap.unattributed.map((u) => `PID ${u.pid} (${fmtBytes(u.workingSet)})`).join(", ")}
                </p>
              )}
              <p className="note">
                Source : registre local Claude Code ({snap?.health.registryDir ?? "…"}), format non documenté, lecture seule.
                Activité détaillée (outils, erreurs) : indisponible tant que les hooks ne sont pas installés.
              </p>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function Stat({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{children}</span>
    </div>
  );
}

function Inspector({ a, now, onBack }: { a: ReturnType<typeof toAgentViews>[number]; now: number; onBack: () => void }) {
  const s = a.session;
  const rows: [string, React.ReactNode][] = [
    ["Projet", s.cwd ?? "—"],
    ["Session", <code>{s.sessionId}</code>],
    ["Nom", `${s.name ?? "—"} (${s.nameSource === "user" ? "choisi" : s.nameSource === "derived" ? "généré" : "?"})`],
    ["Agent (--agent)", s.agent ?? "—"],
    ["État observé", <span style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status]} ({a.rawStatus ?? "absent"})</span>],
    ["Depuis", fmtAgo(s.statusSince, now)],
    ["Démarrée il y a", fmtAgo(s.startedAt, now)],
    ["PID", `${s.pid}${s.identityVerified ? " · identité vérifiée" : " · non vérifiée"}`],
    ["RAM (processus principal)", s.proc ? `${fmtBytes(s.proc.workingSet)} WS · ${fmtBytes(s.proc.privateBytes)} privée` : "—"],
    ["CPU (processus principal)", s.proc ? `${s.proc.cpuPct.toFixed(1)} %` : "—"],
    ["Type", `${s.kind ?? "—"} / ${s.entrypoint ?? "—"} · v${s.version ?? "?"}`],
    ["Activité détaillée", <span className="muted">Indisponible (hooks non installés)</span>],
    ["Erreurs observées", <span className="muted">Indisponible</span>],
  ];
  return (
    <div className="insp">
      <button className="btn back" onClick={onBack}>← Liste</button>
      <h2>{a.displayName}{!a.identityCertain && <span className="muted"> (identité incertaine)</span>}</h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="row"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <p className="note">RAM/CPU : processus claude.exe principal uniquement — les processus enfants (shells, serveurs MCP) ne sont pas attribués.</p>
    </div>
  );
}

//! Boucle de monitoring : un seul thread, 1 Hz pour le registre, 0,5 Hz pour les métriques.
mod registry;

use crate::model::*;
use registry::{filetime_to_unix, Registry, RegistryState};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

pub type Shared = Arc<Mutex<Option<Snapshot>>>;

const TICK: Duration = Duration::from_secs(1);
const METRICS_EVERY: u64 = 2;
const PROCESS_SCAN_EVERY: u64 = 10;

struct Monitor {
    registry: Registry,
    sys: System,
    cpu_count: usize,
    self_pid: Pid,
    app_pids: Vec<Pid>,
    unattributed: Vec<Pid>,
    last_system: SystemSample,
    tick: u64,
}

pub fn spawn(app: AppHandle, shared: Shared) {
    let _ = std::thread::Builder::new()
        .name("agenticlab-monitor".into())
        .spawn(move || {
            let mut m = match Monitor::new() {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("monitor init failed: {e}");
                    return;
                }
            };
            loop {
                let start = Instant::now();
                if let Some(snap) = m.tick() {
                    let _ = app.emit("monitor://snapshot", &snap);
                    if let Ok(mut g) = shared.lock() {
                        *g = Some(snap);
                    }
                }
                std::thread::sleep(TICK.saturating_sub(start.elapsed()));
            }
        });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Monitor {
    fn new() -> Result<Self, String> {
        let sys = System::new().map_err(|e| format!("{e:?}"))?;
        Ok(Self {
            registry: Registry::new(),
            sys,
            cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            self_pid: Pid::from_u32(std::process::id()),
            app_pids: vec![Pid::from_u32(std::process::id())],
            unattributed: Vec::new(),
            last_system: SystemSample::default(),
            tick: 0,
        })
    }

    fn tick(&mut self) -> Option<Snapshot> {
        let reg_changed = self.registry.scan();
        let metrics = self.tick % METRICS_EVERY == 0;
        if self.tick % PROCESS_SCAN_EVERY == 0 {
            self.scan_all_processes();
        }
        self.tick += 1;
        if !metrics && !reg_changed {
            return None;
        }

        let reg_pids: Vec<Pid> = self
            .registry
            .sessions()
            .filter_map(|r| r.pid.map(Pid::from_u32))
            .collect();
        let mut pids = reg_pids.clone();
        pids.extend(&self.app_pids);
        pids.extend(&self.unattributed);
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu(),
        );

        if metrics {
            self.sys.refresh_memory();
            self.sys.refresh_cpu_usage();
            let total = self.sys.total_memory();
            let avail = self.sys.available_memory();
            let (mut app_mem, mut app_cpu, mut app_n) = (0u64, 0f32, 0usize);
            for pid in &self.app_pids {
                if let Some(p) = self.sys.process(*pid) {
                    app_mem += p.virtual_memory(); // PrivateUsage sous Windows : pas de double comptage
                    app_cpu += p.cpu_usage();
                    app_n += 1;
                }
            }
            self.last_system = SystemSample {
                mem_total: total,
                mem_available: avail,
                mem_used: total.saturating_sub(avail),
                cpu_pct: self.sys.global_cpu_usage(),
                cpu_count: self.cpu_count,
                app_private_bytes: app_mem,
                app_cpu_pct: app_cpu / self.cpu_count as f32,
                app_process_count: app_n,
            };
        }

        let mut sessions = Vec::new();
        let mut stale = 0u32;
        for raw in self.registry.sessions() {
            let (Some(pid), Some(sid)) = (raw.pid, raw.session_id.clone()) else { continue };
            let Some(p) = self.sys.process(Pid::from_u32(pid)) else {
                stale += 1;
                continue;
            };
            let verified = match raw.proc_start {
                Some(ft) => {
                    if p.start_time().abs_diff(filetime_to_unix(ft)) > 2 {
                        stale += 1; // PID réutilisé par un autre processus
                        continue;
                    }
                    true
                }
                None => false,
            };
            sessions.push(SessionInfo {
                session_id: sid,
                pid,
                name: raw.name.clone(),
                name_source: raw.name_source.clone(),
                agent: raw.agent.clone(),
                cwd: raw.cwd.clone(),
                kind: raw.kind.clone(),
                entrypoint: raw.entrypoint.clone(),
                status: raw.status.clone(),
                status_since: raw.status_updated_at,
                started_at: raw.started_at,
                version: raw.version.clone(),
                identity_verified: verified,
                proc: Some(ProcStats {
                    working_set: p.memory(),
                    private_bytes: p.virtual_memory(),
                    cpu_pct: p.cpu_usage() / self.cpu_count as f32,
                }),
            });
        }
        sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.pid.cmp(&b.pid)));

        let unattributed = self
            .unattributed
            .iter()
            .filter_map(|pid| self.sys.process(*pid))
            .map(|p| UnattributedProc {
                pid: p.pid().as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                working_set: p.memory(),
            })
            .collect();

        let (registry, registry_detail) = match &self.registry.state {
            RegistryState::Ok => ("ok", None),
            RegistryState::Missing => ("missing", Some("Dossier de sessions introuvable".to_string())),
            RegistryState::Error(e) => ("error", Some(e.clone())),
        };

        Some(Snapshot {
            ts: now_ms(),
            sessions,
            system: self.last_system.clone(),
            unattributed,
            health: Health {
                registry,
                registry_detail,
                registry_dir: self.registry.dir.display().to_string(),
                stale_entries: stale,
            },
        })
    }

    /// Scan complet léger (noms + parents uniquement) toutes les 10 s :
    /// - processus d'AgenticLab (WebView2 enfants inclus) pour mesurer sa propre consommation ;
    /// - processus claude.exe absents du registre (non attribuables à une session).
    fn scan_all_processes(&mut self) {
        self.sys
            .refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        let procs = self.sys.processes();

        let mut app: HashSet<Pid> = HashSet::from([self.self_pid]);
        for _ in 0..6 {
            let before = app.len();
            for (pid, p) in procs {
                if p.parent().is_some_and(|pp| app.contains(&pp)) {
                    app.insert(*pid);
                }
            }
            if app.len() == before {
                break;
            }
        }
        self.app_pids = app.into_iter().collect();

        let reg: HashSet<u32> = self.registry.sessions().filter_map(|r| r.pid).collect();
        let is_claude = |p: &sysinfo::Process| p.name().eq_ignore_ascii_case("claude.exe");
        self.unattributed = procs
            .iter()
            .filter(|(pid, p)| {
                is_claude(p)
                    && !reg.contains(&pid.as_u32())
                    // Un claude.exe enfant d'une session connue appartient à celle-ci.
                    && !p.parent().and_then(|pp| procs.get(&pp)).is_some_and(|pp| is_claude(pp))
            })
            .map(|(pid, _)| *pid)
            .collect();
    }
}

//! Types échangés avec l'interface (sérialisés en camelCase).
use serde::Serialize;

/// Session Claude Code observée et vérifiée (PID vivant + heure de démarrage cohérente).
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub pid: u32,
    pub name: Option<String>,
    /// "user" (nom choisi via /rename ou --name) ou "derived" (nom généré).
    pub name_source: Option<String>,
    /// Agent lancé via --agent, si présent.
    pub agent: Option<String>,
    pub cwd: Option<String>,
    pub kind: Option<String>,
    pub entrypoint: Option<String>,
    /// Statut publié par Claude Code : busy | idle | waiting (valeur brute conservée).
    pub status: Option<String>,
    pub status_since: Option<u64>,
    pub started_at: Option<u64>,
    pub version: Option<String>,
    /// true si l'heure de création du processus correspond à celle du registre.
    pub identity_verified: bool,
    pub proc: Option<ProcStats>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcStats {
    /// Working set du processus principal (octets).
    pub working_set: u64,
    /// Mémoire privée engagée du processus principal (octets).
    pub private_bytes: u64,
    /// CPU en % de la machine entière (0–100).
    pub cpu_pct: f32,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnattributedProc {
    pub pid: u32,
    pub name: String,
    pub working_set: u64,
}

#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemSample {
    pub mem_total: u64,
    /// Mémoire réellement disponible (inclut le cache standby récupérable).
    pub mem_available: u64,
    pub mem_used: u64,
    pub cpu_pct: f32,
    pub cpu_count: usize,
    /// Mémoire privée cumulée d'AgenticLab (processus + WebView2 enfants).
    pub app_private_bytes: u64,
    pub app_cpu_pct: f32,
    pub app_process_count: usize,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// ok | missing | error
    pub registry: &'static str,
    pub registry_detail: Option<String>,
    pub registry_dir: String,
    /// Entrées du registre dont le processus n'existe plus.
    pub stale_entries: u32,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub ts: u64,
    pub sessions: Vec<SessionInfo>,
    pub system: SystemSample,
    pub unattributed: Vec<UnattributedProc>,
    pub health: Health,
}

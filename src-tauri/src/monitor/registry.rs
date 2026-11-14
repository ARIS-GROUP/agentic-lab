//! Adaptateur : registre local des sessions Claude Code (`~/.claude/sessions/<pid>.json`).
//!
//! Format NON documenté officiellement : parsing tolérant, champs tous optionnels.
//! Lecture seule. Les fichiers `*.key` voisins ne sont jamais lus.
use serde::{Deserialize, Deserializer};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::SystemTime;

const MAX_FILE_SIZE: u64 = 64 * 1024;
const MAX_FILES: usize = 1024;

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawSession {
    #[serde(default, deserialize_with = "lenient_u32")]
    pub pid: Option<u32>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    #[serde(default, deserialize_with = "lenient_u64")]
    pub started_at: Option<u64>,
    /// FILETIME Windows (100 ns depuis 1601) de création du processus.
    #[serde(default, deserialize_with = "lenient_u64")]
    pub proc_start: Option<u64>,
    pub version: Option<String>,
    pub kind: Option<String>,
    pub entrypoint: Option<String>,
    pub name: Option<String>,
    pub name_source: Option<String>,
    pub agent: Option<String>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "lenient_u64")]
    pub status_updated_at: Option<u64>,
}

/// Accepte un entier JSON, une chaîne numérique ou null (ex. `procStart` est écrit en chaîne).
fn lenient_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::Number(n) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

fn lenient_u32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    Ok(lenient_u64(d)?.and_then(|v| u32::try_from(v).ok()))
}

struct Entry {
    mtime: Option<SystemTime>,
    len: u64,
    raw: RawSession,
}

pub enum RegistryState {
    Ok,
    Missing,
    Error(String),
}

pub struct Registry {
    pub dir: PathBuf,
    cache: HashMap<PathBuf, Entry>,
    pub state: RegistryState,
}

pub fn claude_config_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return d.into();
    }
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".claude")
}

impl Registry {
    pub fn new() -> Self {
        Self {
            dir: claude_config_dir().join("sessions"),
            cache: HashMap::new(),
            state: RegistryState::Missing,
        }
    }

    /// Relit uniquement les fichiers modifiés (mtime/taille). Renvoie true si l'ensemble a changé.
    pub fn scan(&mut self) -> bool {
        let rd = match std::fs::read_dir(&self.dir) {
            Ok(rd) => rd,
            Err(e) => {
                let changed = !self.cache.is_empty();
                self.cache.clear();
                self.state = if e.kind() == std::io::ErrorKind::NotFound {
                    RegistryState::Missing
                } else {
                    RegistryState::Error(e.to_string())
                };
                return changed;
            }
        };
        self.state = RegistryState::Ok;
        let mut seen = HashSet::new();
        let mut changed = false;
        for ent in rd.flatten().take(MAX_FILES) {
            let path = ent.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(md) = ent.metadata() else { continue };
            let (mtime, len) = (md.modified().ok(), md.len());
            seen.insert(path.clone());
            if let Some(e) = self.cache.get(&path) {
                if e.mtime == mtime && e.len == len {
                    continue;
                }
            }
            if len > MAX_FILE_SIZE {
                continue;
            }
            // Fichier possiblement en cours d'écriture : on garde l'ancienne valeur et on réessaie au tick suivant.
            let Some(raw) = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<RawSession>(&b).ok())
            else {
                continue;
            };
            let differs = self.cache.get(&path).map_or(true, |e| e.raw != raw);
            self.cache.insert(path, Entry { mtime, len, raw });
            changed |= differs;
        }
        let before = self.cache.len();
        self.cache.retain(|k, _| seen.contains(k));
        changed || self.cache.len() != before
    }

    pub fn sessions(&self) -> impl Iterator<Item = &RawSession> {
        self.cache.values().map(|e| &e.raw)
    }
}

/// FILETIME (100 ns depuis 1601-01-01) -> secondes Unix.
pub fn filetime_to_unix(ft: u64) -> u64 {
    (ft / 10_000_000).saturating_sub(11_644_473_600)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_registry_entry() {
        let j = r#"{"pid":16040,"sessionId":"e6030302-f23d-4e29-b89d-96a279db32e8","cwd":"H:\\Game\\SentinelProject","startedAt":1794463494774,"procStart":"134389370927854786","version":"2.1.322","peerProtocol":1,"peerFeatures":["notify_idle","artifact_yield"],"kind":"interactive","entrypoint":"cli","asksForConvertedSkills":false,"name":"sentinel-leader","nameSource":"user","updatedAt":1794644105875,"status":"idle","statusUpdatedAt":1794644105875}"#;
        let r: RawSession = serde_json::from_str(j).unwrap();
        assert_eq!(r.pid, Some(16040));
        assert_eq!(r.proc_start, Some(134389370927854786));
        assert_eq!(r.name.as_deref(), Some("sentinel-leader"));
        assert_eq!(r.status.as_deref(), Some("idle"));
        // procStart ≈ startedAt (à 2 s près)
        assert!(filetime_to_unix(r.proc_start.unwrap()).abs_diff(r.started_at.unwrap() / 1000) <= 2);
    }

    #[test]
    fn tolerates_missing_and_numeric_fields() {
        let r: RawSession = serde_json::from_str(r#"{"pid":"42","procStart":134389370927854786,"agent":"x"}"#).unwrap();
        assert_eq!(r.pid, Some(42));
        assert_eq!(r.proc_start, Some(134389370927854786));
        assert_eq!(r.session_id, None);
    }
}

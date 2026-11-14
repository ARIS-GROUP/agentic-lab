# AgenticLab — Architecture

Application unique (un exécutable, une fenêtre). Aucun processus auxiliaire.

```
src-tauri/src/
  lib.rs              fenêtre, tray, instance unique, commandes IPC
  model.rs            types sérialisés vers l'UI (Snapshot, SessionInfo, SystemSample)
  monitor/mod.rs      thread de monitoring unique (1 Hz) → événement `monitor://snapshot`
  monitor/registry.rs adaptateur registre de sessions Claude Code
src/
  types.ts            miroir des types Rust + AgentView
  agents.ts           SessionInfo → AgentView (identité, rôle, thème)
  office/scene.ts     studio PixiJS ; ne dépend que d'AgentView
  App.tsx             barre supérieure, scène, Inspector
```

## Flux
`monitor` → `Snapshot` (événement Tauri, uniquement si changement ou toutes les 2 s) → React → `OfficeScene.setAgents()` (diff : création/suppression ciblées).

## Événements
| Événement | Contenu |
|---|---|
| `monitor://snapshot` | sessions vérifiées, métriques système, santé des collecteurs |
| `app://visible` | fenêtre visible / masquée / minimisée → arrêt du ticker Pixi |
| `app://focused` | focus → FPS 15–30, sinon 8 |
| `app://always-on-top` | état du mode premier plan (menu tray) |

## Comportement fenêtre
- Fermer = réduire dans le tray. Quitter : menu du tray.
- Relancer le raccourci réaffiche l'instance existante.
- Position/taille restaurées (plugin window-state).

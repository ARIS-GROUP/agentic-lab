# Sources de données

Vérifié avec Claude Code 2.1.325 (2026-11-14).

## Utilisé
| Source | Statut | Usage |
|---|---|---|
| `%USERPROFILE%\.claude\sessions\<pid>.json` (ou `CLAUDE_CONFIG_DIR`) | **Non documenté**, lecture seule | sessions actives : pid, sessionId, cwd, name/nameSource, agent, status (busy/idle/waiting), statusUpdatedAt, procStart |
| sysinfo (API Windows) | Stable | RAM totale/disponible, CPU global, processus |

Validation d'une session : le PID doit exister **et** son heure de création doit correspondre à `procStart` (±2 s). Sinon l'entrée est comptée comme périmée (PID réutilisé ou session terminée sans nettoyage).

Les fichiers `*.key` du même dossier ne sont jamais lus.

## Disponible, non utilisé (accord requis)
| Source | Statut | Apport | Contrainte |
|---|---|---|---|
| Hooks `http` vers localhost | Officiel | outils utilisés, erreurs, attente de permission, fin de tour | modifie `~/.claude/settings.json` (global) |
| statusLine stdin `rate_limits` | Officiel | quota 5 h / 7 j : % utilisé + reset | modifie `~/.claude/settings.json` ; Pro/Max uniquement ; après la 1re réponse API |
| `claude agents --json` | Officiel | liste des sessions (sans le champ `agent`) | lance un processus (~400 ms) ; prévu en repli |

## Exclu
- Endpoints OAuth d'usage : API privée non documentée.
- Transcripts `projects/*.jsonl` : contiennent les conversations.

## Mesures
- RAM disponible = `ullAvailPhys` (inclut le cache standby) ; utilisée = totale − disponible.
- RAM processus : working set et mémoire privée du processus `claude.exe` principal seulement.
- CPU processus : % de la machine entière.
- AgenticLab : somme des mémoires privées (pas de double comptage) de l'app et de ses WebView2.

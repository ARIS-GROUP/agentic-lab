# Compilation

Prérequis : Node ≥ 20, pnpm, Rust stable (MSVC), WebView2 (présent sur Windows 11).

```
pnpm install
pnpm tauri dev                  # développement (console visible)
pnpm tauri build --no-bundle    # exécutable : src-tauri/target/release/agenticlab.exe
pnpm tauri build                # installeur NSIS (utilisateur courant)
```

En release, aucune console n'est ouverte (`windows_subsystem = "windows"`).

# Limitations connues (v0.1)
- Activité détaillée (outil en cours, erreurs) : indisponible sans hooks.
- Quota Claude : indisponible sans statusLine.
- Le registre de sessions est un format interne de Claude Code : peut changer sans préavis.
- Attribution RAM/CPU limitée au processus `claude.exe` principal.
- Bureaux attribués en mémoire : l'ordre peut changer au redémarrage de l'app.
- Personnage Kobunix non personnalisable pour l'instant.

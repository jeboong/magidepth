# Security

The renderer uses sandboxing, context isolation and a limited preload API; Node integration is disabled. Navigation/new windows are denied. Local media uses an explicit allowlist. The Python worker is local-only and handles one GPU job at a time. Child processes launch without a shell.

Model revisions and SHA-256 are pinned. BiRefNet architecture files are verified before local execution. This is not a security audit or a guarantee that hostile media is safe. Use trusted sources.

Runtime libraries come from official registries. Python/pip and FFmpeg archives have integrity checks. Updates use GitHub Releases and electron-updater integrity verification. Initial builds are unsigned, without a publisher certificate identity guarantee.

Report defects without private media or credentials. Use private vulnerability reporting if available for security issues. This beta is not a hardened sandbox for untrusted files.

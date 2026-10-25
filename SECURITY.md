# Security Policy

Anim8 treats model-generated and remotely loaded scene documents as untrusted data.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected security vulnerability.

Use GitHub's private vulnerability reporting for this repository when available. If private reporting is unavailable, contact the repository owner privately before publishing details.

When reporting, include:

- affected package and version/commit;
- a minimal reproduction;
- the security boundary involved (scene parsing, SVG rendering, asset loading, expressions, interactions, packaging, etc.);
- expected versus observed behavior;
- any known impact or exploit prerequisites.

## Supported versions

Anim8 is currently pre-1.0. Security fixes are applied to the latest `main` branch and the latest published prerelease when packages begin publishing.

## Security model

The detailed trust model and declarative-scene constraints are documented in [docs/security.md](docs/security.md).

Key guarantees include:

- declarative scenes do not execute arbitrary JavaScript;
- raw untrusted HTML/SVG is not a normal scene primitive;
- external resources are policy-controlled;
- expression and interaction languages are bounded and allowlisted;
- scene complexity and numeric inputs are validated;
- renderers escape generated markup and do not use DOM state as authoritative animation state.

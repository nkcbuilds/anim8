# ADR 0004: Heavy features are optional packages

Status: Accepted

## Decision

Graph layout engines, framework wrappers, editor UI, and advanced sketch dependencies are not part of the standard player runtime.

Basic layout and deterministic clean SVG rendering are native.

## Rationale

This preserves the <35 KB gzip target and lets documentation pages contain many Anim8 scenes without loading editor-scale code.

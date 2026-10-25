# ADR 0003: Reject ambiguous overlapping property writes

Status: Accepted for v1

## Context

Two simultaneous actions may target the same object property. Letting callback timing or renderer order decide the result would violate determinism.

## Decision

The v1 compiler/validator rejects overlapping actions that write the same property unless an explicit future composition model is introduced.

Actions affecting different properties may overlap.

## Consequences

- Model-generated timelines fail loudly and repairably.
- Semantics remain small and predictable.
- A future effect-stack model can add explicit replace/add/multiply composition without breaking v1 behavior.

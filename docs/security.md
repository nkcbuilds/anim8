# Security Model

Anim8 distinguishes four trust domains:

1. Declarative scene documents.
2. Trusted developer TypeScript.
3. Third-party extensions.
4. Remote assets.

## Declarative documents

JSON/DSL documents are data. They never contain executable JavaScript.

Validation must reject:

- unknown/invalid object references,
- duplicate IDs and parent cycles,
- non-finite/extreme numeric values,
- unsupported expressions/actions,
- script-bearing SVG/HTML,
- unsafe URL schemes,
- scenes exceeding configured complexity limits.

## Renderer

The default renderer emits a typed, allowlisted SVG vocabulary. Text/attribute content is escaped. The v1 declarative object model intentionally does not expose arbitrary HTML.

Raw arbitrary SVG is not part of the normal untrusted IR. A future SVG import path must parse and sanitize into canonical typed objects instead of storing untrusted markup.

## Assets

Network access is policy-controlled by the host. Untrusted scenes cannot grant themselves permission to fetch arbitrary URLs.

The default compiler policy rejects unsafe schemes such as `javascript:` and treats external resources as a privileged boundary.

## Denial of service

Compiler policy places limits on scene size, node count, timeline actions, duration, text/path lengths and nesting. Optional graph-layout adapters must have their own limits/cancellation.

## Extensions

Trusted JavaScript plugins may add capabilities, but they are outside the guarantee made for portable untrusted scene files.

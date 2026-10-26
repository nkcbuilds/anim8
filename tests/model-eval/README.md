# Real-provider model evaluation

Run `pnpm build` first, then `node tests/model-eval/test.mjs` for offline transport contract tests.

To conduct **real**, paid comparisons set the relevant API keys in the environment and explicitly run:

```sh
node tests/model-eval/run.mjs --models openai:gpt-4.1-mini,anthropic:claude-sonnet-4-5,gemini:gemini-2.5-flash --cases 36 --attempts 2 --out model-report.json
```

Requires `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and/or `GEMINI_API_KEY`. Keys are never printed or written. The CLI uses official provider endpoints, sequential requests, a maximum of 6 models, 36 cases, 3 attempts, 5000 max output tokens per request, and 45-second call timeouts. External calls incur real costs. Reports include scores, error codes, and token usage; never raw model output.

Scoring is intentionally narrow: JSON parsing, compiler acceptance and SVG render on representative seek timestamps. Human semantic correctness, accessibility content, geometric overlap and actual teaching quality require manual adjudication. A test run against mocks is **not** real-model verification. Model names in command examples must be replaced with available provider versions.

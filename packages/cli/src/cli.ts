#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { renderSource, validateSource } from "./index.js";

const [command, input, outputOrTime] = process.argv.slice(2);

async function main(): Promise<void> {
  if (!command || !input || !["validate", "render"].includes(command)) {
    console.error("Usage: anim8 validate <scene.json> | anim8 render <scene.json> [timeMs] [output.svg]");
    process.exitCode = 2;
    return;
  }

  const source = await readFile(input, "utf8");

  if (command === "validate") {
    const result = validateSource(source);
    if (!result.ok) {
      console.error(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, diagnostics: [] }));
    return;
  }

  const time = Number(outputOrTime ?? 0);
  const result = renderSource(source, Number.isFinite(time) ? time : 0);
  if (!result.ok || !result.svg) {
    console.error(JSON.stringify({ ok: false, diagnostics: result.diagnostics }, null, 2));
    process.exitCode = 1;
    return;
  }

  const output = process.argv[5];
  if (output) await writeFile(output, result.svg);
  else process.stdout.write(result.svg);
}

void main();

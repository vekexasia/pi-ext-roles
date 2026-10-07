#!/usr/bin/env node
import { runPiRole } from "./launcher.js";
const code = await runPiRole(process.argv.slice(2));
// Extension factories loaded for discovery may leak timers/servers that invalidate() cannot close.
// Drain stdio so output is not truncated, then exit explicitly. This lives in the executable only; runPiRole stays API-safe.
await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(done => { stream.write("", () => done()); })));
process.exit(code);

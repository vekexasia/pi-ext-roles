#!/usr/bin/env node
import { runPiRole } from "./launcher.js";
process.exitCode = await runPiRole(process.argv.slice(2));

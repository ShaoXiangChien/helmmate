#!/usr/bin/env node
// Manual usage probe: prints getUsage() as pretty JSON.
// Usage:
//   node helmmate/bin/usage-check.mjs          # full getUsage() snapshot
//   node helmmate/bin/usage-check.mjs --raw     # getRawBlock() debug dump
import { getUsage, getRawBlock } from "../lib/usage.js";

const raw = process.argv.includes("--raw");
const out = raw ? getRawBlock() : getUsage({ force: true });
process.stdout.write(JSON.stringify(out, null, 2) + "\n");

#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import { BOARD_DIR, CONFIG_PATH, TICKETS_DIR, TICKETS_INDEX } from "../lib/paths.js";

const command = process.argv[2] || "help";
const rest = process.argv.slice(3);

function usage() {
  console.log(`Usage:
  dev-board init
  dev-board new-ticket --title "Add auth smoke test"
  dev-board validate [--fix]
  dev-board start
`);
}

function runNode(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: BOARD_DIR,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

function init() {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
  if (!fs.existsSync(TICKETS_INDEX)) fs.writeFileSync(TICKETS_INDEX, "[]\n");
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Tickets: ${TICKETS_DIR}`);
}

if (command === "help" || command === "--help" || command === "-h") {
  usage();
} else if (command === "init") {
  init();
} else if (command === "new-ticket" || command === "new") {
  runNode(new URL("./new-ticket.mjs", import.meta.url).pathname, rest);
} else if (command === "validate") {
  runNode(new URL("./validate-tickets.mjs", import.meta.url).pathname, rest);
} else if (command === "start") {
  runNode(new URL("../server.js", import.meta.url).pathname, rest);
} else {
  usage();
  process.exit(1);
}

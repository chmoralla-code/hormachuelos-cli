#!/usr/bin/env node
"use strict"
/**
 * The `hormachuelos` (and `horma`) command npm puts on PATH. npm wraps it in a
 * .cmd, a .ps1 and a shell shim, so it runs the same from cmd, PowerShell, bash,
 * zsh or fish. It starts the native binary with the same arguments, terminal and
 * exit code, fetching the binary first if the install step was skipped
 * (`npm install --ignore-scripts`, or an offline install).
 */
const { spawn } = require("node:child_process")
const { install, installed } = require("../lib/install.js")

async function main() {
  let binary = installed()
  if (!binary) {
    try {
      binary = await install()
    } catch (error) {
      process.stderr.write(`hormachuelos: ${error.message}\n`)
      process.exit(1)
    }
  }
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", windowsHide: false })
  // The terminal sends Ctrl+C to the whole group; the app handles it, the wrapper just waits.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    try {
      process.on(signal, () => {
        if (signal !== "SIGINT" && !child.killed) child.kill(signal)
      })
    } catch {}
  }
  child.on("error", (error) => {
    process.stderr.write(`hormachuelos: could not start ${binary}: ${error.message}\n`)
    process.exit(1)
  })
  child.on("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

main()

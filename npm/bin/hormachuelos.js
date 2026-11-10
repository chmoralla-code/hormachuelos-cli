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

// What the app's terminal library switches on, switched off again: mouse, focus and paste reports,
// synchronized output, grapheme and theme reports, the keyboard flags, then the cursor shown.
const MODES_OFF =
  "[?1000l[?1002l[?1003l[?1006l[?1004l[?2004l[?2026l[?2027l[?2031l[<u[>4;0m[?25h"

/**
 * What to write to the terminal once the app has ended. An app that was killed
 * (Task Manager, Stop-Process -Force, kill -9) never cleaned up: its mouse
 * reports would keep printing into the shell. The cursor is saved before
 * leaving the full-screen view, so on a screen that was already the shell's
 * the restore puts it back where it was.
 */
function afterExit(code, signal) {
  return code === 0 && !signal ? "" : `7[?1049l${MODES_OFF}`
}

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
    const reset = process.stdout.isTTY ? afterExit(code, signal) : ""
    process.stdout.write(reset, () => {
      if (signal) {
        process.removeAllListeners(signal)
        process.kill(process.pid, signal)
        return
      }
      process.exit(code ?? 0)
    })
  })
}

if (require.main === module) main()

module.exports = { afterExit }

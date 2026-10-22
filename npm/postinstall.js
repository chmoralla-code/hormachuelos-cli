"use strict"
/**
 * npm's install step: fetch the binary now so the first `hormachuelos` starts at
 * once. A failure (offline, a firewall, a platform without a build yet) never
 * fails the npm install; the command fetches it on first run instead.
 */
const { install, installed } = require("./lib/install.js")

if (process.env.HORMACHUELOS_SKIP_DOWNLOAD) process.exit(0)
if (installed()) process.exit(0)
install().catch((error) => {
  process.stderr.write(`hormachuelos: ${error.message}\n`)
  process.stderr.write("hormachuelos: the binary will be downloaded the first time you run `hormachuelos`.\n")
})

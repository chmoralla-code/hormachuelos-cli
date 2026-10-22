"use strict"
/**
 * Fetches the HORMACHUELOS binary for this computer from the website's CLI feed
 * (the same signed feed /update reads) and keeps it beside this package, or in
 * the user's cache when the global npm folder is read-only.
 *
 * Plain Node (16+), no dependencies, so it runs under any npm on Windows, macOS
 * and Linux, from cmd, PowerShell, bash, zsh or fish.
 */
const crypto = require("node:crypto")
const fs = require("node:fs")
const https = require("node:https")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

const FEED_URL = "https://hormachuelos.vercel.app/downloads/cli/latest.json"
/** The desktop updater's public key (tauri.conf.json → plugins.updater.pubkey), as in house-update.ts. */
const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNFNTMzNDA0RURGQ0E4NjcKUldSbnFQenRCRFJUUGc4djhoRHdEa09vR3BZNkFyWDN2a2Q0N0NOWlFBby9RM2pTRUkzcERKWGIK"
/** Files may come from the site that hosts the feed, and nowhere else. */
const HOSTS = new Set(["hormachuelos.com", "www.hormachuelos.com", "hormachuelos.vercel.app"])
// The builds are too big for the website, so they live in this project's GitHub releases;
// github.com redirects each download to its file CDN. The signature check still decides.
const RELEASES = "/chmoralla-code/hormachuelos-cli/releases/download/"
const GITHUB_FILES = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com"])
const MAX_BYTES = 512 * 1024 * 1024

const BINARY = process.platform === "win32" ? "hormachuelos.exe" : "hormachuelos"

/** windows-x86_64, darwin-aarch64, linux-x86_64… the feed's platform keys (house-update.ts platformKey). */
function platformKey(platform = process.platform, arch = process.arch) {
  const system = platform === "win32" ? "windows" : platform
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : arch
  return `${system}-${cpu}`
}

/** The feed in use and its key. A test key is honoured only beside a test feed. */
function source(env = process.env) {
  const feed = env.HORMACHUELOS_UPDATE_FEED && env.HORMACHUELOS_UPDATE_FEED.trim()
  const key = env.HORMACHUELOS_UPDATE_PUBKEY && env.HORMACHUELOS_UPDATE_PUBKEY.trim()
  return { feed: feed || FEED_URL, key: (feed && key) || PUBLIC_KEY, test: Boolean(feed) }
}

function allowed(url, test) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" && HOSTS.has(parsed.hostname)) return true
    if (parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.pathname.startsWith(RELEASES)) return true
    if (parsed.protocol === "https:" && GITHUB_FILES.has(parsed.hostname)) return true
    // A local test feed may serve from this machine only.
    return test && parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
  } catch {
    return false
  }
}

function get(url, test, onProgress, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (!allowed(url, test)) return reject(new Error(`Refusing to download from ${url}`))
    const client = url.startsWith("https:") ? https : http
    const request = client.get(url, { headers: { "User-Agent": "hormachuelos-npm" } }, (response) => {
      const status = response.statusCode || 0
      if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
        response.resume()
        return resolve(get(new URL(response.headers.location, url).toString(), test, onProgress, redirects - 1))
      }
      if (status !== 200) {
        response.resume()
        return reject(new Error(`${url} answered ${status}`))
      }
      const total = Number(response.headers["content-length"]) || 0
      const chunks = []
      let received = 0
      response.on("data", (chunk) => {
        received += chunk.length
        if (received > MAX_BYTES) {
          request.destroy()
          return reject(new Error("The download is far larger than any HORMACHUELOS build."))
        }
        chunks.push(chunk)
        if (onProgress) onProgress(received, total)
      })
      response.on("end", () => resolve(Buffer.concat(chunks)))
      response.on("error", reject)
    })
    request.setTimeout(60_000, () => request.destroy(new Error(`${url} timed out`)))
    request.on("error", reject)
  })
}

function textLines(base64) {
  return Buffer.from(base64.trim(), "base64").toString("utf8").split(/\r?\n/)
}

/** A minisign signature as Tauri writes it (house-update.ts verifySignature). */
function verifySignature(data, signature, publicKey) {
  try {
    const keyBytes = Buffer.from(textLines(publicKey)[1] || "", "base64")
    const lines = textLines(signature)
    const sigBytes = Buffer.from(lines[1] || "", "base64")
    const trusted = lines[2] || ""
    const globalSig = Buffer.from(lines[3] || "", "base64")
    if (keyBytes.length !== 42 || sigBytes.length !== 74 || globalSig.length !== 64) return false
    if (keyBytes.subarray(0, 2).toString() !== "Ed") return false
    if (!keyBytes.subarray(2, 10).equals(sigBytes.subarray(2, 10))) return false
    if (!trusted.startsWith("trusted comment: ")) return false
    const algorithm = sigBytes.subarray(0, 2).toString()
    if (algorithm !== "ED" && algorithm !== "Ed") return false
    const key = crypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: keyBytes.subarray(10).toString("base64url") },
      format: "jwk",
    })
    const message = algorithm === "ED" ? crypto.createHash("blake2b512").update(data).digest() : data
    const fileSig = sigBytes.subarray(10)
    if (!crypto.verify(null, message, key, fileSig)) return false
    const comment = Buffer.from(trusted.slice("trusted comment: ".length))
    return crypto.verify(null, Buffer.concat([fileSig, comment]), key, globalSig)
  } catch {
    return false
  }
}

/** Beside the package when npm's folder is writable, else the user's cache (a read-only global prefix). */
function candidates() {
  const cache =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "hormachuelos", "npm")
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "hormachuelos", "npm")
  return [path.join(__dirname, "..", "vendor"), cache]
}

/** The installed binary, or undefined. */
function installed() {
  for (const dir of candidates()) {
    const file = path.join(dir, BINARY)
    if (fs.existsSync(file)) return file
  }
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.probe-${process.pid}`)
    fs.writeFileSync(probe, "")
    fs.rmSync(probe)
    return true
  } catch {
    return false
  }
}

function bar(received, total) {
  if (!process.stderr.isTTY || !total) return
  const width = 30
  const filled = Math.round((received / total) * width)
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)
  process.stderr.write(`\r  ${"█".repeat(filled)}${"░".repeat(width - filled)} ${mb(received)} / ${mb(total)} MB`)
}

/** Downloads, checks and places the binary; returns its path. */
async function install({ quiet = false } = {}) {
  const key = platformKey()
  const { feed, key: publicKey, test } = source()
  const log = (line) => quiet || process.stderr.write(`${line}\n`)
  const manifest = JSON.parse((await get(feed, test)).toString("utf8"))
  const release = manifest.platforms && manifest.platforms[key]
  if (!release) {
    const known = Object.keys(manifest.platforms || {}).join(", ") || "none yet"
    throw new Error(`HORMACHUELOS ${manifest.version} has no build for ${key} (available: ${known}).`)
  }
  log(`Downloading HORMACHUELOS ${manifest.version} for ${key}…`)
  const data = await get(release.url, test, quiet ? undefined : bar)
  if (!quiet && process.stderr.isTTY) process.stderr.write("\n")
  if (release.size !== undefined && data.length !== release.size) throw new Error("The download was cut short. Try again.")
  if (!verifySignature(data, release.signature, publicKey))
    throw new Error("The download's signature does not match HORMACHUELOS's key, so it was not installed.")
  const dir = candidates().find(writable)
  if (!dir) throw new Error("No writable folder for the HORMACHUELOS binary.")
  const target = path.join(dir, BINARY)
  const incoming = `${target}.download`
  fs.writeFileSync(incoming, data, { mode: 0o755 })
  if (process.platform !== "win32") fs.chmodSync(incoming, 0o755)
  fs.rmSync(target, { force: true })
  fs.renameSync(incoming, target)
  log(`Installed HORMACHUELOS ${manifest.version}. Run: hormachuelos`)
  return target
}

module.exports = { install, installed, platformKey, verifySignature, BINARY }

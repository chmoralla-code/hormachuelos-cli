#!/usr/bin/env node
/**
 * Publishes the `hormachuelos` npm package after a CLI release is live on the
 * website feed, so `npm install -g hormachuelos` fetches that release.
 *
 * Release order:
 *   1. In packages/cli: OPENCODE_VERSION=2.1.2 bun run script/build.ts           (every platform)
 *   2. bun run script/publish-update.ts --version 2.1.2 --notes-file …            (signs, writes dist/update)
 *   3. Copy dist/update/* to the website's downloads/cli/ and deploy.
 *   4. In npm/: node publish.mjs --version 2.1.2            (checks the feed, packs; add --yes to publish)
 *
 * Needs `npm login` as the package owner first. Without --yes it only packs a
 * tarball you can try with `npm install -g ./hormachuelos-2.1.2.tgz`.
 */
import { execSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const publish = process.argv.includes("--yes")
const version = (flag("version") ?? "").replace(/^v/, "")
if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error("Pass --version, e.g. --version 2.1.2")

// The feed must already carry this version for every platform, or installs would fail.
const feedUrl = flag("feed") ?? "https://hormachuelos.vercel.app/downloads/cli/latest.json"
const feed = await fetch(feedUrl).then((response) => {
  if (!response.ok) throw new Error(`${feedUrl} answered ${response.status}; publish the CLI release to the website first.`)
  return response.json()
})
if (feed.version !== version) throw new Error(`The feed is at ${feed.version}, not ${version}.`)
const wanted = ["windows-x86_64", "windows-aarch64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64", "linux-aarch64"]
const missing = wanted.filter((key) => !feed.platforms?.[key])
if (missing.length) console.warn(`warning: the feed has no build for ${missing.join(", ")}; those computers can't install.`)

// LF everywhere: a CRLF shebang breaks the command on macOS and Linux.
const walk = (folder) =>
  readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name)
    return statSync(file).isDirectory() ? walk(file) : [file]
  })
for (const file of [...walk(path.join(dir, "bin")), ...walk(path.join(dir, "lib")), path.join(dir, "postinstall.js")]) {
  const text = readFileSync(file, "utf8")
  if (text.includes("\r\n")) writeFileSync(file, text.replaceAll("\r\n", "\n"))
}

const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
manifest.version = version
writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)

execSync("npm pack", { cwd: dir, stdio: "inherit" })
if (!publish) {
  console.log(`\nPacked hormachuelos-${version}.tgz. Try it: npm install -g ./hormachuelos-${version}.tgz`)
  console.log("Publish with: node publish.mjs --version " + version + " --yes")
  process.exit(0)
}
execSync("npm publish --access public", { cwd: dir, stdio: "inherit" })
console.log(`\nPublished. Anyone can now run: npm install -g hormachuelos`)

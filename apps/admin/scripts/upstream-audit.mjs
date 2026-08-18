import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const adminRoot = resolve(import.meta.dirname, '..')
const manifestPath = resolve(adminRoot, 'upstream.manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const allowedClasses = new Set([
  'unchanged',
  'adapted',
  'productized',
  'inactive',
  'removed',
])

function fail(message) {
  console.error(`upstream audit: ${message}`)
  process.exitCode = 1
}

function gitBlobHash(content) {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex')
}

function currentBlob(path) {
  const absolutePath = resolve(adminRoot, path)
  if (!existsSync(absolutePath)) return null
  const stat = lstatSync(absolutePath)
  const content = stat.isSymbolicLink()
    ? Buffer.from(readlinkSync(absolutePath))
    : readFileSync(absolutePath)
  return { hash: gitBlobHash(content), mode: stat.isSymbolicLink() ? '120000' : null }
}

if (manifest.schemaVersion !== 1) fail('unsupported manifest schema')
if (manifest.upstream.commit !== 'e16c87f213a5ba5e45964e9b67c792105ec74d26') {
  fail('unexpected upstream commit')
}
if (manifest.upstream.tree !== '35ae1233fc1231724604c5012fb62f5302702706') {
  fail('unexpected upstream tree')
}
if (manifest.files.length !== manifest.upstream.fileCount) {
  fail(`manifest contains ${manifest.files.length} files; expected ${manifest.upstream.fileCount}`)
}

const upstreamPaths = new Set()
for (const entry of manifest.files) {
  if (upstreamPaths.has(entry.path)) fail(`duplicate upstream path: ${entry.path}`)
  upstreamPaths.add(entry.path)
  if (!allowedClasses.has(entry.classification)) {
    fail(`invalid classification for ${entry.path}: ${entry.classification}`)
    continue
  }
  if (entry.classification !== 'unchanged' && !entry.reason?.trim()) {
    fail(`classified file requires a reason: ${entry.path}`)
  }

  const current = currentBlob(entry.path)
  if (entry.classification === 'removed') {
    if (current) fail(`removed file still exists: ${entry.path}`)
    continue
  }
  if (!current) {
    fail(`upstream file is missing without removed classification: ${entry.path}`)
    continue
  }
  if (entry.classification === 'unchanged' && current.hash !== entry.blob) {
    fail(`unclassified content drift: ${entry.path}`)
  }
  if (entry.mode === '120000' && current.mode !== '120000') {
    fail(`symlink mode drift: ${entry.path}`)
  }
}

const additions = new Map(manifest.additions.map((entry) => [entry.path, entry]))
for (const entry of manifest.additions) {
  if (!entry.reason?.trim()) fail(`addition requires a reason: ${entry.path}`)
  if (!currentBlob(entry.path)) fail(`registered addition is missing: ${entry.path}`)
}

const tracked = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'apps/admin'],
  { cwd: resolve(adminRoot, '../..'), encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .map((path) => path.slice('apps/admin/'.length))

for (const path of tracked) {
  if (upstreamPaths.has(path) || additions.has(path) || path.startsWith('docs/')) continue
  fail(`unregistered Kokoro addition: ${path}`)
}

if (!process.exitCode) {
  const counts = Object.fromEntries(
    [...allowedClasses].map((classification) => [
      classification,
      manifest.files.filter((entry) => entry.classification === classification).length,
    ]),
  )
  console.log(
    `upstream audit passed: ${manifest.files.length} frozen files; ` +
      [...allowedClasses].map((key) => `${key}=${counts[key]}`).join(', ') +
      `; additions=${manifest.additions.length}`,
  )
}

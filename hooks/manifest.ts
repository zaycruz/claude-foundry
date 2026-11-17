// The agent-manifest, kept per orthanc binary (orthanc-0hzh).
//
// A session can outlive the orthanc it started with: install.sh writes a new
// release over the old one at the same path. The manifest is read again when
// the binary's identity changes. The identity is a stat, not a spawn: the
// path that ORTHANC_BIN or PATH leads to, where it lands after links, and the
// file's size and mtime. `orthanc --version` would cost a process on every
// call, and would miss a rebuild that keeps its version.
//
// What a stat cannot see: $.fs.stat gives no inode, ctime or mode. A copy made
// with `cp -p` (same size, same mtime) over the old file is not seen, and a
// file without the execute bit counts as the binary. Both are accepted; see
// binaryIdentity.
import type { EngineInterface } from 'claude-code'

import type { ManifestCommand } from './policy'

/** Which orthanc a call would start, as a stat sees it. */
export type BinaryIdentity = {
  /** ORTHANC_BIN, or `orthanc`. */
  bin: string
  /** The file it leads to, or null when nothing on PATH (or at ORTHANC_BIN) stats as a file. */
  path: string | null
  /** Equal for the same file with the same contents, as far as a stat can tell. */
  key: string
}

/** A manifest and the binary it was read from; `version` null when that binary did not say. */
export type LoadedManifest = { identity: BinaryIdentity; commands: readonly ManifestCommand[]; version: string | null }
export type ManifestReader = () => Promise<{ commands: readonly ManifestCommand[]; version: string | null }>

/** A binary whose manifest could not be read is tried again after this long, counted from the failure. */
export const MANIFEST_RETRY_MS = 60_000

/**
 * The binary $.process.run would start for ORTHANC_BIN, or for `orthanc` on
 * PATH: one stat per PATH directory up to the first file.
 *
 * A stat cannot see the execute bit. A non-executable `orthanc` earlier on
 * PATH is taken as the binary and pins the key, so an upgrade of the real one
 * further down PATH is not seen until that file goes. orthanc_cli spawns the
 * path found here, so it then fails to start rather than run another binary.
 */
export async function binaryIdentity($: EngineInterface): Promise<BinaryIdentity> {
  const bin = (await $.env.get('ORTHANC_BIN'))?.trim() || 'orthanc'
  const candidates = bin.includes('/') ? [bin] : ((await $.env.get('PATH')) ?? '').split(':').map(dir => `${dir === '' ? '.' : dir}/${bin}`)
  for (const candidate of candidates) {
    const stat = await $.fs.stat(candidate, { resolve: true }).catch(() => undefined)
    if (stat?.kind !== 'file') continue
    return { bin, path: candidate, key: [bin, candidate, stat.realPath ?? candidate, stat.size, stat.mtimeMs].join('\n') }
  }
  return { bin, path: null, key: `${bin}\nmissing` }
}

const where = (identity: BinaryIdentity) => identity.path ?? identity.bin
const said = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300)
/** `orthanc 0.7.1`, or a phrase for a binary that did not report its version. */
export const named = (version: string | null) => (version === null ? 'an orthanc that did not report its version' : `orthanc ${version}`)

function reloadNotice(before: LoadedManifest, next: LoadedManifest): string {
  const at = where(next.identity)
  if (before.version !== null && before.version === next.version) return `orthanc ${next.version} at ${at} changed on disk: the command list was read again.`
  if (before.version !== null && next.version !== null) return `orthanc changed from ${before.version} to ${next.version} (${at}): the command list was read again.`
  return `orthanc changed from ${named(before.version)} to ${named(next.version)} (${at}): the command list was read again.`
}

/**
 * One manifest at a time, read again when the binary changes. A failed read
 * keeps the manifest it had; calls that arrive during a read share it; a read
 * never replaces a result that a later-started read already gave.
 */
export class ManifestCache {
  private loaded: LoadedManifest | undefined
  private loadedGeneration = 0
  private inflight: { key: string; promise: Promise<LoadedManifest> } | undefined
  private failed: { key: string; atMs: number; error: unknown } | undefined
  private generation = 0
  private notice: string | undefined
  private warning: string | undefined

  /**
   * The manifest for `identity`: read now if it is another binary than the one
   * read last. The result can be for another identity (the old binary's after a
   * failed read, a newer read's when this one was overtaken): callers compare
   * `identity.key` before they run anything with it.
   */
  async get(identity: BinaryIdentity, now: () => Promise<number>, read: ManifestReader): Promise<LoadedManifest> {
    const loaded = this.loaded
    if (loaded !== undefined && loaded.identity.key === identity.key) {
      this.warning = undefined
      return loaded
    }
    if (loaded !== undefined && identity.path === null) {
      this.warning =
        `orthanc is not found (${identity.bin === 'orthanc' ? 'not on PATH' : `ORTHANC_BIN=${identity.bin}`}). ` +
        `These are the commands of ${named(loaded.version)}, read from ${where(loaded.identity)}; orthanc_cli runs none of them until orthanc is installed.`
      return loaded
    }
    // A read that failed is not tried again for a while: with no manifest at
    // all, the remembered failure is thrown without starting anything.
    if (this.failed?.key === identity.key && (await now()) - this.failed.atMs < MANIFEST_RETRY_MS) {
      if (loaded === undefined) throw this.failed.error
      return loaded
    }
    try {
      return await this.reload(identity, read)
    } catch (error) {
      this.failed = { key: identity.key, atMs: await now(), error }
      const kept = this.loaded
      if (kept === undefined) throw error
      this.warning =
        `orthanc at ${where(identity)} changed, but its agent-manifest could not be read (${said(error)}). ` +
        `These are the commands of ${named(kept.version)}, read before; orthanc_cli runs none of them on the changed binary. ` +
        `The list is read again ${MANIFEST_RETRY_MS / 1000} s after this failure, or when the binary changes.`
      return kept
    }
  }

  /** Lines for orthanc_help to put first: a reload notice once, a warning while it holds. */
  takeNotes(): string[] {
    const notes = [this.notice, this.warning].filter((line): line is string => line !== undefined)
    this.notice = undefined
    return notes
  }

  get version(): string | null | undefined {
    return this.loaded?.version
  }

  private reload(identity: BinaryIdentity, read: ManifestReader): Promise<LoadedManifest> {
    if (this.inflight?.key === identity.key) return this.inflight.promise
    const generation = ++this.generation
    const promise = read().then(got => {
      const next: LoadedManifest = { identity, ...got }
      // Overtaken: a later-started read already gave its result. Return that
      // one, so no caller acts on the older binary's list after the newer one.
      if (generation < this.loadedGeneration && this.loaded !== undefined) return this.loaded
      const before = this.loaded
      if (before !== undefined && before.identity.key !== identity.key) this.notice = reloadNotice(before, next)
      this.loaded = next
      this.loadedGeneration = generation
      this.failed = undefined
      this.warning = undefined
      return next
    })
    this.inflight = { key: identity.key, promise }
    const settle = () => {
      if (this.inflight?.promise === promise) this.inflight = undefined
    }
    promise.then(settle, settle)
    return promise
  }
}

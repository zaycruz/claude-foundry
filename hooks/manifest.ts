// The agent-manifest, kept per orthanc binary (orthanc-0hzh).
//
// A session can outlive the orthanc it started with: install.sh writes a new
// release over the old one at the same path. The manifest is read again when
// the binary's identity changes. The identity is a stat, not a spawn: the
// path that ORTHANC_BIN or PATH leads to, where it lands after links, and the
// file's size and mtime. `orthanc --version` would cost a process on every
// call, and would miss a rebuild that keeps its version.
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

export type LoadedManifest = { identity: BinaryIdentity; commands: readonly ManifestCommand[]; version: string }
export type ManifestReader = () => Promise<{ commands: readonly ManifestCommand[]; version: string }>

/** A binary whose manifest could not be read is tried again after this long. */
export const MANIFEST_RETRY_MS = 60_000

/**
 * The binary $.process.run would start for ORTHANC_BIN, or for `orthanc` on
 * PATH: one stat per PATH directory up to the first file. A stat cannot see the
 * execute bit, so a non-executable `orthanc` earlier on PATH is taken as the
 * binary; the worst case is a reload that comes late, never a wrong command list.
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

/**
 * One manifest at a time, read again when the binary changes. A failed read
 * keeps the manifest it had; calls that arrive during a read share it.
 */
export class ManifestCache {
  private loaded: LoadedManifest | undefined
  private inflight: { key: string; promise: Promise<LoadedManifest> } | undefined
  private failed: { key: string; atMs: number } | undefined
  private generation = 0
  private notice: string | undefined
  private warning: string | undefined

  /** The manifest for `identity`: read now if it is another binary than the one read last. */
  async get(identity: BinaryIdentity, nowMs: number, read: ManifestReader): Promise<LoadedManifest> {
    const loaded = this.loaded
    if (loaded !== undefined && loaded.identity.key === identity.key) {
      this.warning = undefined
      return loaded
    }
    if (loaded !== undefined && identity.path === null) {
      this.warning =
        `orthanc is not found (${identity.bin === 'orthanc' ? 'not on PATH' : `ORTHANC_BIN=${identity.bin}`}). ` +
        `These are the commands of orthanc ${loaded.version}, read from ${where(loaded.identity)}; orthanc_cli cannot run them until orthanc is installed.`
      return loaded
    }
    if (loaded !== undefined && this.failed?.key === identity.key && nowMs - this.failed.atMs < MANIFEST_RETRY_MS) return loaded
    try {
      return await this.reload(identity, read)
    } catch (error) {
      const kept = this.loaded
      if (kept === undefined) throw error
      this.failed = { key: identity.key, atMs: nowMs }
      this.warning =
        `orthanc at ${where(identity)} changed, but its agent-manifest could not be read (${said(error)}). ` +
        `These are the commands of orthanc ${kept.version}, read before; it is read again in ${MANIFEST_RETRY_MS / 1000} s or when the binary changes.`
      return kept
    }
  }

  /** Lines for orthanc_help to put first: a reload notice once, a warning while it holds. */
  takeNotes(): string[] {
    const notes = [this.notice, this.warning].filter((line): line is string => line !== undefined)
    this.notice = undefined
    return notes
  }

  get version(): string | undefined {
    return this.loaded?.version
  }

  private reload(identity: BinaryIdentity, read: ManifestReader): Promise<LoadedManifest> {
    if (this.inflight?.key === identity.key) return this.inflight.promise
    const generation = ++this.generation
    const promise = read().then(got => {
      const next: LoadedManifest = { identity, ...got }
      // A read started later wins over one that finishes later.
      if (generation === this.generation) {
        const before = this.loaded
        if (before !== undefined) {
          this.notice =
            before.version === next.version
              ? `orthanc ${next.version} at ${where(identity)} changed on disk: the command list was read again.`
              : `orthanc changed from ${before.version} to ${next.version} (${where(identity)}): the command list was read again.`
        }
        this.loaded = next
        this.failed = undefined
        this.warning = undefined
      }
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

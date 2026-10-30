import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const hash = value => createHash('sha256').update(value).digest('hex')

/** A warning exemption binds the complete normalized log to its API and exact
 * shader sources, independent of getAttachedShaders ordering. */
export function shaderDiagnosticIdentity(record) {
  assert(['getProgramInfoLog', 'getShaderInfoLog'].includes(record.name), 'Invalid shader diagnostic method')
  assert(typeof record.log === 'string' && record.log.trim(), 'Expected nonempty shader diagnostic log')
  assert(Array.isArray(record.sources) && record.sources.length > 0 &&
    record.sources.every(source => typeof source === 'string' && source.trim()),
  'Shader diagnostic requires nonempty sources')
  return hash(JSON.stringify({
    name: record.name,
    log: record.log.replace(/\r\n/g, '\n').trim(),
    sources: record.sources.map(hash).sort()
  }))
}

export function assertKnownShaderDiagnostics(records, allowed) {
  const identities = new Set(allowed)
  for (const record of records) {
    assert(typeof record.log === 'string', 'Invalid shader diagnostic log')
    if (!record.log.trim()) continue
    const identity = shaderDiagnosticIdentity(record)
    assert(identities.has(identity), `Unreviewed shader diagnostic ${identity}: ${record.log.trim()}`)
  }
}

/** Self-contained for Playwright page.addInitScript; no Node dependencies in the
 * browser function. Restore after the probe to release captured source strings. */
export function installShaderDiagnostics() {
  const prototype = WebGL2RenderingContext.prototype
  const previous = Object.getOwnPropertyDescriptor(window, '__shaderDiagnostics')
  const restorations = []
  const records = [], seen = new Set()
  for (const name of ['getProgramInfoLog', 'getShaderInfoLog']) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)
    const original = prototype[name]
    prototype[name] = function (object) {
      const log = original.call(this, object)
      if (log?.trim()) {
        const shaders = name === 'getProgramInfoLog' ? this.getAttachedShaders(object) ?? [] : [object]
        const sources = shaders.map(shader => this.getShaderSource(shader))
        const key = JSON.stringify([name, log, [...sources].sort()])
        if (!seen.has(key)) {
          seen.add(key)
          records.push({ name, log, sources })
        }
      }
      return log
    }
    restorations.push(() => {
      if (descriptor) Object.defineProperty(prototype, name, descriptor)
      else delete prototype[name]
    })
  }
  let restored = false
  Object.defineProperty(window, '__shaderDiagnostics', {
    configurable: true,
    value: {
      snapshot: () => records.map(record => ({ ...record, sources: [...record.sources] })),
      restore() {
        if (restored) return
        restored = true
        for (const restore of restorations) restore()
        if (previous) Object.defineProperty(window, '__shaderDiagnostics', previous)
        else delete window.__shaderDiagnostics
        records.length = 0
        seen.clear()
      }
    }
  })
}

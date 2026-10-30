import { test } from 'vitest'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import {
  assertKnownShaderDiagnostics, installShaderDiagnostics, shaderDiagnosticIdentity
} from '../../scripts/lib/shader-diagnostics.mjs'

const warning = {
  name: 'getProgramInfoLog',
  log: '(63,12-86): warning X3595: gradient instruction used in a loop with varying iteration',
  sources: ['vertex source', 'fragment source']
}

test('a reviewed warning matches its complete log, method and shader sources', () => {
  const allowed = [shaderDiagnosticIdentity(warning)]
  assert.doesNotThrow(() => assertKnownShaderDiagnostics([warning], allowed))
  assert.doesNotThrow(() => assertKnownShaderDiagnostics([
    { ...warning, log: `\r\n${warning.log}\r\n`, sources: [...warning.sources].reverse() }
  ], allowed))
  for (const record of [
    { ...warning, sources: ['vertex source', 'unreviewed fragment source'] },
    { ...warning, log: warning.log + '\nA second warning' },
    { ...warning, log: warning.log.replace('X3595', 'X3206') },
    { ...warning, name: 'getShaderInfoLog' }
  ]) assert.throws(() => assertKnownShaderDiagnostics([record], allowed), /Unreviewed shader diagnostic/)
})

test('nonempty shader logs require usable source evidence', () => {
  for (const sources of [undefined, [], [''], ['vertex source', null]]) {
    assert.throws(() => shaderDiagnosticIdentity({ ...warning, sources }), /sources/)
  }
  assert.doesNotThrow(() => assertKnownShaderDiagnostics([{ log: ' \n ' }], []))
  assert.throws(() => assertKnownShaderDiagnostics([warning], []), /Unreviewed shader diagnostic/)
})

function collector() {
  class Context {
    getProgramInfoLog(program) { return program.log }
    getShaderInfoLog(shader) { return shader.log }
    getAttachedShaders(program) { return program.shaders }
    getShaderSource(shader) { return shader.source }
  }
  const previous = { value: 'previous diagnostics', writable: false, enumerable: false, configurable: true }
  const window = {}
  Object.defineProperty(window, '__shaderDiagnostics', previous)
  const descriptors = Object.getOwnPropertyDescriptors(Context.prototype)
  runInNewContext(`(${installShaderDiagnostics.toString()})()`, { window, WebGL2RenderingContext: Context })
  return { gl: new Context(), capture: window.__shaderDiagnostics, window, previous, descriptors, Context }
}

test('capture distinguishes identical messages from different sources and deduplicates exact repeats', () => {
  const { gl, capture } = collector()
  const first = { log: warning.log, shaders: warning.sources.map(source => ({ source })) }
  const second = { ...first, shaders: [{ source: 'vertex source' }, { source: 'another fragment' }] }
  try {
    assert.equal(gl.getProgramInfoLog(first), warning.log)
    gl.getProgramInfoLog(second)
    gl.getProgramInfoLog(first)
    gl.getProgramInfoLog({ ...first, shaders: [...first.shaders].reverse() })
    gl.getProgramInfoLog({ ...first, log: '' })
    const records = JSON.parse(JSON.stringify(capture.snapshot()))
    assert.equal(records.length, 2)
    assert.deepEqual(records[0], warning)
    assert.throws(() => assertKnownShaderDiagnostics(records, [shaderDiagnosticIdentity(warning)]), /Unreviewed/)
    records[0].sources[0] = 'changed'
    const snapshot = capture.snapshot()
    snapshot[0].sources[0] = 'also changed'
    snapshot.push({})
    assert.equal(capture.snapshot().length, 2)
    assert.equal(capture.snapshot()[0].sources[0], warning.sources[0])
  } finally { capture.restore() }
})

test('shader-stage logs and missing source evidence reach the validator unchanged', () => {
  const { gl, capture } = collector()
  try {
    gl.getShaderInfoLog({ log: 'stage warning', source: 'fragment' })
    gl.getProgramInfoLog({ log: 'program warning', shaders: null })
    const records = JSON.parse(JSON.stringify(capture.snapshot()))
    assert.deepEqual(records[0], { name: 'getShaderInfoLog', log: 'stage warning', sources: ['fragment'] })
    assert.throws(() => assertKnownShaderDiagnostics([records[1]], []), /sources/)
    assert.throws(() => gl.getShaderInfoLog(null), TypeError)
  } finally { capture.restore() }
})

test('restoration preserves the original prototype and window property descriptors', () => {
  const { capture, window, previous, descriptors, Context } = collector()
  capture.restore()
  capture.restore()
  assert.deepEqual(Object.getOwnPropertyDescriptors(Context.prototype), descriptors)
  assert.deepEqual(Object.getOwnPropertyDescriptor(window, '__shaderDiagnostics'), previous)
})

test('restoration removes properties that were originally inherited or absent', () => {
  class Base {
    getProgramInfoLog() { return '' }
    getShaderInfoLog() { return '' }
  }
  class Context extends Base {}
  const window = {}
  runInNewContext(`(${installShaderDiagnostics.toString()})()`, { window, WebGL2RenderingContext: Context })
  window.__shaderDiagnostics.restore()
  assert.equal(Object.hasOwn(window, '__shaderDiagnostics'), false)
  assert.equal(Object.hasOwn(Context.prototype, 'getProgramInfoLog'), false)
  assert.equal(Object.hasOwn(Context.prototype, 'getShaderInfoLog'), false)
})

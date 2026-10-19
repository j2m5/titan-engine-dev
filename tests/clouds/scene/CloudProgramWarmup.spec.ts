import { describe, expect, it, vi } from 'vitest'
import { Camera, Mesh, PlaneGeometry, Scene, ShaderMaterial, type WebGLRenderer } from 'three'
import { CloudProgramWarmup } from '@/core/clouds/takram/CloudProgramWarmup'

function fixture(parallel = true, linked = true) {
  const scene = new Scene(),
    camera = new Camera(),
    material = new ShaderMaterial()
  scene.add(new Mesh(new PlaneGeometry(2, 2), material))
  let ready = false
  let shadersReady = false
  const debug = { checkShaderErrors: true }
  const program = {
    program: {},
    vertexShader: {},
    fragmentShader: {},
    isReady: vi.fn(() => ready),
    getUniforms: vi.fn(() => {
      expect(debug.checkShaderErrors).toBe(true)
    })
  }
  const properties = new Map<object, { currentProgram: typeof program }>()
  const renderer = {
    debug,
    getContext: () => ({
      LINK_STATUS: 0x8b82,
      getProgramParameter: () => linked,
      getShaderParameter: () => shadersReady
    }),
    extensions: { has: () => parallel },
    properties: { get: (owner: object) => properties.get(owner) ?? {} },
    compile: vi.fn(() => {
      properties.set(material, { currentProgram: program })
      return new Set([material])
    })
  } as unknown as WebGLRenderer
  return {
    scene,
    camera,
    material,
    program,
    renderer,
    ready: () => {
      ready = true
      shadersReady = true
    },
    programReady: () => {
      ready = true
    }
  }
}

describe('cloud shader warmup', () => {
  it('waits for shader objects even when the linked program is already available from a driver cache', () => {
    const f = fixture(),
      warmup = new CloudProgramWarmup()
    warmup.compile(f.renderer, f.scene, f.camera)
    f.programReady()
    expect(warmup.ready()).toBe(false)
    expect(f.program.getUniforms).not.toHaveBeenCalled()
    f.ready()
    expect(warmup.ready()).toBe(true)
  })
  it('keeps the endpoint pending until compilation finishes without submitting draws or timers', () => {
    const f = fixture(),
      warmup = new CloudProgramWarmup()
    warmup.compile(f.renderer, f.scene, f.camera)
    expect(warmup.ready()).toBe(false)
    expect(f.program.getUniforms).not.toHaveBeenCalled()
    f.ready()
    expect(warmup.ready()).toBe(true)
    expect(f.program.getUniforms).toHaveBeenCalledOnce()
    expect(f.renderer.debug.checkShaderErrors).toBe(true)
    // Warmup does not own shaders: disposing the real owner is still the only release.
    expect(f.program.program).toBeDefined()
  })
  it('leaves failed-program diagnostics intact for the checked render path', () => {
    const f = fixture(true, false),
      warmup = new CloudProgramWarmup()
    warmup.compile(f.renderer, f.scene, f.camera)
    f.ready()
    expect(warmup.ready()).toBe(true)
    expect(f.program.getUniforms).not.toHaveBeenCalled()
    expect(f.renderer.debug.checkShaderErrors).toBe(true)
  })
  it('clears pending work synchronously and never polls a retired program', () => {
    const f = fixture(),
      warmup = new CloudProgramWarmup()
    warmup.compile(f.renderer, f.scene, f.camera)
    warmup.clear()
    expect(warmup.ready()).toBe(true)
    expect(f.program.isReady).not.toHaveBeenCalled()
  })
  it('uses the existing synchronous draw path when parallel compilation is unavailable', () => {
    const f = fixture(false),
      warmup = new CloudProgramWarmup()
    warmup.compile(f.renderer, f.scene, f.camera)
    expect(warmup.ready()).toBe(true)
    expect(f.renderer.compile).not.toHaveBeenCalled()
  })
})

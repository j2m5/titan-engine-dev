import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Camera,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import { TerrainBoulderShadows } from '@/core/terrain/TerrainBoulderShadows'
import { toThreeJSUnits } from '@/core/helpers/scaling'

function fixture() {
  let target: WebGLRenderTarget | null = new WebGLRenderTarget(8, 8),
    face = 3,
    mip = 2,
    scissorTest = true
  const viewport = new Vector4(2, 3, 5, 6),
    scissor = new Vector4(1, 2, 3, 4)
  const renderer = {
    autoClear: false,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: true,
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    info: { autoReset: true },
    getContext: () => ({
      SCISSOR_BOX: 1,
      SCISSOR_TEST: 2,
      getParameter: () => scissor.toArray(),
      isEnabled: () => scissorTest
    }),
    getCurrentViewport: (out: Vector4) => out.copy(viewport),
    state: {
      viewport: (v: Vector4) => viewport.copy(v),
      scissor: (v: Vector4) => scissor.copy(v),
      setScissorTest: (value: boolean) => {
        scissorTest = value
      }
    },
    getRenderTarget: () => target,
    getActiveCubeFace: () => face,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: (value: WebGLRenderTarget | null, f = 0, m = 0) => {
      target = value
      face = f
      mip = m
      if (value) {
        viewport.copy(value.viewport)
        scissor.copy(value.scissor)
        scissorTest = value.scissorTest
      }
    },
    getViewport: (out: Vector4) => out.copy(viewport),
    setViewport: (v: Vector4) => viewport.copy(v),
    getScissor: (out: Vector4) => out.copy(scissor),
    setScissor: (v: Vector4) => scissor.copy(v),
    getScissorTest: () => scissorTest,
    setScissorTest: (value: boolean) => {
      scissorTest = value
    },
    render: vi.fn((_scene: Scene, _camera: Camera) => {})
  }
  const host = new Object3D(),
    geometry = new BoxGeometry(),
    material = new ShaderMaterial()
  const mesh = new InstancedMesh(geometry, material, 2)
  mesh.count = 1
  const shadows = new TerrainBoulderShadows(host, renderer as unknown as WebGLRenderer, [mesh])
  shadows.bind(material)
  const camera = new Camera(),
    local = new Vector3(0, 0, toThreeJSUnits(3390)),
    sun = new Vector3(0, 0, 1)
  camera.position.copy(local)
  camera.updateMatrixWorld()
  const prepare = () => shadows.update(local, sun, local)
  const draw = () =>
    material.onBeforeRender(renderer as unknown as WebGLRenderer, new Scene(), camera, geometry, mesh, new Group())
  const state = () => ({
    target,
    face,
    mip,
    viewport: viewport.toArray(),
    scissor: scissor.toArray(),
    scissorTest,
    autoClear: renderer.autoClear,
    color: renderer.autoClearColor,
    depth: renderer.autoClearDepth,
    stencil: renderer.autoClearStencil,
    xr: renderer.xr.enabled,
    shadow: renderer.shadowMap.autoUpdate,
    reset: renderer.info.autoReset
  })
  return { host, geometry, material, mesh, shadows, renderer, camera, local, sun, prepare, draw, state }
}

describe('local boulder shadow lifecycle', () => {
  it('renders lazily once per prepared frame and shares the real instance buffers', () => {
    const f = fixture(),
      original = f.mesh.matrixWorld.clone()
    try {
      f.prepare()
      expect(f.renderer.render).not.toHaveBeenCalled()
      f.draw()
      f.draw()
      expect(f.renderer.render).toHaveBeenCalledTimes(1)
      const proxy = f.renderer.render.mock.calls[0][0].children[0] as InstancedMesh
      expect(proxy.geometry).toBe(f.geometry)
      expect(proxy.instanceMatrix).toBe(f.mesh.instanceMatrix)
      expect(proxy.count).toBe(1)
      expect(f.mesh.matrixWorld.equals(original)).toBe(true)
      expect(f.material.uniforms.uBoulderShadowStrength.value).toBe(1)
      f.prepare()
      f.draw()
      expect(f.renderer.render).toHaveBeenCalledTimes(2)
    } finally {
      f.shadows.dispose()
    }
  })

  it('restores the enclosing render state and counts the nested draw in the frame', () => {
    const f = fixture(),
      before = f.state()
    try {
      f.renderer.render.mockImplementation(() => {
        expect(f.renderer.info.autoReset).toBe(false)
        expect(f.renderer.xr.enabled).toBe(false)
        expect(f.renderer.autoClearDepth).toBe(true)
        expect(f.renderer.getRenderTarget()).not.toBe(before.target)
      })
      f.prepare()
      f.draw()
      expect(f.state()).toEqual(before)
    } finally {
      f.shadows.dispose()
    }
  })

  it('restores state and disables stale shadows when the depth render throws', () => {
    const f = fixture(),
      before = f.state()
    try {
      f.renderer.render.mockImplementation(() => {
        throw new Error('depth failed')
      })
      f.prepare()
      expect(f.draw).toThrow('depth failed')
      expect(f.state()).toEqual(before)
      expect(f.material.uniforms.uBoulderShadowStrength.value).toBe(0)
      expect(f.material.uniforms.uBoulderShadowMap.value).toBeNull()
    } finally {
      f.shadows.dispose()
    }
  })

  it('uses the actual receiver camera without rebuilding the shadow depth', () => {
    const f = fixture()
    try {
      f.prepare()
      f.draw()
      const point = new Vector3(0, 0, -toThreeJSUnits(0.02)),
        matrix = f.material.uniforms.uBoulderShadowMatrix.value as Matrix4
      const expected = point.clone().applyMatrix4(matrix)
      const world = point.clone().applyMatrix4(f.camera.matrixWorld)
      f.camera.position.x += toThreeJSUnits(0.1)
      f.camera.rotateY(0.3)
      f.camera.updateMatrixWorld()
      f.draw()
      expect(world.applyMatrix4(f.camera.matrixWorldInverse).applyMatrix4(matrix).distanceTo(expected)).toBeLessThan(
        1e-9
      )
      expect(f.renderer.render).toHaveBeenCalledTimes(1)
    } finally {
      f.shadows.dispose()
    }
  })

  it('releases hidden maps, recreates on return, and skips night or empty deposits', () => {
    const f = fixture()
    try {
      f.prepare()
      f.draw()
      const first = f.material.uniforms.uBoulderShadowMap.value
      f.shadows.hide()
      expect(f.material.uniforms.uBoulderShadowMap.value).toBeNull()
      expect(f.material.uniforms.uBoulderShadowStrength.value).toBe(0)
      f.draw()
      expect(f.renderer.render).toHaveBeenCalledTimes(1)
      f.prepare()
      f.draw()
      expect(f.material.uniforms.uBoulderShadowMap.value).not.toBe(first)
      f.sun.negate()
      f.prepare()
      f.draw()
      expect(f.material.uniforms.uBoulderShadowStrength.value).toBe(0)
      f.sun.negate()
      f.mesh.count = 0
      f.prepare()
      f.draw()
      expect(f.renderer.render).toHaveBeenCalledTimes(2)
    } finally {
      f.shadows.dispose()
    }
  })

  it('chains and restores receiver callbacks without disposing shared geometry', () => {
    const f = fixture(),
      second = new ShaderMaterial(),
      previous = vi.fn(),
      geometryDisposed = vi.fn()
    second.onBeforeRender = previous
    f.shadows.bind(second)
    f.geometry.addEventListener('dispose', geometryDisposed)
    f.prepare()
    second.onBeforeRender(
      f.renderer as unknown as WebGLRenderer,
      new Scene(),
      f.camera,
      f.geometry,
      f.mesh,
      new Group()
    )
    expect(previous).toHaveBeenCalledTimes(1)
    expect(second.uniforms.uBoulderShadowMap).toBe(f.material.uniforms.uBoulderShadowMap)
    f.shadows.dispose()
    f.shadows.dispose()
    expect(second.onBeforeRender).toBe(previous)
    expect(geometryDisposed).not.toHaveBeenCalled()
    expect(second.uniforms.uBoulderShadowMap.value).toBeNull()
  })
})

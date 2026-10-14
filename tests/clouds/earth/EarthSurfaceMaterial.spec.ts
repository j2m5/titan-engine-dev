import { describe, it, expect, vi } from 'vitest'
import { DataTexture, Data3DTexture, DataArrayTexture, PerspectiveCamera, Matrix4, Vector2, Vector3 } from 'three'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import { createEarthSurfaceMaterials, type EarthSurfaceOptions } from '@/labs/earth-clouds/EarthSurfaceMaterial'
import { buildEarthSurfaceShader } from '@/labs/earth-clouds/earthSurfaceShader'
import { buildEarthCloudShadowGLSL } from '@/labs/earth-clouds/earthCloudShadowShader'

function fixture() {
  const owned = Array.from({ length: 6 }, () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1))
  const noise = new Data3DTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, 1)
  const aerial = new PlanetAerialPerspectiveEffect(new PerspectiveCamera())
  const options: EarthSurfaceOptions = {
    textures: { surface: owned[0], clouds: owned[1], night: owned[2], specular: owned[3], dispose() {} },
    radiusMeters: 6360000,
    atmosphere: {
      bottomRadius: 6360,
      topRadius: 6420,
      sunAngularRadius: 0.004675
    } as EarthSurfaceOptions['atmosphere'],
    lut: { transmittanceTexture: owned[4], irradianceTexture: owned[5] },
    stbnTexture: noise,
    longitudeOffsetRadians: 0,
    shadowReferenceShader: aerial.getFragmentShader()
  }
  return {
    options,
    owned: [...owned, noise],
    dispose() {
      owned.forEach((t) => t.dispose())
      noise.dispose()
      aerial.dispose()
    }
  }
}
describe('Earth surface materials', () => {
  it.each([
    ['getShadowUv', /getShadowUv\(const vec3 worldPosition/, 'getShadowUv(const vec4 worldPosition'],
    [
      'getFadedCascadeIndex',
      /getFadedCascadeIndex\(([\s\S]*?)vec2 intervals\[SHADOW_CASCADE_COUNT\]/,
      'getFadedCascadeIndex($1vec2 intervals[4]'
    ]
  ])('rejects incompatible same-arity %s parameters before near rendering', (name, anchor, replacement) => {
    const f = fixture()
    let pair: ReturnType<typeof createEarthSurfaceMaterials> | undefined
    try {
      const original = f.options.shadowReferenceShader
      f.options.shadowReferenceShader = original.replace(anchor, replacement)
      expect(f.options.shadowReferenceShader).not.toBe(original)
      expect(() => buildEarthCloudShadowGLSL(f.options.shadowReferenceShader)).toThrow(
        new RegExp(`signature changed: ${name}`)
      )
      pair = createEarthSurfaceMaterials(f.options)
      expect(pair.volumeError?.message).toMatch(new RegExp(`signature changed: ${name}`))
      expect(pair.far.uniforms.diffuseMap.value.image).toBe(f.options.textures.surface.image)
      pair.setMapEnabled(false)
      expect(pair.far.uniforms.earthSurfaceMapEnabled.value).toBe(false)
      expect(() => pair!.bindShadow(null)).not.toThrow()
    } finally {
      pair?.dispose()
      f.dispose()
    }
  })
  it('accepts whitespace and input/precision qualifier variation in compatible helper parameters', () => {
    const f = fixture()
    try {
      const reference = f.options.shadowReferenceShader.replace(
        /getShadowUv\(const vec3 worldPosition, const int cascadeIndex\)/,
        'getShadowUv( in highp vec3 worldPosition , in mediump int cascadeIndex )'
      )
      expect(reference).not.toBe(f.options.shadowReferenceShader)
      expect(() => buildEarthCloudShadowGLSL(reference)).not.toThrow()
    } finally {
      f.dispose()
    }
  })
  it('isolates borrowed texture transforms, preserves metres and suppresses legacy cloud paths', () => {
    const f = fixture()
    f.options.textures.surface.offset.set(0.3, 0.4)
    const pair = createEarthSurfaceMaterials(f.options)
    try {
      expect(pair.volumeError).toBeNull()
      for (const material of [pair.far, pair.near]) {
        expect(material.defines.USE_CLOUD).toBeUndefined()
        expect(material.defines.USE_CLOUD_SHADOW).toBeUndefined()
        expect(material.uniforms.uBodyRadiusUnits.value).toBe(6360000)
        expect(material.uniforms.uAtmoDatumRadius.value).toBe(6360)
        expect(material.uniforms.diffuseMap.value).not.toBe(f.options.textures.surface)
        expect(material.uniforms.diffuseMap.value.offset.toArray()).toEqual([0, 0])
      }
      pair.setMapEnabled(false)
      expect(pair.far.uniforms.earthSurfaceMapEnabled.value).toBe(false)
      const camera = new PerspectiveCamera()
      camera.updateMatrixWorld()
      pair.updateFrame({
        camera,
        planetMatrixWorld: new Matrix4().makeTranslation(10, 20, 30),
        worldToECEFMatrix: new Matrix4(),
        sunDirection: new Vector3(0, 0, 2),
        resolution: new Vector2(100, 50),
        frame: 7
      })
      expect(pair.far.uniforms.lightPosition.value.toArray()).toEqual([10, 20, 149597870730])
      expect(pair.near.uniforms.earthShadowFrame.value).toBe(7)
    } finally {
      pair.dispose()
      f.dispose()
    }
  })
  it('disposes only owned material and texture views and is idempotent', () => {
    const f = fixture(),
      spies = f.owned.map((t) => vi.spyOn(t, 'dispose')),
      pair = createEarthSurfaceMaterials(f.options)
    const view = pair.far.uniforms.diffuseMap.value,
      dispose = vi.spyOn(view, 'dispose')
    try {
      pair.dispose()
      pair.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
      spies.forEach((s) => expect(s).not.toHaveBeenCalled())
    } finally {
      f.dispose()
    }
  })
  it('retains far surface when near reference extraction fails', () => {
    const f = fixture()
    f.options.shadowReferenceShader = 'void main(){}'
    const pair = createEarthSurfaceMaterials(f.options)
    try {
      expect(pair.volumeError).toBeInstanceOf(Error)
      expect(pair.near).not.toBe(pair.far)
      expect(pair.near.uniforms.diffuseMap.value).toBe(pair.far.uniforms.diffuseMap.value)
      pair.bindShadow(null)
    } finally {
      pair.dispose()
      f.dispose()
    }
  })
  it('rejects missing and duplicate surface anchors', () => {
    expect(() => buildEarthSurfaceShader('void main(){}', 'void main(){}', 'far', '')).toThrow(/anchor|shader/i)
    expect(() =>
      buildEarthSurfaceShader(
        SphereSurfaceShaderTemplate.vertexShader,
        SphereSurfaceShaderTemplate.fragmentShader.replace('vec2 uv = vUv;', 'vec2 uv = vUv; vec2 uv = vUv;'),
        'far',
        ''
      )
    ).toThrow(/canonical UV/)
  })
  it('refreshes mutable current shadow descriptors and clears attachment on null', () => {
    const f = fixture(),
      pair = createEarthSurfaceMaterials(f.options)
    const map = new DataArrayTexture(new Uint8Array(8), 1, 1, 2),
      next = new DataArrayTexture(new Uint8Array(12), 1, 1, 3)
    const shadow = {
      map,
      mapSize: new Vector2(1, 1),
      cascadeCount: 2,
      intervals: [new Vector2(), new Vector2()],
      matrices: [new Matrix4(), new Matrix4()],
      inverseMatrices: [new Matrix4(), new Matrix4()],
      far: 10000,
      topHeight: 8000
    }
    const spies = [map, next, f.options.stbnTexture].map((t) => vi.spyOn(t, 'dispose'))
    try {
      pair.bindShadow(shadow)
      shadow.map = next
      shadow.cascadeCount = 3
      shadow.far = 12345
      shadow.intervals.push(new Vector2())
      shadow.matrices.push(new Matrix4())
      shadow.inverseMatrices.push(new Matrix4())
      const camera = new PerspectiveCamera()
      camera.updateMatrixWorld()
      pair.updateFrame({
        camera,
        planetMatrixWorld: new Matrix4(),
        worldToECEFMatrix: new Matrix4(),
        sunDirection: new Vector3(0, 0, 1),
        resolution: new Vector2(1, 1),
        frame: 1
      })
      expect(pair.near.defines.EARTH_SHADOW_CASCADE_COUNT).toBe(3)
      expect(pair.near.uniforms.earthShadowShadowBuffer.value).toBe(next)
      expect(pair.near.uniforms.earthShadowShadowIntervals.value).toBe(shadow.intervals)
      expect(pair.near.uniforms.earthShadowShadowFar.value).toBe(12345)
      pair.bindShadow(null)
      expect(pair.near.uniforms.earthShadowEnabled.value).toBe(false)
      const neutral = pair.near.uniforms.earthShadowShadowBuffer.value,
        dispose = vi.spyOn(neutral, 'dispose')
      expect(neutral).not.toBe(next)
      pair.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
      spies.forEach((s) => expect(s).not.toHaveBeenCalled())
    } finally {
      pair.dispose()
      map.dispose()
      next.dispose()
      f.dispose()
    }
  })
})

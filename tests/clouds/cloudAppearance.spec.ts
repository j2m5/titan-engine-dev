import { describe, expect, it, vi } from 'vitest'
import { CloudsEffect } from '@takram/three-clouds'
import {
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  Texture,
  Matrix3,
  Matrix4
} from 'three'
import { validCloudConfig } from './cloudFixtures'
import { resolveCloudConfig } from '@/core/clouds/validateCloudConfig'
import { prepareCloudAppearanceTextures } from '@/labs/jupiter-clouds/cloudAppearanceTextures'
import { assertCloudAppearanceSupport, bindCloudAppearance } from '@/labs/jupiter-clouds/cloudAppearance'

const source = () =>
  new DataTexture(
    new Uint8Array([32, 64, 96, 255, 192, 224, 255, 255, 64, 96, 128, 255, 224, 255, 128, 255]),
    2,
    2,
    RGBAFormat
  )

// Interpret only vector addition and matrix/component multiplication, so the regression
// exercises the emitted GLSL coordinate expressions rather than a copied transformation.
function evaluateNoiseExpression(expression: string, values: Record<string, Vector3 | Matrix3>): Vector3 {
  const tokens = expression.match(/\w+|[()+*]/g) ?? []
  let cursor = 0
  const operand = (): Vector3 | Matrix3 => {
    if (tokens[cursor] === '(') {
      cursor++
      const value = sum()
      if (tokens[cursor++] !== ')') throw new Error('Unbalanced shader expression')
      return value
    }
    const value = values[tokens[cursor++]]
    if (!value) throw new Error('Unknown shader operand')
    return value.clone()
  }
  const product = (): Vector3 | Matrix3 => {
    let value = operand()
    while (tokens[cursor] === '*') {
      cursor++
      const right = operand()
      if (!(right instanceof Vector3)) throw new Error('Expected vector multiplier')
      value = value instanceof Matrix3 ? right.applyMatrix3(value) : value.multiply(right)
    }
    return value
  }
  const sum = (): Vector3 | Matrix3 => {
    const value = product()
    while (tokens[cursor] === '+') {
      cursor++
      const right = product()
      if (!(value instanceof Vector3) || !(right instanceof Vector3)) throw new Error('Expected vector addition')
      value.add(right)
    }
    return value
  }
  const result = sum()
  if (!(result instanceof Vector3) || cursor !== tokens.length) throw new Error('Unsupported shader expression')
  return result
}
describe('cloud appearance', () => {
  it.each(['image', 'data'] as const)('uses intrinsic color width for %s texture mip bias', (kind) => {
    // The real binding must use uploaded pixels, not an image's displayed dimensions.
    const image = document.createElement('img')
    image.width = 128
    Object.defineProperty(image, 'naturalWidth', { value: 4096 })
    const color = kind === 'image' ? new Texture(image) : source()
    const weather = source()
    const effect = new CloudsEffect(new PerspectiveCamera())
    const maps = { weather, color, constantColorLinear: [1, 1, 1] as const, colorStrength: 1, dispose() {} }
    const binding = bindCloudAppearance(effect, validCloudConfig(), maps)
    try {
      expect(effect.cloudsPass.currentMaterial.uniforms.cloudColorMipBias.value).toBe(kind === 'image' ? 11 : 0)
      expect(color.image.width).toBe(kind === 'image' ? 128 : 2)
    } finally {
      binding.dispose()
      color.dispose()
      weather.dispose()
      effect.dispose()
    }
  })
  it('preserves planet noise coordinates with geographic turbulence at high quality', () => {
    const effect = new CloudsEffect(new PerspectiveCamera())
    effect.qualityPreset = 'high'
    const original = source(),
      maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    const binding = bindCloudAppearance(effect, validCloudConfig(), maps)
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.71)
    binding.setPlanetRotation(rotation)
    expect(effect.turbulence).toBe(true)
    for (const pass of [effect.cloudsPass, effect.shadowPass]) {
      const shader = pass.currentMaterial.fragmentShader
      const values = {
        position: new Vector3(0.12, 0.25, 0.4).applyQuaternion(rotation),
        evolution: new Vector3(0.01, -0.02, 0.03).applyQuaternion(rotation),
        turbulence: new Vector3(0.09, 0.04, -0.05),
        cloudECEFToPlanet: new Matrix3().setFromMatrix4(
          new Matrix4().makeRotationFromQuaternion(rotation.clone().invert())
        ),
        shapeRepeat: new Vector3(1, 1, 1),
        shapeDetailRepeat: new Vector3(1, 1, 1),
        shapeOffset: new Vector3(0.03, 0.06, 0.01),
        shapeDetailOffset: new Vector3(0.03, 0.06, 0.01)
      }
      for (const [name, expected] of [
        ['shapePosition', [0.25, 0.33, 0.39]],
        ['detailPosition', [0.24, 0.35, 0.36]]
      ] as const) {
        const expression = shader.match(new RegExp(`vec3 ${name} = ([^;]+);`))?.[1]
        if (!expression) throw new Error(`Missing ${name}`)
        const actual = evaluateNoiseExpression(expression, values).toArray()
        expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 10))
      }
    }
    binding.dispose()
    maps.dispose()
    original.dispose()
    effect.dispose()
  })
  it('accepts surface-map mask and rejects mismatched pairs, unsupported patterns and multiple layers', () => {
    const config = validCloudConfig()
    const pattern = config.layers[0].pattern
    if (pattern.kind !== 'appearance') throw new Error('fixture')
    config.farAppearance = 'surface-map'
    config.layers[0].pattern = { kind: 'mask', map: pattern.map, decode: pattern.decode }
    expect(resolveCloudConfig(config, new Set([32])).state).toBe('configured')
    expect(() => assertCloudAppearanceSupport(config)).not.toThrow()
    config.farAppearance = 'base-texture'
    expect(() => assertCloudAppearanceSupport(config)).toThrow(/unsupported/i)
    const wrongPair = validCloudConfig()
    wrongPair.farAppearance = 'surface-map'
    expect(() => assertCloudAppearanceSupport(wrongPair)).toThrow(/unsupported/i)
    for (const pattern of [
      { kind: 'uniform', coverage: 1 },
      { kind: 'procedural', coverage: 1, scaleMeters: 100, bandStrength: 0 }
    ] as const) {
      config.layers[0].pattern = pattern
      expect(() => assertCloudAppearanceSupport(config)).toThrow(/unsupported/i)
    }
    const multiple = validCloudConfig()
    multiple.layers.push({ ...multiple.layers[0], id: 'second' })
    expect(() => assertCloudAppearanceSupport(multiple)).toThrow(/unsupported/i)
  })
  it('owns only derived textures and preserves shared source parameters', () => {
    const original = source()
    original.colorSpace = SRGBColorSpace
    const before = {
      colorSpace: original.colorSpace,
      wrapS: original.wrapS,
      flipY: original.flipY,
      image: original.image
    }
    const spy = vi.spyOn(original, 'dispose')
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    expect(maps.color).not.toBe(original)
    expect(maps.color?.source).toBe(original.source)
    const weatherDispose = vi.spyOn(maps.weather, 'dispose')
    const colorDispose = vi.spyOn(maps.color!, 'dispose')
    maps.dispose()
    maps.dispose()
    expect(weatherDispose).toHaveBeenCalledTimes(1)
    expect(colorDispose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
    expect({
      colorSpace: original.colorSpace,
      wrapS: original.wrapS,
      flipY: original.flipY,
      image: original.image
    }).toEqual(before)
    spy.mockRestore()
    original.dispose()
  })
  it.each([false, true])('matches source sampling row orientation flipY=%s', (flipY) => {
    const original = source()
    original.flipY = flipY
    const config = validCloudConfig()
    const pattern = config.layers[0].pattern
    if (pattern.kind !== 'appearance') throw new Error('fixture')
    pattern.decode.channel = 'r'
    pattern.decode.sampleSpace = 'linear'
    pattern.coverageRange = [0, 1]
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    expect(Array.from(maps.weather.image.data as Uint8Array).filter((_, i) => i % 4 === 0)).toEqual(
      flipY ? [64, 224, 32, 192] : [32, 192, 64, 224]
    )
    expect(maps.weather.flipY).toBe(false)
    maps.dispose()
    original.dispose()
  })
  it('diagnoses missing, unreadable, unloaded and unknown-space resources', () => {
    const layer = validCloudConfig().layers[0]
    expect(() => prepareCloudAppearanceTextures(layer, () => undefined)).toThrow(/resource/i)
    const original: Texture = source()
    original.image = null
    expect(() => prepareCloudAppearanceTextures(layer, () => original)).toThrow(/image/i)
    original.image = { width: 0, height: 0 }
    expect(() => prepareCloudAppearanceTextures(layer, () => original)).toThrow(/loaded|image/i)
    const unknown = source()
    unknown.colorSpace = 'unknown'
    expect(() => prepareCloudAppearanceTextures(layer, () => unknown)).toThrow(/colorSpace/i)
    layer.color = { kind: 'map', map: { resourceId: 33 }, strength: 1 }
    expect(() => prepareCloudAppearanceTextures(layer, (id) => (id === 32 ? source() : undefined))).toThrow(/33/)
  })
  it('binds deterministic seed and physical units without changing config or owning textures', () => {
    const config = validCloudConfig()
    config.layers[0].detail.seed = 0
    const before = structuredClone(config)
    const original = source()
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    const effects = [new CloudsEffect(new PerspectiveCamera()), new CloudsEffect(new PerspectiveCamera())]
    effects[1].qualityPreset = 'low'
    const bindings = effects.map((effect) => bindCloudAppearance(effect, config, maps))
    expect(effects[0].shapeOffset.toArray()).toEqual(effects[1].shapeOffset.toArray())
    expect(effects[0].shapeOffset.length()).toBeGreaterThan(0)
    expect(effects[0].scatteringCoefficient).toBe(config.layers[0].extinctionPerMeter)
    expect(effects[0].absorptionCoefficient).toBe(0)
    bindings[0].setPlanetRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))
    expect(effects[0].cloudsPass.currentMaterial.uniforms.cloudECEFToPlanet).toBe(
      effects[0].shadowPass.currentMaterial.uniforms.cloudECEFToPlanet
    )
    const spy = vi.spyOn(maps.weather, 'dispose')
    bindings.forEach((binding) => {
      binding.dispose()
      binding.dispose()
    })
    expect(spy).not.toHaveBeenCalled()
    expect(config).toEqual(before)
    maps.dispose()
    original.dispose()
    effects.forEach((effect) => effect.dispose())
  })
  it('rejects a mismatched shadow shader atomically', () => {
    const effect = new CloudsEffect(new PerspectiveCamera())
    const shadow = effect.shadowPass.currentMaterial
    shadow.fragmentShader = shadow.fragmentShader.replace('vec2 getGlobeUv', 'vec2 obsoleteGlobeUv')
    const materials = [effect.cloudsPass.currentMaterial, shadow]
    const before = materials.map((material) => ({
      shader: material.fragmentShader,
      uniforms: { ...material.uniforms },
      version: material.version
    }))
    const original = source()
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    expect(() => bindCloudAppearance(effect, validCloudConfig(), maps)).toThrow(/shadow.*getGlobeUv/i)
    materials.forEach((material, i) => {
      expect(material.fragmentShader).toBe(before[i].shader)
      expect(material.uniforms).toEqual(before[i].uniforms)
      expect(material.version).toBe(before[i].version)
    })
    maps.dispose()
    original.dispose()
    effect.dispose()
  })
  it('rejects duplicated anchors and restores both materials on detach', () => {
    const effect = new CloudsEffect(new PerspectiveCamera())
    const original = source()
    const maps = prepareCloudAppearanceTextures(validCloudConfig().layers[0], () => original)
    const material = effect.cloudsPass.currentMaterial
    const before = material.fragmentShader
    material.fragmentShader += '\nvec2 getGlobeUv(const vec3 position) { return vec2(0.); }'
    expect(() => bindCloudAppearance(effect, validCloudConfig(), maps)).toThrow(/cloud.*getGlobeUv/i)
    material.fragmentShader = before
    const shadowBefore = effect.shadowPass.currentMaterial.fragmentShader
    const binding = bindCloudAppearance(effect, validCloudConfig(), maps)
    binding.dispose()
    expect(material.fragmentShader).toBe(before)
    expect(effect.shadowPass.currentMaterial.fragmentShader).toBe(shadowBefore)
    expect(material.uniforms.cloudColorTexture).toBeUndefined()
    maps.dispose()
    original.dispose()
    effect.dispose()
  })
  it('converts constant sRGB to linear without allocating a color texture', () => {
    const config = validCloudConfig()
    config.layers[0].color = { kind: 'constant', srgb: [0.5, 0, 1] }
    const original = source()
    const maps = prepareCloudAppearanceTextures(config.layers[0], () => original)
    expect(maps.color).toBeNull()
    expect(maps.constantColorLinear[0]).toBeCloseTo(0.21404114, 6)
    expect(maps.constantColorLinear.slice(1)).toEqual([0, 1])
    expect(maps.colorStrength).toBe(1)
    maps.dispose()
    original.dispose()
  })
})

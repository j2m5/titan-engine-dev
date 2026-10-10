import { describe, it, expect } from 'vitest'
import { config } from '@/core/framework/config'
import { background } from '@/config/background'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import {
  buildSkySampleFunctions,
  buildSkySampleUniforms,
  createSkyUniforms,
  skySampleFunctions,
  skySampleUniforms
} from '@/core/materials/shaders/lib/chunks/SkySample'
import { createGaiaSkyUniforms, gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'

const RESERVED =
  /\b(centroid|sample|patch|filter|input|output|active|common|partition|resource|half|fixed|attribute|varying|superp)\b/
const stripComments = (source: string): string => source.replace(/\/\/.*$/gm, '')

describe('SkySample: общий чанк неба', () => {
  it('чанки зарегистрированы и собраны по background.source', () => {
    expect(AppShaderChunk.skySampleUniforms).toBe(skySampleUniforms)
    expect(AppShaderChunk.skySampleFunctions).toBe(skySampleFunctions)
    expect(skySampleUniforms).toBe(buildSkySampleUniforms(config('background.source')))
    expect(skySampleFunctions).toBe(buildSkySampleFunctions(config('background.source')))
  })

  describe('ветка gaia', () => {
    const functions = buildSkySampleFunctions('gaia')
    const uniforms = buildSkySampleUniforms('gaia')

    it('контракт: sampleSky(dir, dDirDx, dDirDy)', () => {
      expect(functions).toContain('vec3 sampleSky(vec3 dir, vec3 dDirDx, vec3 dDirDy)')
    })

    it('внутри нет производных и неявной выборки — звать можно из любой ветки', () => {
      const code = stripComments(functions)
      expect(code).not.toMatch(/\bdFdx\b|\bdFdy\b|\bfwidth\b/)
      expect(code).not.toMatch(/\btexture\(/)
      expect(code).toContain('textureGrad(uGaiaGalaxy, d, dx, dy)')
      expect(code).toContain('textureLod(uGaiaStars, texelDir, lod)')
    })

    it('грубые уровни читаются ИСХОДНЫМ направлением (у Брунетона — переставленным)', () => {
      expect(functions).toContain('textureGrad(uGaiaStarsCoarse, dir, dxDir, dyDir)')
    })

    it('вырожденные производные не доходят до inverse: NaN раздул бы блум', () => {
      expect(functions).toContain('abs(det) <= 1e-6 * dot(dUv, dUv)')
      expect(functions.indexOf('abs(det)')).toBeLessThan(functions.indexOf('inverse('))
    })

    it('у gaiaStars один выход: ранний return перед динамическим циклом ANGLE считает неинициализированным', () => {
      const body = stripComments(functions.slice(functions.indexOf('vec3 gaiaStars('), functions.indexOf('vec3 sampleSkyLensed(')))
      expect(body.match(/\breturn\b/g)).toHaveLength(1)
    })

    it('константы данных Брунетона', () => {
      expect(functions).toContain('const float GAIA_CUBE_SIZE = 2048.0;')
      expect(functions).toContain('const float GAIA_MAX_FOOTPRINT_SIZE = 4.0;')
      expect(functions).toContain('const float GAIA_MAX_FOOTPRINT_LOD = 6.0;')
      expect(functions).toContain('const float GAIA_GALAXY_SCALE = 6.78494e-5;')
      expect(functions).toContain('const float GAIA_TEXEL_AREA_INV = 1048576.0;')
      expect(functions).toContain('(floatBitsToInt(star.rb) >> 8) % 257')
    })

    it('мягкий потолок — на каждую звезду до раскладки по пикселям: энергия не зависит от субпиксельной позиции', () => {
      const code = stripComments(functions)
      expect(code).toContain('uGaiaStarCeiling * (1.0 + log(y / uGaiaStarCeiling)) / y')
      expect(code).toContain('result += gaiaCeiling(star * scale) * overlap.x * overlap.y;')
      expect(code.slice(code.indexOf('vec3 sampleSky('))).not.toContain('gaiaCeiling(')
    })

    it('экспозиция — у галактики, у звёзд через scale (с усилением) и у грубых уровней', () => {
      const code = stripComments(functions)
      expect(code).toContain('galaxy * uGaiaExposure')
      expect(code).toContain('uGaiaExposure * amplification / pixelArea')
      expect(code).toContain('textureGrad(uGaiaStarsCoarse, dir, dxDir, dyDir).rgb * uGaiaExposure')
    })

    it('контракт линзы: sampleSkyLensed(луч, производные луча, производные пикселя); sampleSky — обёртка', () => {
      expect(functions).toContain('vec3 sampleSkyLensed(vec3 dir, vec3 dDirDx, vec3 dDirDy, vec3 dPixDx, vec3 dPixDy)')
      expect(functions).toContain('return sampleSkyLensed(dir, dDirDx, dDirDy, dDirDx, dDirDy);')
    })

    it('усиление по Брунетону: omega / omega′ с потолком 1e6, площадь — от неотклонённого луча', () => {
      const code = stripComments(functions)
      expect(code).toContain('float omega = length(cross(uGaiaOrientation * dPixDx, uGaiaOrientation * dPixDy));')
      expect(code).toContain('float omegaPrime = length(cross(dx, dy));')
      expect(code).toContain('float amplification = min(omega / max(omegaPrime, 1e-30), 1e6);')
      expect(code).toContain('float pixelArea = max(omega * GAIA_TEXEL_AREA_INV, 1.0);')
    })

    it('сэмплеры highp: хеш позиции звезды читает биты float', () => {
      for (const name of ['uGaiaGalaxy', 'uGaiaStars', 'uGaiaStarsCoarse']) {
        expect(uniforms).toContain(`uniform highp samplerCube ${name};`)
      }
    })

    it('нет зарезервированных слов GLSL ES 3.00', () => {
      expect(stripComments(functions)).not.toMatch(RESERVED)
      expect(uniforms).not.toMatch(RESERVED)
    })

    it('объявленные юниформы = ключи createGaiaSkyUniforms', () => {
      const declared = Array.from(uniforms.matchAll(/uniform\s+(?:highp\s+)?\w+\s+(\w+)\s*;/g))
        .map((m) => m[1])
        .sort()
      expect(declared).toEqual(Object.keys(createGaiaSkyUniforms()).sort())
    })
  })

  describe('ветка cubemap', () => {
    it('sampleSky зовёт прежнюю sampleSkyboxHdr; юниформы — прежний набор', () => {
      expect(buildSkySampleFunctions('cubemap')).toContain('return sampleSkyboxHdr(skybox, dir, uSkyFlipX);')
      expect(buildSkySampleUniforms('cubemap')).toBe(skyboxSampleUniforms)
    })

    it('sampleSkyLensed — та же кубмапа, лишние аргументы игнорируются', () => {
      expect(buildSkySampleFunctions('cubemap')).toContain(
        'vec3 sampleSkyLensed(vec3 dir, vec3 dDirDx, vec3 dDirDy, vec3 dPixDx, vec3 dPixDy)'
      )
    })
  })

  describe('createSkyUniforms', () => {
    it('gaia — те же экземпляры, что пишет GaiaSky', () => {
      const a = createSkyUniforms('gaia')
      const b = createSkyUniforms('gaia')
      expect(a.uGaiaMinLod).toBe(gaiaSkyUniforms.uGaiaMinLod)
      expect(b.uGaiaGalaxy).toBe(a.uGaiaGalaxy)
    })

    it('cubemap — прежние ручки из конфига, свежие экземпляры', () => {
      const a = createSkyUniforms('cubemap')
      expect(a.uSkyHighlightThreshold.value).toBe(background.background.highlightThreshold)
      expect(a.uSkyHighlightBoost.value).toBe(background.background.highlightBoost)
      expect(a.uSkyFloor.value).toBe(background.background.floor)
      expect(a.uSkyGain.value).toBe(background.background.gain)
      expect(createSkyUniforms('cubemap').uSkyGain).not.toBe(a.uSkyGain)
    })
  })
})

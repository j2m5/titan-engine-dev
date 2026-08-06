import { Color, NormalBlending, PerspectiveCamera, ShaderChunk, Vector3 } from 'three'
import type { WebGLRenderer } from 'three'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import {
  buildStarPalette,
  DEFAULT_STAR_TEMPERATURE_K,
  STAR_CORE_INTENSITY,
  STAR_GRANULATION_TIME_SCALE,
  STAR_LIMB_COEFF
} from '@/core/materials/shaders/lib/helpers'
import { starSurface } from '@/core/materials/shaders/lib/chunks/StarSurface'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

const TEMPERATURE_K = 9500
const RADIUS_KM = 695700

// getAttribute — единственное, что FakeStar читает у Actor; тот же приём,
// что в tests/renderables/ApparentSize.spec.ts
function stubActor(temperature?: number): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => {
        if (key === 'radius') return RADIUS_KM
        if (key === 'temperature' && temperature !== undefined) return temperature
        return def
      }
    }
  } as unknown as Actor
}

// FakeStar читает у рендерера только domElement.height
function stubRenderer(): WebGLRenderer {
  return { domElement: { height: 1080 } } as unknown as WebGLRenderer
}

function colorFrom(c: { r: number; g: number; b: number }): Color {
  return new Color().setRGB(c.r, c.g, c.b)
}

describe('FakeStar: контракт материала', () => {
  it('перекрывает фон, как диск: NormalBlending, прозрачность, без записи глубины', () => {
    // Аддитив складывался бы с туманностью/скайбоксом и вспыхивал на стыке;
    // depthWrite: true резал бы объекты позади всей площадью квада
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.blending).toBe(NormalBlending)
    expect(star.material.transparent).toBe(true)
    expect(star.material.depthWrite).toBe(false)
    expect(star.material.depthTest).toBe(true)
  })

  it('шейдер несёт logdepthbuf-чанки: рендерер живёт с логарифмической глубиной', () => {
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.vertexShader).toContain(ShaderChunk['logdepthbuf_pars_vertex'])
    expect(star.material.vertexShader).toContain(ShaderChunk['logdepthbuf_vertex'])
    expect(star.material.fragmentShader).toContain(ShaderChunk['logdepthbuf_pars_fragment'])
    expect(star.material.fragmentShader).toContain(ShaderChunk['logdepthbuf_fragment'])
  })

  it('поверхность — общий с диском чанк, текстур нет', () => {
    // Тот же starSurface, что резолвится в фрагмент диска: формулы яркости
    // не могут разъехаться между LOD. Семплеров нет — round.png ушёл
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.fragmentShader).toContain(starSurface)
    expect(star.material.fragmentShader).not.toContain('sampler2D')
    expect(star.material.fragmentShader.match(/float fbm\(/g)).toHaveLength(1)
  })

  it('палитра-триада — та же buildStarPalette, что у диска', () => {
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())
    const palette = buildStarPalette(TEMPERATURE_K)

    expect(star.material.uniforms.uColorCool.value).toEqual(colorFrom(palette.cool))
    expect(star.material.uniforms.uColorBase.value).toEqual(colorFrom(palette.base))
    expect(star.material.uniforms.uColorHot.value).toEqual(colorFrom(palette.hot))
  })

  it('без атрибута температуры — общий с диском дефолт', () => {
    const star = new FakeStar(stubActor(), stubRenderer())
    const palette = buildStarPalette(DEFAULT_STAR_TEMPERATURE_K)

    expect(star.material.uniforms.uColorBase.value).toEqual(colorFrom(palette.base))
  })

  it('яркость и лимб — общие константы диска, крутить нечего', () => {
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.uniforms.uCoreIntensity.value).toBe(STAR_CORE_INTENSITY)
    expect(star.material.uniforms.uLimbCoeff.value).toEqual(new Vector3(...STAR_LIMB_COEFF))
  })

  it('масштаб ячеек грануляции — от радиуса звезды, как у диска', () => {
    // Диск сэмплит vPosition * 0.05 при |vPosition| = R: импостору нужен
    // тот же R, иначе размер ячеек скакнёт на переключении
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.uniforms.uRadius.value).toBe(toThreeJSUnits(RADIUS_KM))
  })

  it('время грануляции живое и идёт с общим множителем', () => {
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())
    const ctx: UpdateContext = { camera: new PerspectiveCamera(50), delta: 0, epoch: 0, elapsed: 321 }

    star.updateObject(ctx)

    expect(star.material.uniforms.uTime.value).toBe(321 * STAR_GRANULATION_TIME_SCALE)
  })
})

import { describe, it, expect } from 'vitest'
import { Color, PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShaderTemplate'
import {
  giantStarCellEnergy,
  giantStarIntensity,
  GIANT_STAR_TIME_SCALE
} from '@/core/renderables/GiantStar/GiantStarParameters'
import { buildStarPalette, planckX } from '@/core/materials/shaders/lib/helpers'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { UpdateContext } from '@/core/UpdateContext'
import { withoutComments } from '../helpers/glsl'
import { stubGiantActor } from './stubGiantActor'

describe('шаблон ядра', () => {
  const vertex: string = withoutComments(GiantStarShaderTemplate.vertexShader)
  const fragment: string = withoutComments(GiantStarShaderTemplate.fragmentShader)

  it('зависимости чанка подключены в нужном порядке', () => {
    const order: number[] = ['noiseFunctions', 'starSurface', 'planckLimb', 'giantStarSurface'].map((name: string) =>
      GiantStarShaderTemplate.fragmentShader.indexOf(`#include <${name}>`)
    )

    order.forEach((position: number, i: number) => {
      expect(position).toBeGreaterThanOrEqual(0)
      if (i > 0) expect(position).toBeGreaterThan(order[i - 1])
    })
  })

  it('gl_Position идёт через modelViewMatrix', () => {
    expect(vertex).toContain('modelViewMatrix * vec4(position, 1.0)')
    expect(vertex).not.toContain('modelMatrix')
  })

  it('фрагмент не работает в мировых координатах', () => {
    expect(fragment).not.toContain('cameraPosition')
    expect(fragment).toContain('normalize(-vViewPosition)')
  })

  it('домен шума — единичное направление в объектных координатах, не абсолютная позиция', () => {
    // Рисунок не зависит от радиуса: сверхгигант и гипергигант различаются ручкой
    expect(fragment).toContain('vec3 domain = normalize(vObjectPosition) * uCellCount + uSeed;')
  })

  it('экранный масштаб домена считается до вызова композиции', () => {
    expect(fragment.indexOf('starDomainPerPixel(domain)')).toBeLessThan(fragment.indexOf('giantStarShade('))
  })
})

describe('материал ядра', () => {
  it('все юниформы поверхности выведены из температуры и данных', () => {
    const body = new GiantStar(stubGiantActor())
    const u = body.material.uniforms
    const palette = buildStarPalette(3700, 700)

    expect((u.uColorBase.value as Color).getHex()).toBe(new Color().setRGB(palette.base.r, palette.base.g, palette.base.b).getHex())
    expect(u.uCellEnergy.value.toArray()).toEqual(giantStarCellEnergy(3700, 700))
    expect(u.uPlanckX.value.toArray()).toEqual(planckX(3700))
    expect(u.uCoreIntensity.value).toBe(giantStarIntensity(body.parameters))
    expect(u.uCellCount.value).toBe(5)
    expect(u.uProximityExposure.value).toBe(1)
  })

  it('юниформы клонированы: два гиганта не делят состояние', () => {
    const a = new GiantStar(stubGiantActor({ cellCount: 4 }))
    const b = new GiantStar(stubGiantActor({ cellCount: 20 }))

    expect(a.material.uniforms.uCellCount.value).toBe(4)
    expect(b.material.uniforms.uCellCount.value).toBe(20)
  })

  it('seed уводит домен на некратный сдвиг, а не на целое число периодов', () => {
    const body = new GiantStar(stubGiantActor({ seed: 3 }))

    expect(body.material.uniforms.uSeed.value).toBeCloseTo(3 * 17.31, 10)
  })
})

describe('тело', () => {
  it('помечено типом для навигации и кликабельно', () => {
    const body = new GiantStar(stubGiantActor())

    expect(body.userData.type).toBe('giantStar')
    expect(body.userData.clickable).toBe(true)
    expect(body.radius).toBeCloseTo(toThreeJSUnits(1.06e9), 6)
  })

  it('время поверхности идёт со своим множителем', () => {
    const body = new GiantStar(stubGiantActor())

    body.updateObject({ elapsed: 100 } as unknown as UpdateContext)

    expect(body.material.uniforms.time.value).toBeCloseTo(100 * GIANT_STAR_TIME_SCALE, 12)
  })

  it('диск во весь кадр роняет прокси-экспозицию, дальний вид не тронут', () => {
    const body = new GiantStar(stubGiantActor())
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1e12)

    body.updateMatrixWorld()

    camera.position.set(0, 0, body.radius * 200)
    camera.updateMatrixWorld()
    body.onBeforeRender({} as WebGLRenderer, new Scene(), camera, body.geometry, body.material, null as never)
    expect(body.material.uniforms.uProximityExposure.value).toBe(1)

    camera.position.set(0, 0, body.radius * 1.2)
    camera.updateMatrixWorld()
    body.onBeforeRender({} as WebGLRenderer, new Scene(), camera, body.geometry, body.material, null as never)
    expect(body.material.uniforms.uProximityExposure.value).toBeLessThan(1)
  })
})

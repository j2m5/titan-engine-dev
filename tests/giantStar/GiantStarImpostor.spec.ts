import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PerspectiveCamera, Texture, WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { StarInnerLayer } from '@/core/renderables/utils/StarInnerLayer'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell } from '@/core/renderables/GiantStar/GiantStarShell'
import {
  GiantStarImpostor,
  IMPOSTOR_SHARED_BODY_UNIFORMS,
  IMPOSTOR_SHARED_SHELL_UNIFORMS
} from '@/core/renderables/GiantStar/GiantStarImpostor'
import { GiantStarShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShaderTemplate'
import { GiantStarShellShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShellShaderTemplate'
import { GiantStarImpostorShaderTemplate } from '@/core/renderables/GiantStar/GiantStarImpostorShaderTemplate'
import { GIANT_STAR_IMPOSTOR_PIXELS, frameHeightAt } from '@/core/helpers/apparentSize'
import { UpdateContext } from '@/core/UpdateContext'
import { withoutComments } from '../helpers/glsl'
import { stubGiantActor } from './stubGiantActor'

const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

/** Имена параметров вызова: сравниваем роли аргументов, а не их выражения */
function argumentCount(source: string, fn: string): number {
  const start: number = source.indexOf(`${fn}(`)

  expect(start).toBeGreaterThanOrEqual(0)

  let depth = 0
  let commas = 0

  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return commas + 1
    } else if (source[i] === ',' && depth === 1) commas++
  }

  throw new Error(`незакрытый вызов ${fn}`)
}

describe('шаблон импостора', () => {
  const fragment: string = withoutComments(GiantStarImpostorShaderTemplate.fragmentShader)

  it('берёт формулы из общих чанков, а не из своей копии', () => {
    for (const name of ['noiseFunctions', 'starSurface', 'planckLimb', 'giantStarSurface', 'giantStarShell']) {
      expect(GiantStarImpostorShaderTemplate.fragmentShader).toContain(`#include <${name}>`)
    }

    expect(fragment).not.toContain('vec3 giantStarShade(')
    expect(fragment).not.toContain('vec4 giantStarShell(')
  })

  it('поверхность зовётся тем же хвостом аргументов, что у диска', () => {
    const tail: string =
      'uColorCool, uColorBase, uColorHot, uCellEnergy, uPlanckX, uCoreIntensity, uProximityExposure'
    const flat = (source: string): string => withoutComments(source).replace(/\s+/g, ' ')

    expect(flat(GiantStarShaderTemplate.fragmentShader)).toContain(tail)
    expect(flat(GiantStarImpostorShaderTemplate.fragmentShader)).toContain(tail)
    expect(argumentCount(fragment, 'giantStarShade')).toBe(
      argumentCount(withoutComments(GiantStarShaderTemplate.fragmentShader), 'giantStarShade')
    )
  })

  it('оболочка зовётся тем же хвостом аргументов, что у меша оболочки', () => {
    const tail: string = 'uColorCool, uCellEnergy.x, uCoreIntensity, uProximityExposure'
    const flat = (source: string): string => withoutComments(source).replace(/\s+/g, ' ')

    expect(flat(GiantStarShellShaderTemplate.fragmentShader)).toContain(tail)
    expect(flat(GiantStarImpostorShaderTemplate.fragmentShader)).toContain(tail)
  })

  it('производные считаются до ветвления по попаданию в ядро', () => {
    const branch: number = fragment.indexOf('if (r < 1.0)')

    expect(branch).toBeGreaterThanOrEqual(0)
    expect(fragment.indexOf('starDomainPerPixel(domain)')).toBeLessThan(branch)
    expect(fragment.indexOf('starDomainPerPixel(woolDomain)')).toBeLessThan(branch)
    expect(fragment.indexOf('fwidth(r)')).toBeLessThan(branch)
  })

  it('ядро кладётся ПОД оболочку премультиплаем — как два меша на диске', () => {
    expect(fragment).toContain('shell.rgb + core * coreAlpha * (1.0 - shell.a)')
    expect(fragment).toContain('shell.a + coreAlpha * (1.0 - shell.a)')
  })

  it('подкоренное выражение псевдосферы защищено', () => {
    expect(fragment).toContain('sqrt(max(1.0 - rCore * rCore, 0.0))')
  })

  it('кромки smoothstep у кромки ядра не совпадают при нулевой производной', () => {
    expect(fragment).toContain('float aa = max(edge * 1.5, 1e-4);')
    expect(fragment).toContain('smoothstep(1.0 - aa, 1.0, r)')
  })

  it('gl_Position идёт через modelViewMatrix', () => {
    const vertex: string = withoutComments(GiantStarImpostorShaderTemplate.vertexShader)

    expect(vertex).toContain('modelViewMatrix')
    expect(vertex).not.toContain('modelMatrix')
  })
})

describe('импостор', () => {
  it('шарит САМИ объекты Uniform с телом и оболочкой', () => {
    const body = new GiantStar(stubGiantActor())
    const shell = new GiantStarShell(body)
    const impostor = new GiantStarImpostor(body, shell, fakeRenderer)

    for (const key of IMPOSTOR_SHARED_BODY_UNIFORMS) {
      expect(impostor.material.uniforms[key]).toBe(body.material.uniforms[key])
    }
    for (const key of IMPOSTOR_SHARED_SHELL_UNIFORMS) {
      expect(impostor.material.uniforms[key]).toBe(shell.material.uniforms[key])
    }
  })

  it('общие списки покрывают все юниформы шаблона, кроме собственных', () => {
    const own: string[] = ['uBodyRotation', 'uQuadScale']
    const shared: string[] = [...IMPOSTOR_SHARED_BODY_UNIFORMS, ...IMPOSTOR_SHARED_SHELL_UNIFORMS, ...own]

    expect(shared.sort()).toEqual(Object.keys(GiantStarImpostorShaderTemplate.uniforms).sort())
  })

  it('материал премультиплицирован — иначе кромка оболочки темнеет', () => {
    const body = new GiantStar(stubGiantActor())
    const impostor = new GiantStarImpostor(body, new GiantStarShell(body), fakeRenderer)

    expect(impostor.material.premultipliedAlpha).toBe(true)
    expect(impostor.material.depthWrite).toBe(false)
  })

  it('квад крупнее ядра ровно на протяжённость оболочки', () => {
    const body = new GiantStar(stubGiantActor({ atmosphereHeight: 0.4 }))
    const impostor = new GiantStarImpostor(body, new GiantStarShell(body), fakeRenderer)
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1e12)

    camera.position.set(0, 0, 1e9)
    camera.updateMatrixWorld()
    impostor.updateObject({ camera, elapsed: 0 } as unknown as UpdateContext)

    expect(impostor.material.uniforms.uQuadScale.value).toBeCloseTo(1.4, 12)
    expect(impostor.scale.x).toBeCloseTo(((GIANT_STAR_IMPOSTOR_PIXELS * 1.4) / 1080) * frameHeightAt(1e9, 50), 3)
  })

  it('dispose освобождает геометрию и материал всех трёх мешей', () => {
    const body = new GiantStar(stubGiantActor())
    const shell = new GiantStarShell(body)
    const impostor = new GiantStarImpostor(body, shell, fakeRenderer)
    let released = 0

    for (const mesh of [body, shell, impostor]) {
      mesh.geometry.addEventListener('dispose', () => released++)
      mesh.material.addEventListener('dispose', () => released++)
      mesh.dispose()
    }

    expect(released).toBe(6)
  })
})

describe('сборка узла звезды-гиганта', () => {
  beforeEach(() => {
    const map = new Texture()
    map.name = 'sun.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('sun.png')
  })

  function make(): DynamicNode {
    const factory = new RenderableFactory(
      fakeRenderer,
      {} as unknown as ResourceObserver,
      new AtmosphereRegistry(),
      new DepthVolumeRegistry()
    )

    return factory.make(stubGiantActor()) as DynamicNode
  }

  it('тело остаётся под DynamicNode', () => {
    const node = make()

    expect(node).toBeInstanceOf(DynamicNode)
    expect(node.renderable).toBeInstanceOf(GiantStar)
    expect(node.name).toBe('W26')
  })

  it('оболочка — дочь тела, гало — на LOD, импостор — второй уровень', () => {
    const node = make()
    let body: GiantStar | undefined
    let shell: GiantStarShell | undefined
    let impostor: GiantStarImpostor | undefined
    let halo: StarInnerLayer | undefined

    node.traverse((child) => {
      if (child instanceof GiantStar) body = child
      if (child instanceof GiantStarShell) shell = child
      if (child instanceof GiantStarImpostor) impostor = child
      if (child instanceof StarInnerLayer) halo = child
    })

    expect(shell!.parent).toBe(body)
    expect(halo!.parent).toBeInstanceOf(ApparentSizeLod)
    expect(impostor!.parent).toBeInstanceOf(ApparentSizeLod)
    expect(body!.userData.type).toBe('giantStar')
  })

  it('протуберанцев у гиганта нет', () => {
    let prominences = 0

    make().traverse((child) => {
      if (child.constructor.name === 'StarOuterLayer') prominences++
    })

    expect(prominences).toBe(0)
  })
})

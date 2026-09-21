import { describe, it, expect } from 'vitest'
import { AlwaysDepth, BackSide, FrontSide, LessEqualDepth, PerspectiveCamera, Scene, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { giantStarShell } from '@/core/materials/shaders/lib/chunks/GiantStarShell'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { GiantStar } from '@/core/renderables/GiantStar/GiantStar'
import { GiantStarShell, SHELL_SHARED_UNIFORMS } from '@/core/renderables/GiantStar/GiantStarShell'
import { GiantStarShellShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShellShaderTemplate'
import { shellDensityScale, SHELL_STEPS, SHELL_SCALE_FRACTION } from '@/core/renderables/GiantStar/shellMath'
import { withoutComments } from '../helpers/glsl'
import { stubGiantActor } from './stubGiantActor'

function render(shell: GiantStarShell, camera: PerspectiveCamera): void {
  camera.updateMatrixWorld()
  shell.onBeforeRender({} as WebGLRenderer, new Scene(), camera, shell.geometry, shell.material, null as never)
}

describe('чанк giantStarShell — структура', () => {
  const code: string = withoutComments(giantStarShell)

  it('зарегистрирован в реестре', () => {
    expect(AppShaderChunk.giantStarShell).toBe(giantStarShell)
  })

  it('константы интеграла синхронизированы с CPU', () => {
    expect(giantStarShell).toContain(`#define GS_SHELL_STEPS ${SHELL_STEPS}`)
    expect(giantStarShell).toContain(`#define GS_SHELL_SCALE_FRACTION ${SHELL_SCALE_FRACTION}`)
  })

  it('плотность на верхней границе — ровно ноль, а не обрыв', () => {
    expect(code).toContain('max(exp(-(r - 1.0) / scale) - cut, 0.0) / (1.0 - cut)')
  })

  it('луч обрезается фотосферой аналитически, чтения глубины нет', () => {
    expect(code).toContain('if (tCore > 0.0) t1 = min(t1, tCore);')
    expect(code).not.toMatch(/texture|sampler/)
  })

  it('дискриминанты считаются через перпендикуляр — разность b*b - (oo - R*R) теряет точность', () => {
    expect(code).toContain('vec3 perp = origin - dir * b;')
    expect(code).toContain('float discOuter = outer * outer - p2;')
    expect(code).toContain('float discCore = 1.0 - p2;')
    expect(code).not.toContain('b * b - (oo')
  })

  it('луч в диск адресует «шерсть» точкой входа в ядро, а не точкой под поверхностью', () => {
    expect(code).toContain('float discCore = 1.0 - dot(perp, perp);')
    expect(code).toContain('float tClosest = max(-b, 0.0);')
    expect(code).toContain('float tCore = -b - sqrt(max(discCore, 0.0));')
    expect(code).toContain('float t = (discCore > 0.0 && tCore > 0.0) ? tCore : tClosest;')
  })

  it('подкоренные выражения защищены от отрицательных значений', () => {
    expect(code).not.toMatch(/sqrt\((?!max\()/)
  })

  it('выход премультиплицирован', () => {
    expect(code).toContain('return vec4(coolColor * coolEnergy * intensity * exposure * alpha, alpha);')
  })

  it('производных внутри чанка нет', () => {
    expect(code).not.toMatch(/dFdx|dFdy|fwidth|starDomainPerPixel/)
  })
})

describe('шаблон оболочки', () => {
  const vertex: string = withoutComments(GiantStarShellShaderTemplate.vertexShader)
  const fragment: string = withoutComments(GiantStarShellShaderTemplate.fragmentShader)

  it('gl_Position идёт через modelViewMatrix', () => {
    expect(vertex).toContain('modelViewMatrix * vec4(position, 1.0)')
    expect(vertex).not.toContain('modelMatrix')
    expect(fragment).not.toContain('cameraPosition')
  })

  it('«шерсть» гасится экранной мерой, посчитанной до композиции', () => {
    expect(fragment.indexOf('starDomainPerPixel(woolDomain)')).toBeGreaterThanOrEqual(0)
    expect(fragment.indexOf('starDomainPerPixel(woolDomain)')).toBeLessThan(fragment.indexOf('giantStarShell('))
  })
})

describe('меш оболочки', () => {
  it('прозрачен, премультиплицирован, глубину не пишет', () => {
    const shell = new GiantStarShell(new GiantStar(stubGiantActor()))

    expect(shell.material.transparent).toBe(true)
    expect(shell.material.premultipliedAlpha).toBe(true)
    expect(shell.material.depthWrite).toBe(false)
  })

  it('прокси описана вокруг всей оболочки', () => {
    const body = new GiantStar(stubGiantActor({ atmosphereHeight: 0.4 }))
    const shell = new GiantStarShell(body)

    shell.geometry.computeBoundingSphere()
    expect(shell.geometry.boundingSphere!.radius).toBeCloseTo(body.radius * 1.4, 0)
  })

  it('нормировка плотности посчитана на CPU тем же интегралом', () => {
    const shell = new GiantStarShell(new GiantStar(stubGiantActor({ atmosphereDensity: 1.7 })))

    expect(shell.material.uniforms.uDensityScale.value).toBe(shellDensityScale(0.3, 1.7))
  })

  it('нулевая плотность скрывает меш целиком — точка отката', () => {
    expect(new GiantStarShell(new GiantStar(stubGiantActor({ atmosphereDensity: 0 }))).visible).toBe(false)
  })

  it('шарит с телом САМИ объекты Uniform', () => {
    const body = new GiantStar(stubGiantActor())
    const shell = new GiantStarShell(body)

    for (const key of SHELL_SHARED_UNIFORMS) {
      expect(shell.material.uniforms[key]).toBe(body.material.uniforms[key])
    }
  })

  it('снаружи рисуются лицевые грани с обычным тестом глубины', () => {
    const body = new GiantStar(stubGiantActor())
    const shell = new GiantStarShell(body)
    const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)

    body.add(shell)
    body.updateMatrixWorld()
    camera.position.set(0, 0, body.radius * 3)
    render(shell, camera)

    expect(shell.material.side).toBe(FrontSide)
    expect(shell.material.depthFunc).toBe(LessEqualDepth)
    expect(shell.material.uniforms.uCameraUnit.value.z).toBeCloseTo(3, 6)
  })

  it('камера внутри оболочки: изнанка без теста глубины, обрезку делает аналитика', () => {
    const body = new GiantStar(stubGiantActor())
    const shell = new GiantStarShell(body)
    const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)

    body.add(shell)
    body.updateMatrixWorld()
    camera.position.set(0, 0, body.radius * 1.1)
    render(shell, camera)

    expect(shell.material.side).toBe(BackSide)
    expect(shell.material.depthFunc).toBe(AlwaysDepth)

    camera.position.set(0, 0, body.radius * 3)
    render(shell, camera)
    expect(shell.material.side).toBe(FrontSide)
  })
})

import { Mesh, RawShaderMaterial, RGFormat, Scene, UnsignedByteType, WebGLCubeRenderTarget, WebGLRenderer } from 'three'
import { BrownDwarfCloudBaker } from '@/core/renderables/BrownDwarf/BrownDwarfCloudBaker'

interface RenderCall {
  target: unknown
  face: number | undefined
  /** Текстура, из которой проход читает (uPrev); undefined у посева */
  source: unknown
  /** Номер итерации во впрыске; undefined у не-адвекционных проходов */
  injectSeed: number | undefined
}

/**
 * Заглушка обязана заглядывать в материал квада на каждом render: без этого
 * ни привязка uPrev, ни смена материала между проходами, ни декорреляция
 * впрыска не наблюдаемы вовсе, и запекатель может делать что угодно, оставаясь
 * зелёным. GPU здесь нет, наблюдаемы только вызовы — значит наблюдать надо всё.
 */
function fakeRenderer(): { renderer: WebGLRenderer; calls: RenderCall[] } {
  const calls: RenderCall[] = []
  let current: unknown = null
  let face: number | undefined

  const renderer = {
    getRenderTarget: () => current,
    setRenderTarget: (target: unknown, activeFace?: number) => {
      current = target
      face = activeFace
    },
    render: (scene: Scene) => {
      const material = (scene.children[0] as Mesh).material as RawShaderMaterial

      calls.push({
        target: current,
        face,
        source: material.uniforms.uPrev?.value,
        injectSeed: material.uniforms.uInjectSeed?.value
      })
    }
  } as unknown as WebGLRenderer

  return { renderer, calls }
}

const PARAMS = {
  seed: 4096,
  bandCount: 9,
  jetStrength: 0.6,
  turbulence: 1.6,
  size: 64,
  steps: 3,
  injection: 0.05
}

describe('запекатель облачного поля', () => {
  it('создаёт цель заявленного размера и формата, с мипами', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)
    const texture = baker.bake()

    // Размер спрашиваем у цели, а не у текстуры: у CubeTexture поле image —
    // МАССИВ из шести описателей граней, поэтому texture.image.width равен
    // undefined на любом WebGLCubeRenderTarget
    expect(baker.targetsForTest[0].width).toBe(64)
    expect(texture.image).toHaveLength(6)
    expect(texture.image[0].width).toBe(64)

    expect(texture.format).toBe(RGFormat)
    expect(texture.type).toBe(UnsignedByteType)
    expect(texture.generateMipmaps).toBe(true)

    baker.dispose()
  })

  it('гоняет посев, адвекцию и финализацию по всем шести граням', () => {
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    // (посев + steps адвекции + финализация) × 6 граней
    expect(calls).toHaveLength((1 + PARAMS.steps + 1) * 6)
    expect(new Set(calls.map((c) => c.face))).toEqual(new Set([0, 1, 2, 3, 4, 5]))

    baker.dispose()
  })

  it('адвекция идёт ping-pong: соседние проходы пишут в разные цели', () => {
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    // проходы сгруппированы по шесть граней; берём первую грань каждого прохода
    const perPass = calls.filter((_, i) => i % 6 === 0).map((c) => c.target)

    for (let i = 1; i < perPass.length; i++) {
      expect(perPass[i]).not.toBe(perPass[i - 1])
    }

    baker.dispose()
  })

  it('возвращает рендерер на прежнюю цель', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    expect(renderer.getRenderTarget()).toBeNull()

    baker.dispose()
  })

  it('черновая цель освобождается сразу, финальная — в dispose', () => {
    const { renderer } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)
    const disposed: unknown[] = []

    for (const target of baker.targetsForTest) {
      const original = target.dispose.bind(target)
      target.dispose = () => {
        disposed.push(target)
        original()
      }
    }

    const texture = baker.bake()

    // Ровно одна — и это НЕ та, чью текстуру отдали наружу
    expect(disposed).toHaveLength(1)
    expect((disposed[0] as WebGLCubeRenderTarget).texture).not.toBe(texture)

    baker.dispose()

    // Вторая уходит в dispose, черновая повторно не освобождается
    expect(disposed).toHaveLength(2)
  })

  it('отдаёт текстуру той цели, в которую писал последний проход', () => {
    // Самая опасная строка запекателя: вернуть черновую вместо финальной
    // ничем больше не ловится — обе цели одного размера и формата
    for (const steps of [3, 4]) {
      const { renderer, calls } = fakeRenderer()
      const baker = new BrownDwarfCloudBaker(renderer, { ...PARAMS, steps })

      const texture = baker.bake()
      const lastTarget = calls[calls.length - 1].target as WebGLCubeRenderTarget

      expect(texture).toBe(lastTarget.texture)

      baker.dispose()
    }
  })

  it('каждый проход рисует все шесть граней, а не только первую', () => {
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    // Общий Set по всем вызовам прошёл бы и при одном полном проходе:
    // грани проверяются пер-проход, шестёрками
    for (let pass = 0; pass < calls.length / 6; pass++) {
      const faces = calls.slice(pass * 6, pass * 6 + 6).map((c) => c.face)

      expect(new Set(faces)).toEqual(new Set([0, 1, 2, 3, 4, 5]))
    }

    baker.dispose()
  })

  it('адвекция читает соседнюю цель, а не ту, в которую пишет', () => {
    // Чтение и запись одной текстуры в проходе — гонка; заглушка
    // рендерера иначе этого не видит вовсе
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    for (const call of calls) {
      if (!call.source) continue

      expect(call.source).not.toBe((call.target as WebGLCubeRenderTarget).texture)
    }

    baker.dispose()
  })

  it('впрыск шума декоррелирован по шагам', () => {
    // Одинаковый впрыск на всех шагах складывается когерентно в призрак
    // фиксированного fbm вместо широкополосной детали
    const { renderer, calls } = fakeRenderer()
    const baker = new BrownDwarfCloudBaker(renderer, PARAMS)

    baker.bake()

    const seeds = calls.filter((c) => c.injectSeed !== undefined).map((c) => c.injectSeed)

    expect(new Set(seeds).size).toBe(PARAMS.steps)

    baker.dispose()
  })
})

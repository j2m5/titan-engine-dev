import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import { BrownDwarfImpostorShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfImpostorShaderTemplate'
import { buildStarPalette, mixColor } from '@/core/materials/shaders/lib/helpers'
import {
  BROWN_DWARF_CLOUD_DIM,
  BROWN_DWARF_DECK_PLUM,
  BROWN_DWARF_PALETTE_SPREAD_K
} from '@/core/renderables/BrownDwarf/BrownDwarfParameters'

const fakeRenderer = {
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def ?? 'Dwarf',
    renderingObject: { getAttribute: () => ({ bandCount: 9 }) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def)
    }
  } as unknown as Actor
}

describe('тело коричневого карлика', () => {
  it('поле считается аналитически, кубмапы больше нет', () => {
    const body = new BrownDwarf(stubActor())

    expect(BrownDwarfShaderTemplate.fragmentShader).toContain('bdField(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('textureCube')
    expect(body.material.uniforms).not.toHaveProperty('uClouds')
    expect(body.material.uniforms.uBandCount.value).toBe(9)
    // Сохранённое покрытие прежнего теста: сборка узла не завязана на uClouds
    expect(body.userData.type).toBe('brownDwarf')
    expect(body.userData.clickable).toBe(true)

    body.dispose()
  })

  it('поле считается один раз на фрагмент: параллакс берёт отдельную дешёвую высоту', () => {
    // Полный bdField — девятнадцать октав; звать его ради одного канала
    // высоты значит выбрасывать восемнадцать
    const source = BrownDwarfShaderTemplate.fragmentShader

    expect((source.match(/bdField\(/g) ?? []).length).toBe(1)
    expect(source).toContain('bdHeight(')
  })

  it('параллакс гаснет к центру диска, а не держится постоянным', () => {
    // |tangent| равен синусу угла взгляда и уже несёт нужный множитель.
    // Нормировка выбрасывала спад: в подсолнечной точке сдвиг оставался
    // полным, а направление там неустойчиво — отсюда разрыв рисунка.
    //
    // Три проверки работают ТОЛЬКО вместе: обе на отсутствие пройдут и если
    // параллакс выкинуть целиком, держит их третья
    const source = BrownDwarfShaderTemplate.fragmentShader

    expect(source).not.toContain('normalize(tangent)')
    expect(source).not.toContain('dot(tangent, tangent)')
    expect(source).toContain('tangent * (height * uParallax)')
  })

  it('импостор параллакса не знает', () => {
    // На двенадцати пикселях сдвиг субтекселен; ручки у импостора нет
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).not.toContain('uParallax')
  })

  it.each([
    ['диск', BrownDwarfShaderTemplate.fragmentShader],
    ['импостор', BrownDwarfImpostorShaderTemplate.fragmentShader]
  ])('%s включает зависимости поля до чанка композиции', (_name, source: string) => {
    // bdField зовёт fbm, fbm зовёт snoise; включение после — undeclared identifier
    const noise = source.indexOf('#include <noiseFunctions>')
    const star = source.indexOf('#include <starSurface>')
    const dwarf = source.indexOf('#include <brownDwarfSurface>')

    expect(noise).toBeGreaterThanOrEqual(0)
    expect(star).toBeGreaterThan(noise)
    expect(dwarf).toBeGreaterThan(star)
  })

  it('камера переводится в объектные координаты в onBeforeRender', () => {
    // updateObject идёт до scene.updateMatrixWorld(), поэтому matrixWorld там
    // отстаёт на кадр; three зовёт onBeforeRender уже с актуальными матрицами
    const body = new BrownDwarf(stubActor())

    body.position.set(10, 0, 0)
    body.rotation.set(0, Math.PI / 2, 0)
    body.updateMatrixWorld(true)

    const camera = new PerspectiveCamera()
    camera.position.set(10, 0, 5)
    camera.updateMatrixWorld(true)

    body.onBeforeRender(fakeRenderer, new Scene(), camera, body.geometry, body.material, null as never)

    // Камера смещена на +5 по мировому Z от центра тела; тело повёрнуто на +90°
    // вокруг Y, значит обратный поворот кладёт камеру в -5 по объектному X
    const value = body.material.uniforms.uCameraObject.value as Vector3

    expect(value.x).toBeCloseTo(-5, 5)
    expect(value.y).toBeCloseTo(0, 5)
    expect(value.z).toBeCloseTo(0, 5)

    body.dispose()
  })

  it('время доезжает в юниформ и не трогает толщу', () => {
    const body = new BrownDwarf(stubActor())
    const before = body.material.uniforms.uOpticalDepth.value

    body.updateObject({ delta: 0.016, epoch: 0, elapsed: 9999, camera: new PerspectiveCamera() })

    expect(body.material.uniforms.time.value).toBeCloseTo(9999)
    expect(body.material.uniforms.uOpticalDepth.value).toBe(before)

    body.dispose()
  })

  it('шаблон не держит собственной копии формул композиции', () => {
    // Дубль формулы — это будущая рассинхронизация LOD при первой правке
    expect(BrownDwarfShaderTemplate.fragmentShader).toContain('#include <brownDwarfSurface>')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('float bdTransmit(')
  })

  it('фрагментный шейдер живёт только в объектных координатах', () => {
    // Смешение мирового вектора с объектным даёт сдвиг выборки, зависящий от
    // поворота тела, то есть «поехавший» рисунок. Здесь смешать нечего:
    // мировых величин в теле шейдера нет вовсе
    const fragment = BrownDwarfShaderTemplate.fragmentShader
    const start = fragment.indexOf('void main()')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(fragment).toContain('uniform vec3 uCameraObject;')

    const main = fragment.slice(start)

    expect(main).not.toContain('cameraPosition')
    expect(main).not.toContain('modelMatrix')
    expect(main).not.toContain('vPositionW')
  })

  it('вся композиция идёт одной точкой входа чанка', () => {
    // Собственных вызовов примитивов в шаблоне нет — иначе диск и импостор
    // могут разойтись порядком операций или забытым дыханием
    expect(BrownDwarfShaderTemplate.fragmentShader).toContain('bdShade(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('bdTransmit(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('bdCompose(')
    expect(BrownDwarfShaderTemplate.fragmentShader).not.toContain('smoothstep')
  })

  it('dispose освобождает геометрию и материал', () => {
    const body = new BrownDwarf(stubActor())

    const geometryDispose = vi.spyOn(body.geometry, 'dispose')
    const materialDispose = vi.spyOn(body.material, 'dispose')

    body.dispose()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(() => body.dispose()).not.toThrow()
  })
})

describe('тонировка палубы карлика', () => {
  const tinted = (temperature: number, deckTint: number): Actor =>
    ({
      getAttribute: (_key: string, def?: unknown): unknown => def ?? 'Dwarf',
      renderingObject: { getAttribute: () => ({ deckTint }) },
      physicalObject: {
        getAttribute: (key: string, def?: unknown): unknown =>
          key === 'radius' ? 69900 : key === 'temperature' ? temperature : def
      }
    }) as unknown as Actor

  it('синий палубы перестал быть нулём', () => {
    // Главный дефект арки: у чёрнотельного цвета синий равен ровно нулю ниже
    // 1900 K, и третий канал объекта производил только пост
    const body = new BrownDwarf(tinted(1210, 0.5))

    expect(body.material.uniforms.uColorCloud.value.b).toBeGreaterThan(0)
    expect(body.material.uniforms.uColorCloudHigh.value.b).toBeGreaterThan(0)

    body.dispose()
  })

  it('нулевая тонировка даёт чистый планковский цвет', () => {
    const body = new BrownDwarf(tinted(1210, 0))
    const cool = buildStarPalette(1210, BROWN_DWARF_PALETTE_SPREAD_K).cool

    expect(body.material.uniforms.uColorCloud.value.r).toBeCloseTo(cool.r * BROWN_DWARF_CLOUD_DIM, 12)
    expect(body.material.uniforms.uColorCloud.value.b).toBe(0)

    body.dispose()
  })

  it('совпадает с ручной сборкой из примитивов', () => {
    const body = new BrownDwarf(tinted(1210, 0.5))
    const cool = buildStarPalette(1210, BROWN_DWARF_PALETTE_SPREAD_K).cool
    const manual = mixColor(cool, BROWN_DWARF_DECK_PLUM, 0.5)
    const cloud = body.material.uniforms.uColorCloud.value

    expect(cloud.r).toBeCloseTo(manual.r * BROWN_DWARF_CLOUD_DIM, 12)
    expect(cloud.g).toBeCloseTo(manual.g * BROWN_DWARF_CLOUD_DIM, 12)
    expect(cloud.b).toBeCloseTo(manual.b * BROWN_DWARF_CLOUD_DIM, 12)

    body.dispose()
  })

  it('верхушки палубы — тот же цвет, вдвое темнее', () => {
    // Тонировка ложится на хроматичность ДО затемнения, поэтому обе записи
    // палубы обязаны отличаться ровно множителем
    const body = new BrownDwarf(tinted(1210, 0.5))
    const cloud = body.material.uniforms.uColorCloud.value
    const high = body.material.uniforms.uColorCloudHigh.value

    expect(high.r).toBeCloseTo(cloud.r * 0.45, 12)
    expect(high.g).toBeCloseTo(cloud.g * 0.45, 12)
    expect(high.b).toBeCloseTo(cloud.b * 0.45, 12)

    body.dispose()
  })

  it('прогалины тонировка не трогает: синий нутра остаётся планковским', () => {
    const plain = new BrownDwarf(tinted(1210, 0))
    const full = new BrownDwarf(tinted(1210, 1))

    expect(full.material.uniforms.uColorHot.value.g).toBeCloseTo(plain.material.uniforms.uColorHot.value.g, 12)
    expect(full.material.uniforms.uColorHotDeep.value.b).toBeCloseTo(
      plain.material.uniforms.uColorHotDeep.value.b,
      12
    )

    plain.dispose()
    full.dispose()
  })
})

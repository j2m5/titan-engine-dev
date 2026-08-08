import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import { BrownDwarfImpostorShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfImpostorShaderTemplate'

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

import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { BrownDwarf } from '@/core/renderables/BrownDwarf/BrownDwarf'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'

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
  it('строится и несёт запечённую кубмапу в юниформе', () => {
    const body = new BrownDwarf(stubActor(), fakeRenderer)

    expect(body.material.uniforms.uClouds.value).toBeTruthy()
    expect(body.userData.type).toBe('brownDwarf')
    expect(body.userData.clickable).toBe(true)

    body.dispose()
  })

  it('камера переводится в объектные координаты в onBeforeRender', () => {
    // updateObject идёт до scene.updateMatrixWorld(), поэтому matrixWorld там
    // отстаёт на кадр; three зовёт onBeforeRender уже с актуальными матрицами
    const body = new BrownDwarf(stubActor(), fakeRenderer)

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
    const body = new BrownDwarf(stubActor(), fakeRenderer)
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

  it('dispose освобождает запекатель, а не только свои ресурсы', () => {
    // Ловушка: проверять длину массива целей бессмысленно — dispose его не
    // укорачивает, и тест прошёл бы даже без вызова baker.dispose() вовсе
    const body = new BrownDwarf(stubActor(), fakeRenderer)
    const baker = body.bakerForTest

    let bakerDisposed = 0
    const original = baker.dispose.bind(baker)
    baker.dispose = (): void => {
      bakerDisposed++
      original()
    }

    body.dispose()

    expect(bakerDisposed).toBe(1)
    expect(() => body.dispose()).not.toThrow()
  })
})

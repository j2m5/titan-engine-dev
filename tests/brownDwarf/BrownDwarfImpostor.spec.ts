import { WebGLRenderer } from 'three'
import { Actor } from '@/core/models/Actor'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { BrownDwarf } from '@/core/renderables/BrownDwarf'
import { BrownDwarfImpostorShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfImpostorShaderTemplate'
import { BrownDwarfShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfShaderTemplate'
import { STAR_IMPOSTOR_PIXELS, starLodSwitchDistance } from '@/core/helpers/apparentSize'
import { ResourceObserver } from '@/core/services/ResourceObserver'

// Запекатель внутри тела дёргает рендерер, поэтому заглушка шире, чем нужно
// одному только LOD
const fakeRenderer = {
  domElement: { height: 1080 },
  getRenderTarget: () => null,
  setRenderTarget: () => {},
  render: () => {}
} as unknown as WebGLRenderer

function stubActor(): Actor {
  return {
    // 'name' — отдельный случай, а не (def ?? 'Dwarf'): производственный код
    // зовёт getAttribute('name', ''), и '' не нулевое — `??` его не подменит
    getAttribute: (key: string, def?: unknown): unknown => (key === 'categoryId' ? 8 : key === 'name' ? 'Dwarf' : def),
    // Именно null, а не отсутствие поля: OrientationModel проверяет `!== null`
    rotation: null,
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 69900 : key === 'temperature' ? 1600 : def
    }
  } as unknown as Actor
}

describe('LOD по видимому размеру', () => {
  it('с размером звезды повторяет старую формулу звезды один в один', () => {
    // Обобщение не имеет права сдвинуть сведённый стык звезды
    const lod = new ApparentSizeLod(696000, fakeRenderer, STAR_IMPOSTOR_PIXELS)

    expect(lod.switchDistance(50)).toBeCloseTo(starLodSwitchDistance(696000, 50, 1080), 10)
  })

  it('StarLod сохраняет двухаргументный конструктор и то же поведение', () => {
    // Существующий тест стыка звезды строит StarLod двумя аргументами и
    // править его нельзя: он охраняет сведённый стык
    const star = new StarLod(696000, fakeRenderer)
    const generic = new ApparentSizeLod(696000, fakeRenderer, STAR_IMPOSTOR_PIXELS)

    expect(star).toBeInstanceOf(ApparentSizeLod)
    expect(star.switchDistance(50)).toBeCloseTo(generic.switchDistance(50), 10)
  })

  it('больший импостор переключается ближе', () => {
    const small = new ApparentSizeLod(69900, fakeRenderer, 12)
    const large = new ApparentSizeLod(69900, fakeRenderer, 24)

    expect(large.switchDistance(50)).toBeLessThan(small.switchDistance(50))
  })
})

describe('сборка узла карлика', () => {
  it('тело остаётся под DynamicNode, а не подменяет его собой', () => {
    // Без обёртки тело потеряло бы кеплерово обновление и регистрацию маркера,
    // а traverse по корню прошёл бы и по самому корню — то есть проверка
    // «BrownDwarf достижим» такую подмену не ловит
    const factory = new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver)
    const node = factory.make(stubActor())

    expect(node).toBeInstanceOf(DynamicNode)
    expect((node as DynamicNode).renderable).toBeInstanceOf(BrownDwarf)
    expect(node.name).toBe('Dwarf')
  })
})

describe('импостор коричневого карлика', () => {
  it('берёт формулы из общего чанка, а не из своей копии', () => {
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).toContain('#include <brownDwarfSurface>')
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).not.toContain('float bdTransmit(')
    expect(BrownDwarfImpostorShaderTemplate.fragmentShader).not.toContain('float bdCompose(')
  })

  it('зовёт ту же точку композиции с тем же списком аргументов, что и диск', () => {
    // Самый прямой контракт «одна формула на оба LOD»: если аргументы
    // разъедутся, на переключении появится шов
    const call = (source: string): string => {
      const start: number = source.indexOf('bdShade(')
      const end: number = source.indexOf(')', start)

      return source.slice(start, end + 1).replace(/\s+/g, ' ')
    }

    expect(call(BrownDwarfImpostorShaderTemplate.fragmentShader)).toBe(call(BrownDwarfShaderTemplate.fragmentShader))
  })

  it('сэмплит ту же кубмапу, что и диск', () => {
    // Общий источник данных — то, чем сведён шов на переключении.
    // uCameraObject не в списке: это позиция камеры в объектных координатах,
    // нужна только диску (сэмплит по vPosition); импостор восстанавливает
    // псевдосферу из координат квада и camera-object-space не читает
    expect(BrownDwarfImpostorShaderTemplate.uniforms.uClouds).toBeDefined()
    const sharedWithDisk = Object.keys(BrownDwarfShaderTemplate.uniforms).filter((key) => key !== 'uCameraObject')
    expect(Object.keys(BrownDwarfImpostorShaderTemplate.uniforms)).toEqual(expect.arrayContaining(sharedWithDisk))
  })

  it('не имеет собственного множителя яркости', () => {
    // Любой множитель поверх воссоздал бы шов на переключении
    expect(BrownDwarfImpostorShaderTemplate.uniforms).not.toHaveProperty('uImpostorBrightness')
  })
})

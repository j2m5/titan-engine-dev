import {
  BufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsUtils,
  Vector3,
  WebGLRenderer
} from 'three'
import { Actor } from '@/core/models/Actor'
import { STAR_IMPOSTOR_PIXELS, worldSizeForPixels } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  buildStarPalette,
  DEFAULT_STAR_TEMPERATURE_K,
  STAR_GRANULATION_TIME_SCALE,
  StarPalette
} from '@/core/materials/shaders/lib/helpers'
import { FakeStarShaderTemplate } from '@/core/materials/shaders/lib/FakeStarShaderTemplate'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Билборд-импостор звезды: LOD-уровень 2 звёздного меша. Поверхность —
 * формулы диска (общий чанк starSurface + общие константы helpers), палитра —
 * та же buildStarPalette: на дистанции переключения уровни совпадают по
 * яркости, цвету, bloom и бликам по построению, ручек подстройки нет
 * намеренно.
 *
 * Не использовать ни для чего, кроме LOD-утилиты сверх-ярких источников
 * света: размер меряется под STAR_IMPOSTOR_PIXELS.
 */
class FakeStar extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()

  public constructor(
    model: Actor,
    private readonly renderer: WebGLRenderer
  ) {
    super()
    this.model = model

    this.__setup()
  }

  __setup(): void {
    const temperature: number =
      this.model.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
    const palette: StarPalette = buildStarPalette(temperature)
    const radius: number = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    this.geometry = new PlaneGeometry(1, 1)

    // NormalBlending: билборд перекрывает фон, как непрозрачный диск L1 —
    // аддитив складывался бы с туманностью и вспыхивал на стыке.
    // depthWrite: false — квад не режет объекты позади своей площадью
    this.material = new ShaderMaterial({
      vertexShader: FakeStarShaderTemplate.vertexShader,
      fragmentShader: FakeStarShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(FakeStarShaderTemplate.uniforms),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: NormalBlending
    })
    this.material.uniforms.uColorCool.value.setRGB(palette.cool.r, palette.cool.g, palette.cool.b)
    this.material.uniforms.uColorBase.value.setRGB(palette.base.r, palette.base.g, palette.base.b)
    this.material.uniforms.uColorHot.value.setRGB(palette.hot.r, palette.hot.g, palette.hot.b)
    this.material.uniforms.uRadius.value = radius
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    // Живая грануляция — общий множитель с диском (Star.updateObject):
    // скорость эволюции поверхности одна на оба LOD
    this.material.uniforms.uTime.value = ctx.elapsed * STAR_GRANULATION_TIME_SCALE

    // Позиция мировая, а не локальная: билборд висит в нуле родительского узла,
    // и по локальной мерилось бы расстояние до начала сцены. Ту же величину
    // меряет LOD.update, выбирая между диском и билбордом
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    // Мировой размер, дающий STAR_IMPOSTOR_PIXELS пикселей на этом расстоянии.
    // Общий helper, а не своя копия формулы: тот же пол держит импостор ЧД
    const worldSize: number = worldSizeForPixels(
      STAR_IMPOSTOR_PIXELS,
      distance,
      ctx.camera.fov,
      this.renderer.domElement.height
    )

    this.scale.setScalar(worldSize)
  }
}

export { FakeStar }

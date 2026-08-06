import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  Vector3,
  WebGLRenderer
} from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STAR_IMPOSTOR_PIXELS, frameHeightAt } from '@/core/helpers/apparentSize'
import { buildStarPalette, DEFAULT_STAR_TEMPERATURE_K, StarPalette } from '@/core/materials/shaders/lib/helpers'
import { FakeStarShaderTemplate } from '@/core/materials/shaders/lib/FakeStarShaderTemplate'
import { config } from '@/core/framework/config'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Билборд-импостор звезды: LOD-уровень 2 звёздного меша. Цвет — палитра
 * диска (buildStarPalette) × config('star.impostorIntensity'): диск и билборд
 * считают цвет от одной температуры одной функцией, и стык LOD сведён по
 * цвету по построению. Форма — альфа-канал round.png
 * (см. FakeStarShaderTemplate).
 *
 * Не использовать ни для чего, кроме LOD-утилиты сверх-ярких источников
 * света: размер меряется под STAR_IMPOSTOR_PIXELS, яркость — под bloom.
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
    // Ресурс движковый и обязан быть в сторадже; прежний getTexture(...)!
    // молча отдавал undefined и билборд ломался без следа в консоли
    const map: Texture | undefined = resourceStorage.getTexture('round.png')
    if (map === undefined) {
      console.warn(
        '[FakeStar] Текстура формы "round.png" не найдена — билборд дальней звезды будет рисоваться квадратом'
      )
    }

    const temperature: number =
      this.model.physicalObject?.getAttribute('temperature', DEFAULT_STAR_TEMPERATURE_K) ?? DEFAULT_STAR_TEMPERATURE_K
    const palette: StarPalette = buildStarPalette(temperature)

    this.geometry = new PlaneGeometry(1, 1)

    // transparent + depthWrite: false — иначе квад пишет глубину всей
    // площадью, включая прозрачные углы, и объекты позади билборда
    // получают квадратную дырку. depthTest остаётся: билборд перекрывается
    // телами на переднем плане честно
    this.material = new ShaderMaterial({
      vertexShader: FakeStarShaderTemplate.vertexShader,
      fragmentShader: FakeStarShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(FakeStarShaderTemplate.uniforms),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: AdditiveBlending
    })
    this.material.uniforms.map.value = map ?? null
    // Палитра linear-sRGB, setRGB без конверсии; multiplyScalar даёт HDR —
    // порог bloom перекрыт, дальняя звезда светится
    ;(this.material.uniforms.uColor.value as Color)
      .setRGB(palette.base.r, palette.base.g, palette.base.b)
      .multiplyScalar(config('star.impostorIntensity'))
  }

  public updateObject(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)

    this.lookAt(cameraPosition)

    // Позиция мировая, а не локальная: билборд висит в нуле родительского узла,
    // и по локальной мерилось бы расстояние до начала сцены. Ту же величину
    // меряет LOD.update, выбирая между диском и билбордом
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)
    const viewportHeight: number = this.renderer.domElement.height
    // Мировой размер, дающий STAR_IMPOSTOR_PIXELS пикселей на этом расстоянии:
    // доля кадра по высоте, пропорциональная доле пикселей по высоте
    const worldSize: number = (STAR_IMPOSTOR_PIXELS / viewportHeight) * frameHeightAt(distance, ctx.camera.fov)

    this.scale.setScalar(worldSize)
  }
}

export { FakeStar }

import type { Texture, WebGLRenderer } from 'three'
import { applyTextureParameters } from '@/core/textures/applyTextureParameters'
import { PlaceholderTexture } from '@/core/textures/PlaceholderTexture'
import { CubeStrategy } from '@/core/textures/strategies/CubeStrategy'
import { ImageBitmapStrategy } from '@/core/textures/strategies/ImageBitmapStrategy'
import type { LoadResult, TextureLoadStrategy, TextureRequest } from '@/core/textures/types'

/** Число граней кубической карты — запрос такой формы заглушке не подлежит. */
const CUBE_FACE_COUNT: number = 6

/**
 * Единая точка загрузки текстур.
 *
 * Выбирает стратегию по форме запроса и расширению файла, применяет параметры
 * three в одном месте и заливает результат в GPU. Ничего не регистрирует в
 * `resourceStorage`: размещение и время жизни — дело вызывающего. Это
 * принципиально для стримера, который должен единолично решать, что лежит
 * в VRAM.
 *
 * Заливка выполняется сразу, а не лениво на первом кадре: прежний путь
 * стриминга её не делал, из-за чего рывок приходился ровно на подлёт.
 */
class TextureProvider {
  private readonly strategies: TextureLoadStrategy[]

  public constructor(
    private readonly renderer: WebGLRenderer,
    strategies?: TextureLoadStrategy[]
  ) {
    this.strategies = strategies ?? [CubeStrategy.create(), ImageBitmapStrategy.create()]
  }

  public async load(request: TextureRequest): Promise<LoadResult> {
    const strategy: TextureLoadStrategy | undefined = this.strategies.find((s: TextureLoadStrategy): boolean =>
      s.supports(request)
    )

    // Отсутствие стратегии — ошибка конфигурации, а не сбой загрузки: маскируй
    // мы её заглушкой, опечатка в расширении молча превращалась бы в серый
    // квадрат. Бросаем наружу.
    if (!strategy) {
      throw new Error(
        `TextureProvider: нет стратегии для ${request.name} (${request.resourceType}, ${request.paths.length} пут.)`
      )
    }

    try {
      const texture: Texture = await strategy.load(request)

      applyTextureParameters(texture, request, this.renderer)
      this.renderer.initTexture(texture)

      return { ok: true, texture }
    } catch (cause) {
      const error: Error = cause instanceof Error ? cause : new Error(String(cause))

      // Кубмапе заглушки нет: подменить CubeTexture обычной текстурой нечем,
      // а вызывающий и так терпит отсутствие фона.
      if (request.paths.length === CUBE_FACE_COUNT) return { ok: false, texture: null, error }

      // Заглушка отдаётся КАК ЕСТЬ: ни параметров, ни initTexture. Она
      // разделяемая, и переименование под каждый промах ломало бы поиск по
      // имени в реестре.
      return { ok: false, texture: PlaceholderTexture.get(), error }
    }
  }
}

export { TextureProvider }

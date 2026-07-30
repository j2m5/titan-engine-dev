import { describe, it, expect, vi, afterEach } from 'vitest'
import { Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { TextureRequest, LoadResult } from '@/core/textures/types'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/**
 * Закрывает структурный пробел раунда ревью: у Task 5 не было ни одного
 * теста, гоняющего `closestChange`/`collectCandidates`/бюджетное ранжирование
 * end-to-end — только `evictActor` напрямую (`ResourceObserverStreaming.spec.ts`).
 * Пробник ревьюера нашёл три дефекта именно здесь за минуты.
 *
 * Тела — настоящие акторы движка (Mercury/Ceres/Korriban I/Korriban II), а не
 * фикстуры: `collectCandidates` ходит в реальный `Actor`/`Resource` через ORM,
 * подменить эти вызовы нечем без искажения самого проверяемого механизма.
 * `distance`/`position` в `SceneObserver.data` подконтрольны тесту напрямую.
 */

const SIZE_8K: number = textureBytes(8192, 4096)

function record(name: string, distance: number): ObservableRecord {
  return { name, distance, position: new Vector3() }
}

function makeTexture(): Texture {
  const texture: Texture = new Texture()
  texture.image = { width: 2048, height: 1024 }
  return texture
}

function makeObserver(
  budgetBytes: number,
  load: TextureProvider['load']
): { observer: ResourceObserver; handlers: Record<string, (event: ObservableRecord) => Promise<void>>; data: Map<string, ObservableRecord> } {
  const handlers: Record<string, (event: ObservableRecord) => Promise<void>> = {}
  const data: Map<string, ObservableRecord> = new Map()

  const sceneObserver = {
    subscribe: vi.fn((event: string, handler: (e: ObservableRecord) => Promise<void>): void => {
      handlers[event] = handler
    }),
    data
  } as unknown as SceneObserver

  const textures = { load } as unknown as TextureProvider

  const observer = new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene(),
    new TextureBudget(budgetBytes)
  )

  return { observer, handlers, data }
}

describe('ResourceObserver: closestChange end-to-end', () => {
  afterEach(() => {
    resourceStorage.deleteAllTextures()
  })

  it('провалившийся актор не ретраится немедленно, пока остаётся приоритетным (Critical 2)', async () => {
    // Все пути Меркурия проваливаются — актор целиком уходит в attempted.
    const load = vi.fn(
      (): Promise<LoadResult> => Promise.resolve({ ok: false as const, texture: null, error: new Error('сеть недоступна') })
    )

    const { handlers, data } = makeObserver(SIZE_8K * 8, load)

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1: провал, актор уходит в attempted.
    await handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(2) // диффуз + bump

    // Цикл 2: Меркурий по-прежнему на первом месте по приоритету (та же
    // дистанция) — значит decision.wanted всё ещё содержит его, и attempted
    // не должен сняться.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Цикл 3: если attempted снялся раньше времени (старое поведение —
    // wanted считался из decision.load, где исключённый никогда не
    // появляется, и снятие блокировки происходило уже на цикле 2), актор
    // ретраится здесь — новые вызовы load. Если фикс на месте, вызовов
    // по-прежнему ровно два.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('крупное дальнее тело обходит мелкое ближнее и грузится первым', async () => {
    const order: string[] = []
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      order.push(request.name)
      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { handlers, data } = makeObserver(SIZE_8K * 8, load)

    // Меркурий (радиус 2440 км) втрое дальше Цереры (469.7 км), но угловой
    // размер всё равно больше: 2440/300 ≈ 8.13 против 469.7/100 ≈ 4.70.
    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    // decision.load сохраняет убывающий порядок приоритета (см.
    // decideStreaming.spec.ts) — Меркурий первым запускает свою загрузку.
    expect(order[0]).toBe('planets/mercury/mercury.jpg')
    expect(order).toContain('planets/ceres/ceres.jpg')
  })

  it('бюджет впритык одному телу — грузится только приоритетное', async () => {
    const load = vi.fn((): Promise<LoadResult> => Promise.resolve({ ok: true as const, texture: makeTexture() }))

    // Оба тела ещё ни разу не грузились — decideStreaming использует
    // завышенную оценку ~8K на путь, а не реальный вес мок-текстуры. Бюджет
    // ровно на два пути (диффуз+bump) одного актора.
    const { handlers, data } = makeObserver(SIZE_8K * 2, load)

    data.set('Mercury', record('Mercury', 300))
    data.set('Ceres', record('Ceres', 100))

    await handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/mercury/mercury.jpg' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/ceres/ceres.jpg' }))
  })

  it('второй пересчёт, пока актор ещё грузится, не переспрашивает и не вытесняет его', async () => {
    // Мутируемый объект-обёртка вместо голого `let`: иначе TS сужает тип
    // резолвера по видимому потоку управления, теряя его после промежуточных
    // await и объявляя вызов недостижимым (`never`) — резолвер-то на самом
    // деле присваивается асинхронно, из колбэка исполнителя промиса.
    const hold: { resolve: ((result: LoadResult) => void) | null } = { resolve: null }
    let callIndex: number = 0

    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      // Только первый вызов (диффуз Меркурия) держится открытым — он и создаёт
      // окно "в полёте", которое проверяет тест. Остальные (bump) резолвятся
      // сразу, чтобы загрузка после resolve могла нормально завершиться.
      if (callIndex === 1) {
        return new Promise<LoadResult>((resolve: (result: LoadResult) => void): void => {
          hold.resolve = resolve
        })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))

    expect(load).toHaveBeenCalledTimes(1)

    // Второй пересчёт с той же дистанцией — Меркурий уже loaded И inFlight.
    await handlers['ClosestChange'](record('Mercury', 300))

    // Не переспросили (тот же единственный вызов) и не вытеснили.
    expect(load).toHaveBeenCalledTimes(1)
    expect(evictSpy).not.toHaveBeenCalled()

    hold.resolve?.({ ok: true, texture: makeTexture() })
    await first
  })

  it('два актора, разделяющие путь, грузят его один раз — путь переживает вытеснение одного из них', async () => {
    // Реестр ищет текстуру по `texture.name`; в проде его проставляет
    // `applyTextureParameters` (см. src/core/textures/applyTextureParameters.ts),
    // мок делает это вручную — иначе resourceStorage.getTexture(path) не
    // нашёл бы то, что якобы уже загружено.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)

    // Korriban I и II (реальные акторы 93 и 94) делят ОБА streamable-пути —
    // диффуз и bump — один и тот же файл на семь планет Korriban I–VII.
    data.set('Korriban I', record('Korriban I', 100))
    await handlers['ClosestChange'](record('Korriban I', 100))

    expect(load).toHaveBeenCalledTimes(2) // диффуз + bump
    expect(resourceStorage.getTexture('planets/StarWars/korriban/i/i.jpg')).toBeDefined()
    expect(resourceStorage.getTexture('planets/StarWars/korriban/i/i_bump.jpg')).toBeDefined()

    // Korriban II входит в зону, Korriban I остаётся резидентным. Оба пути
    // уже в реестре — повторного сетевого запроса быть не должно.
    data.set('Korriban II', record('Korriban II', 120))
    await handlers['ClosestChange'](record('Korriban II', 120))

    expect(load).toHaveBeenCalledTimes(2)

    // Прямое вытеснение Korriban I — ровно то, что сделал бы decideStreaming,
    // выбери он его на вытеснение. Пути принадлежат резиденции по данным.
    observer.evictActor({
      actorId: 93,
      name: 'Korriban I',
      priority: 0,
      paths: ['planets/StarWars/korriban/i/i.jpg', 'planets/StarWars/korriban/i/i_bump.jpg']
    })

    // Путь пережил вытеснение первого владельца — Korriban II всё ещё на него
    // ссылается.
    expect(resourceStorage.getTexture('planets/StarWars/korriban/i/i.jpg')).toBeDefined()
    expect(resourceStorage.getTexture('planets/StarWars/korriban/i/i_bump.jpg')).toBeDefined()
  })

  it('два актора, разделяющие путь, В ОДНОМ цикле грузят его один раз — не задваивают ни сеть, ни реестр', async () => {
    // round 2 ревью, Important: если оба candidate попадают в decision.load
    // ОДНОГО пересчёта, Promise.all запускает их loadActor конкурентно, и
    // оба успевают проверить реестр ДО того, как первый там что-то
    // зарегистрирует — реестр сам по себе от этой гонки не спасает.
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = makeTexture()
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { handlers, data } = makeObserver(SIZE_8K * 8, load)

    // Оба актора — candidates уже в ПЕРВОМ пересчёте, ни один ещё не
    // загружен: decision.load отдаёт их ОБОИХ разом.
    data.set('Korriban I', record('Korriban I', 100))
    data.set('Korriban II', record('Korriban II', 120))

    await handlers['ClosestChange'](record('Korriban I', 100))

    // Диффуз + bump — ровно два сетевых запроса, а не четыре (по два на
    // каждого из двух акторов, разделяющих оба пути).
    expect(load).toHaveBeenCalledTimes(2)

    // И ровно одна запись в реестре на путь, а не две — иначе вторая
    // Texture осталась бы в реестре недиспоузнутой и недостижимой.
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i.jpg').count()).toBe(1)
    expect(resourceStorage.textures.where('name', 'planets/StarWars/korriban/i/i_bump.jpg').count()).toBe(1)
  })

  it('устаревший резолв после смены сценария не трогает живую загрузку того же актора (Critical, round 2)', async () => {
    // round 2 ревью, Critical: удаления loaded/actorPaths и снятие inFlight,
    // ключуемые только по actorId, без сверки эпохи, разбирали учёт СВЕЖЕЙ
    // загрузки того же актора, начатой уже после смены сценария. Ре-ревьюер
    // воспроизвёл это на реальном сценарии: устаревший резолв Korriban II
    // снимал пометки живой загрузки того же актора, и последующее
    // вытеснение освобождало разделяемый диффуз, который Korriban I ещё
    // показывал (Critical 1 назад).
    // Держим открытыми только первые два вызова (диффуз "устаревшего" и
    // диффуз "живого" актора) — Меркурий это единственное, что нужно
    // проверить; остальные (bump с обеих сторон) резолвятся сразу, чтобы обе
    // загрузки могли нормально завершиться после того, как держащиеся пути
    // будут отпущены явно.
    const resolvers: Array<(result: LoadResult) => void> = []
    let callIndex: number = 0
    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex <= 2) {
        return new Promise<LoadResult>((resolve) => resolvers.push(resolve))
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 8, load)
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    // Цикл 1 (эпоха E1): Меркурий начинает грузиться, первый путь (диффуз)
    // держится открытым — это и есть "устаревший" вызов.
    const stale: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(1)

    // Сценарий сменился, пока путь ещё грузился — epoch увеличился, весь
    // учёт стриминга (loaded/loadedAt/inFlight/attempted/actorPaths) сброшен.
    observer.scenario = null

    // Цикл 2 (эпоха E2): Меркурий снова кандидат (тот же actorId) — живая,
    // свежая загрузка. Её первый путь тоже держится открытым.
    const live: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(resolvers).toHaveLength(2)

    // Резолвим УСТАРЕВШИЙ (первый) вызов — именно та гонка, которую нашёл
    // ре-ревьюер.
    resolvers[0]({ ok: true, texture: makeTexture() })
    await stale

    // Третий пересчёт, пока живая загрузка (цикл 2) всё ещё висит на своём
    // await: если её пометки не снесены устаревшим резолвом, актор всё ещё
    // inFlight/loaded — не должно быть ни повторного запроса, ни вытеснения.
    await handlers['ClosestChange'](record('Mercury', 300))

    expect(resolvers).toHaveLength(2) // не выросло — переспроса не было
    expect(evictSpy).not.toHaveBeenCalled()

    // Достраиваем живую загрузку, чтобы не оставить висящий промис.
    resolvers[1]({ ok: true, texture: makeTexture() })
    await live
  })

  it('inFlight защищает актор от вытеснения, пока он грузится впервые, даже если приоритет упал', async () => {
    // Решение по находке «vacuous test» round 2: inFlight — НЕ избыточный
    // термин. Пока актор грузится ВПЕРВЫЕ, loadedAt для него ещё не
    // выставлен (выставляется только по успеху) — второе условие isPinned
    // тогда всегда ложно, и защищать актора может только inFlight. Проверка:
    // Меркурий начинает грузиться (inFlight, budget впритык ему одному),
    // затем появляется гораздо более приоритетное тело — Меркурий выпадает
    // из reserved, но всё ещё должен быть защищён, пока не завершил свою
    // ПЕРВУЮ загрузку.
    const hold: { resolve: ((result: LoadResult) => void) | null } = { resolve: null }
    let callIndex: number = 0

    const load = vi.fn((): Promise<LoadResult> => {
      callIndex += 1

      if (callIndex === 1) {
        return new Promise<LoadResult>((resolve) => {
          hold.resolve = resolve
        })
      }

      return Promise.resolve({ ok: true as const, texture: makeTexture() })
    })

    // Бюджет ровно на одного актора (два пути по 8K-оценке).
    const { observer, handlers, data } = makeObserver(SIZE_8K * 2, load)
    const evictSpy = vi.spyOn(observer, 'evictActor')

    data.set('Mercury', record('Mercury', 300))

    const first: Promise<void> = handlers['ClosestChange'](record('Mercury', 300))
    expect(load).toHaveBeenCalledTimes(1) // held — Меркурий inFlight, ещё ни разу не succeeded

    // Луна (радиус 1735.97 км) совсем рядом — приоритет ~173.6, намного выше
    // меркуриевых ~8.13. Бюджет впритык теперь достаётся ей, Меркурий
    // выпадает из reserved. Но он ещё грузится ВПЕРВЫЕ — loadedAt не
    // выставлен, только inFlight его защищает.
    data.set('Moon', record('Moon', 10))
    await handlers['ClosestChange'](record('Moon', 10))

    expect(evictSpy).not.toHaveBeenCalled()

    hold.resolve?.({ ok: true, texture: makeTexture() })
    await first
  })
})

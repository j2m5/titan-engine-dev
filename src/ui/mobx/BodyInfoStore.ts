import { makeAutoObservable, observable, runInAction } from 'mobx'
import type { Actor } from '@/core/models/Actor'
import { describeBody } from '@/core/bodyInfo/describeBody'
import type { BodyLive, BodyReference } from '@/core/bodyInfo/types'
import type { BodyInfoService } from '@/core/bodyInfo/BodyInfoService'

/**
 * Состояние карточки объекта. Справка считается один раз при открытии, живые
 * величины — опросом сервиса раз в POLL_MS и только пока карточка открыта:
 * закрытая карточка не стоит кадру ничего.
 */
class BodyInfoStore {
  /** Период опроса живых величин, мс */
  public static readonly POLL_MS: number = 250

  public actor: Actor | null = null
  public reference: BodyReference | null = null
  public live: BodyLive | null = null

  private service: Pick<BodyInfoService, 'measure'> | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  public constructor() {
    makeAutoObservable<BodyInfoStore, 'service' | 'timer' | 'sample'>(this, {
      actor: observable.ref,
      reference: observable.ref,
      live: observable.ref,
      service: false,
      timer: false,
      sample: false
    })
  }

  /** Подключение к сервису ядра (UiServiceProvider.boot) */
  public connect(service: Pick<BodyInfoService, 'measure'>): void {
    this.service = service
  }

  public isOpen(actor: Actor): boolean {
    return this.actor !== null && this.actor.getAttribute('id') === actor.getAttribute('id')
  }

  /** Кнопка ⓘ: открыть, на открытом теле — закрыть, на другом — заменить */
  public toggle(actor: Actor): void {
    if (this.isOpen(actor)) {
      this.close()

      return
    }

    this.open(actor)
  }

  public open(actor: Actor): void {
    this.actor = actor
    this.reference = describeBody(actor)
    this.sample()
    // Замена тела не заводит второй таймер: опрос читает текущий actor
    this.timer ??= setInterval(this.sample, BodyInfoStore.POLL_MS)
  }

  public close(): void {
    if (this.timer !== null) clearInterval(this.timer)

    this.timer = null
    this.actor = null
    this.reference = null
    this.live = null
  }

  private sample = (): void => {
    const live: BodyLive | null = this.actor && this.service ? this.service.measure(this.actor) : null

    runInAction((): void => {
      this.live = live
    })
  }
}

export { BodyInfoStore }
export const bodyInfoStore: BodyInfoStore = new BodyInfoStore()

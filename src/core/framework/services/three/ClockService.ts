import { injectable } from 'inversify'
import { Clock } from 'three'
import { config } from '@/core/framework/config'

@injectable()
class ClockService {
  public clock: Clock

  public constructor() {
    this.clock = new Clock()
    this.clock.startTime = config('clock.startTime')
  }
}

export { ClockService }

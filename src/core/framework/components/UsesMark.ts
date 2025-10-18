import { MarkerShape } from '@/core/services/MarkerManager'

class UsesMark {
  public shape: MarkerShape

  public constructor(shape: MarkerShape) {
    this.shape = shape
  }
}

export { UsesMark }

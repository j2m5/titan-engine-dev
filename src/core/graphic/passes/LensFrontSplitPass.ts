import type { WebGLRenderer, WebGLRenderTarget } from 'three'
import { Pass } from 'postprocessing'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'

/**
 * Разметка «прозрачное перед линзой» — первым в композере, до RenderPass:
 * основной проход уже не видит перенесённое на LENS_FRONT_LAYER. Отдельный
 * пасс, а не вызов в Postprocessing.render: разметку получает и скриншот,
 * идущий через тот же композер. Ничего не рисует
 */
export class LensFrontSplitPass extends Pass {
  public constructor(private readonly sorter: LensFrontSorter) {
    super('LensFrontSplitPass')
    this.needsSwap = false
  }

  public override render(
    _renderer?: WebGLRenderer,
    _inputBuffer?: WebGLRenderTarget | null,
    _outputBuffer?: WebGLRenderTarget | null
  ): void {
    this.sorter.split()
  }
}

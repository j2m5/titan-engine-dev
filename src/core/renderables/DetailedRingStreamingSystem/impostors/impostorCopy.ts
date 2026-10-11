import { type Box2, type Texture, type Vector2, type Vector3, type WebGLRenderer } from 'three'

/** r182 не пересоздаёт внутренние FBO copyTextureToTexture после contextrestored. */
export class ImpostorTextureCopy {
  private read: WebGLFramebuffer | null
  private write: WebGLFramebuffer | null

  constructor(private readonly renderer: WebGLRenderer) {
    const gl = renderer.getContext()
    this.read = gl.createFramebuffer()
    this.write = gl.createFramebuffer()
    if (!this.read || !this.write) { this.dispose(); throw new Error('Не удалось создать framebuffer копирования') }
  }

  copy(source: Texture, destination: Texture, region: Box2 | null, position: Vector2 | Vector3, sourceMip: number, destinationMip: number): void {
    const r = this.renderer, gl = r.getContext() as WebGL2RenderingContext
    if (gl.isContextLost() || !this.read || !this.write) throw new Error('Контекст копирования недоступен')
    const src = (r.properties.get(source) as { __webglTexture?: WebGLTexture }).__webglTexture
    const dst = (r.properties.get(destination) as { __webglTexture?: WebGLTexture }).__webglTexture
    if (!src || !dst) throw new Error('Текстура копирования не выделена')
    const image = source.image as { width: number; height: number }
    const x = region?.min.x ?? 0, y = region?.min.y ?? 0
    const w = region ? region.max.x - x : Math.max(1, image.width >> sourceMip)
    const h = region ? region.max.y - y : Math.max(1, image.height >> sourceMip)
    try {
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, this.read)
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, sourceMip)
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.write)
      if ('isDataArrayTexture' in destination) gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, dst, destinationMip, 'z' in position ? position.z : 0)
      else gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, destinationMip)
      gl.blitFramebuffer(x, y, x + w, y + h, position.x, position.y, position.x + w, position.y + h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    } finally {
      if (!gl.isContextLost()) {
        r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
        r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      }
    }
  }

  invalidateGpu(): void { this.read = this.write = null }

  dispose(): void {
    const gl = this.renderer.getContext()
    if (!gl.isContextLost()) {
      if (this.read) gl.deleteFramebuffer(this.read)
      if (this.write) gl.deleteFramebuffer(this.write)
    }
    this.invalidateGpu()
  }
}

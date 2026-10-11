import { Box2, BufferGeometry, DataArrayTexture, Texture, Vector2, Vector3, type WebGLRenderer } from 'three'
import { forgetImpostorContext, rememberImpostorContext } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorContext'
import { ImpostorTextureCopy } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorCopy'

describe('Ресурсы поколения WebGL', () => {
  it('убирает старую renderer-подписку, сохраняя владельца и подписку нового контекста', () => {
    const geometry = new BufferGeometry(), oldDelete = vi.fn(), newDelete = vi.fn(), owner = vi.fn()
    geometry.addEventListener('dispose', owner)
    rememberImpostorContext(geometry)
    geometry.addEventListener('dispose', function a() { oldDelete() })
    forgetImpostorContext(geometry)
    geometry.addEventListener('dispose', function b() { newDelete() })
    geometry.dispose()
    expect(oldDelete).not.toHaveBeenCalled()
    expect(newDelete).toHaveBeenCalledTimes(1)
    expect(owner).toHaveBeenCalledTimes(1)
  })

  it('копирует прямоугольник в нужный слой/mip собственными FBO и не удаляет утраченное поколение', () => {
    const gl = {
      READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, COLOR_ATTACHMENT0: 3, TEXTURE_2D: 4, COLOR_BUFFER_BIT: 5, NEAREST: 6,
      createFramebuffer: vi.fn(() => ({})), deleteFramebuffer: vi.fn(), isContextLost: () => false,
      framebufferTexture2D: vi.fn(), framebufferTextureLayer: vi.fn(), blitFramebuffer: vi.fn()
    }
    const handles = new Map<object, object>(), bindFramebuffer = vi.fn()
    const renderer = { getContext: () => gl, state: { bindFramebuffer }, properties: { get: (object: object) => ({ __webglTexture: handles.get(object) }) } } as unknown as WebGLRenderer
    const src = new Texture(), dst = new DataArrayTexture(), srcHandle = {}, dstHandle = {}
    handles.set(src, srcHandle); handles.set(dst, dstHandle)
    const copier = new ImpostorTextureCopy(renderer)
    copier.copy(src, dst, new Box2(new Vector2(2, 3), new Vector2(10, 9)), new Vector3(12, 4, 7), 1, 2)
    expect(gl.framebufferTexture2D).toHaveBeenCalledWith(1, 3, 4, srcHandle, 1)
    expect(gl.framebufferTextureLayer).toHaveBeenCalledWith(2, 3, dstHandle, 2, 7)
    expect(gl.blitFramebuffer).toHaveBeenCalledWith(2, 3, 10, 9, 12, 4, 20, 10, 5, 6)
    expect(bindFramebuffer.mock.calls.slice(-2)).toEqual([[1, null], [2, null]])
    copier.invalidateGpu(); copier.dispose()
    expect(gl.deleteFramebuffer).not.toHaveBeenCalled()
    const restored = new ImpostorTextureCopy(renderer)
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(4)
    restored.dispose(); restored.dispose()
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2)
  })
})

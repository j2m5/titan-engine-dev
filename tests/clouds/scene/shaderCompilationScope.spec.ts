import { describe, it, expect } from 'vitest'
import type { WebGLRenderer } from 'three'
import { captureShaderCompilation } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'
import { appendProgramCacheKey } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'
import { ShaderMaterial } from 'three'

describe('deferred shader compilation errors', () => {
  it('preserves existing adapter keys and normal first-attempt cache sharing', () => {
    const material = new ShaderMaterial()
    material.customProgramCacheKey = () => 'existing-adapter-key'
    const original = material.customProgramCacheKey
    appendProgramCacheKey(material, undefined)
    expect(material.customProgramCacheKey).toBe(original)
    appendProgramCacheKey(material, 'retry-2')
    expect(material.customProgramCacheKey()).toBe('existing-adapter-key;retry-2')
    material.dispose()
  })
  it('defers compiler and previous-handler exceptions until the caller has returned from render', () => {
    const previous = () => {
      throw Error('previous handler failure')
    }
    const renderer = { debug: { onShaderError: previous, checkShaderErrors: false } } as unknown as WebGLRenderer
    const scope = captureShaderCompilation(renderer, 'fixture')
    const gl = {
      getProgramInfoLog: () => 'bad link',
      getShaderInfoLog: () => 'bad shader'
    } as unknown as WebGL2RenderingContext
    expect(renderer.debug.checkShaderErrors).toBe(true)
    type Program = Parameters<NonNullable<WebGLRenderer['debug']['onShaderError']>>[1]
    expect(() => renderer.debug.onShaderError!(gl, {} as Program, {} as WebGLShader, {} as WebGLShader)).not.toThrow()
    expect(scope.failed).toBe(true)
    expect(() => scope.check()).toThrow(/fixture shader compilation failed.*previous handler failure/)
    scope.restore()
    scope.restore()
    expect(renderer.debug.onShaderError).toBe(previous)
    expect(renderer.debug.checkShaderErrors).toBe(false)
  })
})

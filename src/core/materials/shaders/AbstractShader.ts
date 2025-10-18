import { IUniform } from 'three'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

export type ShaderProps = {
  name?: string
  defines?: Record<string, any>
  uniforms: Record<string, IUniform>
  vertexShader: string
  fragmentShader: string
}

export interface ShaderConstructor<T extends AbstractShader> {
  new (shader: ShaderProps): T
}

abstract class AbstractShader<TUniformKey extends string = string, TDefineKey extends string = string> {
  private _uniforms: Record<TUniformKey, IUniform>
  private _defines: Record<TDefineKey, any>
  private _vertexShader: string
  private _fragmentShader: string
  private _name: string

  protected constructor(shader: ShaderProps) {
    this._uniforms = shader.uniforms
    this._defines = shader.defines || {}
    this._vertexShader = shader.vertexShader
    this._fragmentShader = shader.fragmentShader
    this._name = shader.name || 'Unnamed shader'

    this.prepareForCompilation()
  }

  public get uniforms(): Record<TUniformKey, IUniform> {
    return this._uniforms
  }

  public set uniforms(uniforms: Record<TUniformKey, IUniform>) {
    this._uniforms = uniforms
  }

  public get defines(): Record<TDefineKey, any> {
    return this._defines
  }

  public set defines(defines: Record<TDefineKey, any>) {
    this._defines = defines
  }

  public get vertexShader(): string {
    return this._vertexShader
  }

  private set vertexShader(vertexShader: string) {
    this._vertexShader = vertexShader
  }

  public get fragmentShader(): string {
    return this._fragmentShader
  }

  private set fragmentShader(fragmentShader: string) {
    this._fragmentShader = fragmentShader
  }

  public get name(): string {
    return this._name
  }

  public set name(name: string) {
    this._name = name
  }

  public toJSON(): ShaderProps {
    return {
      uniforms: { ...this.uniforms },
      defines: { ...this.defines },
      vertexShader: this.vertexShader,
      fragmentShader: this.fragmentShader,
      name: this.name
    }
  }

  protected prepareForCompilation(): void {
    const replaceIncludes = (shader: string): string => {
      return shader.replace(/#include <(\w+)>/g, (match: string, chunkName: any) => {
        return AppShaderChunk[chunkName] || ''
      })
    }

    this.vertexShader = replaceIncludes(this.vertexShader)
    this.fragmentShader = replaceIncludes(this.fragmentShader)
  }

  public static clone<T extends AbstractShader>(this: ShaderConstructor<T>, shader: ShaderProps): T {
    return new this(shader)
  }
}

export { AbstractShader }

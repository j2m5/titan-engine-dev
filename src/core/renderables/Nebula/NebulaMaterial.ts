import { AdditiveBlending, BackSide, Camera, Matrix4, Object3D, Texture, Vector3 } from 'three'
import { ShaderMaterialParameters } from 'three/src/materials/ShaderMaterial'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { NebulaShader } from '@/core/renderables/Nebula/NebulaShader'
import { NebulaParameters } from '@/core/renderables/Nebula/NebulaParameters'

class NebulaMaterial extends AbstractShaderMaterial {
  private static readonly _invModel = new Matrix4()
  private static readonly _cameraLocal = new Vector3()

  public constructor(parameters: NebulaParameters, materialParameters?: ShaderMaterialParameters) {
    super(materialParameters)

    const { uniforms, vertexShader, fragmentShader, defines } = new NebulaShader(parameters)

    this.uniforms = uniforms
    this.vertexShader = vertexShader
    this.fragmentShader = fragmentShader
    this.defines = defines

    this.transparent = true
    this.depthWrite = false
    this.blending = AdditiveBlending
    this.side = BackSide
  }

  public setCloudTexture(tex: Texture | null): void {
    this.uniforms.uCloudTex.value = tex
  }

  public update(mesh: Object3D, camera: Camera): void {
    // mesh.matrixWorld обновляется движком до рендера; инвертируем в мир→локаль
    NebulaMaterial._invModel.copy(mesh.matrixWorld).invert()

    // позиция камеры в мире → в локаль куба
    NebulaMaterial._cameraLocal.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(NebulaMaterial._invModel)

    this.uniforms.uCameraLocal.value.copy(NebulaMaterial._cameraLocal)
  }

  public updateMaterial(): void {}

  public resetMaterial(): void {}
}

export { NebulaMaterial }

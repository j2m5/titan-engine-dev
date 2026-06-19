import { IUniform, Texture, Uniform, Vector2 } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'

class NebulaUpscaleShader extends AbstractShader {
  public constructor(nebulaTexture: Texture | null, resolution: Vector2) {
    const uniforms: Record<string, IUniform> = {
      // half-res результат марша (заполняется Nebula каждый кадр)
      uNebulaTex: new Uniform<Texture | null>(nebulaTexture),
      // полное разрешение основного буфера (для пересчёта экранных UV)
      uResolution: new Uniform<Vector2>(resolution.clone())
    }

    const vertexShader = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <logdepthbuf_vertex>
      }
    `

    const fragmentShader = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>

      uniform sampler2D uNebulaTex;
      uniform vec2 uResolution;

      void main() {
        #include <logdepthbuf_fragment>

        // экранные UV из позиции фрагмента → прямая индексация half-RT,
        // т.к. half-RT рендерился той же проекцией камеры
        vec2 uv = gl_FragCoord.xy / uResolution;

        vec4 nebula = texture2D(uNebulaTex, uv);

        // half-RT уже содержит финальный цвет и альфу марша
        // (premultiplied — см. марш-шейдер: gl_FragColor = vec4(color, alpha))
        if (nebula.a < 0.001) discard;

        gl_FragColor = nebula;
      }
    `

    super({
      name: 'NebulaUpscaleShader',
      uniforms,
      vertexShader,
      fragmentShader
    })
  }
}

export { NebulaUpscaleShader }

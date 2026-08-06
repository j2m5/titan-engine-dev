import { ShaderProps } from '@/core/materials/shaders/AbstractShader'
import { Color, ShaderChunk, Uniform } from 'three'

/**
 * Билборд дальней звезды (LOD-уровень 2, см. FakeStar): плоский HDR-цвет,
 * форму даёт ТОЛЬКО альфа-канал текстуры.
 *
 * Ровно так вёл себя и прежний MeshStandardMaterial в сцене без источников
 * света three: его диффуз был чёрным, map в emissive не входит, и от текстуры
 * работала одна альфа через бленд-фактор SrcAlpha. RGB текстуры не читается
 * и здесь — намеренно, чтобы замена материала не сдвинула вид.
 *
 * Logdepthbuf-чанки обязательны: рендерер работает с логарифмической
 * глубиной (three.renderer.logarithmicDepthBuffer), без них depthTest
 * билборда разъезжается с глубиной остальной сцены (прецедент —
 * BlackHoleImpostorShaderTemplate). Standard-материал нёс эти чанки сам.
 */
export const FakeStarShaderTemplate: ShaderProps = {
  uniforms: {
    map: new Uniform(null),
    uColor: new Uniform(new Color())
  },
  vertexShader: `
    varying vec2 vUv;

    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_vertex']}

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      ${ShaderChunk['logdepthbuf_vertex']}
    }
  `,
  fragmentShader: `
    ${ShaderChunk['common']}
    ${ShaderChunk['logdepthbuf_pars_fragment']}

    uniform sampler2D map;
    uniform vec3 uColor;

    varying vec2 vUv;

    void main() {
      ${ShaderChunk['logdepthbuf_fragment']}
      gl_FragColor = vec4(uColor, texture2D(map, vUv).a);
    }
  `
}

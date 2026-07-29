import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, NormalBlending, ShaderMaterial, UniformsUtils, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { StarOuterLayerShaderTemplate } from '@/core/materials/shaders/lib/StarOuterLayerShaderTemplate'
import { UpdateContext } from '@/core/UpdateContext'
import { buildStarPalette, StarPalette } from '@/core/materials/shaders/lib/helpers'

class StarOuterLayer extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  private readonly radius: number
  private lineCount: number = 2048
  private lineLength: number = 16

  public constructor(model: Actor) {
    super()
    this.model = model

    this.radius = toThreeJSUnits(this.model.physicalObject?.getAttribute('radius') ?? 0)

    this.__setup()
  }

  __setup(): void {
    const aPos = new Float32Array(this.lineCount * this.lineLength * 2 * 3)
    const aPos0 = new Float32Array(this.lineCount * this.lineLength * 2 * 3)
    const aPos1 = new Float32Array(this.lineCount * this.lineLength * 2 * 3)
    const aWireRand = new Float32Array(this.lineCount * this.lineLength * 2 * 4)
    const indices = new Uint16Array(this.lineCount * (this.lineLength - 1) * 2 * 3)

    const d = new Vector3()
    const held = new Vector3()
    const f = new Vector3()
    const p = new Vector3()
    const g = new Vector3()

    let s = 0,
      l = 0,
      c = 0,
      h = 0,
      u = 0

    f.set(Math.random(), Math.random(), Math.random()).normalize()
    let m = Math.random(),
      _p = Math.random()

    for (let y = 0; y < this.lineCount; y++) {
      if (Math.random() < 0.025 || y === 0) {
        d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
        held.copy(d)
        g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
          .normalize()
          .multiplyScalar(0.4)
        held.add(g).normalize()
        m = Math.random()
        _p = Math.random()
      }

      f.copy(d)
      g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(0.02)
      f.add(g).normalize()

      p.copy(held)
      g.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(0.075)
      p.add(g).normalize()

      const rands = [m, _p, Math.random(), Math.random()]

      for (let E = 0; E < this.lineLength; E++) {
        const base = 2 * (y * this.lineLength + E)
        for (let A = 0; A <= 1; A++) {
          aPos[s++] = (E + 0.5) / this.lineLength
          aPos[s++] = (y + 0.5) / this.lineCount
          aPos[s++] = 2 * A - 1

          for (let R = 0; R < 4; R++) aWireRand[l++] = rands[R]

          aPos0[c++] = f.x
          aPos0[c++] = f.y
          aPos0[c++] = f.z
          aPos1[h++] = p.x
          aPos1[h++] = p.y
          aPos1[h++] = p.z
        }

        if (E < this.lineLength - 1) {
          indices[u++] = base
          indices[u++] = base + 1
          indices[u++] = base + 2
          indices[u++] = base + 2
          indices[u++] = base + 1
          indices[u++] = base + 3
        }
      }
    }

    this.geometry = new BufferGeometry()

    this.geometry.setAttribute('aPos', new BufferAttribute(aPos, 3))
    this.geometry.setAttribute('aPos0', new BufferAttribute(aPos0, 3))
    this.geometry.setAttribute('aPos1', new BufferAttribute(aPos1, 3))
    this.geometry.setAttribute('aWireRandom', new BufferAttribute(aWireRand, 4))
    this.geometry.setIndex(new BufferAttribute(indices, 1))

    // Юниформы клонируются: шаблонные объекты общие на модуль, а палитра
    // пер-звёздная (двойная система с разными температурами)
    this.material = new ShaderMaterial({
      vertexShader: StarOuterLayerShaderTemplate.vertexShader,
      fragmentShader: StarOuterLayerShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(StarOuterLayerShaderTemplate.uniforms),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending
    })

    const temperature: number = this.model.physicalObject?.getAttribute('temperature', 3000) ?? 3000
    const palette: StarPalette = buildStarPalette(temperature, 1500)
    this.material.uniforms.uColorCool.value.setRGB(palette.cool.r, palette.cool.g, palette.cool.b)
    this.material.uniforms.uColorBase.value.setRGB(palette.base.r, palette.base.g, palette.base.b)

    this.frustumCulled = false
    this.scale.multiplyScalar(this.radius)
  }

  public updateObject(ctx: UpdateContext): void {
    this.material.uniforms.uTime.value = ctx.elapsed * 0.009
  }
}

export { StarOuterLayer }

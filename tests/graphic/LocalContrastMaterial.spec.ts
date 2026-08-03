import { LocalContrastMaterial } from '@/core/graphic/effects/lensflare/LocalContrastMaterial'

describe('LocalContrastMaterial: локальный контраст', () => {
  it('вычитается симметричная окрестность по обеим осям', () => {
    // Симметрия обязательна: среднее четырёх соседей равно центру на любом
    // линейном градиенте, поэтому вычитание гасит и плато, и ровный склон.
    // Несимметричная выборка оставляла бы на градиенте серпы вместо нуля
    const material = new LocalContrastMaterial()
    const shader = material.fragmentShader

    expect(shader).toContain('texture(inputBuffer, vUv + vec2(radius.x, 0.0)).rgb')
    expect(shader).toContain('texture(inputBuffer, vUv - vec2(radius.x, 0.0)).rgb')
    expect(shader).toContain('texture(inputBuffer, vUv + vec2(0.0, radius.y)).rgb')
    expect(shader).toContain('texture(inputBuffer, vUv - vec2(0.0, radius.y)).rgb')
    expect(shader).toContain('0.25 * (')
  })

  it('результат отсекается в ноль', () => {
    const material = new LocalContrastMaterial()

    expect(material.fragmentShader).toContain(
      'max(texture(inputBuffer, vUv).rgb - wide, vec3(0.0))'
    )
  })

  it('радиус окрестности — константа шейдера, а не юниформ', () => {
    // Радиус задаёт масштаб различения «компактный пик против плато», а не
    // элемент вида: крутить его на приёмке нечего
    const material = new LocalContrastMaterial()

    expect(material.fragmentShader).toContain('#define LOCAL_CONTRAST_RADIUS 8.0')
    // Набор юниформов закрыт целиком, а не проверкой одного УГАДАННОГО имени:
    // прежнее `material.uniforms.radius` проходило бы и при юниформе с любым
    // другим названием
    expect(Object.keys(material.uniforms).sort()).toEqual(['inputBuffer', 'texelSize'])
  })

  it('texelSize берётся у сэмплируемого буфера', () => {
    const material = new LocalContrastMaterial()

    material.setSize(1024, 512)

    expect(material.uniforms.texelSize.value.x).toBeCloseTo(1 / 1024, 10)
    expect(material.uniforms.texelSize.value.y).toBeCloseTo(1 / 512, 10)
  })

  it('входной буфер читается и пишется через свойство', () => {
    const material = new LocalContrastMaterial()

    expect(material.inputBuffer).toBeNull()

    const texture = { isTexture: true } as never
    material.inputBuffer = texture

    expect(material.uniforms.inputBuffer.value).toBe(texture)
  })
})

import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'
import { CubeTexture } from 'three'
import { readFileSync } from 'fs'

describe('SkyboxBackground: собственный фоновый проход', () => {
  it('не отсекается фрустумом и рисуется раньше любой геометрии', () => {
    const background = new SkyboxBackground(new CubeTexture())

    expect(background.frustumCulled).toBe(false)
    expect(background.renderOrder).toBeLessThan(0)
  })

  it('не участвует в тесте глубины и не пишет её', () => {
    const background = new SkyboxBackground(new CubeTexture())
    const material = background.material as { depthTest: boolean; depthWrite: boolean }

    expect(material.depthTest).toBe(false)
    expect(material.depthWrite).toBe(false)
  })

  it('выборка идёт через общий чанк, своей копии нет', () => {
    const source = readFileSync('src/core/renderables/SkyboxBackground.ts', 'utf8')

    expect(source).toContain('#include <skyboxSampleFunctions>')
    expect(source).toContain('sampleSkyboxHdr(')
    expect(source).not.toContain('texture(skybox,')
  })

  it('three больше не рисует фон сам — иначе он ляжет вторым слоем', () => {
    const source = readFileSync('src/Application.ts', 'utf8')

    expect(source).not.toContain('this.scene.background = this.resourceObserver.sceneBackground')
  })
})

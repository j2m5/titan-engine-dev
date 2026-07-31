import { Engine } from '@/core/Engine'

function createEngineWithMocks() {
  const renderer = {
    domElement: document.createElement('canvas'),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    setAnimationLoop: vi.fn()
  }
  const labelRenderer = { domElement: document.createElement('div'), setSize: vi.fn() }
  const renderCamera = { aspect: 1, updateProjectionMatrix: vi.fn() }
  const postprocessing = { setSize: vi.fn() }

  const engine = new Engine(
    null as never, // sceneManager — в onResize не участвует
    null as never, // sceneObserver
    null as never, // clock
    null as never, // camera (CameraController)
    renderer as never,
    labelRenderer as never,
    null as never, // scene
    renderCamera as never,
    null as never, // astroControls
    null as never, // renderClock
    postprocessing as never
  )

  return { engine, renderer, labelRenderer, renderCamera, postprocessing }
}

describe('Engine: ресайз окна', () => {
  it('resize обновляет pixelRatio, рендереры, композер и камеру', () => {
    const { renderer, labelRenderer, renderCamera, postprocessing } = createEngineWithMocks()

    window.dispatchEvent(new Event('resize'))

    expect(renderer.setPixelRatio).toHaveBeenCalled()
    expect(renderer.setSize).toHaveBeenCalledWith(window.innerWidth, window.innerHeight)
    expect(labelRenderer.setSize).toHaveBeenCalledWith(window.innerWidth, window.innerHeight)
    expect(postprocessing.setSize).toHaveBeenCalledWith(window.innerWidth, window.innerHeight)
    expect(renderCamera.updateProjectionMatrix).toHaveBeenCalled()
  })
})

import { vi } from 'vitest'

vi.mock('@/core/graphic/ThreeJS', () => {
  // Заглушка повторяет ПУБЛИЧНУЮ форму ThreeJS: все девять полей,
  // к которым код может обратиться при импорте или в логике под тестом.
  const noop = () => {}

  const scene = {
    name: 'MainScene',
    traverse: noop,
    add: noop,
    remove: noop,
    getObjectsByUserDataProperty: () => []
  }

  const camera = {
    position: { clone: () => ({ x: 0, y: 0, z: 0 }), set: noop },
    aspect: 1,
    updateProjectionMatrix: noop,
    lookAt: noop
  }

  const domElement = {
    id: '',
    style: {},
    addEventListener: noop,
    removeEventListener: noop
  }

  const threeJS = {
    renderer: {
      domElement,
      setPixelRatio: noop,
      setSize: noop,
      setAnimationLoop: noop,
      render: noop
    },
    labelRenderer: { domElement, setSize: noop, render: noop },
    scene,
    camera,
    cameraSphere: {},
    astroControls: { update: noop, movementSpeed: 0, rollSpeed: 0, autoForward: false },
    raycaster: { setFromCamera: noop, intersectObjects: () => [] },
    clock: { getDelta: () => 0, getElapsedTime: () => 0, startTime: 0 },
    stats: { dom: { style: {} }, showPanel: noop, update: noop }
  }

  return { threeJS }
})

vi.mock('@/core/graphic/Postprocessing', () => {
  const noop = () => {}

  return {
    postprocessing: {
      initialize: noop,
      render: noop,
      dispose: noop
    }
  }
})

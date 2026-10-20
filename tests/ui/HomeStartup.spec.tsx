import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from '@/ui/App'

const { createRenderer } = vi.hoisted(() => ({ createRenderer: vi.fn(() => { throw new Error('WebGL before selection') }) }))
vi.mock('@/core/graphic/renderingFactories', () => ({ createRenderer }))

it('renders the scenario menu before creating the simulation renderer', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  document.body.append(container)
  try {
    // Import the same shell as the entry point. Importing it must stay safe
    // without WebGL, and rendering it must expose the scenario actions.
    await act(async () => root.render(<App />))
    expect(container.querySelector('[aria-label="Run Solar system"]')).not.toBeNull()
    expect(createRenderer).not.toHaveBeenCalled()
    expect(document.querySelector('canvas')).toBeNull()
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})

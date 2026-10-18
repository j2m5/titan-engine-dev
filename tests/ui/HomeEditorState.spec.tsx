import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import HomePage from '@/ui/components/layout/HomePage'
// Transform the real editor before the timed interaction test; HomePage still
// controls when its instance is first mounted.
import '@/ui/editor/DataEditorModal'

it('keeps the editor draft and active table after closing and reopening', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => {
    const target = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(element => element.textContent?.trim() === text)
    expect(target, text).toBeDefined()
    return target!
  }
  try {
    act(() => root.render(<HomePage />))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => {
      button('Data Editor').click()
      await import('@/ui/editor/DataEditorModal')
    })
    const categories = Array.from(container.querySelectorAll<HTMLButtonElement>('.titan-tab'))
      .find(element => element.textContent?.startsWith('Categories'))!
    act(() => categories.click())
    act(() => container.querySelector<HTMLButtonElement>('.titan-editor-row')!.click())
    const name = Array.from(container.querySelectorAll('label'))
      .find(element => element.querySelector('.titan-field-label')?.textContent === 'Name')!
      .querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Unsaved category draft')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('.titan-editor-row')?.textContent).toContain('Unsaved category draft')
    act(() => button('Close').click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    act(() => button('Data Editor').click())
    expect(container.querySelector('.titan-tab.active')?.textContent).toContain('Categories')
    expect(container.querySelector('.titan-editor-row')?.textContent).toContain('Unsaved category draft')
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})

/**
 * Событие пришло из поля ввода: клавиши в нём — набор текста, а не команды
 * (камера, Escape окна). Атрибут contenteditable проверяется и через closest:
 * isContentEditable есть не во всех средах (jsdom), а редактируемым бывает и
 * предок цели.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true

  return (
    target.isContentEditable === true || target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  )
}

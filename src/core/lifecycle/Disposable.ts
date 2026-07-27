/**
 * Контракт освобождения ресурсов. Совпадает с конвенцией самого Three
 * (`geometry.dispose()`, `material.dispose()`) и с одиннадцатью методами,
 * которые в проекте уже так называются.
 *
 * Требования к реализации:
 *   - идемпотентность: повторный вызов безвреден. Не пожелание — разделяемый
 *     материал инстанс-пула гарантированно приходит в обход дважды;
 *   - освобождать только своё: то, что этот объект создал, а не то, что ему
 *     передали в конструктор.
 */
export interface Disposable {
  dispose(): void
}

export function isDisposable(value: unknown): value is Disposable {
  return typeof (value as Disposable | null | undefined)?.dispose === 'function'
}

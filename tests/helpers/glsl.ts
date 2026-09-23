/**
 * Снятие комментариев GLSL для структурных проверок шейдеров.
 *
 * Проверка вида «такой конструкции в шейдере нет» обязана смотреть на КОД.
 * Комментарий, объясняющий, почему запрещённая форма запрещена, называет её по
 * имени — и роняет тест сам по себе. Ловилось дважды подряд: на `modelMatrix` в
 * шейдере белого карлика и на `cameraPosition` в шейдере протуберанцев.
 *
 * Блочные комментарии снимаются ДО строчных: иначе `//` внутри блока обрежет
 * строку раньше, чем блок будет распознан целиком.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Выбирает ветку "дефайн не задан" для КАЖДОГО `#ifdef NAME ... #endif` блока
 * (с `#else` или без — оставляет его тело, без — вырезает блок целиком).
 * Построчный обход, а не единый regex: несколько блоков одного NAME в файле,
 * часть с `#else`, часть без — жадный/нежадный regex через файл склеил бы
 * чужие ветки между блоками. Каждая директива обязана быть на своей строке
 * (так формат шейдеров проекта). Вложенность одного и того же NAME не
 * поддерживается — в проекте её нет.
 */
export function withoutDefine(source: string, name: string): string {
  const ifdefLine = new RegExp(`^\\s*#ifdef\\s+${name}\\s*$`)
  const elseLine = /^\s*#else\s*$/
  const endifLine = /^\s*#endif\s*$/

  const out: string[] = []
  let mode: 'normal' | 'then' | 'else' = 'normal'

  for (const line of source.split('\n')) {
    if (mode === 'normal' && ifdefLine.test(line)) {
      mode = 'then'
      continue
    }
    if (mode === 'then' && elseLine.test(line)) {
      mode = 'else'
      continue
    }
    if (mode !== 'normal' && endifLine.test(line)) {
      mode = 'normal'
      continue
    }
    if (mode === 'then') continue

    out.push(line)
  }

  return out.join('\n')
}

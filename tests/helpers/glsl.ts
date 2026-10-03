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

/**
 * Мини-препроцессор: #ifdef/#ifndef/#if/#elif/#else/#endif по набору define.
 * Условие #if — только `defined(X)` с && || ! и скобками; прочее считается ложью.
 */
export function preprocessGlsl(source: string, defines: ReadonlySet<string>): string {
  const evalCondition = (expr: string): boolean => {
    const replaced = expr
      .replace(/defined\s*\(\s*(\w+)\s*\)/g, (_m, name: string) => (defines.has(name) ? '1' : '0'))
      .replace(/defined\s+(\w+)/g, (_m, name: string) => (defines.has(name) ? '1' : '0'))

    if (!/^[01\s&|!()]*$/.test(replaced)) return false

    return Boolean(new Function(`return (${replaced})`)())
  }

  const stack: { parent: boolean; active: boolean; taken: boolean }[] = []
  const out: string[] = []
  const isActive = (): boolean => (stack.length === 0 ? true : stack[stack.length - 1].active)

  for (const line of source.split('\n')) {
    const t = line.trim()
    let m: RegExpMatchArray | null

    if ((m = t.match(/^#ifdef\s+(\w+)/)) || (m = t.match(/^#ifndef\s+(\w+)/)) || (m = t.match(/^#if\s+(.*)$/))) {
      const parent = isActive()
      const cond = t.startsWith('#ifdef') ? defines.has(m[1]) : t.startsWith('#ifndef') ? !defines.has(m[1]) : evalCondition(m[1])
      stack.push({ parent, active: parent && cond, taken: cond })
    } else if ((m = t.match(/^#elif\s+(.*)$/))) {
      const top = stack[stack.length - 1]
      const cond = !top.taken && evalCondition(m[1])
      top.active = top.parent && cond
      top.taken = top.taken || cond
    } else if (t === '#else') {
      const top = stack[stack.length - 1]
      top.active = top.parent && !top.taken
      top.taken = true
    } else if (t.startsWith('#endif')) {
      stack.pop()
    } else if (isActive()) {
      out.push(line)
    }
  }

  return out.join('\n')
}

/** Сравнимая форма GLSL: без комментариев, пробелы схлопнуты, пустых строк нет. */
export function normalizeGlsl(source: string): string {
  return withoutComments(source)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n')
}

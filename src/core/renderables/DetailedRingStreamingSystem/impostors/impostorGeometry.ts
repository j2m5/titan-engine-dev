import { InterleavedBufferAttribute, type BufferGeometry } from 'three'
import { hasImpostorContext, rememberImpostorContext } from './impostorContext'

const owners = new WeakMap<object, Set<BufferGeometry>>()

/** Последняя GPU-обёртка удаляет VBO; CPU-источники остаются в кэше. */
export function trackImpostorGeometry(geometry: BufferGeometry): void {
  const attributes = Object.entries(geometry.attributes)
  if (geometry.index) attributes.push(['', geometry.index])
  const buffers = attributes.map(([name, attribute]) => ({ name,
    key: attribute instanceof InterleavedBufferAttribute ? attribute.data : attribute }))
  for (const { key } of buffers) {
    let users = owners.get(key)
    if (!users) { users = new Set(); owners.set(key, users) }
    users.add(geometry)
  }
  let disposed = false
  geometry.addEventListener('dispose', () => {
    if (disposed) return
    disposed = true
    for (const { name, key } of buffers) {
      const users = owners.get(key)!
      users.delete(geometry)
      if ([...users].some(hasImpostorContext)) {
        if (name) geometry.deleteAttribute(name)
        else geometry.setIndex(null)
      }
    }
  })
  rememberImpostorContext(geometry)
}

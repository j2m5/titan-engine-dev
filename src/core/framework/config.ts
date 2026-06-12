import { app } from '@/config/app'
import { filesystem } from '@/config/filesystem'
import { three } from '@/config/three'
import { blackHole } from '@/config/blackHole'
import { database } from '@/config/database'

type PrevDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

type DotPaths<T, Depth extends number = 5, Prefix extends string = ''> = [Depth] extends [never]
  ? never
  : {
      [K in keyof T & string]: T[K] extends object
        ? `${Prefix}${K}` | DotPaths<T[K], PrevDepth[Depth], `${Prefix}${K}.`>
        : `${Prefix}${K}`
    }[keyof T & string]

type DotValue<T, Path extends string> = Path extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? DotValue<T[Key], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never

function createConfig<T>(data: Readonly<T>) {
  return function <P extends DotPaths<T>, F = undefined>(path: P, fallback?: F): DotValue<T, P> {
    return path.split('.').reduce<any>((acc, key) => acc?.[key], data) ?? fallback
  }
}

export const config = createConfig({
  ...app,
  ...filesystem,
  ...three,
  ...blackHole,
  database
})

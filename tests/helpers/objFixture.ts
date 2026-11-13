export const TETRAHEDRON_VERTICES = 'v 1 1 1\nv -1 -1 1\nv -1 1 -1\nv 1 -1 -1\n'
export const RELATIVE_TETRAHEDRON_OBJ = TETRAHEDRON_VERTICES +
  'f -4 -2 -3\nf -4 -3 -1\nf -4 -1 -2\nf -3 -2 -1\n'

export function scaledTetrahedronObj(scale: number): string {
  return RELATIVE_TETRAHEDRON_OBJ.replace(/^v (.+)$/gm, (_line, coordinates: string) =>
    `v ${coordinates.split(' ').map(value => Number(value) * scale).join(' ')}`)
}

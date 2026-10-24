import type { PerspectiveCamera } from 'three'
import type { CloudView } from '@/labs/jupiter-clouds/CloudFlight'
export function applyEarthCloudView(camera: PerspectiveCamera, view: CloudView, radius: number): void {
  const height = { orbit: 20000000, approach: 110000, above: 12000, inside: 6000, below: 2000 }[view]
  const down = view === 'orbit' || view === 'approach'
  camera.position.set(0, 0, height)
  camera.up.set(0, down ? 1 : 0, down ? 0 : 1)
  if (down) camera.lookAt(0, 0, -radius)
  else camera.lookAt(10000, 0, height + (view === 'above' ? -5000 : 1000))
  camera.updateMatrixWorld()
}

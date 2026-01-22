import { useState, useRef, useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import TitanFlex from '@/ui/TitanUI/components/TitanFlex'
import TitanIconButton from '@/ui/TitanUI/components/TitanIconButton'
import { SkipBackIcon, SkipForwardIcon } from '@phosphor-icons/react'
import { threeJS } from '@/core/graphic/ThreeJS'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { formatter } from '@/ui/helpers'

const HIDE_DELAY = 5000
const HIDE_ANIMATION = 300

const CameraSpeed = observer(() => {
  const [visible, setVisible] = useState(false)
  const [hiding, setHiding] = useState(false)

  const hideTimer = useRef<number | null>(null)
  const hideAnimationTimer = useRef<number | null>(null)

  useEffect(() => {
    const canvas = threeJS.renderer.domElement

    const handleWheel = () => {
      setVisible(true)
      setHiding(false)

      if (hideTimer.current) {
        clearTimeout(hideTimer.current)
      }

      if (hideAnimationTimer.current) {
        clearTimeout(hideAnimationTimer.current)
      }

      hideTimer.current = window.setTimeout(() => {
        setHiding(true)

        hideAnimationTimer.current = window.setTimeout(() => {
          setVisible(false)
        }, HIDE_ANIMATION)
      }, HIDE_DELAY)
    }

    canvas.addEventListener('wheel', handleWheel)

    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (hideAnimationTimer.current) clearTimeout(hideAnimationTimer.current)
    }
  }, [])

  const formattedSpeed: string = `${formatter().format(cameraStore.formatSpeed.speed)} ${cameraStore.formatSpeed.unit}`

  return (
    <div className={`camera-speed ${hiding ? 'hiding' : ''} ${!visible ? 'hidden' : ''}`}>
      <TitanFlex align="center">
        <TitanIconButton
          disabled={cameraStore.speed === cameraStore.minSpeed}
          onClick={() => cameraStore.setSpeed(cameraStore.minSpeed)}
        >
          <SkipBackIcon size={20} />
        </TitanIconButton>
        {formattedSpeed}
        <TitanIconButton
          disabled={cameraStore.speed === cameraStore.maxSpeed}
          onClick={() => cameraStore.setSpeed(cameraStore.maxSpeed)}
        >
          <SkipForwardIcon size={20} />
        </TitanIconButton>
      </TitanFlex>
    </div>
  )
})

export default CameraSpeed

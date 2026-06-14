import { FC } from 'react'
import { TitanPopupProps } from '@titanui/types'

const TitanPopup: FC<TitanPopupProps> = ({
  visible = false,
  anchor,
  left = 270,
  right = 0,
  header = '',
  content = ''
}) => {
  if (!visible || !anchor?.current) return null

  return (
    <div className="titan-popup" style={{ position: 'absolute', top: 0, left, right }}>
      <div className="titan-popup-header">{header}</div>
      <div className="titan-popup-divider" />
      <div className="titan-popup-content">{content}</div>
    </div>
  )
}

export default TitanPopup

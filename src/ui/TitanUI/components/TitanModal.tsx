import { FC } from 'react'
import { TitanModalProps } from '@titanui/types'
import TitanContainer from '@titanui/components/TitanContainer'
import TitanDivider from '@titanui/components/TitanDivider'

const TitanModal: FC<TitanModalProps> = ({
  children,
  visible,
  title,
  actions,
  keepMounted = false,
  height = 'auto',
  width = 'auto',
  className = '',
  dimScene = false
}) => {
  if (!keepMounted && !visible) return null

  return (
    <>
      {dimScene && visible && <div className="titan-scene-dim" />}
      <div className={`titan-modal ${visible ? 'open' : 'closed'} ${className}`}>
        <TitanContainer width={width} height={height}>
          {title && (
            <>
              <div className="titan-modal-header">{title}</div>
              <TitanDivider />
            </>
          )}

          <div className="titan-modal-content">{children}</div>

          {actions && (
            <>
              <TitanDivider />
              <div className="titan-modal-actions">{actions}</div>
            </>
          )}
        </TitanContainer>
      </div>
    </>
  )
}

export default TitanModal

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
  width = 'auto'
}) => {
  if (!keepMounted && !visible) return null

  return (
    <div className={`titan-modal ${visible ? 'open' : 'closed'}`}>
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
  )
}

export default TitanModal

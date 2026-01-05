import { FC } from 'react'
import { TitanModalProps } from '@/ui/TitanUI/types'
import TitanContainer from '@/ui/TitanUI/components/TitanContainer'
import TitanDivider from '@/ui/TitanUI/components/TitanDivider'

const TitanModal: FC<TitanModalProps> = ({ children, visible, title, actions, height = 'auto', width = 'auto' }) => {
  if (!visible) return null

  return (
    <div className="titan-modal">
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

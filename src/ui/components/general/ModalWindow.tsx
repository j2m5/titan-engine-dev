import { FC } from 'react'
import { observer } from 'mobx-react-lite'
import { Closable, TitanModalProps } from '@/ui/TitanUI/types'
import TitanModal from '@/ui/TitanUI/components/TitanModal'
import TitanButton from '@/ui/TitanUI/components/TitanButton'

const ModalWindow: FC<Omit<TitanModalProps, 'actions'> & Closable> = observer(
  ({ children, visible, title, height = 'auto', width = 'auto', onClose }) => {
    return (
      <TitanModal
        visible={visible}
        title={title}
        actions={<TitanButton onClick={onClose}>Close</TitanButton>}
        height={height}
        width={width}
      >
        {children}
      </TitanModal>
    )
  }
)

export default ModalWindow

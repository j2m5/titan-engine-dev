import { FC } from 'react'
import { observer } from 'mobx-react-lite'
import { Closable, TitanModalProps } from '@titanui/types'
import TitanModal from '@titanui/components/TitanModal'
import TitanButton from '@titanui/components/TitanButton'

const ModalWindow: FC<Omit<TitanModalProps, 'actions'> & Closable> = observer(
  ({ children, visible, title, keepMounted = false, height = 'auto', width = 'auto', onClose }) => {
    return (
      <TitanModal
        visible={visible}
        title={title}
        actions={<TitanButton onClick={onClose}>Close</TitanButton>}
        keepMounted={keepMounted}
        height={height}
        width={width}
      >
        {children}
      </TitanModal>
    )
  }
)

export default ModalWindow

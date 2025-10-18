import { observer } from 'mobx-react-lite'
import { FC } from 'react'
import { ModalWindowProps } from '@/ui/interfaces/ModalWindowProps'
import { Dialog, DialogContent, DialogTitle, IconButton, Theme } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

const ModalWindow: FC<ModalWindowProps> = observer(({ visible, title, content, keepMounted, close }) => {
  return (
    <Dialog maxWidth="lg" keepMounted={keepMounted} open={visible} onClose={close}>
      <DialogTitle sx={{ m: 0, p: 2 }} id="customized-dialog-title">
        {title}
      </DialogTitle>
      <IconButton
        aria-label="close"
        onClick={() => close(false)}
        sx={{
          position: 'absolute',
          right: 8,
          top: 8,
          color: (theme: Theme) => theme.palette.grey[500]
        }}
      >
        <CloseIcon />
      </IconButton>
      <DialogContent dividers>{content}</DialogContent>
    </Dialog>
  )
})

export default ModalWindow

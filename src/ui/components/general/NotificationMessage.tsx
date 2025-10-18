import { observer } from 'mobx-react-lite'
import { Alert, Slide, Snackbar } from '@mui/material'
import { notificationStore } from '@/ui/mobX/NotificationStore'
import { FC } from 'react'
import { NotificationMessageProps } from '@/ui/interfaces/NotificationMessageProps'

const NotificationMessage: FC<NotificationMessageProps> = observer(({ type, message }) => {
  return (
    <Snackbar
      open={notificationStore.notification.isOpen}
      TransitionComponent={Slide}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      autoHideDuration={5000}
      onClose={() => notificationStore.closeNotification()}
    >
      <Alert
        severity={type}
        onClose={() => notificationStore.closeNotification()}
        variant="filled"
        sx={{ width: '100%' }}
      >
        {message}
      </Alert>
    </Snackbar>
  )
})

export default NotificationMessage

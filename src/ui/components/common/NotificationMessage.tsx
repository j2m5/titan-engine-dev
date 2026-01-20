import { FC } from 'react'
import { observer } from 'mobx-react-lite'
import TitanToast from '@/ui/TitanUI/components/TitanToast'
import TitanAlert from '@/ui/TitanUI/components/TitanAlert'
import { SystemNotification } from '@/ui/types'
import { notificationStore } from '@/ui/mobx/NotificationStore'

const NotificationMessage: FC<SystemNotification> = observer(({ type, message }) => {
  return (
    <TitanToast visible={notificationStore.notification.visible} onClose={() => notificationStore.closeNotification()}>
      <TitanAlert
        type={notificationStore.notification.type}
        message={notificationStore.notification.message}
        showIcon
      />
    </TitanToast>
  )
})

export default NotificationMessage

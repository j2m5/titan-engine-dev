import { observer } from 'mobx-react-lite'
import TitanToast from '@/ui/TitanUI/components/TitanToast'
import TitanAlert from '@/ui/TitanUI/components/TitanAlert'
import { notificationStore } from '@/ui/mobx/NotificationStore'

const calculateBottomOffset = (index: number, spacing: number) => {
  if (index === 0) return spacing

  return spacing + index * (spacing + 48)
}

const NotificationMessage = observer(() => {
  const ntfStore = notificationStore

  return (
    <>
      {ntfStore.notifications.map((notification, index) => (
        <TitanToast
          key={notification.id}
          visible={true}
          duration={ntfStore.delay}
          style={{ bottom: `${calculateBottomOffset(index, 24)}px` }}
          onClose={() => ntfStore.release(notification.id)}
        >
          <TitanAlert type={notification.type} message={notification.message} showIcon />
        </TitanToast>
      ))}
    </>
  )
})

export default NotificationMessage

/**
 * FUTURE WORK — Flutter mobile app integration
 * 1. POST /api/devices/register — Flutter calls with FCM/APNs token
 * 2. POST /api/devices/[id]/deactivate — on sign out
 * 3. Implement sendFCM(device, payload) using firebase-admin
 * 4. Implement sendAPNs(device, payload)
 * 5. Add Vercel Cron processing NotificationSchedule
 * 6. Mark stale devices on repeated failures
 */

interface NotificationUser {
  _id: string
  username: string
  timezone?: string
}

interface NotificationEntry {
  type: string
  scheduledFor: Date
  payload: {
    title?: string
    body?: string
    deepLink?: string
    habitId?: string
  }
}

export async function sendNotification(
  user: NotificationUser,
  notification: NotificationEntry,
): Promise<{ delivered: boolean; error: string }> {
  // NOTE: Delivery not yet implemented — pending Flutter mobile app integration
  return { delivered: false, error: 'delivery_not_implemented' }
}

export default sendNotification

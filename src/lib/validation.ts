import { z } from 'zod'
import { isValidIanaTimeZone, isValidIsoDate } from './timeZone.js'

export const AgendaQuerySchema = z.object({
  date: z.string().refine(isValidIsoDate, 'date must be a valid YYYY-MM-DD value'),
  timeZone: z.string().refine(isValidIanaTimeZone, 'timeZone must be a valid IANA time zone').optional(),
})

export const CalendarInventoryUpdateSchema = z.object({
  group: z.enum(['active', 'passive']).optional(),
  visible: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  color: z.string().min(1).max(32).nullable().optional(),
  isDefaultWrite: z.boolean().optional(),
}).refine(
  value => Object.values(value).some(field => field !== undefined),
  'at least one calendar setting is required',
)

export const DisconnectGoogleAccountSchema = z.object({
  accountId: z.string().min(1).optional(),
})

export const GoogleCalendarSyncSchema = z.object({
  accountId: z.string().min(1),
})

export const SyncTaskToGoogleSchema = z.object({
  taskId: z.string().min(1),
})

export const UnsyncTaskFromGoogleSchema = z.object({
  taskId: z.string().min(1),
  deleteGoogleEvent: z.boolean().default(false),
})

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  clientCommandId: z.string().min(1).max(200).optional(),
  priority: z.enum(['low', 'medium', 'high', 'none']).optional().nullable(),
  status: z.enum(['backlog', 'todo', 'in-progress', 'done', 'dropped']).optional(),
  dueDate: z.string().optional().nullable(),
  scheduledStart: z.string().optional().nullable(),
  scheduledEnd: z.string().optional().nullable(),
  listId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.unknown().optional().nullable(),
  estimatedEffort: z.number().optional().nullable(),
  parentId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  kanbanOrder: z.number().optional(),
  sectionId: z.string().optional().nullable(),
  workflowId: z.string().optional().nullable(),
  reminders: z.array(z.object({
    id: z.string(),
    type: z.enum(['before-start', 'on-day-at', 'absolute']),
    offsetMinutes: z.number().optional(),
    timeOfDay: z.string().nullable().optional(),
    absoluteTime: z.string().nullable().optional(),
    sent: z.boolean().optional(),
  })).optional(),
  repeat: z.string().nullable().optional(),
})

export const UpdateTaskSchema = CreateTaskSchema
  .omit({ clientCommandId: true })
  .partial()

// ── Workflow schemas ───────────────────────────────────────────────────────

export const WorkflowColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  order: z.number().int().min(0),
  color: z.string().nullable().optional(),
  wipLimit: z.number().int().min(1).nullable().optional(),
})

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  templateType: z.enum(['kanban', 'sprint', 'sales', 'content', 'matrix', 'custom']),
  columns: z.array(WorkflowColumnSchema).optional(),
  order: z.number().optional(),
})

export const UpdateWorkflowSchema = CreateWorkflowSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const CreateHabitSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  frequency: z.enum(['daily', 'weekdays', 'weekly', 'custom']).optional(),
  customDays: z.array(z.number().int().min(0).max(6)).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
  order: z.number().optional(),
})

export const UpdateHabitSchema = CreateHabitSchema.partial().extend({
  archived: z.boolean().optional(),
})

export const HabitCheckinSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['achieved', 'unachieved', 'skipped', 'frozen']),
  value: z.number().optional(),
  reason: z.string().max(500).optional(),
})

export const CreateFocusSessionSchema = z.object({
  taskId: z.string().nullable().optional(),
  plannedDurationMin: z.number().int().min(1).max(480).optional(),
  plannedBreakMin: z.number().int().min(0).max(120).optional(),
  mode: z.enum(['POMO', 'STOPWATCH']).optional(),
  targetType: z.enum(['TASK', 'HABIT', 'NONE']).optional(),
  targetId: z.string().nullable().optional(),
  taskTitle: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  const inferredTargetType = data.targetType ?? (data.taskId ? 'TASK' : 'NONE')
  const targetId = data.targetId ?? data.taskId

  if (inferredTargetType === 'NONE' && targetId) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetId'],
      message: 'targetId must be empty when targetType is NONE',
    })
  }
  if (inferredTargetType !== 'NONE' && !targetId) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetId'],
      message: 'targetId is required when a focus target is selected',
    })
  }
})

export const FocusSessionActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'extend', 'complete', 'cancel']),
  additionalMin: z.number().int().min(1).max(480).optional(),
  endedReason: z.enum(['timer_ended', 'user_completed', 'user_cancelled']).optional(),
  postSessionNote: z.string().max(2000).optional(),
})

export const CompleteActiveFocusSessionSchema = z.object({
  postSessionNote: z.string().max(2000).optional(),
})

export const CreateFocusRecordSchema = z.object({
  targetType: z.enum(['TASK', 'HABIT', 'NONE']),
  targetId: z.string().nullable().optional(),
  targetTitleSnapshot: z.string().max(500).nullable().optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  mode: z.enum(['POMO', 'STOPWATCH']),
  pomoCount: z.number().int().min(0).optional(),
  note: z.string().max(2000).nullable().optional(),
  timezone: z.string().max(50).refine(isValidIanaTimeZone, 'timezone must be a valid IANA time zone').nullable().optional(),
}).superRefine((data, ctx) => {
  if (!(new Date(data.endTime) > new Date(data.startTime))) {
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'endTime must be after startTime' })
  }
  if (data.targetType === 'NONE' && data.targetId) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'targetId must be empty when targetType is NONE' })
  }
  if (data.targetType !== 'NONE' && !data.targetId) {
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'targetId is required when a focus target is selected' })
  }
})

export const UpdateFocusSettingsSchema = z.object({
  pomoDurationSeconds: z.number().int().min(60).max(7200).optional(),
  shortBreakDurationSeconds: z.number().int().min(0).max(3600).optional(),
  longBreakDurationSeconds: z.number().int().min(0).max(3600).optional(),
  longBreakAfterPomos: z.number().int().min(1).max(20).optional(),
  autoStartBreak: z.boolean().optional(),
  autoStartPomo: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
}).refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'at least one setting is required' }
)

export const FocusDashboardQuerySchema = z.object({
  timezone: z.string().max(50).refine(isValidIanaTimeZone, 'timezone must be a valid IANA time zone').optional(),
})

export const FocusRecordsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const FocusTargetSearchSchema = z.object({
  type: z.enum(['TASK', 'HABIT']),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const CreateEventSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().optional().nullable(),
  allDay: z.boolean().optional(),
  color: z.string().max(20).optional(),
  location: z.string().max(500).optional().nullable(),
  notifyBefore: z.number().int().min(0).nullable().optional(),
  recurrence: z.string().max(200).optional().nullable(),
})

export const UpdateEventSchema = CreateEventSchema.partial()

export const CreateReminderSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional().nullable(),
  reminderDate: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
})

export const UpdateReminderSchema = CreateReminderSchema.partial()

export const ReminderSnoozeSchema = z.object({
  snoozeMinutes: z.number().int().min(1).max(10080),
})

export const CreateListSchema = z.object({
  title: z.string().max(200).optional(),
  type: z.string().max(50).optional(),
  icon: z.string().max(50).optional(),
  coverImageUrl: z.string().max(2000).optional(),
  groupId: z.string().nullable().optional(),
  isInbox: z.boolean().optional(),
  blocks: z.unknown().optional(),
})

export const UpdateListSchema = z.object({
  title: z.string().max(200).optional(),
  icon: z.string().max(50).optional(),
  coverImageUrl: z.string().max(2000).optional(),
  pinnedToFavorites: z.boolean().optional(),
  hideCompletedTasks: z.boolean().optional(),
  groupId: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
  collaborators: z.array(z.string()).optional(),
  type: z.string().max(50).optional(),
})

export const CreateFolderSchema = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().max(50).optional(),
  groupId: z.string().nullable().optional(),
  groupTitle: z.string().max(200).optional(),
  coverImageUrl: z.string().max(2000).optional(),
  isPrivate: z.boolean().optional(),
})

export const UpdateFolderSchema = CreateFolderSchema.partial()

export const CreateKanbanSectionSchema = z.object({
  title: z.string().min(1).max(200),
})

export const CreateListGroupSchema = z.object({
  title: z.string().min(1).max(200),
})

export const UpdateListGroupSchema = z.object({
  title: z.string().max(200).optional(),
  order: z.number().int().optional(),
  collapsed: z.boolean().optional(),
})

export const CreatePomodoroSchema = z.object({
  taskId: z.string().nullable().optional(),
  taskTitle: z.string().max(500).optional(),
  type: z.enum(['focus', 'break']),
  duration: z.number().int().min(1),
  startedAt: z.string().min(1),
})

export const UpdatePomodoroSchema = z.object({
  completedAt: z.string().nullable().optional(),
  completed: z.boolean().optional(),
})

export const TaskScheduleSchema = z.object({
  scheduledStart: z.string().min(1),
  scheduledEnd: z.string().nullable().optional(),
})

export const TaskReorderSchema = z.object({
  taskId: z.string().min(1),
  kanbanOrder: z.number(),
  sectionId: z.string().nullable().optional(),
  status: z.string().optional(),
  dueDate: z.string().nullable().optional(),
})

export const TaskReparentSchema = z.object({
  parentId: z.string().nullable().optional(),
})

export const FocusPreferencesSchema = z.object({
  defaultWorkMin: z.number().int().min(1).max(480).optional(),
  defaultShortBreakMin: z.number().int().min(0).max(120).optional(),
  defaultLongBreakMin: z.number().int().min(0).max(120).optional(),
  longBreakEveryNSessions: z.number().int().min(1).max(20).optional(),
  theme: z.enum(['aurora', 'minimal', 'liquid']).optional(),
  soundOnComplete: z.boolean().optional(),
  showInSidebar: z.boolean().optional(),
  keyboardShortcutsEnabled: z.boolean().optional(),
})

export const CreateChatSessionSchema = z.object({
  title: z.string().max(200).optional(),
})

export const PushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().min(1),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  userAgent: z.string().optional(),
})

export const FolderTaskSchema = z.object({
  taskId: z.string().min(1),
})

export const ListBlocksSchema = z.object({
  blocks: z.unknown(),
})


// ── Helpers ────────────────────────────────────────────────────────────────

export function parseBody<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, body: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body) as any
  if (!result.success) return { success: false, error: result.error.issues.map((i: any) => i.message).join(', ') }
  return { success: true, data: result.data as T }
}

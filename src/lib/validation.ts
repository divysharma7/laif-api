import { z } from 'zod'

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  priority: z.enum(['low', 'medium', 'high']).optional().nullable(),
  status: z.enum(['backlog', 'todo', 'in-progress', 'done', 'dropped']).optional(),
  dueDate: z.string().optional().nullable(),
  scheduledStart: z.string().optional().nullable(),
  scheduledEnd: z.string().optional().nullable(),
  listId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
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

export const UpdateTaskSchema = CreateTaskSchema.partial()

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
})

export const FocusSessionActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'extend', 'complete', 'cancel']),
  additionalMin: z.number().int().min(1).max(480).optional(),
  endedReason: z.enum(['timer_ended', 'user_completed', 'user_cancelled']).optional(),
  postSessionNote: z.string().max(200).optional(),
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

export const EventRemindSchema = z.object({
  minutesBefore: z.number().int().min(0).max(10080).optional(),
})

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

export const CreateContactSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
})

export const UpdateContactSchema = CreateContactSchema.partial()

export const CreateNoteSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().optional(),
  listId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
})

export const UpdateNoteSchema = CreateNoteSchema.partial()

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

export const JournalSchema = z.object({
  date: z.string().min(1),
  content: z.string().optional(),
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

export const CalendarSyncSchema = z.object({
  calendarId: z.string().optional(),
})

export const FolderTaskSchema = z.object({
  taskId: z.string().min(1),
})

export const ListBlocksSchema = z.object({
  blocks: z.unknown(),
})

export const McpCallSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().min(1),
})


// ── Helpers ────────────────────────────────────────────────────────────────

export function parseBody<T>(schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: { message: string }[] } } }, body: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body) as any
  if (!result.success) return { success: false, error: result.error.issues.map((i: any) => i.message).join(', ') }
  return { success: true, data: result.data as T }
}

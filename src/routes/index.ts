import { Router } from 'express'
import authRoutes from './auth.js'
import taskRoutes from './tasks.js'
import habitRoutes from './habits.js'
import focusRoutes from './focus.js'
import calendarRoutes from './calendar.js'
import eventRoutes from './events.js'
import listRoutes from './lists.js'
import folderRoutes from './folders.js'
import workflowRoutes from './workflows.js'
import kanbanSectionRoutes from './kanbanSections.js'
import memoryRoutes from './memories.js'
import reminderRoutes from './reminders.js'
import listGroupRoutes from './listGroups.js'
import pomodoroRoutes from './pomodoro.js'
import chatRoutes from './chat.js'
import notificationRoutes from './notifications.js'
import pushRoutes from './push.js'
import deviceRoutes from './devices.js'
import userRoutes from './users.js'
import googleRoutes from './integrations/google.js'
import alexaRoutes from './alexa.js'
import posthookRoutes from './posthookListener.js'
import mcpRoutes from './mcp.js'
import analyticsRoutes from './analytics.js'

export const routes = Router()

// Public routes (auth handled internally or not required)
routes.use('/auth', authRoutes)
routes.use('/posthook_listener', posthookRoutes)
routes.use('/alexa', alexaRoutes)

// Protected routes (auth middleware applied globally in app.ts)
routes.use('/tasks', taskRoutes)
routes.use('/habits', habitRoutes)
routes.use('/focus', focusRoutes)
routes.use('/calendar', calendarRoutes)
routes.use('/events', eventRoutes)
routes.use('/lists', listRoutes)
routes.use('/folders', folderRoutes)
routes.use('/workflows', workflowRoutes)
routes.use('/kanban-sections', kanbanSectionRoutes)
routes.use('/memories', memoryRoutes)
routes.use('/reminders', reminderRoutes)
routes.use('/list-groups', listGroupRoutes)
routes.use('/pomodoro', pomodoroRoutes)
routes.use('/chat', chatRoutes)
routes.use('/notifications', notificationRoutes)
routes.use('/push', pushRoutes)
routes.use('/devices', deviceRoutes)
routes.use('/users', userRoutes)
routes.use('/integrations/google', googleRoutes)
routes.use('/mcp', mcpRoutes)
routes.use('/analytics', analyticsRoutes)

export type AgendaItemKind = 'task' | 'habit' | 'external_event' | 'focus_session'
export type AgendaAvailability = 'busy' | 'free'
export type AgendaSyncState = 'healthy' | 'delayed' | 'needs_attention' | 'not_connected'
export type AgendaAction = 'view' | 'complete' | 'focus' | 'reschedule'

export interface AgendaItemSource {
  type: 'lifeos' | 'google'
  accountId?: string | null
  calendarId?: string
  displayName?: string
}

export interface AgendaItem {
  id: string
  kind: AgendaItemKind
  title: string
  start: string | null
  end: string | null
  allDay: boolean
  completed: boolean
  source: AgendaItemSource
  availability: AgendaAvailability
  color: string
  actions: AgendaAction[]
}

export interface AgendaUnscheduledPriority {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
  estimatedMinutes?: number
  dueDate?: string
}

export interface AgendaResponse {
  date: string
  timeZone: string
  generatedAt: string
  sync: {
    state: AgendaSyncState
    lastSuccessfulAt: string | null
  }
  items: AgendaItem[]
  unscheduledPriorities: AgendaUnscheduledPriority[]
}

import { getPrisma } from '../lib/prisma.js'

interface CreateFolderInput {
  title: string
  ownerId: string
  icon?: string
  groupId?: string | null
  groupTitle?: string
  coverImageUrl?: string
  isPrivate?: boolean
}

interface UpdateFolderInput {
  title?: string
  icon?: string
  coverImageUrl?: string
  isPrivate?: boolean
  groupId?: string | null
  groupTitle?: string | null
}

type ApiRecord = Record<string, any>

const taskInclude = {
  comments: { orderBy: { createdAt: 'asc' as const } },
  reminders: true,
  completions: { orderBy: { date: 'asc' as const } },
  activities: { orderBy: { timestamp: 'asc' as const } },
} as const

function serializeRecord(record: ApiRecord): ApiRecord {
  const { id, ...rest } = record
  return { ...rest, _id: id }
}

function serializeTask(task: ApiRecord): ApiRecord {
  const { id, comments = [], reminders = [], completions = [], activities = [], ...rest } = task
  if (rest.status === 'in_progress') rest.status = 'in-progress'
  return {
    ...rest,
    _id: id,
    comments: comments.map(({ id: childId, taskId: _taskId, ...item }: ApiRecord) => ({
      ...item,
      _id: childId,
    })),
    reminders: reminders.map(({ id: childId, taskId: _taskId, ...item }: ApiRecord) => ({
      ...item,
      type: item.type === 'before_start'
        ? 'before-start'
        : item.type === 'on_day_at'
          ? 'on-day-at'
          : item.type,
      id: childId,
      _id: childId,
    })),
    completions: completions.map(({ id: childId, taskId: _taskId, ...item }: ApiRecord) => ({
      ...item,
      _id: childId,
      date: item.date instanceof Date ? item.date.toISOString().slice(0, 10) : item.date,
    })),
    activities: activities.map(({ id: childId, taskId: _taskId, ...item }: ApiRecord) => ({
      ...item,
      _id: childId,
    })),
  }
}

async function resolveGroup(
  ownerId: string,
  groupId?: string | null,
  groupTitle?: string | null,
): Promise<{ group: ApiRecord | null; created: boolean }> {
  const prisma = getPrisma()
  if (!groupId && !groupTitle) {
    return { group: null, created: false }
  }

  if (groupId) {
    const existing = await prisma.listGroup.findFirst({ where: { id: groupId, ownerId } })
    if (!existing) throw new Error('Group not found or not owned by user')
    return { group: existing, created: false }
  }

  if (groupTitle) {
    const existing = await prisma.listGroup.findFirst({ where: { title: groupTitle, ownerId } })
    if (existing) return { group: existing, created: false }

    const maximum = await prisma.listGroup.aggregate({
      where: { ownerId },
      _max: { order: true },
    })
    const group = await prisma.listGroup.create({
      data: {
        title: groupTitle,
        ownerId,
        order: (maximum._max.order ?? -1) + 1,
        collapsed: false,
      },
    })
    return { group, created: true }
  }

  return { group: null, created: false }
}

export async function createFolder(input: CreateFolderInput) {
  const { title, ownerId, icon, groupId, groupTitle, coverImageUrl, isPrivate } = input
  if (!title || !title.trim()) throw new Error('Title is required')

  const { group, created: groupCreated } = await resolveGroup(ownerId, groupId, groupTitle)
  const list = await getPrisma().list.create({
    data: {
      type: 'standard',
      title: title.trim(),
      icon: icon || '📁',
      ownerId,
      groupId: group?.id ?? null,
      coverImageUrl: coverImageUrl || '',
      isPrivate: isPrivate ?? true,
      blocks: [],
      isInbox: false,
    },
  })

  return {
    list: serializeRecord(list),
    group: group ? serializeRecord(group) : null,
    created: { list: true, group: groupCreated },
  }
}

export async function updateFolder(
  folderId: string,
  ownerId: string,
  updates: UpdateFolderInput,
) {
  const prisma = getPrisma()
  const existing = await prisma.list.findUnique({ where: { id: folderId } })
  if (!existing) throw new Error('NOT_FOUND')
  if (existing.ownerId !== ownerId) throw new Error('FORBIDDEN')

  const data: ApiRecord = {}
  if (updates.title !== undefined) data.title = updates.title.trim()
  if (updates.icon !== undefined) data.icon = updates.icon
  if (updates.coverImageUrl !== undefined) data.coverImageUrl = updates.coverImageUrl
  if (updates.isPrivate !== undefined) data.isPrivate = updates.isPrivate

  if (updates.groupId !== undefined || updates.groupTitle !== undefined) {
    const { group } = await resolveGroup(ownerId, updates.groupId, updates.groupTitle)
    data.groupId = group?.id ?? null
  }

  if (Object.keys(data).length === 0) return serializeRecord(existing)

  const updated = await prisma.list.update({ where: { id: folderId }, data })
  return serializeRecord(updated)
}

export async function deleteFolder(folderId: string, ownerId: string) {
  const prisma = getPrisma()
  const existing = await prisma.list.findUnique({ where: { id: folderId } })
  if (!existing) throw new Error('NOT_FOUND')
  if (existing.ownerId !== ownerId) throw new Error('FORBIDDEN')
  if (existing.isInbox) throw new Error('Cannot delete the Inbox')

  await prisma.list.update({
    where: { id: folderId },
    data: { deletedAt: new Date() },
  })
  return { deleted: true, folderId }
}

export async function addTaskToFolder(
  taskId: string,
  folderId: string,
  ownerId: string,
) {
  const prisma = getPrisma()
  const updated = await prisma.$transaction(async (tx) => {
    const folder = await tx.list.findFirst({ where: { id: folderId, ownerId } })
    if (!folder) throw new Error('Folder not found')

    const task = await tx.task.findFirst({ where: { id: taskId, userId: ownerId } })
    if (!task) throw new Error('Task not found')

    return tx.task.update({
      where: { id: task.id },
      data: { listId: folder.id },
      include: taskInclude,
    })
  })

  return serializeTask(updated)
}

import { connectDB } from '../lib/mongodb.js'
import ListModel from '../models/List'
import ListGroupModel from '../models/ListGroup'
import TaskModel from '../models/Task'

// ── Types ────────────────────────────────────────────────────

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

type LeanDoc = Record<string, unknown> & { _id: unknown }

// ── Group resolution (shared by create + update) ─────────────

async function resolveGroup(
  ownerId: string,
  groupId?: string | null,
  groupTitle?: string | null,
): Promise<{ group: LeanDoc | null; created: boolean }> {
  // Case A — no group
  if (!groupId && !groupTitle) {
    return { group: null, created: false }
  }

  // Case B — groupId passed: validate it exists and belongs to owner
  if (groupId) {
    const existing = await ListGroupModel.findOne({
      _id: groupId,
      ownerId,
    }).lean() as LeanDoc | null

    if (!existing) {
      throw new Error('Group not found or not owned by user')
    }
    return { group: existing, created: false }
  }

  // Case C — groupTitle passed: find or create
  if (groupTitle) {
    const existing = await ListGroupModel.findOne({
      title: groupTitle,
      ownerId,
    }).lean() as LeanDoc | null

    if (existing) {
      return { group: existing, created: false }
    }

    // Get max order for positioning
    const maxOrder = await ListGroupModel.findOne({ ownerId })
      .sort({ order: -1 })
      .lean() as LeanDoc | null
    const nextOrder = maxOrder ? ((maxOrder.order as number) || 0) + 1 : 0

    const newGroup = await ListGroupModel.create({
      title: groupTitle,
      ownerId,
      order: nextOrder,
      collapsed: false,
    })
    const plain = newGroup.toObject() as LeanDoc
    return { group: plain, created: true }
  }

  return { group: null, created: false }
}

// ── createFolder ─────────────────────────────────────────────

export async function createFolder(input: CreateFolderInput) {
  await connectDB()

  const { title, ownerId, icon, groupId, groupTitle, coverImageUrl, isPrivate } = input

  if (!title || !title.trim()) {
    throw new Error('Title is required')
  }

  // Resolve group (Cases A/B/C)
  const { group, created: groupCreated } = await resolveGroup(ownerId, groupId, groupTitle)

  // Create the list (folder)
  const list = await ListModel.create({
    type: 'standard',
    title: title.trim(),
    icon: icon || '📁',
    ownerId,
    groupId: group ? String(group._id) : null,
    coverImageUrl: coverImageUrl || undefined,
    isPrivate: isPrivate ?? true,
    blocks: [],
    isInbox: false,
  })

  const plainList = list.toObject() as LeanDoc

  return {
    list: { ...plainList, _id: String(plainList._id) },
    group: group ? { ...group, _id: String(group._id) } : null,
    created: { list: true, group: groupCreated },
  }
}

// ── updateFolder ─────────────────────────────────────────────

export async function updateFolder(
  folderId: string,
  ownerId: string,
  updates: UpdateFolderInput,
) {
  await connectDB()

  // Validate ownership
  const existing = await ListModel.findById(folderId).lean() as LeanDoc | null
  if (!existing) {
    throw new Error('NOT_FOUND')
  }
  if (String(existing.ownerId) !== ownerId) {
    throw new Error('FORBIDDEN')
  }

  // Build $set object — only include fields that were explicitly passed
  const $set: Record<string, unknown> = {}

  if (updates.title !== undefined) $set.title = updates.title.trim()
  if (updates.icon !== undefined) $set.icon = updates.icon
  if (updates.coverImageUrl !== undefined) $set.coverImageUrl = updates.coverImageUrl
  if (updates.isPrivate !== undefined) $set.isPrivate = updates.isPrivate

  // Handle group change (same Cases A/B/C logic)
  if (updates.groupId !== undefined || updates.groupTitle !== undefined) {
    const { group } = await resolveGroup(ownerId, updates.groupId, updates.groupTitle)
    $set.groupId = group ? String(group._id) : null
  }

  if (Object.keys($set).length === 0) {
    // Nothing to update — return existing
    return { ...existing, _id: String(existing._id) }
  }

  const updated = await ListModel.findByIdAndUpdate(
    folderId,
    { $set },
    { new: true },
  ).lean() as LeanDoc | null

  if (!updated) {
    throw new Error('NOT_FOUND')
  }

  return { ...updated, _id: String(updated._id) }
}

// ── deleteFolder ─────────────────────────────────────────────

export async function deleteFolder(folderId: string, ownerId: string) {
  await connectDB()

  // Validate ownership
  const existing = await ListModel.findById(folderId).lean() as LeanDoc | null
  if (!existing) {
    throw new Error('NOT_FOUND')
  }
  if (String(existing.ownerId) !== ownerId) {
    throw new Error('FORBIDDEN')
  }

  // Prevent deleting Inbox
  if (existing.isInbox) {
    throw new Error('Cannot delete the Inbox')
  }

  // Soft delete — set deletedAt, don't touch tasks inside
  await ListModel.findByIdAndUpdate(folderId, {
    $set: { deletedAt: new Date() },
  })

  return { deleted: true, folderId }
}

// ── addTaskToFolder ──────────────────────────────────────────

export async function addTaskToFolder(
  taskId: string,
  folderId: string,
  ownerId: string,
) {
  await connectDB()

  // Validate folder exists and belongs to owner
  const folder = await ListModel.findById(folderId).lean() as LeanDoc | null
  if (!folder) {
    throw new Error('Folder not found')
  }
  if (String(folder.ownerId) !== ownerId) {
    throw new Error('FORBIDDEN')
  }

  // Validate task exists
  const task = await TaskModel.findById(taskId).lean() as LeanDoc | null
  if (!task) {
    throw new Error('Task not found')
  }

  // Move task to folder
  const updated = await TaskModel.findByIdAndUpdate(
    taskId,
    { $set: { listId: folderId } },
    { new: true },
  ).lean() as LeanDoc | null

  if (!updated) {
    throw new Error('Failed to update task')
  }

  return { ...updated, _id: String(updated._id) }
}

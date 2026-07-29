import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const prisma = vi.hoisted(() => ({
  list: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  listCollaborator: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  listGroup: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  workflow: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  workflowColumn: {
    findFirst: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  kanbanSection: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  task: {
    updateMany: vi.fn(),
  },
  user: {
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({
  getPrisma: () => prisma,
}))

const { createApp } = await import('../app.js')
const { signToken } = await import('../lib/auth.js')

let authorization: string

describe('Prisma list and workflow route ownership', () => {
  beforeAll(async () => {
    const token = await signToken({
      userId: 'owner-123',
      username: 'owner@example.com',
      name: 'Owner',
    })
    authorization = `Bearer ${token}`
  })

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.$transaction.mockImplementation(async input => (
      typeof input === 'function' ? input(prisma) : Promise.all(input)
    ))
  })

  it('lists only owned active lists and preserves embedded collaborator shape', async () => {
    const createdAt = new Date('2026-07-29T00:00:00.000Z')
    prisma.list.findMany.mockResolvedValue([{
      id: 'list-1',
      ownerId: 'owner-123',
      groupId: null,
      type: 'standard',
      title: 'Launch',
      icon: '',
      coverImageUrl: '',
      isPrivate: true,
      pinnedToFavorites: false,
      hideCompletedTasks: false,
      blocks: null,
      isInbox: false,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
      collaborators: [{
        listId: 'list-1',
        userId: 'collaborator-1',
        email: 'friend@example.com',
        role: 'collaborator',
        pending: false,
        invitedAt: createdAt,
        acceptedAt: createdAt,
      }],
    }])

    const response = await request(createApp())
      .get('/api/lists')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.list.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 'owner-123', deletedAt: null },
    }))
    expect(response.body[0]).toMatchObject({
      _id: 'list-1',
      ownerId: 'owner-123',
      collaborators: [{
        userId: 'collaborator-1',
        email: 'friend@example.com',
      }],
    })
    expect(response.body[0]).not.toHaveProperty('id')
    expect(response.body[0].collaborators[0]).not.toHaveProperty('listId')
  })

  it('rejects attaching a new list to another user’s group', async () => {
    prisma.listGroup.findFirst.mockResolvedValue(null)

    const response = await request(createApp())
      .post('/api/lists')
      .set('Authorization', authorization)
      .send({ title: 'Private', groupId: 'other-group' })
      .expect(404)

    expect(prisma.listGroup.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-group', ownerId: 'owner-123' },
      select: { id: true },
    })
    expect(prisma.list.create).not.toHaveBeenCalled()
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('hides another user’s workflow on update', async () => {
    prisma.workflow.findFirst.mockResolvedValue(null)

    await request(createApp())
      .put('/api/workflows/not-owned')
      .set('Authorization', authorization)
      .send({ name: 'Hijacked' })
      .expect(404)

    expect(prisma.workflow.findFirst).toHaveBeenCalledWith({
      where: { id: 'not-owned', ownerId: 'owner-123' },
      select: { id: true },
    })
    expect(prisma.workflow.update).not.toHaveBeenCalled()
  })

  it('returns normalized workflow columns in the existing embedded response shape', async () => {
    const timestamp = new Date('2026-07-29T00:00:00.000Z')
    prisma.workflow.findMany.mockResolvedValue([{
      id: 'workflow-1',
      ownerId: 'owner-123',
      name: 'Delivery',
      icon: '',
      color: '#0f62fe',
      templateType: 'kanban',
      order: 0,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      columns: [
        { id: 'done', workflowId: 'workflow-1', title: 'Done', order: 1, color: null, wipLimit: null },
        { id: 'todo', workflowId: 'workflow-1', title: 'Todo', order: 0, color: null, wipLimit: 3 },
      ],
    }])

    const response = await request(createApp())
      .get('/api/workflows')
      .set('Authorization', authorization)
      .expect(200)

    expect(response.body[0]._id).toBe('workflow-1')
    expect(response.body[0].columns.map((column: { id: string }) => column.id))
      .toEqual(['todo', 'done'])
    expect(response.body[0].columns[0]).not.toHaveProperty('workflowId')
  })

  it('updates retained workflow columns without deleting their task assignments', async () => {
    prisma.workflow.findFirst.mockResolvedValue({ id: 'workflow-1' })
    prisma.workflowColumn.findFirst.mockResolvedValue(null)
    prisma.workflow.findUniqueOrThrow.mockResolvedValue({
      id: 'workflow-1',
      ownerId: 'owner-123',
      name: 'Delivery',
      icon: '',
      color: '#0f62fe',
      templateType: 'kanban',
      order: 0,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      columns: [{ id: 'todo', workflowId: 'workflow-1', title: 'Ready', order: 0 }],
    })

    await request(createApp())
      .put('/api/workflows/workflow-1/columns')
      .set('Authorization', authorization)
      .send([{ id: 'todo', title: 'Ready', order: 0 }])
      .expect(200)

    expect(prisma.workflowColumn.deleteMany).toHaveBeenCalledWith({
      where: { workflowId: 'workflow-1', id: { notIn: ['todo'] } },
    })
    expect(prisma.workflowColumn.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'todo' },
      update: expect.objectContaining({ title: 'Ready', order: 0 }),
    }))
  })

  it('scopes list-group and Kanban-section cleanup to the authenticated user', async () => {
    prisma.list.updateMany.mockResolvedValue({ count: 1 })
    prisma.listGroup.deleteMany.mockResolvedValue({ count: 1 })
    prisma.task.updateMany.mockResolvedValue({ count: 1 })
    prisma.kanbanSection.deleteMany.mockResolvedValue({ count: 1 })

    await request(createApp())
      .delete('/api/list-groups/group-1')
      .set('Authorization', authorization)
      .expect(200)
    await request(createApp())
      .delete('/api/kanban-sections/section-1')
      .set('Authorization', authorization)
      .expect(200)

    expect(prisma.list.updateMany).toHaveBeenCalledWith({
      where: { groupId: 'group-1', ownerId: 'owner-123' },
      data: { groupId: null },
    })
    expect(prisma.listGroup.deleteMany).toHaveBeenCalledWith({
      where: { id: 'group-1', ownerId: 'owner-123' },
    })
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { sectionId: 'section-1', userId: 'owner-123' },
      data: { sectionId: null },
    })
    expect(prisma.kanbanSection.deleteMany).toHaveBeenCalledWith({
      where: { id: 'section-1', userId: 'owner-123' },
    })
  })
})

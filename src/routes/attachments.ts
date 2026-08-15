import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPrisma } from '../lib/prisma.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'

const router = Router({ mergeParams: true })
const maxBytes = 3 * 1024 * 1024
const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
])

function decodeBase64(value: string): Buffer | null {
  if (!value || value.length > Math.ceil(maxBytes / 3) * 4 + 4) return null
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null
  }
  const data = Buffer.from(value, 'base64')
  return data.toString('base64') === value ? data : null
}

async function ownedTask(taskId: string, userId: string) {
  const task = await getPrisma().task.findFirst({
    where: { id: taskId, userId },
    select: { id: true },
  })
  if (!task) throw new NotFoundError('Task', taskId)
  return task
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ownedTask(req.params.taskId, req.userId!)
    const attachments = await getPrisma().taskAttachment.findMany({
      where: { taskId: req.params.taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        filename: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    })
    res.json(attachments.map(({ id, ...attachment }) => ({ ...attachment, _id: id })))
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ownedTask(req.params.taskId, req.userId!)
    const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : ''
    const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : ''
    const dataBase64 = typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64 : ''
    if (!filename || filename.length > 255) throw new ValidationError('Invalid attachment filename')
    if (!allowedTypes.has(contentType)) throw new ValidationError('Unsupported attachment type')
    const data = decodeBase64(dataBase64)
    if (!data?.length || data.length > maxBytes) {
      throw new ValidationError('Attachment must be between 1 byte and 3 MB')
    }
    const attachment = await getPrisma().taskAttachment.create({
      data: {
        taskId: req.params.taskId,
        filename,
        contentType,
        size: data.length,
        data: Uint8Array.from(data),
      },
      select: {
        id: true,
        filename: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    })
    const { id, ...fields } = attachment
    res.status(201).json({ ...fields, _id: id })
  } catch (err) {
    next(err)
  }
})

router.get('/:attachmentId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ownedTask(req.params.taskId, req.userId!)
    const attachment = await getPrisma().taskAttachment.findFirst({
      where: { id: req.params.attachmentId, taskId: req.params.taskId },
    })
    if (!attachment) throw new NotFoundError('Attachment', req.params.attachmentId)
    res.setHeader('Content-Type', attachment.contentType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.filename.replace(/["\r\n]/g, '_')}"`,
    )
    res.send(Buffer.from(attachment.data))
  } catch (err) {
    next(err)
  }
})

router.delete('/:attachmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ownedTask(req.params.taskId, req.userId!)
    await getPrisma().taskAttachment.deleteMany({
      where: { id: req.params.attachmentId, taskId: req.params.taskId },
    })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

export default router

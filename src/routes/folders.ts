import { Router, type Request, type Response, type NextFunction } from 'express'
import { createFolder, updateFolder, deleteFolder, addTaskToFolder } from '../services/folderService.js'
import { CreateFolderSchema, UpdateFolderSchema, FolderTaskSchema, parseBody } from '../lib/validation.js'
import { ValidationError } from '../lib/errors.js'

const router = Router()

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(CreateFolderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const result = await createFolder({ ...(parsed.data as any), ownerId: req.userId! })
    res.status(201).json(result)
  } catch (err) { next(err) }
})

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(UpdateFolderSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const result = await updateFolder(req.params.id, req.userId!, parsed.data)
    res.json(result)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteFolder(req.params.id, req.userId!)
    res.json(result)
  } catch (err) { next(err) }
})

router.patch('/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = parseBody(FolderTaskSchema, req.body)
    if (!parsed.success) throw new ValidationError(parsed.error)
    const result = await addTaskToFolder(parsed.data.taskId, req.params.id, req.userId!)
    res.json(result)
  } catch (err) { next(err) }
})

export default router

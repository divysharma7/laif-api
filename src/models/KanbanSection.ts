import mongoose, { Schema } from 'mongoose'

const KanbanSectionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  order: { type: Number, default: 0 },
  userId: { type: String, required: true },
}, { timestamps: true })

KanbanSectionSchema.index({ userId: 1, order: 1 })

export default mongoose.models.KanbanSection || mongoose.model('KanbanSection', KanbanSectionSchema)

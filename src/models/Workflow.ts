import mongoose, { Schema } from 'mongoose'

const WorkflowColumnSchema = new Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  order: { type: Number, default: 0 },
  color: { type: String, default: null },
  wipLimit: { type: Number, default: null },
}, { _id: false })

const WorkflowSchema = new Schema({
  name: { type: String, required: true },
  icon: { type: String, default: '📋' },
  color: { type: String, default: '#0f62fe' },
  ownerId: { type: String, required: true },
  templateType: { type: String, enum: ['kanban', 'sprint', 'sales', 'content', 'matrix', 'custom'], default: 'kanban' },
  columns: { type: [WorkflowColumnSchema], default: [] },
  order: { type: Number, default: 0 },
  archived: { type: Boolean, default: false },
}, { timestamps: true })

WorkflowSchema.index({ ownerId: 1, archived: 1, order: 1 })

export default mongoose.models.Workflow || mongoose.model('Workflow', WorkflowSchema)

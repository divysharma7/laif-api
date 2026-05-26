import mongoose, { Schema } from 'mongoose'
const MEMORY_TYPES = ['book', 'movie', 'show', 'music', 'game', 'place', 'food', 'person', 'idea', 'quote', 'link', 'other'] as const

const MemorySchema = new Schema({
  userId:      { type: String, index: true },
  type:        { type: String, enum: MEMORY_TYPES, required: true },
  title:       { type: String, required: true },
  description: String,
  attributes:  { type: Object, default: {} },
  status:      String,
  priority:    { type: String, enum: ['low', 'medium', 'high'] },
  tags:        [String],
  linkedTaskId: String,
}, { timestamps: true })

export default mongoose.models.Memory || mongoose.model('Memory', MemorySchema)

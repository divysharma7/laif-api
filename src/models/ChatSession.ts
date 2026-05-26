import mongoose, { Schema } from 'mongoose'

const ChatSessionMessageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { _id: false })

const ChatSessionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, default: 'New chat' },
  messages: { type: [ChatSessionMessageSchema], default: [] },
}, { timestamps: true })

ChatSessionSchema.index({ userId: 1, updatedAt: -1 })

export default mongoose.models.ChatSession || mongoose.model('ChatSession', ChatSessionSchema)

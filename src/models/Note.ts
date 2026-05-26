import mongoose, { Schema } from 'mongoose'

const NoteSchema = new Schema({
  content: { type: String, default: '' },
  color: { type: String, default: '#fef9c3' },
  position: {
    x: { type: Number, default: 100 },
    y: { type: Number, default: 100 },
  },
  size: {
    w: { type: Number, default: 200 },
    h: { type: Number, default: 200 },
  },
}, { timestamps: true })

export default mongoose.models.Note || mongoose.model('Note', NoteSchema)

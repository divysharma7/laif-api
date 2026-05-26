import mongoose, { Schema } from 'mongoose'

const ListGroupSchema = new Schema({
  title: { type: String, required: true },
  ownerId: { type: String, required: true },
  order: { type: Number, default: 0 },
  collapsed: { type: Boolean, default: false },
}, { timestamps: true })

ListGroupSchema.index({ ownerId: 1, order: 1 })

export default mongoose.models.ListGroup || mongoose.model('ListGroup', ListGroupSchema)

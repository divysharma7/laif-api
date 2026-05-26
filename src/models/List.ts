import mongoose, { Schema } from 'mongoose'

const CollaboratorSchema = new Schema({
  userId: { type: String, required: true },
  email: { type: String },
  role: { type: String, enum: ['creator', 'collaborator'], default: 'collaborator' },
  pending: { type: Boolean, default: false },
  invitedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
}, { _id: false })

const ListSchema = new Schema({
  type: {
    type: String,
    enum: ['standard', 'habit', 'journal', 'notes', 'reading', 'contacts'],
    default: 'standard',
  },
  title: { type: String, default: '' },
  icon: { type: String, default: '' },
  coverImageUrl: { type: String, default: '' },
  groupId: { type: String, default: null },
  ownerId: { type: String, required: true },
  isPrivate: { type: Boolean, default: true },
  collaborators: { type: [CollaboratorSchema], default: [] },
  pinnedToFavorites: { type: Boolean, default: false },
  hideCompletedTasks: { type: Boolean, default: false },
  blocks: { type: Schema.Types.Mixed, default: null },
  isInbox: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
}, { timestamps: true })

ListSchema.index({ ownerId: 1, deletedAt: 1 })
ListSchema.index({ groupId: 1 })

export default mongoose.models.List || mongoose.model('List', ListSchema)

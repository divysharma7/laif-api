import mongoose, { Schema } from 'mongoose'

export interface INoteFolder {
  _id:    string
  name:   string
  parent: string | null
}

const NoteFolderSchema = new Schema(
  {
    _id:    { type: String, required: true },
    name:   { type: String, required: true },
    parent: { type: String, default: null },
  },
  { timestamps: true }
)

export default mongoose.models.NoteFolder || mongoose.model("NoteFolder", NoteFolderSchema)
  || mongoose.model('NoteFolder', NoteFolderSchema)

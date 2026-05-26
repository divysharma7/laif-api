import mongoose, { Schema } from 'mongoose'

const ContactSchema = new Schema({
  name:         { type: String, required: true, trim: true },
  role:         { type: String, trim: true },   // e.g. "Electrician", "ISP Helper", "Neighbour"
  phone:        { type: String, trim: true },
  email:        { type: String, trim: true },
  company:      { type: String, trim: true },
  address:      { type: String, trim: true },
  notes:        { type: String, trim: true },
  tags:         [String],
}, { timestamps: true })

export default mongoose.models.Contact || mongoose.model('Contact', ContactSchema)

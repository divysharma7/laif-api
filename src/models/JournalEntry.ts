import mongoose, { Schema } from 'mongoose'

export interface IJournalEntry {
  date:          string   // 'YYYY-MM-DD' — unique per day
  content:       string   // Tiptap JSON string
  last_summary:    string   // AI-generated summary of previous day's entry
  summary_todos:   string[] // AI-extracted carry-forward todos
  today_items:     string[] // AI-suggested focus items for today
  summary_fetched: boolean  // true once the AI recap has been attempted for this entry
  updatedAt:     Date
  createdAt:     Date
}

const JournalEntrySchema = new Schema(
  {
    date:          { type: String, required: true, unique: true, index: true },
    content:       { type: String, default: '' },
    last_summary:    { type: String,  default: '' },
    summary_todos:   [{ type: String }],
    today_items:     [{ type: String }],
    summary_fetched: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export default mongoose.models.JournalEntry || mongoose.model("JournalEntry", JournalEntrySchema)
  || mongoose.model('JournalEntry', JournalEntrySchema)

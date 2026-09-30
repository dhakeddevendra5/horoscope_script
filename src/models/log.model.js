import mongoose from "mongoose";

const logMessageSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['INFO', 'WARN', 'ERROR'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  meta: {
    type: Object,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const logSchema = new mongoose.Schema({
  targetDate: {
    type: String,
    required: true
  },
  messages: [logMessageSchema]
}, {timestamps: true});

export default mongoose.model('Log', logSchema);

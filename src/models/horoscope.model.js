import mongoose from "mongoose";

const horoscopeSchema = new mongoose.Schema({
  zodiacSign: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  day: {
    type: Number,
    required: true
  },
  month: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  weekday: String,
  signRuler: String,
  element: String,
  luckyDay: String,
  source: String,
  overallRating: String,
  physicalRating: String,
  emotionalRating: String,
  intellectualRating: String,
  spiritualRating: String,
  compatibilitySign: String,
  bestTimeToday: String,
  avoidTime: String,
  luckyNumber: Object,
  luckyColor: Object,
  snippet: String,
  keyAdvice: String,
  mainContent: String,
  todaySolution: String,
  emotion: Object,
  profession: Object,
  career: Object,
  love: Object,
  family: Object,
  health: Object,
  moneyAndFinance: Object,
  travel: Object
}, {timestamps: true});

horoscopeSchema.index({zodiacSign: 1, day: 1, month: 1, year: 1}, {unique: true});

export default mongoose.model("ZodiacTest", horoscopeSchema);

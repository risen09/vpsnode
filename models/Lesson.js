const mongoose = require('mongoose');
const { Schema } = mongoose;

const lessonBlockSchema = new Schema({
  blockType: { 
    type: String, 
    required: true,
    enum: ["paragraph", "quiz", "plot"],  // Ensures only valid types
    description: "Тип блока" 
  },

  // Paragraph fields
  content: { 
    type: String, 
    required: function() { return this.blockType === 'paragraph'; },
    default: undefined // Only exists for paragraphs
  },

  // Quiz fields
  data: {
    type: {
      question: { type: String },
      answers: [{ type: String }],
      correctAnswer: { type: Number },
      explanation: { type: String }
    },
    required: function() { return this.blockType === 'quiz'; },
    default: undefined // Only exists for quizzes
  },

  // Plot fields
  plotData: {
    type: {
      plotType: { 
        type: String, 
        enum: ['line', 'bar', 'scatter', 'pie'] 
      },
      title: { type: String },
      xlabel: { type: String },
      ylabel: { type: String },
      series: [{
        name: { type: String },
        points: [{
          x: { type: Number },
          y: { type: Number }
        }]
      }]
    },
    required: function() { return this.blockType === 'plot'; },
    default: undefined // Only exists for plots
  }
}, { 
  _id: false,  // No need for separate IDs for embedded docs
  discriminatorKey: 'type' 
});

const lessonSchema = new Schema({
  subject: { type: String, required: true },
  topic: { type: String, required: true },
  sub_topic: { type: String },
  grade: { type: Number, required: true },
  created_at: { type: Date, default: Date.now },
  content: {
    type: [lessonBlockSchema],
    required: true,
    default: []
  }
}, { collection: 'lessons', strict: false });

// Create & Export Model
module.exports = mongoose.model('Lesson', lessonSchema);
const mongoose = require('mongoose');
const { Schema } = mongoose;
const Assignment = require('./Assignment');

const lessonBlockSchema = new Schema({
  blockType: { 
    type: String, 
    required: true,
    enum: ["paragraph", "quiz", "plot", "assignment"],  // Ensures only valid types
    description: "Тип блока" 
  },

  // Paragraph fields
  content: { 
    type: String, 
    required: function() { return this.blockType === 'paragraph'; },
    default: undefined // Only exists for paragraphs
  },

  // Quiz fields
  quizData: {
    type: new Schema({
      question: { type: String },
      answers: [{ type: String }],
      correctAnswer: { type: Number },
      explanation: { type: String }
    }, { _id: false }),
    required: function() { return this.blockType === 'quiz'; },
    default: undefined // Only exists for quizzes
  },

  // Plot fields
  plotData: {
    type: new Schema({
      plotType: { 
        type: String, 
        enum: ['line', 'bar', 'scatter', 'pie'] 
      },
      title: { type: String },
      xlabel: { type: String },
      ylabel: { type: String },
      series: [new Schema({
        name: { type: String },
        points: [new Schema({
          x: { type: Number },
          y: { type: Number }
        }, { _id: false })]
      }, { _id: false })]
    }, { _id: false }),
    required: function() { return this.blockType === 'plot'; },
    default: undefined // Only exists for plots
  },

  // Homework assignment fields
  assignmentRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    default: undefined,
  },
}, {
  _id: false,  // No need for separate IDs for embedded docs
  discriminatorKey: 'type',
});

lessonBlockSchema.virtual('assignmentData').set(function(data) {
  this._assignmentData = data;
}).get(function() {
  return this._assignmentData;
});

// Improved pre-save hook
lessonBlockSchema.pre('save', async function(next) {
  if (this.blockType === 'assignment') {
    // Case 1: Already has a reference - nothing to do
    if (this.assignmentRef) return next();

    // Case 2: Has assignment data - create new assignment
    if (this._assignmentData) {
      try {
        const assignment = new Assignment({
          ...this._assignmentData,
          lessonId: this.parent()._id,
        });
        const savedAssignment = await assignment.save();
        this.assignmentRef = savedAssignment._id;
        this.parent().assignment_id = savedAssignment._id;
        return next();
      } catch (err) {
        return next(err);
      }
    }

    // Case 3: No reference and no data - error
    return next(new Error('Assignment block requires either assignmentRef or assignmentData'));
  }
  next();
});


// Add schema-level validation
lessonBlockSchema.path('assignmentRef').validate(function(value) {
  if (this.blockType !== 'assignment') return true;
  return !!value; // Must have a value if it's an assignment block
}, 'Assignment block requires an assignment reference');

const lessonSchema = new Schema({
  title: {type: String, required: false},
  subject: { type: String, required: true },
  topic: { type: String, required: true },
  sub_topic: { type: String },
  grade: { type: Number, required: true },
  created_at: { type: Date, default: Date.now },
  content: {
    type: [lessonBlockSchema],
    required: true,
    default: []
  },
  assignment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    default: undefined
  }
}, { collection: 'lessons', strict: false });

// Create & Export Model
module.exports = mongoose.model('Lesson', lessonSchema);
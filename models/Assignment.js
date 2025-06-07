const mongoose = require('mongoose');
const { Schema } = mongoose;

const assignmentSchema = new Schema({
    title: { type: String },
    tasks: [new Schema({
        task: { type: String },
        solution: { type: String },
    }, { _id: false })],
    lessonId: {  // Add this field to track which lesson owns the assignment
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson',
        required: true
    },
});

module.exports = mongoose.model('Assignment', assignmentSchema)
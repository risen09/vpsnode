const mongoose = require('mongoose');
const { Schema } = mongoose;

const submissionSchema = new Schema({
    assignment_id: {
        type: Schema.Types.ObjectId,
        ref: 'Assignment',
        required: true
    },
    task_index: {
        type: Number,
        required: true
    },
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    submission: {
        type: String,
        required: true
    },
    review: {
        verdict: {
            type: String,
            enum: ['correct', 'incorrect', 'partially_correct'],
            default: 'incorrect'
        },
        explanation: {
            type: String,
            required: false
        },
        suggestion: {
            type: String,
            required: false
        }
    },
    feedback: {
        type: String,
        required: false
    },
    submitted_at: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Submission', submissionSchema);

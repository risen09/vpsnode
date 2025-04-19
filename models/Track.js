   const mongoose = require('mongoose');

   const ScheduleSessionSchema = new mongoose.Schema({
     date: {
       type: Date,
       required: true
     },
     startTime: {
       type: String,
       required: true
     },
     endTime: {
       type: String,
       required: true
     },
     lessons: [{
       type: mongoose.Schema.Types.ObjectId,
       ref: 'Lesson'
     }],
     completed: {
       type: Boolean,
       default: false
     }
   });

   const ScheduleSchema = new mongoose.Schema({
     startDate: {
       type: Date,
       required: true
     },
     endDate: {
       type: Date,
       required: true
     },
     dailyHours: {
       type: Number,
       required: true
     },
     sessions: [ScheduleSessionSchema]
   });

   const TrackSchema = new mongoose.Schema({
     userId: {
       type: mongoose.Schema.Types.ObjectId,
       ref: 'User',
       required: true
     },
     name: {
       type: String,
       required: true
     },
     description: {
       type: String
     },
     subject: {
       type: String,
       required: true
     },
     topic: {
       type: String
     },
     lessons: [{
       type: mongoose.Schema.Types.ObjectId,
       ref: 'Lesson'
     }],
     tests: [{
       type: mongoose.Schema.Types.ObjectId,
       ref: 'Test'
     }],
     schedule: ScheduleSchema,
     createdAt: {
       type: Date,
       default: Date.now
     }
   });

   const Track = mongoose.model('Track', TrackSchema);

   module.exports = Track;

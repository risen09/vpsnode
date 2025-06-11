const mongoose = require('mongoose');
const { Schema } = mongoose;

// Define Schema
const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true,
    required: function() {
      return !this.vkProfile?.id;
    }
   },
  username: { type: String, required: true, unique: true },
  password: { type: String, 
    required: function() {
      return !this.vkProfile?.id;
    }
  },
  gender: { type: String, required: true },
  age: {
    type: Number, 
    // min: 7,
    // max: 17,
    required: true
  },
  grade: {
    type: Number,
    // min: 1,
    // max: 11,
    // required: true
  },
  personalityType: { type: String },
  avatar: { type: String },
  createdAt: { type: Date, default: Date.now },
  vkProfile: {
    id: Number,
    access_token: String,
    refresh_token: String,
    expires_at: Number,
    id_token: String,
    device_id: String
  },
}, { collection: 'users', strict: false });

// Create & Export Model
module.exports = mongoose.model('User', userSchema);
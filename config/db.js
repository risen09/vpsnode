const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB Connected!');
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    process.exit(1); // Exit on failure
  }
};

module.exports = connectDB;
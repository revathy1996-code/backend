const mongoose = require('mongoose');

async function connectToDatabase(mongoUri) {
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
}

module.exports = { connectToDatabase };

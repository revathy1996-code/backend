const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  { _id: false }
);

const vehicleSchema = new mongoose.Schema(
  {
    vehicleId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    source: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    currentLocation: { type: locationSchema, required: true },
    status: {
      type: String,
      enum: ['idle', 'moving', 'reached'],
      default: 'idle'
    },
    speedKmh: { type: Number, default: 35 },
    lastUpdated: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vehicle', vehicleSchema);

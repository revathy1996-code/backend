const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  { _id: false }
);

const routePointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    timestamp: { type: Date, required: true }
  },
  { _id: false }
);

const rerouteEventSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    reason: { type: String, required: true },
    blockedAt: { type: locationSchema, required: true },
    oldEtaMinutes: { type: Number, required: true },
    newEtaMinutes: { type: Number, required: true }
  },
  { _id: false }
);

const tripSchema = new mongoose.Schema(
  {
    vehicleId: { type: String, required: true, index: true },
    source: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    status: {
      type: String,
      enum: ['idle', 'moving', 'completed'],
      default: 'idle'
    },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    distanceKm: { type: Number, default: 0 },
    plannedDistanceKm: { type: Number, default: 0 },
    delayMinutes: { type: Number, default: 0 },
    rerouteCount: { type: Number, default: 0 },
    rerouteEvents: { type: [rerouteEventSchema], default: [] },
    routePoints: { type: [routePointSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Trip', tripSchema);

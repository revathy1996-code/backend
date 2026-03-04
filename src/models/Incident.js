const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['block', 'accident', 'congestion'], default: 'block' },
    severity: { type: Number, min: 1, max: 5, default: 3 },
    reason: { type: String, default: 'Road block detected' },
    location: { type: locationSchema, required: true },
    radiusMeters: { type: Number, default: 220 },
    status: { type: String, enum: ['active', 'resolved'], default: 'active' },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Incident', incidentSchema);

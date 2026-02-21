const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const { initializeMockData } = require('../services/simulationService');

async function getVehicles(_req, res, next) {
  try {
    console.log('[API] GET /api/vehicles');
    const vehicles = await Vehicle.find({}).sort({ vehicleId: 1 });
    res.json({ data: vehicles });
  } catch (error) {
    next(error);
  }
}

async function initMockVehicles(_req, res, next) {
  try {
    console.log('[API] POST /api/vehicles/init-mock');
    const vehicles = await initializeMockData();
    res.json({ message: 'Mock vehicles initialized', count: vehicles.length, data: vehicles });
  } catch (error) {
    next(error);
  }
}

async function getTripsByVehicle(req, res, next) {
  try {
    const { vehicleId } = req.params;
    console.log(`[API] GET /api/vehicles/trips/${vehicleId}`);
    const trips = await Trip.find({ vehicleId }).sort({ createdAt: -1 });
    res.json({ data: trips });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getVehicles,
  initMockVehicles,
  getTripsByVehicle
};

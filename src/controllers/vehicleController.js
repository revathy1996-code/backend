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

async function getVehicleOverview(req, res, next) {
  try {
    const { vehicleId } = req.params;
    console.log(`[API] GET /api/vehicles/overview/${vehicleId}`);

    const [vehicle, latestTrip] = await Promise.all([
      Vehicle.findOne({ vehicleId }),
      Trip.findOne({ vehicleId }).sort({ createdAt: -1 })
    ]);

    if (!vehicle) {
      res.status(404).json({ message: 'Vehicle not found' });
      return;
    }

    const rerouteEvents = Array.isArray(latestTrip?.rerouteEvents) ? latestTrip.rerouteEvents : [];
    const rerouteSummary = rerouteEvents.reduce(
      (accumulator, event) => {
        const oldEtaMinutes = Number(event.oldEtaMinutes || 0);
        const newEtaMinutes = Number(event.newEtaMinutes || 0);
        const deltaMinutes = newEtaMinutes - oldEtaMinutes;
        if (deltaMinutes > 0) {
          accumulator.timeLossMinutes += deltaMinutes;
        } else if (deltaMinutes < 0) {
          accumulator.timeGainMinutes += Math.abs(deltaMinutes);
        }
        return accumulator;
      },
      { timeLossMinutes: 0, timeGainMinutes: 0 }
    );

    const fuelLitersPerMinute = 0.04;
    const budgetPerFuelLiterInr = 105;
    const fuelLossLiters = rerouteSummary.timeLossMinutes * fuelLitersPerMinute;
    const fuelGainLiters = rerouteSummary.timeGainMinutes * fuelLitersPerMinute;
    const budgetLossInr = fuelLossLiters * budgetPerFuelLiterInr;
    const budgetGainInr = fuelGainLiters * budgetPerFuelLiterInr;

    res.json({
      data: {
        vehicle: {
          vehicleId: vehicle.vehicleId,
          name: vehicle.name,
          status: vehicle.status
        },
        trip: latestTrip
          ? {
              startTime: latestTrip.startTime,
              reachTime: latestTrip.endTime || null,
              status: latestTrip.status,
              distanceKm: Number((latestTrip.distanceKm || 0).toFixed(2)),
              plannedDistanceKm: Number((latestTrip.plannedDistanceKm || 0).toFixed(2)),
              delayMinutes: Number((latestTrip.delayMinutes || 0).toFixed(2)),
              rerouteCount: latestTrip.rerouteCount || 0
            }
          : {
              startTime: null,
              reachTime: null,
              status: 'idle',
              distanceKm: 0,
              plannedDistanceKm: 0,
              delayMinutes: 0,
              rerouteCount: 0
            },
        rerouteImpact: {
          totalEvents: rerouteEvents.length,
          timeLossMinutes: Number(rerouteSummary.timeLossMinutes.toFixed(2)),
          timeGainMinutes: Number(rerouteSummary.timeGainMinutes.toFixed(2)),
          fuelLossLiters: Number(fuelLossLiters.toFixed(3)),
          fuelGainLiters: Number(fuelGainLiters.toFixed(3)),
          budgetLossInr: Number(budgetLossInr.toFixed(2)),
          budgetGainInr: Number(budgetGainInr.toFixed(2))
        },
        assumptions: {
          fuelLitersPerMinute,
          budgetPerFuelLiterInr
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getVehicles,
  initMockVehicles,
  getTripsByVehicle,
  getVehicleOverview
};

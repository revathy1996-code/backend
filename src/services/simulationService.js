const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const { mockVehicleRoutes } = require('../utils/mockRoutes');

const minTickMs = Number(process.env.GPS_TICK_MIN_MS || 1000);
const maxTickMs = Number(process.env.GPS_TICK_MAX_MS || 3000);

const runtimeState = {
  isRunning: false,
  timers: new Map(),
  routeCache: new Map(),
  io: null
};

function setSocketServer(io) {
  runtimeState.io = io;
}

function getRandomTickDelay() {
  const safeMin = Number.isFinite(minTickMs) && minTickMs > 0 ? minTickMs : 1000;
  const safeMax = Number.isFinite(maxTickMs) && maxTickMs >= safeMin ? maxTickMs : safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function distanceKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return r * c;
}

function interpolateRoute(source, destination, points = 25) {
  const route = [];
  for (let i = 0; i <= points; i += 1) {
    const ratio = i / points;
    route.push({
      lat: source.lat + (destination.lat - source.lat) * ratio,
      lng: source.lng + (destination.lng - source.lng) * ratio
    });
  }
  return route;
}

async function fetchRoadRoute(source, destination) {
  const sourceParam = `${source.lng},${source.lat}`;
  const destinationParam = `${destination.lng},${destination.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${sourceParam};${destinationParam}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OSRM route request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const coordinates = payload?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('OSRM route response has no usable coordinates');
  }

  return coordinates.map(([lng, lat]) => ({ lat, lng }));
}

async function buildRoutePoints(source, destination) {
  try {
    return await fetchRoadRoute(source, destination);
  } catch (error) {
    console.error('[GPS] road route fetch failed, using straight fallback', error.message);
    return interpolateRoute(source, destination);
  }
}

async function initializeMockData() {
  await stopSimulation();
  await Promise.all([Vehicle.deleteMany({}), Trip.deleteMany({})]);

  const vehicles = await Vehicle.insertMany(
    mockVehicleRoutes.map((route) => ({
      vehicleId: route.vehicleId,
      name: route.name,
      source: route.source,
      destination: route.destination,
      currentLocation: route.source,
      status: 'idle',
      speedKmh: 35,
      lastUpdated: new Date()
    }))
  );

  await Trip.insertMany(
    mockVehicleRoutes.map((route) => ({
      vehicleId: route.vehicleId,
      source: route.source,
      destination: route.destination,
      status: 'idle',
      routePoints: [{ ...route.source, timestamp: new Date() }]
    }))
  );

  runtimeState.routeCache.clear();
  for (const route of mockVehicleRoutes) {
    const points = await buildRoutePoints(route.source, route.destination);
    runtimeState.routeCache.set(route.vehicleId, {
      points,
      currentIndex: 0
    });
  }

  emitStatus();
  emitVehicles(vehicles);

  return vehicles;
}

function emitStatus() {
  if (!runtimeState.io) {
    return;
  }

  runtimeState.io.emit('simulation:status', getSimulationStatus());
}

function normalizeVehicle(vehicleDoc) {
  return {
    id: vehicleDoc._id,
    vehicleId: vehicleDoc.vehicleId,
    name: vehicleDoc.name,
    source: vehicleDoc.source,
    destination: vehicleDoc.destination,
    currentLocation: vehicleDoc.currentLocation,
    status: vehicleDoc.status,
    speedKmh: vehicleDoc.speedKmh,
    lastUpdated: vehicleDoc.lastUpdated
  };
}

function emitVehicles(vehicles) {
  if (!runtimeState.io) {
    return;
  }

  runtimeState.io.emit(
    'simulation:update',
    vehicles.map((vehicle) => normalizeVehicle(vehicle))
  );
}

async function getVehiclesSnapshot() {
  const vehicles = await Vehicle.find({}).sort({ vehicleId: 1 });
  return vehicles.map((vehicle) => normalizeVehicle(vehicle));
}

async function tickVehicle(vehicleId) {
  const runtimeRoute = runtimeState.routeCache.get(vehicleId);
  if (!runtimeRoute) {
    return;
  }

  const vehicle = await Vehicle.findOne({ vehicleId });
  const trip = await Trip.findOne({ vehicleId }).sort({ createdAt: -1 });
  if (!vehicle || !trip) {
    return;
  }

  const nextIndex = Math.min(runtimeRoute.currentIndex + 1, runtimeRoute.points.length - 1);
  const previousPoint = runtimeRoute.points[runtimeRoute.currentIndex];
  const nextPoint = runtimeRoute.points[nextIndex];

  runtimeRoute.currentIndex = nextIndex;

  vehicle.currentLocation = nextPoint;
  vehicle.lastUpdated = new Date();
  vehicle.status = nextIndex >= runtimeRoute.points.length - 1 ? 'reached' : 'moving';

  trip.routePoints.push({ ...nextPoint, timestamp: new Date() });
  trip.distanceKm += distanceKm(previousPoint, nextPoint);
  if (trip.status === 'idle') {
    trip.status = 'moving';
  }

  if (vehicle.status === 'reached') {
    trip.status = 'completed';
    trip.endTime = new Date();
  }

  await Promise.all([vehicle.save(), trip.save()]);

  emitVehicles([vehicle]);

  if (vehicle.status === 'reached') {
    const timer = runtimeState.timers.get(vehicle.vehicleId);
    if (timer) {
      clearTimeout(timer);
      runtimeState.timers.delete(vehicle.vehicleId);
    }

    if (runtimeState.timers.size === 0) {
      runtimeState.isRunning = false;
      emitStatus();
    }
  }
}

function scheduleVehicleTick(vehicleId) {
  if (!runtimeState.isRunning) {
    return;
  }

  const delayMs = getRandomTickDelay();
  console.log(`[GPS] scheduling ${vehicleId} tick in ${delayMs}ms`);
  const timer = setTimeout(() => {
    tickVehicle(vehicleId)
      .catch((error) => {
        console.error(`Tick failed for ${vehicleId}`, error);
      })
      .finally(() => {
        if (!runtimeState.isRunning) {
          return;
        }

        if (runtimeState.timers.has(vehicleId)) {
          scheduleVehicleTick(vehicleId);
        }
      });
  }, delayMs);

  runtimeState.timers.set(vehicleId, timer);
}

async function startSimulation() {
  const vehicles = await Vehicle.find({}).sort({ vehicleId: 1 });
  if (!vehicles.length) {
    return { started: false, reason: 'No vehicles found. Initialize mock data first.' };
  }

  if (runtimeState.isRunning) {
    return { started: false, reason: 'Simulation already running.' };
  }

  runtimeState.isRunning = true;
  emitStatus();
  let activeVehicles = 0;
  const vehiclesChangedToMoving = [];

  for (const vehicle of vehicles) {
    const cached = runtimeState.routeCache.get(vehicle.vehicleId);
    if (!cached) {
      const points = await buildRoutePoints(vehicle.source, vehicle.destination);
      runtimeState.routeCache.set(vehicle.vehicleId, {
        points,
        currentIndex: 0
      });
    }

    if (vehicle.status === 'reached') {
      continue;
    }

    if (vehicle.status !== 'moving') {
      vehicle.status = 'moving';
      vehicle.lastUpdated = new Date();
      vehiclesChangedToMoving.push(vehicle);
    }

    activeVehicles += 1;
    scheduleVehicleTick(vehicle.vehicleId);
  }

  if (activeVehicles === 0) {
    runtimeState.isRunning = false;
    emitStatus();
    return { started: false, reason: 'All vehicles already reached destination. Re-initialize mock data.' };
  }

  if (vehiclesChangedToMoving.length > 0) {
    await Promise.all(vehiclesChangedToMoving.map((vehicle) => vehicle.save()));
    emitVehicles(vehiclesChangedToMoving);
  }

  return { started: true };
}

async function stopSimulation() {
  for (const timer of runtimeState.timers.values()) {
    clearTimeout(timer);
  }

  runtimeState.timers.clear();
  runtimeState.isRunning = false;
  emitStatus();

  return { stopped: true };
}

function getSimulationStatus() {
  return { isRunning: runtimeState.isRunning, activeVehicles: runtimeState.timers.size };
}

module.exports = {
  setSocketServer,
  initializeMockData,
  startSimulation,
  stopSimulation,
  getSimulationStatus,
  getVehiclesSnapshot
};

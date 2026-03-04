const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const Incident = require('../models/Incident');
const { mockVehicleRoutes } = require('../utils/mockRoutes');

const minTickMs = Number(process.env.GPS_TICK_MIN_MS || 1000);
const maxTickMs = Number(process.env.GPS_TICK_MAX_MS || 3000);
const osrmTimeoutMs = Number(process.env.OSRM_TIMEOUT_MS || 8000);
const osrmBaseUrl = (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');

const runtimeState = {
  isRunning: false,
  timers: new Map(),
  routeCache: new Map(),
  rerouteCooldowns: new Map(),
  io: null,
  incidentTimer: null,
  recentReroutes: []
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

function distanceMeters(a, b) {
  return distanceKm(a, b) * 1000;
}

function isRerouteCooldownActive(vehicleId) {
  const cooldownUntil = runtimeState.rerouteCooldowns.get(vehicleId);
  if (!cooldownUntil) {
    return false;
  }
  if (Date.now() >= cooldownUntil) {
    runtimeState.rerouteCooldowns.delete(vehicleId);
    return false;
  }
  return true;
}

function setRerouteCooldown(vehicleId, cooldownMs = 6000) {
  runtimeState.rerouteCooldowns.set(vehicleId, Date.now() + cooldownMs);
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

function estimateDistanceForPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceKm(points[i - 1], points[i]);
  }
  return total;
}

function estimateEtaMinutes(points, currentIndex, speedKmh) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  const safeIndex = Math.max(0, Math.min(currentIndex, points.length - 1));
  let remainingKm = 0;
  for (let i = safeIndex + 1; i < points.length; i += 1) {
    remainingKm += distanceKm(points[i - 1], points[i]);
  }

  const safeSpeed = Math.max(10, speedKmh || 35);
  return (remainingKm / safeSpeed) * 60;
}

function offsetPoint(point, northMeters, eastMeters) {
  const dLat = northMeters / 111320;
  const dLng = eastMeters / (111320 * Math.cos((point.lat * Math.PI) / 180));
  return { lat: point.lat + dLat, lng: point.lng + dLng };
}

function toLocationPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function normalizeRoutePoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .map((point) => toLocationPoint(point))
    .filter((point) => point !== null);
}

async function fetchRoadRoute(source, destination) {
  const sourceParam = `${source.lng},${source.lat}`;
  const destinationParam = `${destination.lng},${destination.lat}`;
  const url = `${osrmBaseUrl}/route/v1/driving/${sourceParam};${destinationParam}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(osrmTimeoutMs) && osrmTimeoutMs > 0 ? osrmTimeoutMs : 8000;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`OSRM route request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

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

async function buildAlternateRoute(source, destination) {
  const midpoint = {
    lat: (source.lat + destination.lat) / 2,
    lng: (source.lng + destination.lng) / 2
  };
  const waypoint = offsetPoint(midpoint, 380, -320);

  try {
    const firstLeg = await fetchRoadRoute(source, waypoint);
    const secondLeg = await fetchRoadRoute(waypoint, destination);
    return [...firstLeg, ...secondLeg.slice(1)];
  } catch (_error) {
    return interpolateRoute(source, destination, 30);
  }
}

function generateIncidentId() {
  return `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
    rerouteCount: vehicleDoc.rerouteCount || 0,
    totalDelayMinutes: vehicleDoc.totalDelayMinutes || 0,
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

async function listIncidents() {
  return Incident.find({ status: 'active' }).sort({ createdAt: -1 }).limit(50);
}

async function emitIncidents() {
  if (!runtimeState.io) {
    return;
  }
  const incidents = await listIncidents();
  runtimeState.io.emit('incidents:update', incidents);
}

async function getVehiclesSnapshot() {
  const vehicles = await Vehicle.find({}).sort({ vehicleId: 1 });
  return vehicles.map((vehicle) => normalizeVehicle(vehicle));
}

async function emitRerouteEvent(event) {
  runtimeState.recentReroutes.unshift(event);
  runtimeState.recentReroutes = runtimeState.recentReroutes.slice(0, 40);
  if (runtimeState.io) {
    runtimeState.io.emit('simulation:reroute', event);
  }
}

async function createIncident(data) {
  const incident = await Incident.create({
    incidentId: generateIncidentId(),
    type: data.type || 'block',
    severity: data.severity || 3,
    reason: data.reason || 'Road block detected',
    location: data.location,
    radiusMeters: data.radiusMeters || 220,
    status: 'active'
  });
  await emitIncidents();
  return incident;
}

async function createManualIncident(payload) {
  const location = payload?.location;
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    throw new Error('location.lat and location.lng are required numbers');
  }

  return createIncident({
    type: payload.type || 'block',
    severity: payload.severity || 3,
    reason: payload.reason || 'Manual road block',
    location,
    radiusMeters: payload.radiusMeters || 260
  });
}

async function createIncidentNearVehicle(vehicleId) {
  const vehicle = await Vehicle.findOne({ vehicleId });
  if (!vehicle) {
    return null;
  }

  return createIncident({
    type: 'block',
    severity: 4,
    reason: `Block near ${vehicleId}`,
    location: offsetPoint(vehicle.currentLocation, 120, -90),
    radiusMeters: 260
  });
}

async function resolveIncident(incidentId) {
  const incident = await Incident.findOne({ incidentId, status: 'active' });
  if (!incident) {
    return null;
  }

  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  await incident.save();
  await emitIncidents();
  return incident;
}

async function selectVehicleForIncident(incident, preferredVehicleId) {
  if (preferredVehicleId) {
    const preferredVehicle = await Vehicle.findOne({ vehicleId: preferredVehicleId });
    if (preferredVehicle && preferredVehicle.status !== 'reached') {
      return preferredVehicle;
    }
  }

  const candidates = await Vehicle.find({ status: { $ne: 'reached' } }).sort({ vehicleId: 1 });
  if (!candidates.length) {
    return null;
  }

  const movingCandidates = candidates.filter((vehicle) => vehicle.status === 'moving');
  const pool = movingCandidates.length ? movingCandidates : candidates;

  let selectedVehicle = pool[0];
  let selectedDistance = distanceMeters(selectedVehicle.currentLocation, incident.location);
  for (const candidate of pool.slice(1)) {
    const candidateDistance = distanceMeters(candidate.currentLocation, incident.location);
    if (candidateDistance < selectedDistance) {
      selectedVehicle = candidate;
      selectedDistance = candidateDistance;
    }
  }

  return selectedVehicle;
}

async function getRemainingVehicleRoutePoints(vehicle) {
  const currentLocation = toLocationPoint(vehicle.currentLocation);
  const destination = toLocationPoint(vehicle.destination);
  if (!currentLocation || !destination) {
    return [];
  }

  const runtimeRoute = runtimeState.routeCache.get(vehicle.vehicleId);
  if (!runtimeRoute || !Array.isArray(runtimeRoute.points) || runtimeRoute.points.length < 2) {
    return buildRoutePoints(currentLocation, destination);
  }

  const safeIndex = Math.max(0, Math.min(runtimeRoute.currentIndex, runtimeRoute.points.length - 1));
  const remainingPoints = normalizeRoutePoints(runtimeRoute.points.slice(safeIndex));
  if (!remainingPoints.length) {
    return [currentLocation, destination];
  }

  if (distanceMeters(remainingPoints[0], currentLocation) > 5) {
    remainingPoints.unshift(currentLocation);
  } else {
    remainingPoints[0] = currentLocation;
  }

  if (remainingPoints.length < 2) {
    remainingPoints.push(destination);
  }

  return remainingPoints;
}

async function buildIncidentRoutingPreview(incident, options = {}) {
  const vehicle = await selectVehicleForIncident(incident, options.vehicleId);
  if (!vehicle) {
    return null;
  }

  const currentLocation = toLocationPoint(vehicle.currentLocation);
  const defaultDestination = toLocationPoint(vehicle.destination);
  const proposedDestination = toLocationPoint(options.destination) || defaultDestination;
  if (!currentLocation || !proposedDestination) {
    return null;
  }

  const currentRoutePoints = await getRemainingVehicleRoutePoints(vehicle);
  let alternateRoutePoints = await buildAlternateRoute(currentLocation, proposedDestination);
  alternateRoutePoints = normalizeRoutePoints(alternateRoutePoints);

  if (!alternateRoutePoints.length) {
    alternateRoutePoints = [currentLocation, proposedDestination];
  }

  if (distanceMeters(alternateRoutePoints[0], currentLocation) > 5) {
    alternateRoutePoints.unshift(currentLocation);
  } else {
    alternateRoutePoints[0] = currentLocation;
  }

  if (alternateRoutePoints.length < 2) {
    alternateRoutePoints.push(proposedDestination);
  } else {
    alternateRoutePoints[alternateRoutePoints.length - 1] = proposedDestination;
  }

  const safeCurrentRoute =
    currentRoutePoints.length >= 2 ? currentRoutePoints : [currentLocation, proposedDestination];

  return {
    vehicle,
    currentRoutePoints: safeCurrentRoute,
    alternateRoutePoints,
    proposedDestination
  };
}

async function getIncidentResolvePreview(incidentId, options = {}) {
  const incident = await Incident.findOne({ incidentId, status: 'active' });
  if (!incident) {
    return null;
  }

  const preview = await buildIncidentRoutingPreview(incident, options);
  if (!preview) {
    return {
      incident,
      vehicle: null,
      currentRoutePoints: [],
      alternateRoutePoints: [],
      proposedDestination: null,
      heatmapPoints: []
    };
  }

  const heatmap = await getCongestionHeatmap();
  return {
    incident,
    vehicle: normalizeVehicle(preview.vehicle),
    currentRoutePoints: preview.currentRoutePoints,
    alternateRoutePoints: preview.alternateRoutePoints,
    proposedDestination: preview.proposedDestination,
    heatmapPoints: heatmap.points
  };
}

async function applyIncidentAlternateRoute(incidentId, payload = {}) {
  const incident = await Incident.findOne({ incidentId, status: 'active' });
  if (!incident) {
    return null;
  }

  const preview = await buildIncidentRoutingPreview(incident, payload);
  if (!preview) {
    throw new Error('No active vehicle is available for this incident');
  }

  const vehicle = preview.vehicle;
  const currentLocation = toLocationPoint(vehicle.currentLocation);
  if (!currentLocation) {
    throw new Error('Vehicle current location is invalid');
  }

  let selectedRoutePoints = normalizeRoutePoints(payload.routePoints);
  if (!selectedRoutePoints.length) {
    selectedRoutePoints = preview.alternateRoutePoints;
  }
  if (selectedRoutePoints.length < 2) {
    throw new Error('routePoints must include at least two coordinates');
  }

  selectedRoutePoints[0] = currentLocation;
  const newDestination =
    toLocationPoint(payload.destination) ||
    toLocationPoint(selectedRoutePoints[selectedRoutePoints.length - 1]) ||
    preview.proposedDestination;
  if (!newDestination) {
    throw new Error('destination is required');
  }
  selectedRoutePoints[selectedRoutePoints.length - 1] = newDestination;

  const oldEtaMinutes = estimateEtaMinutes(preview.currentRoutePoints, 0, vehicle.speedKmh);
  const newEtaMinutes = estimateEtaMinutes(selectedRoutePoints, 0, vehicle.speedKmh);
  const addedDelay = Math.max(0, newEtaMinutes - oldEtaMinutes);

  const trip = await Trip.findOne({ vehicleId: vehicle.vehicleId }).sort({ createdAt: -1 });
  if (trip) {
    trip.destination = newDestination;
    trip.rerouteCount = (trip.rerouteCount || 0) + 1;
    trip.delayMinutes = Number((trip.delayMinutes + addedDelay).toFixed(2));
    trip.plannedDistanceKm = Number(
      ((trip.distanceKm || 0) + estimateDistanceForPoints(selectedRoutePoints)).toFixed(2)
    );
    if (trip.status === 'idle' && runtimeState.isRunning) {
      trip.status = 'moving';
    }

    const event = {
      vehicleId: vehicle.vehicleId,
      timestamp: new Date(),
      reason: `Manual alternate route applied for ${incident.incidentId}`,
      blockedAt: currentLocation,
      oldEtaMinutes: Number(oldEtaMinutes.toFixed(2)),
      newEtaMinutes: Number(newEtaMinutes.toFixed(2))
    };

    trip.rerouteEvents.push(event);
    await trip.save();
    await emitRerouteEvent(event);
  }

  vehicle.destination = newDestination;
  vehicle.rerouteCount = (vehicle.rerouteCount || 0) + 1;
  vehicle.totalDelayMinutes = Number((vehicle.totalDelayMinutes + addedDelay).toFixed(2));
  vehicle.lastUpdated = new Date();
  if (vehicle.status !== 'reached') {
    vehicle.status = runtimeState.isRunning ? 'moving' : vehicle.status;
  }
  await vehicle.save();

  runtimeState.routeCache.set(vehicle.vehicleId, {
    points: selectedRoutePoints,
    currentIndex: 0
  });

  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  await incident.save();

  emitVehicles([vehicle]);
  await emitIncidents();

  return {
    incident,
    vehicle: normalizeVehicle(vehicle),
    routePoints: selectedRoutePoints,
    destination: newDestination
  };
}

async function maybeCreateRandomIncident() {
  if (!runtimeState.isRunning || Math.random() > 0.35) {
    return;
  }

  const movingVehicles = await Vehicle.find({ status: 'moving' });
  if (!movingVehicles.length) {
    return;
  }

  const vehicle = movingVehicles[Math.floor(Math.random() * movingVehicles.length)];
  const location = offsetPoint(
    vehicle.currentLocation,
    Math.floor(Math.random() * 240) - 120,
    Math.floor(Math.random() * 240) - 120
  );

  await createIncident({
    type: 'block',
    severity: 2 + Math.floor(Math.random() * 3),
    reason: 'Temporary road block',
    location,
    radiusMeters: 180 + Math.floor(Math.random() * 140)
  });
}

function scheduleIncidentPulse() {
  if (runtimeState.incidentTimer) {
    clearInterval(runtimeState.incidentTimer);
  }

  runtimeState.incidentTimer = setInterval(() => {
    maybeCreateRandomIncident().catch((error) => {
      console.error('Incident pulse failed', error);
    });
  }, 20000);
}

async function rerouteVehicle(vehicle, trip, runtimeRoute, blockingIncident) {
  const oldEtaMinutes = estimateEtaMinutes(runtimeRoute.points, runtimeRoute.currentIndex, vehicle.speedKmh);
  let newPoints = normalizeRoutePoints(
    await buildAlternateRoute(vehicle.currentLocation, vehicle.destination)
  );

  // Avoid immediate re-reroute loops by skipping blocked prefix points.
  if (newPoints.length >= 2) {
    const firstSafeIndex = newPoints.findIndex(
      (point, index) => index > 0 && distanceMeters(point, blockingIncident.location) > blockingIncident.radiusMeters
    );
    if (firstSafeIndex > 1) {
      newPoints = [newPoints[0], ...newPoints.slice(firstSafeIndex)];
    }
  }

  if (newPoints.length < 2) {
    const current = toLocationPoint(vehicle.currentLocation);
    const destination = toLocationPoint(vehicle.destination);
    if (current && destination) {
      newPoints = [current, destination];
    }
  }

  runtimeState.routeCache.set(vehicle.vehicleId, {
    points: newPoints,
    currentIndex: 0
  });
  setRerouteCooldown(vehicle.vehicleId);

  const newEtaMinutes = estimateEtaMinutes(newPoints, 0, vehicle.speedKmh);
  const addedDelay = Math.max(1, newEtaMinutes - oldEtaMinutes) + Math.max(0.5, blockingIncident.severity / 2);

  vehicle.rerouteCount = (vehicle.rerouteCount || 0) + 1;
  vehicle.totalDelayMinutes = Number((vehicle.totalDelayMinutes + addedDelay).toFixed(2));

  trip.rerouteCount = (trip.rerouteCount || 0) + 1;
  trip.delayMinutes = Number((trip.delayMinutes + addedDelay).toFixed(2));

  const event = {
    vehicleId: vehicle.vehicleId,
    timestamp: new Date(),
    reason: blockingIncident.reason,
    blockedAt: vehicle.currentLocation,
    oldEtaMinutes: Number(oldEtaMinutes.toFixed(2)),
    newEtaMinutes: Number(newEtaMinutes.toFixed(2))
  };

  trip.rerouteEvents.push(event);
  await Promise.all([vehicle.save(), trip.save()]);
  emitVehicles([vehicle]);
  await emitRerouteEvent(event);
}

async function tickVehicle(vehicleId) {
  const runtimeRoute = runtimeState.routeCache.get(vehicleId);
  if (!runtimeRoute) {
    return;
  }

  const [vehicle, trip, incidents] = await Promise.all([
    Vehicle.findOne({ vehicleId }),
    Trip.findOne({ vehicleId }).sort({ createdAt: -1 }),
    listIncidents()
  ]);

  if (!vehicle || !trip) {
    return;
  }

  const nextIndex = Math.min(runtimeRoute.currentIndex + 1, runtimeRoute.points.length - 1);
  const previousPoint = runtimeRoute.points[runtimeRoute.currentIndex];
  const nextPoint = runtimeRoute.points[nextIndex];

  const blockingIncident = incidents.find(
    (incident) => distanceMeters(nextPoint, incident.location) <= incident.radiusMeters
  );

  if (blockingIncident && !isRerouteCooldownActive(vehicle.vehicleId)) {
    await rerouteVehicle(vehicle, trip, runtimeRoute, blockingIncident);
    return;
  }

  const nearbyIncident = incidents.find(
    (incident) => distanceMeters(nextPoint, incident.location) <= incident.radiusMeters * 2
  );
  const baseSpeed = 36 + Math.floor(Math.random() * 8);
  const congestionPenalty = nearbyIncident ? nearbyIncident.severity * 2.4 : 0;
  vehicle.speedKmh = Math.max(14, Number((baseSpeed - congestionPenalty).toFixed(1)));

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

async function initializeMockData() {
  await stopSimulation();
  await Promise.all([Vehicle.deleteMany({}), Trip.deleteMany({}), Incident.deleteMany({})]);

  const routePlans = [];
  for (const route of mockVehicleRoutes) {
    const points = await buildRoutePoints(route.source, route.destination);
    routePlans.push({ vehicleId: route.vehicleId, points });
  }
  const planMap = new Map(routePlans.map((entry) => [entry.vehicleId, entry.points]));

  const vehicles = await Vehicle.insertMany(
    mockVehicleRoutes.map((route) => ({
      vehicleId: route.vehicleId,
      name: route.name,
      source: route.source,
      destination: route.destination,
      currentLocation: route.source,
      status: 'idle',
      rerouteCount: 0,
      totalDelayMinutes: 0,
      speedKmh: 35,
      lastUpdated: new Date()
    }))
  );

  await Trip.insertMany(
    mockVehicleRoutes.map((route) => {
      const plannedPoints = planMap.get(route.vehicleId) || [];
      return {
        vehicleId: route.vehicleId,
        source: route.source,
        destination: route.destination,
        status: 'idle',
        distanceKm: 0,
        plannedDistanceKm: estimateDistanceForPoints(plannedPoints),
        delayMinutes: 0,
        rerouteCount: 0,
        rerouteEvents: [],
        routePoints: [{ ...route.source, timestamp: new Date() }]
      };
    })
  );

  runtimeState.routeCache.clear();
  runtimeState.rerouteCooldowns.clear();
  for (const route of routePlans) {
    runtimeState.routeCache.set(route.vehicleId, {
      points: route.points,
      currentIndex: 0
    });
  }

  runtimeState.recentReroutes = [];
  emitStatus();
  emitVehicles(vehicles);
  await emitIncidents();
  return vehicles;
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
  scheduleIncidentPulse();

  let activeVehicles = 0;
  const vehiclesChangedToMoving = [];

  for (const vehicle of vehicles) {
    const cached = runtimeState.routeCache.get(vehicle.vehicleId);
    if (!cached) {
      const points = await buildRoutePoints(vehicle.source, vehicle.destination);
      runtimeState.routeCache.set(vehicle.vehicleId, { points, currentIndex: 0 });
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

  if (runtimeState.incidentTimer) {
    clearInterval(runtimeState.incidentTimer);
    runtimeState.incidentTimer = null;
  }

  runtimeState.isRunning = false;
  runtimeState.rerouteCooldowns.clear();
  emitStatus();
  return { stopped: true };
}

function getSimulationStatus() {
  return { isRunning: runtimeState.isRunning, activeVehicles: runtimeState.timers.size };
}

async function getCongestionHeatmap() {
  const [vehicles, incidents] = await Promise.all([
    Vehicle.find({}).sort({ vehicleId: 1 }),
    listIncidents()
  ]);

  const points = vehicles.map((vehicle) => {
    const nearbyIncident = incidents.find(
      (incident) => distanceMeters(vehicle.currentLocation, incident.location) <= incident.radiusMeters * 2
    );
    const speedFactor = 1 - Math.min(vehicle.speedKmh, 45) / 45;
    const incidentFactor = nearbyIncident ? nearbyIncident.severity / 5 : 0;
    const intensity = Number(Math.min(1, speedFactor + incidentFactor).toFixed(2));

    return {
      vehicleId: vehicle.vehicleId,
      lat: vehicle.currentLocation.lat,
      lng: vehicle.currentLocation.lng,
      intensity,
      speedKmh: vehicle.speedKmh,
      congestionLevel: intensity >= 0.66 ? 'high' : intensity >= 0.33 ? 'medium' : 'low'
    };
  });

  return { generatedAt: new Date(), points };
}

async function getPerformanceAnalytics() {
  const [vehicles, trips] = await Promise.all([
    Vehicle.find({}).sort({ vehicleId: 1 }),
    Trip.find({}).sort({ createdAt: -1 }).limit(200)
  ]);

  const completedTrips = trips.filter((trip) => trip.status === 'completed');
  const totalTrips = trips.length;
  const onTimeTrips = completedTrips.filter((trip) => (trip.delayMinutes || 0) <= 5).length;

  const sum = (values) => values.reduce((total, value) => total + value, 0);

  const avgDelayMinutes = totalTrips ? sum(trips.map((trip) => trip.delayMinutes || 0)) / totalTrips : 0;
  const avgReroutesPerTrip = totalTrips ? sum(trips.map((trip) => trip.rerouteCount || 0)) / totalTrips : 0;
  const efficiencies = trips.map((trip) => {
    const planned = trip.plannedDistanceKm || trip.distanceKm || 1;
    return Math.min(2, (trip.distanceKm || 0) / planned);
  });
  const avgRouteEfficiency = efficiencies.length ? sum(efficiencies) / efficiencies.length : 1;
  const fuelProxyScore = sum(
    trips.map((trip) => (trip.distanceKm || 0) * 0.28 + (trip.delayMinutes || 0) * 0.04)
  );

  return {
    summary: {
      totalVehicles: vehicles.length,
      totalTrips,
      completedTrips: completedTrips.length,
      onTimeDeliveryPct: Number((totalTrips ? (onTimeTrips / totalTrips) * 100 : 0).toFixed(2)),
      avgDelayMinutes: Number(avgDelayMinutes.toFixed(2)),
      avgReroutesPerTrip: Number(avgReroutesPerTrip.toFixed(2)),
      avgRouteEfficiency: Number(avgRouteEfficiency.toFixed(2)),
      fuelProxyScore: Number(fuelProxyScore.toFixed(2))
    },
    vehicleBreakdown: vehicles.map((vehicle) => ({
      vehicleId: vehicle.vehicleId,
      status: vehicle.status,
      rerouteCount: vehicle.rerouteCount || 0,
      totalDelayMinutes: Number((vehicle.totalDelayMinutes || 0).toFixed(2)),
      speedKmh: vehicle.speedKmh
    })),
    recentReroutes: runtimeState.recentReroutes.slice(0, 10)
  };
}

function getRecentReroutes() {
  return runtimeState.recentReroutes.slice(0, 20);
}

module.exports = {
  setSocketServer,
  initializeMockData,
  startSimulation,
  stopSimulation,
  getSimulationStatus,
  getVehiclesSnapshot,
  listIncidents,
  createManualIncident,
  createIncidentNearVehicle,
  resolveIncident,
  getIncidentResolvePreview,
  applyIncidentAlternateRoute,
  getCongestionHeatmap,
  getPerformanceAnalytics,
  getRecentReroutes
};

const {
  listIncidents,
  createManualIncident,
  createIncidentNearVehicle,
  resolveIncident,
  getRecentReroutes,
  getIncidentResolvePreview,
  applyIncidentAlternateRoute
} = require('../services/simulationService');

async function list(_req, res, next) {
  try {
    const incidents = await listIncidents();
    res.json({ data: incidents });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const incident = await createManualIncident(req.body || {});
    res.status(201).json({ data: incident });
  } catch (error) {
    next(error);
  }
}

async function injectNearVehicle(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const incident = await createIncidentNearVehicle(vehicleId);
    if (!incident) {
      res.status(404).json({ message: 'Vehicle not found' });
      return;
    }
    res.status(201).json({ data: incident });
  } catch (error) {
    next(error);
  }
}

async function resolve(req, res, next) {
  try {
    const { incidentId } = req.params;
    const incident = await resolveIncident(incidentId);
    if (!incident) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    res.json({ data: incident });
  } catch (error) {
    next(error);
  }
}

async function resolvePreview(req, res, next) {
  try {
    const { incidentId } = req.params;
    const { vehicleId, destinationLat, destinationLng } = req.query;
    const destination =
      Number.isFinite(Number(destinationLat)) && Number.isFinite(Number(destinationLng))
        ? { lat: Number(destinationLat), lng: Number(destinationLng) }
        : undefined;

    const preview = await getIncidentResolvePreview(incidentId, { vehicleId, destination });
    if (!preview) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    if (!preview.vehicle) {
      res.status(400).json({ message: 'No active vehicle available for this incident' });
      return;
    }

    res.json({ data: preview });
  } catch (error) {
    next(error);
  }
}

async function applyRoute(req, res, next) {
  try {
    const { incidentId } = req.params;
    const result = await applyIncidentAlternateRoute(incidentId, req.body || {});
    if (!result) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

function reroutes(_req, res) {
  res.json({ data: getRecentReroutes() });
}

module.exports = {
  list,
  create,
  injectNearVehicle,
  resolvePreview,
  applyRoute,
  resolve,
  reroutes
};

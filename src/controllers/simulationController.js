const {
  getSimulationStatus,
  startSimulation,
  stopSimulation
} = require('../services/simulationService');

async function start(req, res, next) {
  try {
    console.log('[API] POST /api/simulation/start');
    const result = await startSimulation();
    const statusCode = result.started ? 200 : 400;
    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
}

async function stop(_req, res, next) {
  try {
    console.log('[API] POST /api/simulation/stop');
    const result = await stopSimulation();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

function status(_req, res) {
  console.log('[API] GET /api/simulation/status');
  res.json(getSimulationStatus());
}

module.exports = {
  start,
  stop,
  status
};

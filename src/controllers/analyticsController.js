const { getCongestionHeatmap, getPerformanceAnalytics } = require('../services/simulationService');

async function congestionHeatmap(_req, res, next) {
  try {
    const data = await getCongestionHeatmap();
    res.json(data);
  } catch (error) {
    next(error);
  }
}

async function summary(_req, res, next) {
  try {
    const analytics = await getPerformanceAnalytics();
    res.json(analytics);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  congestionHeatmap,
  summary
};

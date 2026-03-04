const {
  getSimulationStatus,
  getVehiclesSnapshot,
  listIncidents,
  getRecentReroutes
} = require('../services/simulationService');

function registerSocketHandlers(io) {
  io.on('connection', async (socket) => {
    socket.emit('simulation:status', getSimulationStatus());
    try {
      const vehicles = await getVehiclesSnapshot();
      socket.emit('simulation:update', vehicles);
      const incidents = await listIncidents();
      socket.emit('incidents:update', incidents);
      socket.emit('simulation:reroute:history', getRecentReroutes());
    } catch (error) {
      console.error('[Socket] failed to emit vehicles snapshot on connect', error);
    }

    socket.on('disconnect', () => {
      // Client disconnected.
    });
  });
}

module.exports = { registerSocketHandlers };

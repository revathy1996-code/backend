const { getSimulationStatus, getVehiclesSnapshot } = require('../services/simulationService');

function registerSocketHandlers(io) {
  io.on('connection', async (socket) => {
    socket.emit('simulation:status', getSimulationStatus());
    try {
      const vehicles = await getVehiclesSnapshot();
      socket.emit('simulation:update', vehicles);
    } catch (error) {
      console.error('[Socket] failed to emit vehicles snapshot on connect', error);
    }

    socket.on('disconnect', () => {
      // Client disconnected.
    });
  });
}

module.exports = { registerSocketHandlers };

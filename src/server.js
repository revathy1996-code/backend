require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { connectToDatabase } = require('./config/db');
const { registerSocketHandlers } = require('./sockets');
const { setSocketServer } = require('./services/simulationService');
const { getAllowedOrigins } = require('./config/cors');

const port = Number(process.env.PORT || 5000);
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fleet_management';
const allowedOrigins = getAllowedOrigins();

async function bootstrap() {
  await connectToDatabase(mongoUri);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins
    }
  });

  setSocketServer(io);
  registerSocketHandlers(io);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});

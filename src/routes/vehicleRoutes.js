const express = require('express');
const {
  getVehicles,
  getTripsByVehicle,
  initMockVehicles,
  getVehicleOverview
} = require('../controllers/vehicleController');

const router = express.Router();

router.get('/', getVehicles);
router.post('/init-mock', initMockVehicles);
router.get('/overview/:vehicleId', getVehicleOverview);
router.get('/trips/:vehicleId', getTripsByVehicle);

module.exports = router;

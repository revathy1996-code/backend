const express = require('express');
const {
  list,
  create,
  injectNearVehicle,
  resolvePreview,
  applyRoute,
  resolve,
  reroutes
} = require('../controllers/incidentController');

const router = express.Router();

router.get('/', list);
router.get('/reroutes', reroutes);
router.post('/', create);
router.post('/inject/:vehicleId', injectNearVehicle);
router.get('/:incidentId/resolve-preview', resolvePreview);
router.post('/:incidentId/apply-route', applyRoute);
router.patch('/:incidentId/resolve', resolve);

module.exports = router;

const express = require('express');
const { start, status, stop } = require('../controllers/simulationController');

const router = express.Router();

router.post('/start', start);
router.post('/stop', stop);
router.get('/status', status);

module.exports = router;

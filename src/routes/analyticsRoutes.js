const express = require('express');
const { congestionHeatmap, summary } = require('../controllers/analyticsController');

const router = express.Router();

router.get('/congestion-heatmap', congestionHeatmap);
router.get('/summary', summary);

module.exports = router;

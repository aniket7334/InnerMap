const router = require('express').Router();
const ctrl = require('../controllers/preferenceController');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.get));
router.put(
  '/',
  // null is accepted for the default-view fields (clears them); the controller checks they come together.
  validateBody({
    mapProvider: ['providerId', { optional: true }],
    defaultLat: ['latitude', { optional: true }],
    defaultLng: ['longitude', { optional: true }],
    defaultZoom: ['zoom', { optional: true }],
    showDownloadedAreas: ['boolean', { optional: true }],
  }),
  asyncHandler(ctrl.update)
);

module.exports = router;

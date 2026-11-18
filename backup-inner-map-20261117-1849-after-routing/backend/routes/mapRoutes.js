const router = require('express').Router();
const ctrl = require('../controllers/mapController');
const { requireAuth } = require('../middleware/auth');
const { validateBody, parseIdParam } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post(
  '/',
  validateBody({
    mapName: 'locationName',
    region: 'bounds',
    zoomMin: 'zoom',
    zoomMax: 'zoom',
    storageSize: ['bytes', { optional: true }],
    downloadStatus: ['downloadStatus', { optional: true }],
  }),
  asyncHandler(ctrl.create)
);
router.delete('/:id', parseIdParam, asyncHandler(ctrl.remove));

module.exports = router;

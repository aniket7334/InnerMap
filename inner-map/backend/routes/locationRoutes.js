const router = require('express').Router();
const ctrl = require('../controllers/locationController');
const { requireAuth } = require('../middleware/auth');
const { validateBody, parseIdParam } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post(
  '/',
  validateBody({ name: 'locationName', latitude: 'latitude', longitude: 'longitude' }),
  asyncHandler(ctrl.create)
);
router.put(
  '/:id',
  parseIdParam,
  validateBody({
    name: ['locationName', { optional: true }],
    latitude: ['latitude', { optional: true }],
    longitude: ['longitude', { optional: true }],
  }),
  asyncHandler(ctrl.update)
);
router.delete('/:id', parseIdParam, asyncHandler(ctrl.remove));

module.exports = router;

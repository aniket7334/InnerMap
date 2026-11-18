const router = require('express').Router();
const ctrl = require('../controllers/layerController');
const { requireAuth } = require('../middleware/auth');
const { validateBody, parseIdParam } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post('/', validateBody({ name: 'locationName' }), asyncHandler(ctrl.create)); // features validated in controller
router.put('/:id', parseIdParam, validateBody({ name: 'locationName' }), asyncHandler(ctrl.rename));
router.delete('/:id', parseIdParam, asyncHandler(ctrl.remove));
router.get('/:id/features', parseIdParam, asyncHandler(ctrl.listFeatures));
router.post('/:id/features', parseIdParam, asyncHandler(ctrl.addFeatures));

module.exports = router;

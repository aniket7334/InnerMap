const router = require('express').Router();
const ctrl = require('../controllers/layerController');
const { requireAuth } = require('../middleware/auth');
const { parseIdParam } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.put('/:id', parseIdParam, asyncHandler(ctrl.updateFeature));
router.delete('/:id', parseIdParam, asyncHandler(ctrl.removeFeature));

module.exports = router;

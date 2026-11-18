const router = require('express').Router();
const ctrl = require('../controllers/historyController');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

router.use(requireAuth);

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.record)); // validated inside the controller (single point or batch)
router.delete('/', asyncHandler(ctrl.clear));

module.exports = router;

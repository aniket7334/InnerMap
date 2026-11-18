const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');

// Slow down password guessing: 20 attempts per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

router.post(
  '/register',
  authLimiter,
  validateBody({ name: 'name', email: 'email', password: 'password' }),
  asyncHandler(ctrl.register)
);

router.post(
  '/login',
  authLimiter,
  validateBody({ email: 'email', password: 'requiredString' }),
  asyncHandler(ctrl.login)
);

router.get('/profile', requireAuth, asyncHandler(ctrl.getProfile));

router.put(
  '/profile',
  requireAuth,
  validateBody({
    name: ['name', { optional: true }],
    email: ['email', { optional: true }],
    newPassword: ['password', { optional: true }],
    locationHistoryEnabled: ['boolean', { optional: true }],
  }),
  asyncHandler(ctrl.updateProfile)
);

module.exports = router;

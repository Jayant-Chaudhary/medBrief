const express = require('express');
const validateBody = require('../middleware/validateBody');
const authGuard = require('../middleware/authGuard');
const { acceptInviteSchema, signupSchema } = require('../validators/auth.validators');
const { acceptInvite, signup, logout, getMe, getInvite } = require('../controllers/auth.controller');

const router = express.Router();

// Public routes
router.get('/invite/:token', getInvite);
router.post('/accept-invite', validateBody(acceptInviteSchema), acceptInvite);
router.post('/signup', validateBody(signupSchema), signup);
// No /login: clients sign in with Supabase Auth directly. A server-side
// signInWithPassword on the shared service-role client would make every later
// admin query run as the last user who logged in.
router.post('/logout', logout);

// Protected route
router.get('/me', authGuard, getMe);

module.exports = router;

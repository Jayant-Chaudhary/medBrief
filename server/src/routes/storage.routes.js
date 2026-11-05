/**
 * Storage Routes
 *
 * Routes for accessing decrypted files via HMAC-signed URLs.
 */

const express = require('express');
const router = express.Router();
const storageController = require('../controllers/storage.controller');

router.get('/file', storageController.serveStorageFile);

module.exports = router;

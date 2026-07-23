const express = require('express');
const path = require('path');
const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'admin.html'));
});

router.post('/login', express.json(), (req, res) => {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  if (req.body.password === ADMIN_PASSWORD) {
    return res.json({ token: 'authenticated' });
  }
  res.status(401).json({ error: 'Invalid password' });
});

module.exports = router;

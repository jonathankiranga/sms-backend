const express = require('express');
const router = express.Router();

// POST /api/webpush/subscribe — save push subscription
router.post('/subscribe', async (req, res) => {
  const { teacher_id, subscription } = req.body;
  if (!teacher_id || !subscription) return res.status(400).json({ error: 'teacher_id and subscription required' });
  try {
    // Store as JSON in a push_subscriptions table or teachers column
    await req.db.execute(
      'UPDATE teachers SET push_subscription = ? WHERE teacher_id = ?',
      [JSON.stringify(subscription), teacher_id]
    );
    res.json({ subscribed: true });
  } catch (err) {
    console.error('[WEBPUSH]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webpush/unsubscribe
router.post('/unsubscribe', async (req, res) => {
  const { teacher_id } = req.body;
  if (!teacher_id) return res.status(400).json({ error: 'teacher_id required' });
  try {
    await req.db.execute('UPDATE teachers SET push_subscription = NULL WHERE teacher_id = ?', [teacher_id]);
    res.json({ unsubscribed: true });
  } catch (err) {
    console.error('[WEBPUSH]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

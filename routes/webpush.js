const express = require('express');
const router = express.Router();
const { requireStaffSession } = require('../lib/staffAuth');

// Push subscriptions belong to the authenticated school membership, not a
// caller-supplied teacher_id.
router.post('/subscribe', requireStaffSession, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'subscription required' });
  try {
    const [result] = await req.db.execute(
      'UPDATE teachers SET push_subscription = ? WHERE teacher_id = ? AND school_id = ?',
      [JSON.stringify(subscription), req.staff.teacher_id, req.staff.school_id]
    );
    res.json({ subscribed: true });
  } catch (err) {
    console.error('[WEBPUSH]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webpush/unsubscribe
router.post('/unsubscribe', requireStaffSession, async (req, res) => {
  try {
    const [result] = await req.db.execute(
      'UPDATE teachers SET push_subscription = NULL WHERE teacher_id = ? AND school_id = ?',
      [req.staff.teacher_id, req.staff.school_id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Staff membership not found' });
    res.json({ unsubscribed: true });
  } catch (err) {
    console.error('[WEBPUSH]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

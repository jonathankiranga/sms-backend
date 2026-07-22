const express = require('express');
const router = express.Router();

router.get('/:school_id', async (req, res) => {
  try {
    const [rows] = await req.db.execute(
      `SELECT ad_id, banner_image_url, target_link, merchant_name
       FROM marketplace_campaigns
       WHERE target_school_id = ? AND status = 'Active' AND end_date >= CURDATE()
       ORDER BY RAND() LIMIT 1`,
      [req.params.school_id]
    );
    res.json({ ad: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();

// GET /api/schools/search?q=searchterm
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ schools: [] });
  const [rows] = await req.db.execute(
    `SELECT school_id, school_name, region FROM schools WHERE school_name LIKE ? ORDER BY school_name LIMIT 10`,
    [`%${q}%`]
  );
  res.json({ schools: rows });
});

module.exports = router;

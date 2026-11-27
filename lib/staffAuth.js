// Shared staff-session and tenant-scope checks for academic APIs.
async function readSession(req) {
  const auth = (req.headers.authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return null;
  const sessionId = auth.slice(7).trim();
  const [rows] = await req.db.execute(
    'SELECT phone, email, teacher_id, parent_account_id, school_id, login_role, verified, expires_at FROM otp_sessions WHERE session_id = ? LIMIT 1',
    [sessionId]
  );
  const session = rows[0];
  if (!session || !session.verified || !session.expires_at || new Date(session.expires_at) <= new Date()) return null;
  return session;
}

async function resolveStaff(db, session) {
  let rows = [];
  if (session.teacher_id) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE teacher_id = ? LIMIT 1',
      [session.teacher_id]
    );
  }
  if (rows.length === 0 && session.phone) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE phone = ? LIMIT 1',
      [session.phone]
    );
  }
  if (rows.length === 0 && session.email) {
    [rows] = await db.execute(
      'SELECT teacher_id, school_id, role, active FROM teachers WHERE email = ? LIMIT 1',
      [session.email]
    );
  }
  return rows[0] || null;
}

async function checkSchoolScope(req, staff) {
  const schoolId = staff.school_id;
  const requestedSchool = req.params.schoolId || (req.body && req.body.school_id) || req.query.school_id;
  if (requestedSchool && requestedSchool !== schoolId) return false;

  const classId = req.params.class_id || (req.body && req.body.class_id) || req.query.class_id;
  if (classId) {
    const [rows] = await req.db.execute('SELECT school_id FROM classes WHERE class_id = ? LIMIT 1', [classId]);
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const studentIds = new Set();
  const oneStudent = req.params.student_id || (req.body && req.body.student_id) || req.query.student_id;
  if (oneStudent) studentIds.add(String(oneStudent));
  const submittedRows = []
    .concat(Array.isArray(req.body && req.body.results) ? req.body.results : [])
    .concat(Array.isArray(req.body && req.body.ratings) ? req.body.ratings : []);
  for (const result of submittedRows) {
    if (result && result.student_id) studentIds.add(String(result.student_id));
  }
  if (studentIds.size) {
    const ids = [...studentIds];
    const [rows] = await req.db.execute(
      `SELECT student_id FROM students WHERE school_id = ? AND student_id IN (${ids.map(() => '?').join(',')})`,
      [schoolId, ...ids]
    );
    if (rows.length !== ids.length) return false;
  }

  const teacherId = req.params.teacher_id || (req.body && req.body.teacher_id) || req.query.teacher_id;
  if (teacherId) {
    const [rows] = await req.db.execute('SELECT school_id FROM teachers WHERE teacher_id = ? LIMIT 1', [teacherId]);
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
    if (staff.role === 'teacher' && teacherId !== staff.teacher_id) return false;
  }

  if (req.params.id && req.baseUrl.includes('lesson-plans')) {
    const [rows] = await req.db.execute('SELECT school_id FROM lesson_plans WHERE plan_id = ? LIMIT 1', [req.params.id]);
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const assessmentId = req.params.assessment_id || (req.body && req.body.assessment_id) || req.query.assessment_id;
  if (assessmentId) {
    const [rows] = await req.db.execute(
      'SELECT c.school_id FROM assessments a JOIN classes c ON a.class_id = c.class_id WHERE a.assessment_id = ? LIMIT 1',
      [assessmentId]
    );
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const examSessionId = req.params.sessionId || (req.body && req.body.session_id) || req.query.session_id ||
    (req.params.id && req.baseUrl.includes('exam-sessions') ? req.params.id : null);
  if (examSessionId) {
    const [rows] = await req.db.execute(
      'SELECT school_id FROM exam_sessions WHERE session_id = ? LIMIT 1',
      [examSessionId]
    );
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const areaId = (req.body && req.body.area_id) || req.query.area_id ||
    (req.params.id && req.path.includes('/areas/') ? req.params.id : null);
  if (areaId) {
    const [rows] = await req.db.execute('SELECT school_id FROM learning_areas WHERE area_id = ? LIMIT 1', [areaId]);
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const strandId = (req.body && req.body.strand_id) || req.query.strand_id ||
    (req.params.id && req.path.includes('/strands/') && !req.path.includes('/sub-strands/') ? req.params.id : null);
  if (strandId) {
    const [rows] = await req.db.execute(
      'SELECT la.school_id FROM strands st JOIN learning_areas la ON st.area_id = la.area_id WHERE st.strand_id = ? LIMIT 1',
      [strandId]
    );
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  const subStrandId = (req.body && req.body.sub_strand_id) || req.query.sub_strand_id ||
    (req.params.id && req.path.includes('/sub-strands/') ? req.params.id : null);
  if (subStrandId) {
    const [rows] = await req.db.execute(
      'SELECT la.school_id FROM sub_strands ss JOIN strands st ON ss.strand_id = st.strand_id JOIN learning_areas la ON st.area_id = la.area_id WHERE ss.sub_strand_id = ? LIMIT 1',
      [subStrandId]
    );
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  if (req.params.id && req.baseUrl.includes('exam-sessions') && !examSessionId) {
    const [rows] = await req.db.execute('SELECT school_id FROM exam_sessions WHERE session_id = ? LIMIT 1', [req.params.id]);
    if (!rows[0] || rows[0].school_id !== schoolId) return false;
  }

  return true;
}

async function requireStaffSession(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required' });
    const staff = await resolveStaff(req.db, session);
    if (!staff || !['teacher', 'head', 'bursar', 'school_admin'].includes(staff.role) || staff.active === 0) {
      return res.status(403).json({ error: 'An active school staff account is required' });
    }
    if (!(await checkSchoolScope(req, staff))) {
      return res.status(403).json({ error: 'The requested record does not belong to your school' });
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireAssessmentAccess(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication required' });

    // Parents may read reports only for learners linked to their verified
    // global parent account. Legacy phone sessions remain supported during rollout.
    if (req.method === 'GET' && req.path.startsWith('/report/') && req.params.student_id) {
      let links = [];
      if (session.parent_account_id) {
        [links] = await req.db.execute(
          "SELECT student_id FROM parent_student_relationships WHERE student_id = ? AND parent_account_id = ? AND status = 'active' AND can_view_results = 1 LIMIT 1",
          [req.params.student_id, session.parent_account_id]
        );
      } else if (session.phone) {
        [links] = await req.db.execute(
          'SELECT student_id FROM student_parent_map WHERE student_id = ? AND parent_phone = ? LIMIT 1',
          [req.params.student_id, session.phone]
        );
      }
      if (links.length > 0) {
        req.parentSession = true;
        req.parentAccountId = session.parent_account_id || null;
        return next();
      }
    }

    const staff = await resolveStaff(req.db, session);
    if (!staff || !['teacher', 'head', 'bursar', 'school_admin'].includes(staff.role) || staff.active === 0) {
      return res.status(403).json({ error: 'An active school staff account is required' });
    }
    if (!(await checkSchoolScope(req, staff))) {
      return res.status(403).json({ error: 'The requested record does not belong to your school' });
    }
    req.staff = staff;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireStaffSession, requireAssessmentAccess };

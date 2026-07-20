// 1:1 ports of the Row Level Security policies the old Supabase schema used to
// enforce declaratively. Every mutating/scoped route calls one of these
// instead of relying on the database to filter rows — MySQL has no RLS.

/** True if `user` is a lecturer who owns `exam`, or is a co-marker on it. */
async function isExamOwnerOrCoMarker(db, user, exam) {
  if (!user || user.role !== 'lecturer' || !exam) return false;
  if (exam.lecturer_id === user.id) return true;
  const comarker = await db('exam_lecturers')
    .where({ exam_id: exam.id, lecturer_email: user.email })
    .first();
  return Boolean(comarker);
}

/** Same as above, but looks the exam up by id first. */
async function isExamOwnerOrCoMarkerById(db, user, examId) {
  if (!user || user.role !== 'lecturer') return false;
  const exam = await db('exams').where({ id: examId }).first();
  if (!exam) return false;
  return isExamOwnerOrCoMarker(db, user, exam);
}

// The exam row itself, and questions on it, can only be edited/deleted by the
// OWNING lecturer — co-markers may grade (submissions/violations) but not
// change exam settings or the question set. This mirrors the original RLS
// policies exactly ("Lecturers can manage their exams" / "Manage questions"
// both checked `lecturer_id = auth.uid()` only, with no co-marker branch).
function isExamOwner(user, exam) {
  return Boolean(user && user.role === 'lecturer' && exam && exam.lecturer_id === user.id);
}

function isPlatformAdmin(user) {
  return Boolean(user && user.role === 'platform_admin');
}

function isInstitutionAdminOf(user, institutionId) {
  return Boolean(user && user.role === 'institution_admin' && user.institution_id === institutionId);
}

/** Platform admin OR institution admin of the given institution. */
function isPlatformOrInstitutionAdmin(user, institutionId) {
  return isPlatformAdmin(user) || isInstitutionAdminOf(user, institutionId);
}

/**
 * True if `user` is an institution admin of `institutionId` AND their
 * institution_admins row is currently active. Mirrors the old
 * `is_institution_admin(inst_id)` SQL function, which checked `active = TRUE`
 * as part of its definition — the JWT alone can't reflect a suspension that
 * happened after the token was issued, so this re-checks the DB. Used where
 * that stricter check matters (e.g. inviting new institution admins).
 */
async function isActiveInstitutionAdminOf(db, user, institutionId) {
  if (!isInstitutionAdminOf(user, institutionId)) return false;
  const row = await db('institution_admins').where({ id: user.id }).first();
  return Boolean(row && row.active);
}

module.exports = {
  isExamOwnerOrCoMarker,
  isExamOwnerOrCoMarkerById,
  isExamOwner,
  isPlatformAdmin,
  isInstitutionAdminOf,
  isPlatformOrInstitutionAdmin,
  isActiveInstitutionAdminOf,
};

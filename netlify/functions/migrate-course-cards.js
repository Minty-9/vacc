// One-time (but safe to re-run anytime) backfill: builds/rebuilds the lightweight
// course_cards collection from the existing full /courses documents. Needed once
// after the course-list speed fix shipped, since courses created before that
// change have no course_cards entry yet. Admin-only, triggered from a button in
// the admin Courses tab — same auth pattern as send-push.js / delete-student.js.
const admin = require('./_firebaseAdmin');

function courseLessonCount(course) {
  return (course.modules || []).reduce((s, m) => s + (m.lessons ? m.lessons.length : 0), 0);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Missing Authorization header' }) };
  }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.admin) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin only' }) };
    }
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('courses').get();
    let migrated = 0;
    const batch = db.batch();
    snap.docs.forEach(doc => {
      const c = doc.data();
      batch.set(db.collection('course_cards').doc(doc.id), {
        title: c.title, description: c.description, instructor: c.instructor,
        icon: c.icon, is_paid: !!c.is_paid, price: c.price || 0,
        lessonCount: courseLessonCount(c), moduleCount: (c.modules || []).length
      }, { merge: true });
      migrated++;
    });
    await batch.commit();
    return { statusCode: 200, body: JSON.stringify({ success: true, migrated }) };
  } catch (err) {
    console.error('migrate-course-cards error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error running migration' }) };
  }
};

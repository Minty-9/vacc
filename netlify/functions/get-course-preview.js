// Public, no-login-required preview of a course — used by the guest checkout
// page so an ad visitor can see what they're paying for before creating an
// account. Deliberately returns only safe preview fields, never the modules/
// lessons content, so a course can't be read in full by an anonymous visitor.
const admin = require('./_firebaseAdmin');

exports.handler = async (event) => {
  const courseId = event.queryStringParameters && event.queryStringParameters.courseId;
  if (!courseId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing courseId' }) };
  }
  try {
    const db = admin.firestore();
    // The course_cards cache already has exactly these fields precomputed, so
    // prefer it — it's the lightest possible read, which matters here most of
    // all: this is cold ad traffic with nothing cached client-side yet. Fall
    // back to the full course doc for any course that predates the cache.
    const cardSnap = await db.collection('course_cards').doc(courseId).get();
    let c, lessonCount;
    if (cardSnap.exists) {
      c = cardSnap.data();
      lessonCount = c.lessonCount || 0;
    } else {
      const snap = await db.collection('courses').doc(courseId).get();
      if (!snap.exists) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Course not found' }) };
      }
      c = snap.data();
      lessonCount = (c.modules || []).reduce((s, m) => s + (m.lessons ? m.lessons.length : 0), 0);
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: courseId,
        title: c.title,
        description: c.description,
        instructor: c.instructor,
        icon: c.icon,
        is_paid: !!c.is_paid,
        price: c.price || 0,
        lessonCount
      })
    };
  } catch (err) {
    console.error('get-course-preview error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};

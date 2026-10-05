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
    const snap = await admin.firestore().collection('courses').doc(courseId).get();
    if (!snap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Course not found' }) };
    }
    const c = snap.data();
    const lessonCount = (c.modules || []).reduce((s, m) => s + (m.lessons ? m.lessons.length : 0), 0);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: snap.id,
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

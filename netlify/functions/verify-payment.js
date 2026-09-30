// Called by the browser right after Paystack's checkout popup closes with a reference.
// Never trusts the browser's word that payment succeeded — re-checks with Paystack directly
// using the secret key, then cross-checks the amount and course before unlocking anything.
const admin = require('./_firebaseAdmin');
const { unlockEnrollment } = require('./_unlockEnrollment');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { reference, uid, courseId } = payload;
  if (!reference || !uid || !courseId) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing reference, uid, or courseId' }) };
  }

  try {
    const paystackRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      { headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } }
    );
    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'Payment was not successful' }) };
    }

    const db = admin.firestore();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Course not found' }) };
    }
    const course = courseSnap.data();

    const paidKobo = paystackData.data.amount;
    const expectedKobo = Math.round((course.price || 0) * 100);
    if (course.is_paid && paidKobo < expectedKobo) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Amount paid does not match the course price' }) };
    }

    // Sanity cross-check: the metadata we sent when opening checkout should match this student.
    const meta = paystackData.data.metadata || {};
    if (meta.uid && meta.uid !== uid) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'This payment does not match this student' }) };
    }

    await unlockEnrollment(db, uid, courseId, paidKobo / 100, reference);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('verify-payment error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error verifying payment' }) };
  }
};

// Called by the browser right after Paystack's checkout popup closes with a reference.
// Never trusts the browser's word that payment succeeded — re-checks with Paystack directly
// using the secret key, then cross-checks the amount and course before unlocking anything.
//
// Async channels (Bank Transfer, USSD) can report back to the browser a moment before
// Paystack's own backend finishes marking the transaction successful — so this retries
// a few times with short pauses instead of giving up on the first check.
const admin = require('./_firebaseAdmin');
const { unlockEnrollment } = require('./_unlockEnrollment');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verifyWithRetry(reference, attempts = 4, delayMs = 1500) {
  let lastData = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      { headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } }
    );
    const data = await res.json();
    lastData = { ok: res.ok, data };
    if (res.ok && data.status && data.data && data.data.status === 'success') return lastData;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return lastData; // whatever the last attempt saw, even if never 'success'
}

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
    const { ok, data: paystackData } = await verifyWithRetry(reference);

    if (!ok || !paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'Payment was not confirmed as successful after retrying. If this was a bank transfer, it may still complete shortly — the webhook will unlock it automatically when it does.' }) };
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

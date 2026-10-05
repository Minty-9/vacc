// Same idea as verify-payment.js, but for a payment made by someone with no
// account yet. Instead of unlocking an enrollment directly (there's no uid to
// unlock it for), it records a "pending payment" by reference, which
// claim-payment.js later turns into a real enrollment once they sign up.
const admin = require('./_firebaseAdmin');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function verifyWithRetry(reference, attempts = 4, delayMs = 1500) {
  let lastData = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      { headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } }
    );
    const data = await res.json();
    lastData = { ok: res.ok, status: res.status, data };
    if (res.ok && data.status && data.data && data.data.status === 'success') return lastData;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return lastData;
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

  const { reference, email, courseId } = payload;
  if (!reference || !email || !courseId) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing reference, email, or courseId' }) };
  }

  try {
    const { ok, status: lastHttpStatus, data: paystackData } = await verifyWithRetry(reference);

    if (!ok || !paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      console.error('verify-guest-payment: Paystack did not confirm success.', {
        reference, httpOk: ok, httpStatusCode: lastHttpStatus, fullResponse: paystackData
      });
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'Payment was not confirmed as successful after retrying. If this was a bank transfer, it may still complete shortly.' }) };
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

    await db.collection('pending_payments').doc(reference).set({
      email: String(email).toLowerCase().trim(),
      course_id: courseId,
      amount: paidKobo / 100,
      payment_ref: reference,
      claimed: false,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('verify-guest-payment error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error verifying payment' }) };
  }
};

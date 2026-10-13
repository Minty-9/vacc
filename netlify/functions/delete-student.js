// Called by the admin dashboard's "Delete" button. Unlike suspending (which just
// flips a status flag and leaves the account intact), this permanently removes
// the student — including their Firebase Auth record, which is what actually
// frees up their email address so they can sign up again from scratch.
// Admin-only: checks the caller's Firebase ID token for the admin custom claim,
// same pattern as send-push.js.
const admin = require('./_firebaseAdmin');

async function deleteQueryInBatches(query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = admin.firestore().batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
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

  let callerUid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.admin) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Admin only' }) };
    }
    callerUid = decoded.uid;
  } catch (err) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid or expired session' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { uid } = payload;
  if (!uid) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing uid' }) };
  }
  if (uid === callerUid) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'You can\'t delete your own account' }) };
  }

  try {
    const db = admin.firestore();

    // Refuse to delete another admin through this endpoint — admins aren't
    // "students to clean up", and this avoids ever locking everyone out.
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists && userSnap.data().role === 'admin') {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Cannot delete an admin account' }) };
    }

    // Clean up everything tied to this uid before (or alongside) removing the
    // Auth record, so no orphaned data lingers under a uid nobody can look up again.
    await Promise.all([
      deleteQueryInBatches(db.collection('enrollments').where('user_id', '==', uid)),
      deleteQueryInBatches(db.collection('submissions').where('user_id', '==', uid)),
      deleteQueryInBatches(db.collection('posts').where('user_id', '==', uid)),
      deleteQueryInBatches(db.collection('push_subscriptions').doc(uid).collection('devices')),
    ]);
    await db.collection('push_subscriptions').doc(uid).delete().catch(() => {});
    await db.collection('users').doc(uid).delete().catch(() => {});

    // Deleting the Auth record is what actually frees the email up for reuse —
    // Firebase Auth keeps an email reserved to its account for as long as that
    // account exists, suspended or not.
    try {
      await admin.auth().deleteUser(uid);
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        // Already gone from Auth (e.g. a retry) — the Firestore cleanup above
        // still needed to happen, so this isn't a failure.
      } else {
        throw err;
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('delete-student error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Server error deleting student' }) };
  }
};

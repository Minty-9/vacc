// One-time-use endpoint to turn a normal account into a real admin.
// Protected by ADMIN_SETUP_KEY — a password only you know, set in Netlify's
// environment variables. Nobody can call this without it.
//
// Usage: register the account normally through the app first (as a student),
// then send a POST request here (curl, Postman, or your browser's dev console):
//
//   fetch('https://YOUR-SITE.netlify.app/.netlify/functions/promote-admin', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ secret: 'YOUR_ADMIN_SETUP_KEY', email: 'client@example.com' })
//   }).then(r => r.json()).then(console.log)
//
// The promoted user must log out and back in for the change to take effect.
const admin = require('./_firebaseAdmin');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Send a POST request.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { secret, email } = payload;
  if (!secret || secret !== process.env.ADMIN_SETUP_KEY) {
    return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid setup key' }) };
  }
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing email' }) };
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    await admin.firestore().collection('users').doc(user.uid).set({ role: 'admin' }, { merge: true });
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Promoted ' + email + ' to admin. They must log out and back in for it to take effect.' })
    };
  } catch (err) {
    console.error('promote-admin error:', err);
    return { statusCode: 404, body: JSON.stringify({ success: false, error: 'Could not find or update that user: ' + err.message }) };
  }
};

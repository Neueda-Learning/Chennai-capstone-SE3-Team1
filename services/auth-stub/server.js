const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

// Shared secret - the Trade REST API verifies tokens signed with this exact string
// (jwt.secret, normally resolved from the TrustMe vault; docker-compose.override.yml
// on a dev/test host points it at JWT_SECRET from .env instead so both sides agree on a
// value the operator actually knows). As with the auth-stub this was copied from,
// the secret is deliberately visible here - the whole trust relationship is "both
// sides know the same secret," and this is a stub, not a real identity service.
const SECRET = process.env.JWT_SECRET || 'local-dev-secret-change-me';
const ISSUER = process.env.JWT_ISSUER || 'auth-service';

// A stub, not a real user store. These map onto the seeded accounts in
// seed/020_clients.csv so a minted token addresses a real accountId the Trade REST API
// and executor already know about - seed/030_auth.csv's password hashes are placeholders
// ("SEEDDATAONLYnotarealhash...") and were never meant to be checked against anything, so
// every user here shares one fixed stub password instead. Meera's account is SUSPENDED in
// the seed data on purpose, to exercise the "account not active" rejection path.
const STUB_PASSWORD = 'trading123';
const USERS = {
  'aarav.mehta@example.com': { accountId: 1, roles: ['CLIENT'] }, // ACTIVE
  'diya.sharma@example.com': { accountId: 2, roles: ['CLIENT'] }, // ACTIVE
  'rohan.iyer@example.com':  { accountId: 3, roles: ['CLIENT'] }, // ACTIVE
  'meera.nair@example.com':  { accountId: 4, roles: ['CLIENT'] }, // SUSPENDED
};

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS[username];
  if (!user || password !== STUB_PASSWORD) {
    return res.status(401).json({ error: 'invalid username or password' });
  }
  const token = jwt.sign(
    { sub: username, accountId: user.accountId, roles: user.roles, iss: ISSUER },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  res.json({ token, tokenType: 'Bearer', expiresIn: 3600, accountId: user.accountId });
});

app.get('/health', (req, res) => res.json({ status: 'up' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`trading-auth-stub listening on http://localhost:${PORT}`);
  console.log(`Try: curl -X POST http://localhost:${PORT}/login -H "Content-Type: application/json" -d '{"username":"aarav.mehta@example.com","password":"trading123"}'`);
});

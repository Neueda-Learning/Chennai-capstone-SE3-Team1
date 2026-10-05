const express = require('express');
const jwt = require('jsonwebtoken');
const trustme = require('trustme-secrets');

const app = express();
app.use(express.json());

let SECRET;

const USERS = {
  alice: { password: 'mission123', roles: ['MISSION_OPERATOR'] },
  bob: { password: 'wrongpermissions', roles: ['GUEST'] },
};

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'invalid username or password' });
  }
  const token = jwt.sign(
    { sub: username, roles: user.roles },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  res.json({ token });
});

app.get('/health', (req, res) => res.json({ status: 'up' }));

const PORT = 4000;

async function main() {
  const fetched = await trustme.get('JWT_SECRET');
  SECRET = typeof fetched === 'string' ? fetched : undefined;
  if (!SECRET || SECRET.length < 32) {
    throw new Error('the TrustMe secret JWT_SECRET is missing or shorter than 32 characters');
  }
  app.listen(PORT, () => {
    console.log(`trading-auth-stub listening on http://localhost:${PORT}`);
    console.log(`Try: curl -X POST http://localhost:${PORT}/login -H "Content-Type: application/json" -d '{"username":"alice","password":"mission123"}'`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

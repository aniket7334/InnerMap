const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/env');

function signToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email }, jwtConfig.secret, {
    expiresIn: jwtConfig.expiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, jwtConfig.secret);
}

module.exports = { signToken, verifyToken };

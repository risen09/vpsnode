const crypto = require('crypto');

// Генерация 64-байтового ключа (512 бит) в Base64
const generateSecret = () => {
  return crypto.randomBytes(64).toString('base64');
};

const JWT_SECRET = generateSecret();
console.log('Ваш секретный ключ:', JWT_SECRET);
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENCRYPTION_KEY_PATH = path.join(__dirname, 'encryption.key');

function ensureEncryptionKey() {
  if (!fs.existsSync(ENCRYPTION_KEY_PATH)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(ENCRYPTION_KEY_PATH, key);
    console.log('New encryption key generated');
  }
  return fs.readFileSync(ENCRYPTION_KEY_PATH);
}

const SECRET_KEY = ensureEncryptionKey();

function encryptToken(token) {
  try {
    const iv = crypto.randomBytes(16); // Initialization vector
    const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
    
    // Encrypt the token
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      content: encrypted.toString('hex'),
      authTag: authTag.toString('hex'),
      combined: `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
    };
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('Token encryption failed');
  }
}

function decryptToken(encryptedData) {
  try {
    let iv, content, authTag;
    
    if (typeof encryptedData === 'string') {
      [iv, authTag, content] = encryptedData.split(':');
    } else {
      ({ iv, content, authTag } = encryptedData);
    }
    
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      SECRET_KEY,
      Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(content, 'hex')),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('Decryption failed:', err);
    throw new Error('Token decryption failed - possibly corrupted or tampered data');
  }
}

module.exports = { encryptToken, decryptToken };
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET || 'ваш_резервный_секрет';
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware для Basic Auth (если используется в Zrok)
const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Требуется Basic Auth' });
  }
  
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');
  
  if (username !== 'admin' || password !== 'admin123') {
    return res.status(403).json({ error: 'Неверные учетные данные' });
  }
  
  next();
};

// Middleware JWT аутентификации
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется токен' });

  try {
    const decoded = jwt.verify(token, SECRET);
    console.log('[Middleware authenticate] Successfully decoded JWT token');
    const client = new MongoClient(MONGODB_URI);
    
    try {
      await client.connect();
      
      // Получение пользователя по ID или email
      let userInfo = null;
      
      // Проверяем сначала в коллекции users (для новых пользователей)
      if (decoded.userId) {
        userInfo = await client.db('DatabaseAi').collection('users').findOne({ 
          _id: new ObjectId(decoded.userId) 
        });
      } else if (decoded.email) {
        userInfo = await client.db('DatabaseAi').collection('users').findOne({ 
          email: decoded.email 
        });
      }
      
      // Проверка в старой коллекции для совместимости с гигачатом
      if (!userInfo && decoded.username) {
        userInfo = await client.db('DatabaseAi').collection('myCollection').findOne({ 
          username: decoded.username 
        });
      }
      
      if (!userInfo && decoded.username !== 'admin') {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }
      
      // Установка информации о пользователе в req
      if (userInfo) {
        req.user = {
          _id: userInfo._id.toString(),
          email: userInfo.email || userInfo.username,
          name: userInfo.name || userInfo.username,
          nickname: userInfo.nickname,
          role: userInfo.role || 'user',
          personalityType: userInfo.personalityType,
          avatar: userInfo.avatar,
          gender: userInfo.gender,
          age: userInfo.age
        };
      } else if (decoded.username === 'admin') {
        // Для администратора без записи в базе
        req.user = {
          username: 'admin',
          role: 'admin',
          _id: 'admin'
        };
      }
    } catch (err) {
      console.error('Ошибка при получении данных пользователя:', err);
      req.user = {
        ...decoded,
        role: decoded.role || 'user'
      };
    } finally {
      await client.close();
    }
    next();
  } catch (err) {
    res.status(403).json({ error: 'Неверный или просроченный токен' });
  }
}

module.exports = { authenticate, basicAuth };
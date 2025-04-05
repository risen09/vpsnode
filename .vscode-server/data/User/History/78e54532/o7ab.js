const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'ваш_резервный_секрет';
const MONGODB_URI = 'mongodb://AiTutur:kfuai@127.0.0.1:27017/?authSource=admin';

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
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется токен' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Неверный или просроченный токен' });
  }
}

// Эндпоинт для получения токена
app.post('/api/login', basicAuth, (req, res) => {
  const token = jwt.sign({ username: 'admin' }, SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Создание пользователя
const createUser = async (token, userData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });
    
    if (!response.ok) throw new Error('Ошибка создания');
    return await response.json();
  } catch (error) {
    console.error('Create error:', error);
    throw error;
  }
};

// Обновление пользователя
const updateUser = async (token, id, updatedData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updatedData)
    });
    
    if (!response.ok) throw new Error('Ошибка обновления');
    return await response.json();
  } catch (error) {
    console.error('Update error:', error);
    throw error;
  }
};

// Удаление пользователя
const deleteUser = async (token, id) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) throw new Error('Ошибка удаления');
    return true;
  } catch (error) {
    console.error('Delete error:', error);
    throw error;
  }
};
// Защищенный эндпоинт
app.get('/api/users', authenticate, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const users = await client.db('DatabaseAi').collection('myCollection').find().toArray();
    res.json(users);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('API с JWT запущен на http://0.0.0.0:3000');
});
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'ваш_резервный_секрет'; // Лучше задать в .env

// Middleware аутентификации
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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Проверка учетных данных (замените на вашу логику)
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Неверные учетные данные' });
});

// Защищенный эндпоинт
app.get('/api/users', authenticate, async (req, res) => {
  const uri = 'mongodb://AiTutur:kfuai@127.0.0.1:27017/?authSource=admin';
  const client = new MongoClient(uri, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
  });
  
  async function testConnection() {
    try {
      await client.connect();
      console.log('✅ Успешное подключение к MongoDB!');
      await client.db().command({ ping: 1 });
      console.log('🟢 MongoDB отвечает на запросы');
      return true;
    } catch (err) {
      console.error('❌ Ошибка подключения:', err.message);
      return false;
    } finally {
      await client.close();
    }
  }
  
  // Вызываем проверку
  testConnection();
  try {
    await client.connect();
    const users = await client.db('DatabaseAi').collection('myCollection').find().toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.close();
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('API с JWT запущен на http://0.0.0.0:3000');
});s
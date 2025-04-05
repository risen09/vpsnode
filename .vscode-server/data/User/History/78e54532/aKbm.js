const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET;

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    res.status(403).json({ error: 'Неверный токен' });
  }
}
// Подключение к MongoDB через SSH-туннель (localhost:27017 → домашний ноут)
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

// Пример REST-эндпоинта
app.get('/api/users', async (req, res) => {
  try {
    await client.connect();
    const users = await client.db('DatabaseAi').collection('myCollection').find().toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Запуск сервера
app.listen(3000, '0.0.0.0', () => {
  console.log('REST API работает на http://ваш-vps-ip:3000');
});

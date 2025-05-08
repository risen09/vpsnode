const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { basicAuth } = require('../../../middlewares/authenticate');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// Эндпоинт для регистрации (без аутентификации)
router.post('/api/register', async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    
    // Проверяем наличие обязательных полей
    if (!req.body.email || !req.body.password || !req.body.name) {
      return res.status(400).json({ error: 'Требуются поля email, password и name' });
    }
    
    // Проверяем, не существует ли уже пользователь с таким email
    const existingUser = await client.db('DatabaseAi').collection('users').findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }
    
    // Создаем нового пользователя
    const newUser = {
      email: req.body.email,
      password: req.body.password, // В реальном приложении следует хешировать пароль
      name: req.body.name,
      nickname: req.body.nickname || req.body.name,
      role: 'user',
      createdAt: new Date(),
      gender: req.body.gender,
      age: req.body.age ? parseInt(req.body.age) : undefined,
      settings: {
        theme: 'light',
        language: 'ru',
        notifications: true,
        soundEffects: true
      }
    };
    
    const result = await client.db('DatabaseAi').collection('users').insertOne(newUser);
    
    // Создаем JWT токен для нового пользователя
    const token = jwt.sign({ 
      userId: result.insertedId.toString(),
      email: newUser.email
    }, SECRET, { expiresIn: '30d' });
    
    // Возвращаем успешный ответ с данными и токеном
    const userResponse = { ...newUser, _id: result.insertedId };
    delete userResponse.password; // Не отправляем пароль клиенту
    
    res.status(201).json({ 
      user: userResponse,
      token: token
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Обновленный эндпоинт логина
router.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Требуются email и password' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    
    // Проверка для админского доступа (с поддержкой старого формата)
    if (email === 'admin@example.com' && password === 'admin123') {
      const adminUser = await client.db('DatabaseAi').collection('myCollection').findOne({ username: 'admin' });
      
      const token = jwt.sign({ 
        userId: adminUser ? adminUser._id.toString() : 'admin',
        username: 'admin',
        role: 'admin'
      }, SECRET, { expiresIn: '30d' });
      
      return res.json({ 
        token,
        user: {
          _id: adminUser ? adminUser._id.toString() : 'admin',
          name: 'Admin',
          email: 'admin@example.com',
          role: 'admin'
        }
      });
    }
    
    // Поиск пользователя по email
    const user = await client.db('DatabaseAi').collection('users').findOne({ email });
    
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    // Проверка пароля (в реальном приложении должно быть сравнение хэшей)
    if (user.password !== password) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    // Создание токена
    const token = jwt.sign({ 
      userId: user._id.toString(),
      email: user.email,
      role: user.role || 'user'
    }, SECRET, { expiresIn: '30d' });
    
    // Формирование ответа
    const userResponse = { ...user };
    delete userResponse.password; // Не отправляем пароль клиенту
    
    res.json({ 
      user: userResponse,
      token
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Поддержка старого эндпоинта логина с Basic Auth
/**
 * @deprecated Используйте обычный эндпоинт логина с токеном
 */
router.post('/api/login-basic', basicAuth, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const user = await client.db('DatabaseAi').collection('myCollection').findOne({ username: 'admin' });
    
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    const token = jwt.sign({ 
      username: user.username,
    }, SECRET, { expiresIn: '1h' });
    
    res.json({ token });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

module.exports = router;
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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
    const client = new MongoClient(MONGODB_URI);
    
    try {
      await client.connect();
      const userInfo = await client.db('DatabaseAi').collection('myCollection').findOne({ username: decoded.username });
      
      if (!userInfo) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }
      
      req.user = { 
        _id: userInfo._id.toString(),
      };
    } catch (err) {
      console.error('Ошибка при получении данных пользователя:', err);
      req.user = decoded;
    } finally {
      await client.close();
    }
    next();
  } catch (err) {
    res.status(403).json({ error: 'Неверный или просроченный токен' });
  }
}

app.use('/api/gigachat', authenticate, require('./routes/gigachat'));

// Эндпоинт для получения токена
app.post('/api/login', basicAuth, async (req, res) => {
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

app.post('/api/users', authenticate, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    
    // Проверяем наличие обязательного поля username
    if (!req.body.username) {
      return res.status(400).json({ error: 'Требуется поле username' });
    }
    
    // Проверяем, не существует ли уже пользователь с таким username
    const existingUser = await client.db('DatabaseAi').collection('myCollection').findOne({ username: req.body.username });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким username уже существует' });
    }
    
    const user = await client.db('DatabaseAi').collection('myCollection').insertOne({
      ...req.body,
      username: req.body.username,
      role: 'user' // По умолчанию устанавливаем роль 'user'
    });
    
    res.status(201).json({ _id: user.insertedId, ...req.body, role: 'user' });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Обновление пользователя (UPDATE)
app.put('/api/users/:id', authenticate, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  const { id } = req.params;
  
  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection('myCollection').updateOne(
      { _id: new ObjectId(id) },
      { $set: req.body }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.json({ _id: id, ...req.body });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Удаление пользователя (DELETE)
app.delete('/api/users/:id', authenticate, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  const { id } = req.params;
  
  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection('myCollection').deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.status(204).send();
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const user = await client.db('DatabaseAi').collection('myCollection').findOne({ _id: new ObjectId(id) });
    res.json(user);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

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
// Создание новой записи в любой коллекции
app.post('/api/:collection', authenticate, async (req, res) => {
  const { collection } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection(collection).insertOne(req.body);
    res.status(201).json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Получение всех записей из коллекции
app.get('/api/:collection', authenticate, async (req, res) => {
  const { collection } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const data = await client.db('DatabaseAi').collection(collection).find().toArray();
    res.json(data);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

app.get('/api/:collection/:id', authenticate, async (req, res) => {
  const { collection, id } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const data = await client.db('DatabaseAi').collection(collection).findOne({ _id: new ObjectId(id) });
    res.json(data);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Обновление записи в коллекции по ID
app.post('/api/:collection/:id', authenticate, async (req, res) => {
  const { collection, id } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection(collection).updateOne(
      { _id: new ObjectId(id) },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    res.json({ _id: id, ...req.body });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Удаление записи из коллекции по ID
app.delete('/api/:collection/:id', authenticate, async (req, res) => {
  const { collection, id } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection(collection).deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    res.status(204).send();
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
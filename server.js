const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { authenticate, basicAuth } = require('./middlewares/authenticate');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// v1 API
// Добавляем маршруты для агентов
app.use('/api/lesson-creator', authenticate, require('./routes/v1/agents/lesson-creator'));
app.use('/api/experts', authenticate, require('./routes/v1/agents/subject-expert'));
app.use('/api/homework', authenticate, require('./routes/v1/agents/homework-helper'));
app.use('/api/study-plans', authenticate, require('./routes/v1/agents/study-plan'));
app.use('/api/track-assistants', authenticate, require('./routes/v1/agents/track-assistant'));
app.use('/api/progress-analyzer', authenticate, require('./routes/v1/agents/progress-analyzer'));
// Добавляем маршрут для начальной диагностики
app.use('/api/initial-diagnostics', require('./routes/v1/agents/initial-diagnostics'));
// Добавляем маршрут для работы с тестами
app.use('/api/tests', authenticate, require('./routes/v1/agents/tests/index'));
// Добавляем маршрут для работы с уроками
app.use('/api/lessons', authenticate, require('./routes/v1/lessons/index'));
// Добавляем маршрут для работы с пользователями
app.use('/api/users', authenticate, require('./routes/v1/users'));
// Добавляем маршрут для работы с одним пользователем
app.use('/api/user', authenticate, require('./routes/v1/user'));
// Маршруты для гигачата
app.use('/api/gigachat', authenticate, require('./routes/v1/gigachat'));

const SECRET = process.env.JWT_SECRET || 'ваш_резервный_секрет';
const MONGODB_URI = process.env.MONGODB_URI;

// Эндпоинт для регистрации (без аутентификации)
app.post('/api/register', async (req, res) => {
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
app.post('/api/login', async (req, res) => {
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
app.post('/api/login-basic', basicAuth, async (req, res) => {
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

// Создание новой записи в любой коллекции
app.post('/api/:collection', authenticate, async (req, res) => {
  const { collection } = req.params;
  
  // Ограничиваем доступ к критическим коллекциям
  if ((collection === 'users' || collection === 'myCollection') && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав для этой операции' });
  }
  
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const result = await client.db('DatabaseAi').collection(collection).insertOne({
      ...req.body,
      userId: req.user._id, // Добавляем userId для связи с пользователем
      createdAt: new Date()
    });
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
  
  // Ограничиваем доступ к критическим коллекциям
  if ((collection === 'users' || collection === 'myCollection') && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав для этой операции' });
  }
  
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    let query = {};
    
    // Для некритических коллекций обычные пользователи видят только свои записи
    if (req.user.role !== 'admin' && collection !== 'users' && collection !== 'myCollection') {
      query = { userId: req.user._id };
    }
    
    const data = await client.db('DatabaseAi').collection(collection).find(query).toArray();
    
    // Удаляем пароли, если это коллекция пользователей
    if (collection === 'users' || collection === 'myCollection') {
      data.forEach(item => {
        if (item.password) delete item.password;
      });
    }
    
    res.json(data);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Получение записи по ID
app.get('/api/:collection/:id', authenticate, async (req, res) => {
  const { collection, id } = req.params;
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const data = await client.db('DatabaseAi').collection(collection).findOne({ _id: new ObjectId(id) });
    
    if (!data) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }
    
    // Проверка прав доступа
    if (req.user.role !== 'admin' && 
        collection !== 'users' && 
        collection !== 'myCollection' && 
        data.userId !== req.user._id) {
      return res.status(403).json({ error: 'Нет прав для просмотра этой записи' });
    }
    
    // Удаляем пароль, если это запись пользователя
    if ((collection === 'users' || collection === 'myCollection') && data.password) {
      delete data.password;
    }
    
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
    
    // Получаем запись для проверки прав
    const existingData = await client.db('DatabaseAi').collection(collection).findOne({ 
      _id: new ObjectId(id) 
    });
    
    if (!existingData) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }
    
    // Проверка прав доступа
    if (req.user.role !== 'admin' && 
        collection !== 'users' && 
        collection !== 'myCollection' && 
        existingData.userId !== req.user._id) {
      return res.status(403).json({ error: 'Нет прав для изменения этой записи' });
    }
    
    // Подготовка данных для обновления
    let updateData = { ...req.body };
    
    // Запрещаем менять критические поля для не-админов
    if (req.user.role !== 'admin' && (collection === 'users' || collection === 'myCollection')) {
      const { role, _id, ...safeData } = updateData;
      updateData = safeData;
    }
    
    const result = await client.db('DatabaseAi').collection(collection).updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    res.json({ _id: id, ...updateData });
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
    
    // Получаем запись для проверки прав
    const existingData = await client.db('DatabaseAi').collection(collection).findOne({ 
      _id: new ObjectId(id) 
    });
    
    if (!existingData) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }
    
    // Проверка прав доступа
    if (req.user.role !== 'admin' && 
        (collection === 'users' || collection === 'myCollection' || existingData.userId !== req.user._id)) {
      return res.status(403).json({ error: 'Нет прав для удаления этой записи' });
    }
    
    const result = await client.db('DatabaseAi').collection(collection).deleteOne({ 
      _id: new ObjectId(id) 
    });

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
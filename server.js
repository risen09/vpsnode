const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/experts', authenticate, require('./routes/agents/subject-expert'));
app.use('/api/homework', authenticate, require('./routes/agents/homework-helper'));
app.use('/api/study-plans', authenticate, require('./routes/agents/study-plan'));
app.use('/api/track-assistants', authenticate, require('./routes/agents/track-assistant'));
app.use('/api/progress-analyzer', authenticate, require('./routes/agents/progress-analyzer'));
// Добавляем маршрут для начальной диагностики
app.use('/api/initial-diagnostics', authenticate, require('./routes/agents/initial-diagnostics'));
// Добавляем маршрут для работы с тестами
app.use('/api/tests', authenticate, require('./routes/agents/tests'));

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

// Маршруты для гигачата (остаются без изменений)
app.use('/api/gigachat', authenticate, require('./routes/gigachat'));

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

// Получение данных текущего пользователя
app.get('/api/user', authenticate, async (req, res) => {
  res.json(req.user);
});

// Обновление профиля текущего пользователя
app.put('/api/user', authenticate, async (req, res) => {
  const userId = req.user._id;
  if (!userId || userId === 'admin') {
    return res.status(400).json({ error: 'Недопустимый ID пользователя' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    
    // Исключаем чувствительные поля от обновления
    const { password, _id, role, createdAt, ...updateData } = req.body;
    
    const result = await client.db('DatabaseAi').collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Получаем обновленные данные пользователя
    const updatedUser = await client.db('DatabaseAi').collection('users').findOne(
      { _id: new ObjectId(userId) }
    );
    
    // Не возвращаем пароль
    if (updatedUser.password) {
      delete updatedUser.password;
    }
    
    res.json(updatedUser);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Создание пользователей (администраторский доступ)
app.post('/api/users', authenticate, async (req, res) => {
  // Проверка прав администратора
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    
    // Проверяем наличие обязательного поля username или email
    if (!req.body.username && !req.body.email) {
      return res.status(400).json({ error: 'Требуется поле username или email' });
    }
    
    // Определяем коллекцию в зависимости от типа данных
    const collection = req.body.email ? 'users' : 'myCollection';
    const searchField = req.body.email ? { email: req.body.email } : { username: req.body.username };
    
    // Проверяем, не существует ли уже пользователь
    const existingUser = await client.db('DatabaseAi').collection(collection).findOne(searchField);
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким username/email уже существует' });
    }
    
    // Создаем пользователя
    const user = await client.db('DatabaseAi').collection(collection).insertOne({
      ...req.body,
      role: req.body.role || 'user', // По умолчанию устанавливаем роль 'user'
      createdAt: new Date()
    });
    
    res.status(201).json({ _id: user.insertedId, ...req.body });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Обновление пользователя (UPDATE)
app.put('/api/users/:id', authenticate, async (req, res) => {
  // Проверка прав - обычный пользователь может обновлять только себя
  if (req.user.role !== 'admin' && req.user._id !== req.params.id) {
    return res.status(403).json({ error: 'Нет прав для изменения другого пользователя' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  const { id } = req.params;
  
  try {
    await client.connect();
    
    // Исключаем чувствительные поля для не-админов
    let updateData = { ...req.body };
    if (req.user.role !== 'admin') {
      const { role, _id, ...safeData } = updateData;
      updateData = safeData;
    }
    
    // Сначала проверяем в коллекции users
    let result = await client.db('DatabaseAi').collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    // Если не нашли, проверяем в myCollection
    if (result.matchedCount === 0) {
      result = await client.db('DatabaseAi').collection('myCollection').updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
    }
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.json({ _id: id, ...updateData });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Удаление пользователя (DELETE)
app.delete('/api/users/:id', authenticate, async (req, res) => {
  // Проверка прав администратора
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  const { id } = req.params;
  
  try {
    await client.connect();
    
    // Проверяем обе коллекции
    const db = client.db('DatabaseAi');
    let result = await db.collection('users').deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      result = await db.collection('myCollection').deleteOne({ _id: new ObjectId(id) });
    }
    
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

// Получение пользователя по ID
app.get('/api/users/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  
  // Проверка прав - обычный пользователь может просматривать только себя
  if (req.user.role !== 'admin' && req.user._id !== id) {
    return res.status(403).json({ error: 'Нет прав для просмотра другого пользователя' });
  }
  
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    
    // Проверяем обе коллекции
    let user = await client.db('DatabaseAi').collection('users').findOne({ _id: new ObjectId(id) });
    
    if (!user) {
      user = await client.db('DatabaseAi').collection('myCollection').findOne({ _id: new ObjectId(id) });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Не возвращаем пароль
    if (user.password) {
      delete user.password;
    }
    
    res.json(user);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Получение списка пользователей (только для админов)
app.get('/api/users', authenticate, async (req, res) => {
  // Проверка прав администратора
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('DatabaseAi');
    
    // Получаем пользователей из обеих коллекций
    const usersCollection = await db.collection('users').find().toArray();
    const myCollection = await db.collection('myCollection').find().toArray();
    
    // Объединяем и удаляем пароли
    const allUsers = [...usersCollection, ...myCollection].map(user => {
      const { password, ...userData } = user;
      return userData;
    });
    
    res.json(allUsers);
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
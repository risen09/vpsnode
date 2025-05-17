const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { authenticate } = require('../../../middlewares/authenticate');
const User = require('../../../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

router.get('/', authenticate, async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Получение пользователя по ID
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.status(200).json(user);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Обновление пользователя по ID
router.post('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  // Проверка прав администратора и текущего пользователя
  if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
    return res.status(403).json({ error: 'Недостаточно прав для обновления пользователя' });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.status(200).json({
      message: 'Пользователь успешно обновлен',
      user: updatedUser
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Удаление пользователя по ID
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  // check if role is admin and check if current user is trying to delete himself
  if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
    return res.status(403).json({ error: 'Недостаточно прав для удаления пользователя' });
  }

  try {
    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.status(200).json({
      message: 'Пользователь успешно удален'
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Создание пользователей (администраторский доступ)
router.post('/', authenticate, async (req, res) => {
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
router.post('/:id', authenticate, async (req, res) => {
  // Проверка прав - обычный пользователь может обновлять только себя
  if (req.user.role !== 'admin' && req.user._id !== req.params.id) {
    return res.status(403).json({ error: 'Нет прав для изменения другого пользователя' });
  }
  
  const client = new MongoClient(MONGODB_URI);
  const { id } = req.params;
  
  try {
    await client.connect();
    
    // Исключаем чувствительные поля для не-админов
      const { role, _id, ...safeData } = req.body;
    
    // Сначала проверяем в коллекции users
    const result = await client.db('DatabaseAi').collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: safeData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.json({ _id: id, ...safeData });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

// Удаление пользователя (DELETE)
router.delete('/:id', authenticate, async (req, res) => {
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
router.get('/:id', authenticate, async (req, res) => {
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
router.get('/', authenticate, async (req, res) => {
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

module.exports = router;
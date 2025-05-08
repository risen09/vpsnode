const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { authenticate } = require('../../../middlewares/authenticate');

const MONGODB_URI = process.env.MONGODB_URI;

// Получение данных текущего пользователя
router.get('/', authenticate, async (req, res) => {
  res.json(req.user);
});

// Обновление профиля текущего пользователя
router.put('/', authenticate, async (req, res) => {
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

module.exports = router;
const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// Создание новой записи в любой коллекции
router.post('/:collection', authenticate, async (req, res) => {
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
router.get('/api/:collection', authenticate, async (req, res) => {
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
router.get('/api/:collection/:id', authenticate, async (req, res) => {
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
router.post('/api/:collection/:id', authenticate, async (req, res) => {
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
router.delete('/api/:collection/:id', authenticate, async (req, res) => {
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

module.exports = router;
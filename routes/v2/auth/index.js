const router = require('express').Router();
const User = require('../../../models/User');
const { MongoClient  } = require('mongodb');
const { basicAuth } = require('../../../middlewares/authenticate');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const { RegistrationSchema } = require('./schemas')

const SECRET = process.env.JWT_SECRET;

router.use('/vk', require('./vk'))

router.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email })
    if (!user) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }
    const isValidPassword = await bcrypt.compare(req.body.password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Неверный email или пароль' });
    }
    const token = jwt.sign({
      userId: user._id,
      role: user.role || 'user'
    }, SECRET, { expiresIn: '30d' });
    
    // Формирование ответа
    const userResponse = { ...user };
    delete userResponse.password; // Не отправляем пароль клиенту
    
    res.json({ token });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }

});

router.post('/register', async (req, res) => {
  try {
    const schemaResult = RegistrationSchema.safeParse(req.body);
    if (!schemaResult.success) {
      return res.status(400).json({ error: 'Заполнены не все поля' });
    }

    const existingUser = await User.findOne({ email: req.body.email })
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const grade = req.body.age - 6;
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const newUser = new User({
      ...req.body,
      // grade,
      password: hashedPassword,
      role: 'user',
      createdAt: new Date(),
    })
    const { _id } = await newUser.save();
    
    res.status(201).json({ 
      user: _id,
    });
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

module.exports = router;
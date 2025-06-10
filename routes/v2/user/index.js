const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { authenticate } = require('../../../middlewares/authenticate');
const User = require('../../../models/User');
require('dotenv').config();

router.get('/', async (req, res) => {
  const { _id } = req.user;
  console.log(req.user)
  try {
    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    return res.status(200).json(user);
  } catch (err) {
    console.error('MongoDB error:', err);
    return res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

router.post('/', async (req, res) => {
  const { _id } = req.user;
  try {
    const updatedUser = await User.findByIdAndUpdate(_id, req.body, { new: true });
    if (!updatedUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.status(200).json(updatedUser);
  } catch (err) {
    console.error('MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

module.exports = router;
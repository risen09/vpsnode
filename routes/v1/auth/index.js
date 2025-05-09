const router = require('express').Router();
const { MongoClient  } = require('mongodb');
const { basicAuth } = require('../../../middlewares/authenticate');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const SECRET = process.env.JWT_SECRET;

router.use('/vk', require('./vk'));

module.exports = router;
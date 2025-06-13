const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../../../middlewares/authenticate');
const { fetchUserInfo, calculateAge } = require('../../../utils/vk');
const { encryptToken, decryptToken } = require('../../../utils/cryptoUtils');
const User = require('../../../models/User')

const MONGODB_URI = process.env.MONGODB_URI;
const SECRET = process.env.JWT_SECRET;
const VK_PUBLIC_KEY = process.env.VK_PUBLIC_KEY;
const VK_CLIENT_ID = process.env.VK_CLIENT_ID;

router.post('/', async (req, res) => {
  console.log('[API /auth/vk] ', req.body);
  const { code, code_verifier, redirect_uri, device_id } = req.body;

  if (!code || !code_verifier || !redirect_uri || !device_id) {
    return res.status(400).json({ error: 'Требуются все поля' });
  }

  const url = "https://id.vk.com/oauth2/auth";
  const data = {
    client_id: VK_CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    code_verifier: code_verifier,
    device_id: device_id,
    redirect_uri: redirect_uri,
  }

  try {
    console.log('[API /auth/vk] fetch ', url, data);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(data).toString()
    });

    const responseData = await response.json();
    console.log('[API /auth/vk] fetch response data ', responseData);
    const { access_token, refresh_token, id_token } = responseData;

    if (!access_token || !refresh_token || !id_token) {
      return res.status(400).json({ error: 'Неверный ответ от VK' });
    }

    const { sub: vkUserId } = jwt.verify(id_token, VK_PUBLIC_KEY);
    console.log('[API /auth/vk] decode id_token ', vkUserId);
    // find in users collection where vkProfile.id is equal to vkUserId
    const user = await User.findOne({ "vkProfile.id" : vkUserId })
    let userId = user ? user._id.toString() : null;
    if (userId) {
      console.log('[API /auth/vk] found user id ', userId);
      await User.updateOne({ _id: userId }, { $set: { 'vkProfile.access_token': encryptToken(access_token).combined, 'vkProfile.expires_at': Math.floor(Date.now() / 1000) + 3600, 'vkProfile.refresh_token': encryptToken(refresh_token).combined, 'vkProfile.id_token': id_token }});
    } else {
      const fetchedData = await fetchUserInfo(access_token, device_id)
      console.log('[API /auth/vk] creating new user');
      // create new user
      const newUser = new User({
        name: `${fetchedData.first_name} ${fetchedData.last_name}`,
        username: `${fetchedData.first_name.toLowerCase()}_${fetchedData.last_name.toLowerCase()}`,
        email: fetchedData.email,
        // avatar: fetchedData.avatar,
        gender: +(fetchedData.sex - 1),
        age: calculateAge(fetchedData.birthday),
        // grade: calculateAge(fetchedData.birthday) - 6,
        vkProfile: {
          id: vkUserId,
          access_token: encryptToken(access_token).combined,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: encryptToken(refresh_token).combined,
          id_token,
          device_id,
        },
        role: 'user'
      });

      const result = await newUser.save()
      console.log('[API /auth/vk] created new user ', newUser);
      userId = result._id.toString();
    }

    const token = jwt.sign({
      userId: userId,
      role: 'user'
    }, SECRET, { expiresIn: '30d' });

    res.json({ token });
  } catch (err) {
    console.error('[API /auth/vk] MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const userId = req.user._id;

  if (!userId) {
    return res.status(400).json({ error: 'Недопустимый ID пользователя' });
  }
  
  const user = await client.db('DatabaseAi').collection('users').findOne({ _id: new ObjectId(userId) });
  if (!user) {
    console.log('[API /auth/vk/logout] user not found');
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const accessToken = user.vkProfile?.access_token;
  if (!accessToken) {
    console.log('[API /auth/vk/logout] no VK token found');
    return res.status(400).json({ error: 'Нет VK токена для пользователя' });
  }


  const url = 'https://id.vk.com/oauth2/logout';
  const data = {
    client_id: VK_CLIENT_ID,
    access_token: decryptToken(accessToken),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(data).toString()
    });

    const responseData = await response.json();
    console.log('[API /auth/vk/logout] fetch response data ', responseData);

    if (responseData.response === 1) {
      console.log('[API /auth/vk/logout] VK token invalidated');
      res.status(200).json({ message: 'VK токен инвалидирован' });
    } else {
      console.log('[API /auth/vk/logout] error invalidating VK token', responseData);
      res.status(response.status).json({ error: 'Ошибка при инвалидации VK токена' });
    }
  } catch (err) {
    console.error('[API /auth/vk/logout] MongoDB error:', err);
    res.status(500).json({ error: 'Ошибка базы данных' });
  } finally {
    await client.close();
  }
});

router.post('/health', async (req, res) => {
  res.status(200).json({ message: 'OK' });
});

module.exports = router;
require('dotenv').config();
const VK_CLIENT_ID = process.env.VK_CLIENT_ID;

const fetchPublicInfo = async (id_token) => {
  const url = 'https://id.vk.com/oauth2/public_info';
  const data = {
    client_id: VK_CLIENT_ID,
    id_token: id_token
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(data).toString()
  });
  const { user } = await response.json();
  console.log('[VK API] fetch public info ', user);
  return user;
}

const refreshToken = async (refresh_token, device_id) => {
  try {
    const url = 'https://id.vk.com/oauth2/auth';
    const data = {
      client_id: VK_CLIENT_ID,
      refresh_token,
      grant_type: 'refresh_token',
      device_id,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(data).toString()
    });

    const json = await response.json();
    const { access_token, expires_in, refresh_token: newRefreshToken } = json;
    console.log('[VK API] successfully refreshed token');
    return {
      access_token,
      expires_at: expires_in,
      refresh_token: newRefreshToken
    }
  } catch (err) {
    console.log('[VK API] error during refreshing token', err);
    throw err;
  }
}

module.exports = {
  fetchPublicInfo,
  refreshToken
}

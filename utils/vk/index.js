require('dotenv').config();
const VK_CLIENT_ID = process.env.VK_CLIENT_ID;

const fetchUserInfo = async (access_token, device_id) => {
  const url = 'https://id.vk.com/oauth2/user_info';
  const data = {
    access_token,
    device_id,
    client_id: VK_CLIENT_ID,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(data).toString()
  });
  const { user } = await response.json();
  console.log('[VK API] user info ', user);
  return user;
}

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

const calculateAge = (birthday) => {
    // Split the birthday string into day, month, year
    const [day, month, year] = birthday.split('.').map(Number);
    
    // Create Date objects for birthday and today
    const birthDate = new Date(year, month - 1, day); // Note: months are 0-indexed in JS
    const today = new Date();
    
    // Calculate age
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // Adjust age if birthday hasn't occurred yet this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
}

module.exports = {
  fetchUserInfo,
  fetchPublicInfo,
  refreshToken,
  calculateAge
}

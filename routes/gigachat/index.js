const https = require('https');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { MongoClient } = require('mongodb');

module.exports = router

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 200,
    httpsAgent
});

router.get('/list', async (req, res) => {
    const { _id } = req.user;

    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        const collection = db.collection('chatHistory');
        const response = await collection.find({user_id: _id}).toArray();
        await client.close();
        return res.send(response.map(item => ({id: item._id, lastMessage: item.messages[item.messages.length - 1].content})));
    } catch (error) {
        console.error('Ошибка при получении списка чатов:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.post('/new', async (req, res) => {
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];

    const messages = [
        {
            role: 'system',
            content: 'Ты помощник-репетитор для школьников 5-11 классов. Ты отлично знаешь математику, физику,программирование. Ты умеешь объяснять задачи и помогать решать их. Ты всегда готов помочь. Ты готов помочь школьникам и студентам решать задачи и понимать теорию. Ты отвечаешь на вопросы и помогаешь с домашними заданиями.'
        }
    ]
    
    const response = await fetch(`http://localhost:3000/api/chatHistory/`, {
        method: 'POST',
        body: JSON.stringify({user_id: _id, messages: messages}),
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    })

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка при сохранении истории чата:', errorText);
        return res.status(response.status).json({ error: 'Ошибка при сохранении истории чата' });
    }   
    
    const responseData = await response.json();
    console.log('История чата сохранена:', responseData);
    return res.send({chat_id: responseData._id});
});

router.get('/chat/:id', async (req, res) => {
   const { id } = req.params;
   const token = req.headers.authorization.split(' ')[1];

   console.log('Получение истории чата');
   const chatHistoryResponse = await fetch(`http://localhost:3000/api/chatHistory/${id}`, {
       method: 'GET',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       }
   });

   console.log('Отправка истории чата');
   res.send(await chatHistoryResponse.json());
});

router.post('/chat/:id', async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const { id } = req.params;
  const message = req.body.message;
  const { _id } = req.user;

  console.log('Получение данных пользователя');
  const userResponse = await fetch(`http://localhost:3000/api/users/${_id}`, {
      method: 'GET',
      headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
      }
  });

  const { cognitive_profile, selected_subjects } = await userResponse.json();

  console.log('Получение истории чата');
  const chatHistoryResponse = await fetch(`http://localhost:3000/api/gigachat/chat/${id}`, {
      method: 'GET',
      headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
      }
  })

  const chatHistory = await chatHistoryResponse.json();
  const userId = chatHistory.user_id;
  if (userId !== _id) {
      console.log('Ошибка: Вы не имеете доступ к этому чату');
      return res.status(401).json({ error: 'Вы не имеете доступ к этому чату' });
  }
  const messages = chatHistory.messages;

  // Создание персонализированного сообщения
  const personalizedMessage = `
      Помоги мне пожалуйста со следующим запросом:
      "${message}"
      
      Учитывая мой (Cognitive Profile) и выбранные предметы (Selected Subjects), ответь на вопрос.

      Cognitive Profile: ${JSON.stringify(cognitive_profile)}
      Selected Subjects: ${selected_subjects.join(', ')}
  `;

  console.log(personalizedMessage);

  try {
      console.log('Получение ответа от AI');
      const formattedMessages = messages.map(msg => {
          if (msg.role === 'user') {
              return new HumanMessage(msg.content);
          } else if (msg.role === 'assistant') {
              return new AIMessage(msg.content);
          }
          return new SystemMessage(msg.content);
      });

      const aiMessage = await giga.invoke([
          ...formattedMessages,
          new HumanMessage(personalizedMessage)
      ]);
      console.log(aiMessage.content);

      messages.push({
          role: 'user',
          content: message
      });
      messages.push({
          role: 'assistant',
          content: aiMessage.content
      });

      // Проверка формата ID
      if (!ObjectId.isValid(id)) {
          console.log('Ошибка: Неверный формат ID');
          return res.status(400).json({ error: 'Неверный формат ID' });
      }

      console.log('Сохранение истории чата');
      const response = await fetch(`http://localhost:3000/api/chatHistory/${id}`, {
          method: 'POST',
          body: JSON.stringify({user_id: _id, messages: messages}),
          headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
          }
      });
      
      if (!response.ok) {
          const errorText = await response.text();
          console.error('Ошибка при сохранении истории чата:', errorText);
          return res.status(response.status).json({ error: 'Ошибка при сохранении истории чата' });
      }
      
      const responseData = await response.json();
      console.log('История чата сохранена:', responseData);
      return res.send({message: aiMessage.content});
  } catch (error) {
      console.error('Ошибка:', error);
      return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});
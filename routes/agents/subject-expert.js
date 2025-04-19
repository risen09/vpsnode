// routes/agents/subject-expert.js
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { MongoClient } = require('mongodb');

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 400, // Increased token limit for detailed explanations
});

// Get list of expert chats
router.get('/list', async (req, res) => {
    const { _id } = req.user;

    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        const collection = db.collection('expertChatHistory');
        const response = await collection.find({user_id: _id}).toArray();
        await client.close();
        return res.send(response.map(item => ({
            id: item._id, 
            subject: item.subject,
            lastMessage: item.messages[item.messages.length - 1].content
        })));
    } catch (error) {
        console.error('Ошибка при получении списка чатов:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Create new expert chat
router.post('/new', async (req, res) => {
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];
    const { subject } = req.body;

    if (!subject) {
        return res.status(400).json({ error: 'Необходимо указать предмет' });
    }

    // Define persona based on subject
    let systemPrompt;
    switch (subject.toLowerCase()) {
        case 'mathematics':
        case 'math':
        case 'математика':
            systemPrompt = 'Ты эксперт по математике с глубоким пониманием всех тем от элементарной арифметики до высшей математики. Ты объясняешь математические концепции простым и понятным языком, приводишь примеры и можешь помочь с решением задач шаг за шагом. Ты знаешь о частых ошибках учащихся и способах их преодоления.';
            break;
        case 'physics':
        case 'физика':
            systemPrompt = 'Ты эксперт по физике, обладающий глубокими знаниями во всех областях от механики до квантовой физики. Ты умеешь объяснять сложные физические концепции с помощью аналогий и примеров из реальной жизни. Ты помогаешь анализировать и решать задачи по физике, всегда указывая применяемые законы и формулы.';
            break;
        case 'programming':
        case 'coding':
        case 'программирование':
            systemPrompt = 'Ты опытный программист, владеющий множеством языков программирования и технологий. Ты объясняешь концепции программирования понятным языком, приводишь примеры кода и помогаешь решать проблемы. Ты знаешь о лучших практиках написания кода и советуешь оптимальные решения.';
            break;
        default:
            systemPrompt = `Ты эксперт по предмету "${subject}", обладающий глубокими знаниями и педагогическим опытом. Ты объясняешь концепции доступным языком, помогаешь с заданиями и отвечаешь на вопросы, адаптируя объяснения под уровень ученика.`;
    }

    const messages = [
        {
            role: 'system',
            content: systemPrompt
        }
    ];
    
    const response = await fetch(`http://127.0.0.1:3000/api/expertChatHistory/`, {
        method: 'POST',
        body: JSON.stringify({user_id: _id, subject: subject, messages: messages}),
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
    return res.send({chat_id: responseData._id, subject: subject});
});

// Get expert chat
router.get('/chat/:id', async (req, res) => {
   const { id } = req.params;
   const token = req.headers.authorization.split(' ')[1];

   const chatHistoryResponse = await fetch(`http://127.0.0.1:3000/api/expertChatHistory/${id}`, {
       method: 'GET',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       }
   });

   res.send(await chatHistoryResponse.json());
});

// Send message to expert chat
router.post('/chat/:id', async (req, res) => {
    const token = req.headers.authorization.split(' ')[1];
    const { id } = req.params;
    const message = req.body.message;
    const { _id } = req.user;

    // Get user data for personalization
    const userResponse = await fetch(`http://127.0.0.1:3000/api/users/${_id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const userData = await userResponse.json();
    const { cognitive_profile, age } = userData;

    // Get chat history
    const chatHistoryResponse = await fetch(`http://127.0.0.1:3000/api/expertChatHistory/${id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const chatHistory = await chatHistoryResponse.json();
    const userId = chatHistory.user_id;
    if (userId !== _id) {
        return res.status(401).json({ error: 'Вы не имеете доступ к этому чату' });
    }
    
    const messages = chatHistory.messages;
    const subject = chatHistory.subject;

    // Create a personalized message
    const personalizedMessage = `
        Мой вопрос по предмету ${subject}:
        "${message}"
        
        [Информация об ученике: возраст ${age || 'не указан'}, 
        когнитивный профиль: ${JSON.stringify(cognitive_profile || {})}]
    `;

    try {
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

        messages.push({
            role: 'user',
            content: message
        });
        messages.push({
            role: 'assistant',
            content: aiMessage.content
        });

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Неверный формат ID' });
        }

        const response = await fetch(`http://127.0.0.1:3000/api/expertChatHistory/${id}`, {
            method: 'POST',
            body: JSON.stringify({user_id: _id, subject: subject, messages: messages}),
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
        
        return res.send({message: aiMessage.content});
    } catch (error) {
        console.error('Ошибка:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

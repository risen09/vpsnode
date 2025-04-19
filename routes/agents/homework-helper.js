// routes/agents/homework-helper.js
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { MongoClient } = require('mongodb');

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 500, // Higher token limit for detailed homework help
});

router.get('/list', async (req, res) => {
    const { _id } = req.user;

    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        const collection = db.collection('homeworkHistory');
        const response = await collection.find({user_id: _id}).toArray();
        await client.close();
        return res.send(response.map(item => ({
            id: item._id, 
            subject: item.subject,
            title: item.title,
            lastMessage: item.messages[item.messages.length - 1].content
        })));
    } catch (error) {
        console.error('Ошибка при получении списка домашних заданий:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.post('/new', async (req, res) => {
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];
    const { subject, title } = req.body;

    if (!subject || !title) {
        return res.status(400).json({ error: 'Необходимо указать предмет и название задания' });
    }

    const messages = [
        {
            role: 'system',
            content: `Ты помощник по домашним заданиям, который специализируется на предмете "${subject}". 
            Твоя задача - не просто давать ответы, а помогать ученику понять, как решать задачи самостоятельно. 
            Ты объясняешь шаг за шагом, задаешь наводящие вопросы и даешь подсказки, которые помогают прийти к решению. 
            Твой подход основан на принципе "помоги мне научиться это делать самому".`
        }
    ];
    
    const response = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/`, {
        method: 'POST',
        body: JSON.stringify({
            user_id: _id, 
            subject: subject, 
            title: title,
            messages: messages,
            created_at: new Date(),
            status: 'in_progress'
        }),
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка при создании задания:', errorText);
        return res.status(response.status).json({ error: 'Ошибка при создании задания' });
    }   
    
    const responseData = await response.json();
    return res.send({
        homework_id: responseData._id, 
        subject: subject,
        title: title
    });
});

router.get('/chat/:id', async (req, res) => {
   const { id } = req.params;
   const token = req.headers.authorization.split(' ')[1];

   const homeworkResponse = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/${id}`, {
       method: 'GET',
       headers: {
           'Authorization': `Bearer ${token}`,
           'Content-Type': 'application/json'
       }
   });

   res.send(await homeworkResponse.json());
});

router.post('/chat/:id', async (req, res) => {
    const token = req.headers.authorization.split(' ')[1];
    const { id } = req.params;
    const message = req.body.message;
    const { _id } = req.user;

    // Get user educational data
    const userResponse = await fetch(`http://127.0.0.1:3000/api/users/${_id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const userData = await userResponse.json();
    const { grade_level, learning_style } = userData;

    // Get homework chat history
    const homeworkResponse = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/${id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const homework = await homeworkResponse.json();
    const userId = homework.user_id;
    if (userId !== _id) {
        return res.status(401).json({ error: 'Вы не имеете доступ к этому заданию' });
    }
    
    const messages = homework.messages;
    const subject = homework.subject;
    const title = homework.title;

    // Create a personalized message with educational context
    const personalizedMessage = `
        По заданию "${title}" по предмету "${subject}":
        "${message}"
        
        [Контекст: ученик ${grade_level ? `${grade_level} класса` : 'школьного возраста'}, 
        стиль обучения: ${learning_style || 'не указан'}]
        
        Давай подсказки, а не полные ответы. Помоги ученику прийти к решению самостоятельно.
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

        const response = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/${id}`, {
            method: 'POST',
            body: JSON.stringify({
                user_id: _id, 
                subject: subject, 
                title: title,
                messages: messages,
                last_updated: new Date()
            }),
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка при сохранении задания:', errorText);
            return res.status(response.status).json({ error: 'Ошибка при сохранении задания' });
        }
        
        return res.send({message: aiMessage.content});
    } catch (error) {
        console.error('Ошибка:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Mark homework as completed
router.post('/complete/:id', async (req, res) => {
    const { id } = req.params;
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Неверный формат ID' });
    }

    // Get homework to check ownership
    const homeworkResponse = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/${id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const homework = await homeworkResponse.json();
    if (homework.user_id !== _id) {
        return res.status(401).json({ error: 'Вы не имеете доступ к этому заданию' });
    }

    // Update homework status
    const response = await fetch(`http://127.0.0.1:3000/api/homeworkHistory/${id}`, {
        method: 'POST',
        body: JSON.stringify({
            status: 'completed',
            completed_at: new Date()
        }),
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка при завершении задания:', errorText);
        return res.status(response.status).json({ error: 'Ошибка при завершении задания' });
    }

    return res.send({ success: true, message: 'Задание отмечено как выполненное' });
});

module.exports = router;

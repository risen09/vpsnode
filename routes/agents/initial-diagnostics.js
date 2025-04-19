const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");

// Инициализация GigaChat клиента
const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 1500, // Увеличиваем токены для более детальных ответов
});

// Системное сообщение для диагностики
const DIAGNOSTIC_SYSTEM_PROMPT = `
Ты - образовательный ассистент, выполняющий начальную диагностику учебных потребностей. 

Твоя задача:
1. Определить предметную область, которая интересует пользователя (математика, физика, химия и т.д.)
2. Определить конкретную тему в этой области, с которой пользователю нужна помощь
3. Оценить уровень сложности (basic, intermediate, advanced) на основе вопросов пользователя
4. Решить, требуется ли начальный тест для оценки уровня знаний пользователя
5. Предложить смежные темы для изучения (не более 3-5)

В конце анализа ты должен вернуть структурированный объект в своём ответе, заключённый в тройные кавычки:
"""
{
  "diagnosticResult": {
    "subjectArea": "название предмета",
    "topic": "конкретная тема",
    "difficulty": "basic/intermediate/advanced",
    "needsInitialTest": true/false,
    "suggestedTopics": ["тема1", "тема2", "тема3"]
  },
  "nextAction": "start_test/create_track/continue_chat"
}
"""

Где nextAction должен быть одним из:
- start_test: если пользователю нужно пройти диагностический тест
- create_track: если можно сразу создать трек обучения
- continue_chat: если нужна дополнительная информация от пользователя

Всегда отвечай дружелюбно и задавай уточняющие вопросы, если информации недостаточно.
Общайся на русском языке.
`;

// Создание нового диагностического чата
router.post('/new', async (req, res) => {
    try {
        const { _id } = req.user;
        
        // Создаем новый чат в MongoDB
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const result = await client.db('DatabaseAi').collection('diagnosticChats').insertOne({
            user_id: _id,
            messages: [
                {
                    role: 'system',
                    content: DIAGNOSTIC_SYSTEM_PROMPT
                }
            ],
            createdAt: new Date(),
            diagnosticResult: null,
            status: 'active'
        });
        console.log("Создаем новый диагностический чат для пользователя:", _id);
        console.log("Формат ответа:", { chat_id: result.insertedId.toString() });
        
        await client.close();
        await new Promise(resolve => setTimeout(resolve, 300));
        res.status(201).json({ 
            chat_id: result.insertedId.toString() 
        });
    } catch (error) {
        console.error('Ошибка при создании диагностического чата:', error);
        res.status(500).json({ error: 'Ошибка при создании диагностического чата' });
    }
});

// Отправка сообщения в диагностический чат
router.post('/sendMessage', async (req, res) => {
    try {
        const { _id } = req.user;
        const { chat_id, message } = req.body;
        
        if (!chat_id || !message) {
            return res.status(400).json({ error: 'Требуются chat_id и message' });
        }
        
        // Подключаемся к базе данных
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        // Получаем текущий чат
        const db = client.db('DatabaseAi');
        const chat = await db.collection('diagnosticChats').findOne({ 
            _id: new ObjectId(chat_id),
            user_id: _id
        });
        
        if (!chat) {
            await client.close();
            return res.status(404).json({ error: 'Чат не найден или у вас нет к нему доступа' });
        }
        
        // Получаем информацию о пользователе для персонализации
        const user = await db.collection('users').findOne({ _id: new ObjectId(_id) });
        
        // Добавляем сообщение пользователя в историю
        const userMessage = {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        };
        
        chat.messages.push(userMessage);
        
        // Формируем сообщения для отправки в GigaChat
        const formattedMessages = chat.messages.map(msg => {
            if (msg.role === 'user') {
                return new HumanMessage(msg.content);
            } else if (msg.role === 'assistant') {
                return new AIMessage(msg.content);
            }
            return new SystemMessage(msg.content);
        });
        
        // Получаем ответ от GigaChat
        const aiResponse = await giga.invoke(formattedMessages);
        
        // Проверяем наличие JSON-структуры с результатами диагностики
        let diagnosticResult = null;
        let nextAction = 'continue_chat';
        
        const responseContent = aiResponse.content;
        const match = responseContent.match(/```([\s\S]*?)```/);
        
        if (match) {
            try {
                // Извлекаем и парсим JSON из ответа
                const jsonStr = match[1].replace(/^json\n/, '');
                const diagnosticData = JSON.parse(jsonStr);
                
                if (diagnosticData.diagnosticResult) {
                    diagnosticResult = diagnosticData.diagnosticResult;
                    nextAction = diagnosticData.nextAction || 'continue_chat';
                    
                    // Обновляем статус чата
                    if (nextAction !== 'continue_chat') {
                        chat.status = 'completed';
                    }
                }
            } catch (e) {
                console.error('Ошибка при парсинге JSON из ответа:', e);
            }
        }
        
        // Создаем сообщение ассистента
        const assistantMessage = {
            role: 'assistant',
            content: responseContent,
            timestamp: new Date().toISOString()
        };
        
        // Добавляем сообщение в историю
        chat.messages.push(assistantMessage);
        
        // Обновляем чат в базе данных
        if (diagnosticResult) {
            chat.diagnosticResult = diagnosticResult;
        }
        
        await db.collection('diagnosticChats').updateOne(
            { _id: new ObjectId(chat_id) },
            { $set: { messages: chat.messages, status: chat.status, diagnosticResult: chat.diagnosticResult } }
        );
        
        // Подготавливаем ответ
        const response = {
            message: responseContent,
            timestamp: assistantMessage.timestamp
        };
        
        // Если есть результаты диагностики, добавляем их в ответ
        if (diagnosticResult) {
            response.diagnosticResult = diagnosticResult;
            response.nextAction = nextAction;
        }
        console.log("Обрабатываем сообщение в чате:", chat_id);
        console.log("Тип ответа от API:", typeof response);
        await new Promise(resolve => setTimeout(resolve, 300));
        // Создаем тест, если нужно
        if (nextAction === 'start_test' && diagnosticResult) {
            // Создаем тест в базе данных
            const testResult = await db.collection('initialTests').insertOne({
                user_id: _id,
                subject: diagnosticResult.subjectArea,
                topic: diagnosticResult.topic,
                difficulty: diagnosticResult.difficulty,
                createdAt: new Date(),
                status: 'pending'
            });
            
            // Добавляем ID теста в результаты диагностики
            response.diagnosticResult.testId = testResult.insertedId.toString();
            
            // Обновляем информацию о тесте в чате
            await db.collection('diagnosticChats').updateOne(
                { _id: new ObjectId(chat_id) },
                { $set: { 'diagnosticResult.testId': testResult.insertedId.toString() } }
            );
        }
        
        await client.close();
        res.json(response);
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        res.status(500).json({ error: 'Ошибка при обработке сообщения' });
    }
});

// Создание начального теста
router.post('/startInitialTest', async (req, res) => {
    try {
        const { _id } = req.user;
        const { subject, topic } = req.body;
        
        if (!subject || !topic) {
            return res.status(400).json({ error: 'Требуются subject и topic' });
        }
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        // Создаем новый тест
        const result = await client.db('DatabaseAi').collection('initialTests').insertOne({
            user_id: _id,
            subject,
            topic,
            difficulty: 'intermediate', // По умолчанию средний уровень
            createdAt: new Date(),
            status: 'pending'
        });
        
        await client.close();
        
        res.status(201).json({ 
            testId: result.insertedId.toString() 
        });
    } catch (error) {
        console.error('Ошибка при создании теста:', error);
        res.status(500).json({ error: 'Ошибка при создании теста' });
    }
});

// Получение информации о чате
router.get('/:id', async (req, res) => {
    try {
        const { _id } = req.user;
        const { id } = req.params;
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const chat = await client.db('DatabaseAi').collection('diagnosticChats').findOne({
            _id: new ObjectId(id),
            user_id: _id
        });
        
        await client.close();
        
        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден или у вас нет к нему доступа' });
        }
        
        res.json(chat);
    } catch (error) {
        console.error('Ошибка при получении информации о чате:', error);
        res.status(500).json({ error: 'Ошибка при получении информации о чате' });
    }
});

// Получение списка диагностических чатов пользователя
router.get('/', async (req, res) => {
    try {
        const { _id } = req.user;
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const chats = await client.db('DatabaseAi').collection('diagnosticChats')
            .find({ user_id: _id })
            .sort({ createdAt: -1 })
            .toArray();
        
        await client.close();
        
        res.json(chats);
    } catch (error) {
        console.error('Ошибка при получении списка чатов:', error);
        res.status(500).json({ error: 'Ошибка при получении списка чатов' });
    }
});

module.exports = router; 
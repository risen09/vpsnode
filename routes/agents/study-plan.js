// routes/agents/study-plan.js
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');

const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 800, // High token limit for detailed study plans
});

// Generate new study plan
router.post('/generate', async (req, res) => {
    const { _id } = req.user;
    const token = req.headers.authorization.split(' ')[1];
    const { subject, goal, timeframe, difficulty } = req.body;

    if (!subject || !goal) {
        return res.status(400).json({ error: 'Укажите предмет и цель обучения' });
    }

    // Get user data
    const userResponse = await fetch(`http://127.0.0.1:3000/api/users/${_id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const userData = await userResponse.json();
    const { grade_level, learning_style, cognitive_profile } = userData;

    // Create system message for plan generation
    const systemMessage = new SystemMessage(
        `Ты опытный педагог и методист, специализирующийся на создании индивидуальных 
        планов обучения. Твоя задача - создать структурированный план изучения предмета "${subject}" 
        с учетом индивидуальных особенностей ученика и поставленной цели.`
    );

    // Create detailed prompt for plan generation
    const prompt = `
        Создай для меня детальный план обучения по предмету "${subject}".
        
        Цель обучения: ${goal}
        ${timeframe ? `Временные рамки: ${timeframe}` : 'Без конкретных временных рамок'}
        ${difficulty ? `Сложность: ${difficulty}` : 'Средняя сложность'}
        
        Информация обо мне:
        ${grade_level ? `Класс/уровень: ${grade_level}` : ''}
        ${learning_style ? `Стиль обучения: ${learning_style}` : ''}
        ${cognitive_profile ? `Когнитивный профиль: ${JSON.stringify(cognitive_profile)}` : ''}
        
        План должен включать:
        1. Разбивку на темы и подтемы
        2. Примерное время на изучение каждой темы
        3. Рекомендуемые ресурсы (учебники, видео, упражнения)
        4. Контрольные точки для проверки прогресса
        5. Практические задания
        
        Пожалуйста, структурируй план в удобном для чтения формате.
    `;

    try {
        // Generate study plan
        const result = await giga.invoke([
            systemMessage,
            new HumanMessage(prompt)
        ]);

        // Save the plan to database
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const planData = {
            user_id: _id,
            subject: subject,
            goal: goal,
            timeframe: timeframe,
            difficulty: difficulty,
            plan_content: result.content,
            created_at: new Date(),
            status: 'active'
        };
        
        const insertResult = await client.db('DatabaseAi').collection('studyPlans').insertOne(planData);
        await client.close();
        
        return res.json({
            plan_id: insertResult.insertedId,
            ...planData
        });
    } catch (error) {
        console.error('Ошибка при создании плана обучения:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Get user's study plans
router.get('/list', async (req, res) => {
    const { _id } = req.user;
    
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        const plans = await db.collection('studyPlans').find({ user_id: _id }).toArray();
        await client.close();
        
        return res.json(plans);
    } catch (error) {
        console.error('Ошибка при получении планов обучения:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Get specific study plan
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const { _id } = req.user;
    
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Неверный формат ID' });
    }
    
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        
        const plan = await db.collection('studyPlans').findOne({ 
            _id: new ObjectId(id)
        });
        
        if (!plan) {
            return res.status(404).json({ error: 'План не найден' });
        }
        
        if (plan.user_id !== _id) {
            return res.status(403).json({ error: 'Нет доступа к этому плану' });
        }
        
        await client.close();
        return res.json(plan);
    } catch (error) {
        console.error('Ошибка при получении плана:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Update study plan status
router.post('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { _id } = req.user;
    const { status } = req.body;
    
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Неверный формат ID' });
    }
    
    if (!status || !['active', 'completed', 'paused', 'archived'].includes(status)) {
        return res.status(400).json({ error: 'Неверный статус' });
    }
    
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db('DatabaseAi');
        
        // Check ownership
        const plan = await db.collection('studyPlans').findOne({ _id: new ObjectId(id) });
        if (!plan) {
            return res.status(404).json({ error: 'План не найден' });
        }
        
        if (plan.user_id !== _id) {
            return res.status(403).json({ error: 'Нет доступа к этому плану' });
        }
        
        // Update status
        await db.collection('studyPlans').updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: { 
                    status: status,
                    updated_at: new Date()
                } 
            }
        );
        
        await client.close();
        return res.json({ success: true, message: 'Статус плана обновлен' });
    } catch (error) {
        console.error('Ошибка при обновлении статуса плана:', error);
        return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

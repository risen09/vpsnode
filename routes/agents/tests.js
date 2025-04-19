const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

// Инициализация GigaChat клиента
const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 2000,
});

// Системный промпт для генерации вопросов теста
const TEST_GENERATION_PROMPT = `
Ты - образовательный ассистент, который создает диагностические тесты для учеников.

Твоя задача - создать короткий диагностический тест (5 вопросов) по заданной теме.
Каждый вопрос должен:
1. Быть с множественным выбором (4 варианта ответа)
2. Иметь один правильный ответ
3. Соответствовать указанной теме и уровню сложности

Формат ответа должен быть строго в виде JSON:

{
  "testTitle": "Название теста",
  "subject": "Предмет",
  "topic": "Тема",
  "difficulty": "Уровень сложности",
  "questions": [
    {
      "questionText": "Текст вопроса 1",
      "options": [
        "Вариант ответа 1",
        "Вариант ответа 2", 
        "Вариант ответа 3", 
        "Вариант ответа 4"
      ],
      "correctOptionIndex": 0,
      "explanation": "Объяснение правильного ответа"
    },
    // ...остальные вопросы
  ]
}

Сделай вопросы разнообразными, оптимальными для проверки знаний по данной теме.
`;

// Создание начального теста
router.post('/startInitialTest', async (req, res) => {
    try {
        const { _id } = req.user;
        const { subject, topic } = req.body;
        
        if (!subject || !topic) {
            return res.status(400).json({ error: 'Требуются subject и topic' });
        }
        
        // Создаем тест в базе данных (заготовку)
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const testDoc = {
            user_id: _id,
            subject,
            topic,
            difficulty: 'intermediate', // По умолчанию средний
            createdAt: new Date(),
            status: 'generating',
            questions: [],
            userAnswers: [],
            completed: false,
            score: null
        };
        
        const result = await client.db('DatabaseAi').collection('initialTests').insertOne(testDoc);
        const testId = result.insertedId.toString();
        
        // Начинаем асинхронную генерацию вопросов
        // (не блокируем ответ, генерация продолжится в фоне)
        generateTestQuestions(testId, subject, topic, 'intermediate').catch(error => {
            console.error('Ошибка при генерации вопросов теста:', error);
        });
        
        await client.close();
        
        // Возвращаем ID теста
        res.status(201).json({ testId });
    } catch (error) {
        console.error('Ошибка при создании теста:', error);
        res.status(500).json({ error: 'Ошибка при создании теста' });
    }
});

// Функция для асинхронной генерации вопросов теста
async function generateTestQuestions(testId, subject, topic, difficulty) {
    const client = new MongoClient(process.env.MONGODB_URI);
    
    try {
        await client.connect();
        
        // Формируем запрос для GigaChat
        const prompt = `
${TEST_GENERATION_PROMPT}

Предмет: ${subject}
Тема: ${topic}
Уровень сложности: ${difficulty}

Создай тест из 5 вопросов.
`;

        // Получаем ответ от GigaChat
        const response = await giga.invoke([
            new SystemMessage(prompt)
        ]);
        
        try {
            // Пытаемся извлечь JSON из ответа
            const responseText = response.content;
            const jsonMatch = responseText.match(/```(?:json)?\s*({[\s\S]*?})\s*```/) || 
                             responseText.match(/({[\s\S]*"questions"[\s\S]*})/) ||
                             responseText.match(/{[\s\S]*"testTitle"[\s\S]*}/);
                             
            if (!jsonMatch) {
                throw new Error('JSON не найден в ответе');
            }
            
            const testData = JSON.parse(jsonMatch[1]);
            
            // Проверяем наличие обязательных полей
            if (!testData.questions || !Array.isArray(testData.questions)) {
                throw new Error('Некорректный формат данных теста');
            }
            
            // Обновляем тест в базе данных
            await client.db('DatabaseAi').collection('initialTests').updateOne(
                { _id: new ObjectId(testId) },
                { 
                    $set: { 
                        questions: testData.questions,
                        testTitle: testData.testTitle || `Тест по теме "${topic}"`,
                        status: 'ready'
                    } 
                }
            );
        } catch (parseError) {
            console.error('Ошибка при обработке ответа AI:', parseError);
            // Отмечаем ошибку в базе данных
            await client.db('DatabaseAi').collection('initialTests').updateOne(
                { _id: new ObjectId(testId) },
                { $set: { status: 'error', error: parseError.message } }
            );
        }
    } catch (error) {
        console.error('Ошибка при генерации вопросов:', error);
        
        // Отмечаем ошибку в базе данных
        await client.db('DatabaseAi').collection('initialTests').updateOne(
            { _id: new ObjectId(testId) },
            { $set: { status: 'error', error: error.message } }
        );
    } finally {
        await client.close();
    }
}

// Получение теста по ID
router.get('/:id', async (req, res) => {
    try {
        const { _id } = req.user;
        const { id } = req.params;
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const test = await client.db('DatabaseAi').collection('initialTests').findOne({
            _id: new ObjectId(id)
        });
        
        await client.close();
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не найден' });
        }
        
        // Проверка прав доступа (админ или владелец)
        if (test.user_id !== _id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет доступа к этому тесту' });
        }
        
        res.json(test);
    } catch (error) {
        console.error('Ошибка при получении теста:', error);
        res.status(500).json({ error: 'Ошибка при получении теста' });
    }
});

// Отправка ответов на тест
router.post('/:id/submit', async (req, res) => {
    try {
        const { _id } = req.user;
        const { id } = req.params;
        const { answers } = req.body;
        
        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({ error: 'Необходимо предоставить ответы в виде массива' });
        }
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        // Получаем тест
        const test = await client.db('DatabaseAi').collection('initialTests').findOne({
            _id: new ObjectId(id)
        });
        
        if (!test) {
            await client.close();
            return res.status(404).json({ error: 'Тест не найден' });
        }
        
        // Проверка прав доступа
        if (test.user_id !== _id) {
            await client.close();
            return res.status(403).json({ error: 'Нет доступа к этому тесту' });
        }
        
        // Проверяем ответы и вычисляем результат
        const results = answers.map((answer, index) => {
            const question = test.questions[index];
            if (!question) return null;
            
            const isCorrect = answer === question.correctOptionIndex;
            return {
                questionIndex: index,
                selectedOption: answer,
                isCorrect,
                explanation: question.explanation
            };
        }).filter(result => result !== null);
        
        // Вычисляем оценку
        const correctAnswers = results.filter(result => result.isCorrect).length;
        const totalQuestions = results.length;
        const score = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
        
        // Оцениваем уровень на основе результатов
        let assessedLevel;
        if (score < 30) {
            assessedLevel = 'basic';
        } else if (score < 70) {
            assessedLevel = 'intermediate';
        } else {
            assessedLevel = 'advanced';
        }
        
        // Обновляем тест в базе данных
        await client.db('DatabaseAi').collection('initialTests').updateOne(
            { _id: new ObjectId(id) },
            { 
                $set: { 
                    userAnswers: answers,
                    results,
                    score,
                    assessedLevel,
                    completed: true,
                    completedAt: new Date()
                } 
            }
        );
        
        await client.close();
        
        // Возвращаем результаты
        res.json({
            results,
            score,
            assessedLevel,
            correctAnswers,
            totalQuestions
        });
    } catch (error) {
        console.error('Ошибка при отправке ответов:', error);
        res.status(500).json({ error: 'Ошибка при обработке ответов' });
    }
});

// Получение списка тестов пользователя
router.get('/', async (req, res) => {
    try {
        const { _id } = req.user;
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const tests = await client.db('DatabaseAi').collection('initialTests')
            .find({ user_id: _id })
            .sort({ createdAt: -1 })
            .toArray();
        
        await client.close();
        
        res.json(tests);
    } catch (error) {
        console.error('Ошибка при получении списка тестов:', error);
        res.status(500).json({ error: 'Ошибка при получении списка тестов' });
    }
});

module.exports = router; 
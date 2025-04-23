const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { JsonOutputParser } = require("@langchain/core/output_parsers");
const { ChatOllama } = require('@langchain/ollama');

// Инициализация GigaChat клиента
const giga = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    model: 'GigaChat-2',
    maxTokens: 2000,
});

// System prompt template for generating test questions
const TEST_GENERATION_TEMPLATE = `
Ты - образовательный ассистент, который создает диагностические тесты для учеников.

Твоя задача - создать короткий диагностический тест ({num_questions} вопросов) по заданной теме.
Каждый вопрос должен:
1. Быть с множественным выбором (4 варианта ответа)
2. Иметь один правильный ответ
3. Соответствовать указанной теме ({topic}) и уровню сложности ({difficulty}) для предмета ({subject}).
4. Содержать объяснение правильного ответа.

Формат ответа должен быть строго в виде JSON, соответствующий инструкциям ниже. НЕ ДОБАВЛЯЙ никакого другого текста, приветствий или markdown разметки (например \`\`\`) вокруг JSON.

{format_instructions}

Предоставленные данные:
Предмет: {subject}
Тема: {topic}
Уровень сложности: {difficulty}

Создай тест из {num_questions} вопросов.
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
            console.error('Ошибка при асинхронной генерации вопросов теста:', error);
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
async function generateTestQuestions(testId, subject, topic, difficulty, numQuestions = 5) {
    const client = new MongoClient(process.env.MONGODB_URI);
    const db = client.db('DatabaseAi');
    const collection = db.collection('initialTests');

    try {
        await client.connect();

        // 1. Instantiate the parser (without TypeScript type parameter)
        const parser = new JsonOutputParser();

        // 2. Create the prompt template
        const promptTemplate = ChatPromptTemplate.fromTemplate(TEST_GENERATION_TEMPLATE);

        // 3. Create the chain: prompt | model | parser
        // Assuming 'giga' is your initialized Langchain Chat Model instance (e.g., ChatOllama, ChatGigaChat)
        const chain = promptTemplate.pipe(giga).pipe(parser);

        // 4. Get format instructions and Invoke the chain
        console.log(`Generating test for ID: ${testId}, Topic: ${topic}`);
        const formatInstructions = "Ответ должен быть в виде объекта JSON с полями: \`testTitle\` - название теста, \`subject\` - предмет, \`topic\` - тема, \`difficulty\`, \`questions\` - массив вопросов. Каждый вопрос должен иметь поля \`questionText\`, \`options\` - варианты ответа, \`correctOptionIndex\` - индекс правильного ответа в массиве вариантов, \`explanation\` - объяснение правильного ответа.";
        console.log('Format Instructions:', formatInstructions);
        const testData = await chain.invoke({
            subject: subject,
            topic: topic,
            difficulty: difficulty,
            num_questions: numQuestions.toString(), // Ensure it's a string if the template expects it
            format_instructions: formatInstructions
        });

        console.log(`Generated test data for ID: ${testId}`, testData);

        // 5. Validate the received data (basic validation)
        if (!testData || typeof testData !== 'object' || !Array.isArray(testData.questions) || testData.questions.length === 0) {
             throw new Error('Generated test data is invalid or empty.');
        }

        // 6. Update the test document in the database
        await collection.updateOne(
            { _id: new ObjectId(testId) },
            {
                $set: {
                    questions: testData.questions,
                    testTitle: testData.testTitle || `Тест по теме "${topic}"`, // Use generated title or default
                    subject: testData.subject, // Store generated subject/topic/difficulty for consistency
                    topic: testData.topic,
                    difficulty: testData.difficulty,
                    status: 'ready',
                    error: null // Clear any previous error
                }
            }
        );
        console.log(`Successfully updated test ID: ${testId} with generated questions.`);

    } catch (error) {
        console.error(`Error generating/processing test questions for ID ${testId}:`, error);
        // Attempt to update the test status to 'error' in the database
        try {
            await collection.updateOne(
                { _id: new ObjectId(testId) },
                {
                    $set: {
                        status: 'error',
                        error: error.message || 'Unknown error during generation'
                    }
                }
            );
            console.log(`Marked test ID: ${testId} as error.`);
        } catch (dbError) {
            console.error(`Failed to update test status to error for ID ${testId}:`, dbError);
            // Log the original error as well if DB update fails
             console.error(`Original generation error for ID ${testId}:`, error);
        }
    } finally {
        await client.close();
        console.log(`Closed DB connection for test generation ID: ${testId}`);
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
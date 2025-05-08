const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { GigaChat } = require("langchain-gigachat");
const { HumanMessage, SystemMessage, AIMessage } = require("@langchain/core/messages");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { JsonOutputParser } = require("@langchain/core/output_parsers");
const https = require('https');
const { ChatOllama } = require('@langchain/ollama');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

// Инициализация GigaChat клиента
// const giga = new GigaChat({
//     credentials: process.env.GIGACHAT_CREDENTIALS,
//     model: 'GigaChat-2',
//     maxTokens: 1500, // Увеличиваем токены для более детальных ответов
//     httpsAgent
// });
const giga = new ChatOllama({
    model: 'gemma3:1b'
})

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

// Новый системный промпт для одноразового агента диагностики
const DIAGNOSTIC_AGENT_PROMPT = `
Ты - AI ассистент, выполняющий анализ предоставленных учебных потребностей и результатов тестов.
Твоя задача - проанализировать входные данные:
1.  Предметную область (\`field\`)
2.  Интересующие темы (\`subjects\`)
3.  Заявленный уровень сложности (\`difficulty\`)
4.  Результаты пройденного теста (\`testResults\`), если они предоставлены.

На основе этого анализа ты должен:
1. Провести диагностику анкеты пользователя (\`diagnosticResult\`):
1.1.  Определить основную предметную область (\`subjectArea\`) из \`field.name\`.
1.2.  Определить основную тему (\`topic\`) из \`subjects\`.
1.3.  Оценить или уточнить уровень сложности (\`diff-iculty\`) пользователя, учитывая как заявленный уровень, так и анализ \`testResults\` (если есть). Используй значения 'basic', 'intermediate', 'advanced'.
1.4.  Определить, нужен ли дополнительный тест (\`needsInitialTest\`) для более точной оценки (например, если результаты теста отсутствуют, неоднозначны или недостаточны).
1.5.  Предложить смежные темы для изучения (\`suggestedTopics\`, не более 3-5) на основе \`subjects\` и результатов анализа.
2. Определить (\`nextAction\`), готов ли пользователь к обучению (\`createTrack\`), или нужен дополнительный тест (\`startTest\`)

Сгенерируй ТОЛЬКО JSON объект, соответствующий предоставленным инструкциям по форматированию.

Входные данные будут предоставлены в сообщении пользователя в следующем формате:
Предметная область: [Название] (id: [ID])
Интересующие темы: [Список тем]
Уровень сложности: [Название] (id: [ID])
Результаты теста: [Структура JSON с результатами теста или "отсутствуют"]

Структура JSON для \`Результаты теста\`: Объект, где ключи - это названия предметов (например, "algebra"), а значения - массивы объектов вида { "question": "answer" }. Пример: {"algebra": [{"question1": 2}, {"question2": -0.65}], "chemistry": [{"q1": "H2O"}]}

{format_instructions}

НЕ ДОБАВЛЯЙ никакого другого текста, приветствий или объяснений в свой ответ. Только JSON объект.
`;

// Эндпоинт для структурированной начальной диагностики (одноразовый агент)
router.post('/diagnostics', async (req, res) => {
    try {
        const { field, subjects, difficulty, test } = req.body;

        // Валидация входных данных
        if (!field || !field.id || !field.name ||
            !subjects || !Array.isArray(subjects) || subjects.length === 0 || subjects.some(s => !s.id || !s.name) ||
            !difficulty || !difficulty.id || !difficulty.name || !test) {
            return res.status(400).json({ error: 'Некорректный формат входных данных. Требуются field, subjects (массив) и difficulty с полями id и name.' });
        }

        // Формируем входные данные для LLM
        const subjectNames = subjects.map(s => s.name).join(', ');
        const userInputContent = `Предметная область: ${field.name} (id: ${field.id})
Интересующие темы: ${subjectNames}
Пройденный тест: ${test}
Уровень сложности: ${difficulty.name} (id: ${difficulty.id})`;

        // 1. Instantiate the parser
        // Define the desired data structure for the parser's instructions.
        // This helps the LLM generate the correct structure.
        const parser = new JsonOutputParser();
        const formatInstructions = "Выходной JSON ответ должен содержать два поля: \"diagnosticResult\" и \"nextAction\".";
        console.log(formatInstructions);


        // 2. Create the prompt template
        const prompt = ChatPromptTemplate.fromMessages([
            ["system", DIAGNOSTIC_AGENT_PROMPT],
            ["human", "{userInput}"]
        ]);

        // 3. Create the chain: prompt | model | parser
        const chain = prompt.pipe(giga).pipe(parser);

        // 4. Invoke the chain
        console.log("Отправка запроса GigaChat через Langchain chain...");
        const parsedJson = await chain.invoke({
             userInput: userInputContent,
             format_instructions: formatInstructions
        });
        console.log("Получен и распарсен ответ от GigaChat:", parsedJson);

        // Возвращаем только diagnosticResult
        res.status(200).json(parsedJson);

    } catch (error) {
        console.error('Ошибка в эндпоинте /diagnostics:', error);
         // Log the raw response if available in the error object (might depend on Langchain error structure)
        if (error.response && error.response.data) {
            console.error("Raw LLM response on error:", error.response.data);
        }
        // Проверяем, был ли уже отправлен ответ
        if (!res.headersSent) {
             // Provide a more informative error message if possible
             const errorMessage = error.message.includes('Invalid JSON structure')
                ? 'Ошибка при обработке ответа LLM: неверная структура JSON.'
                : 'Внутренняя ошибка сервера при выполнении диагностики.';
             const errorDetails = error.message.includes('Invalid JSON structure') ? { parsedResponse: error.cause } : {}; // Assuming the invalid json might be in error.cause

             // Check if 'parsedJson' was defined before trying to include it
             const responsePayload = { error: errorMessage, ...errorDetails };
              try {
                 // Try to include the potentially problematic JSON if it exists and wasn't the cause of the initial throw
                 if (typeof parsedJson !== 'undefined' && !error.message.includes('Invalid JSON structure')) {
                     responsePayload.rawResponseAttempt = parsedJson;
                 }
             } catch (e) { /* ignore potential reference error */ }


            res.status(500).json(responsePayload);
        }
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

module.exports = router; 
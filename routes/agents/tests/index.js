require('dotenv').config(); // Load environment variables
const router = require('express').Router();
const { QuestionSchema, TestSchema, QuestionMetadataSchema, RequestSchema } = require("./schemas");
const { initializeVectorStore } = require("./vectorstore");
const { generateQuestions, generateTestTitle } = require("./generate");
const { MongoClient } = require('mongodb');
let vectorStore = null;

// Call initialization function
initializeVectorStore().then(store => {
    vectorStore = store;
});

/**
 * POST /startInitialTest
 * Route to generate a diagnostic test by combining retrieved questions from the vector store
 * and generating new ones with LLM when needed.
 * Expects JSON body with: subject, topic, difficulty, numQuestions.
 * @route POST /startInitialTest
 * @group Tests - Operations related to test generation using RAG
 * @param {object} req.body.required - Request body.
 * @param {string} req.body.subject.required - The subject area.
 * @param {string} req.body.topic.required - The specific topic.
 * @param {string} req.body.difficulty.required - The desired difficulty level.
 * @param {number} [req.body.numQuestions=5] - The number of questions (defaults to 5).
 * @returns {object} 200 - A complete test object with metadata and questions.
 * @returns {object} 400 - If required parameters are missing or invalid.
 * @returns {object} 500 - If the vector store is not initialized or search fails.
 */
router.post("/startInitialTest", async (req, res, next) => {
    const { _id } = req.user;
    try {
        if (!vectorStore) {
            return res.status(500).json({ error: 'Vector store is not initialized.' });
        }

        // Validate request body
        const validatedParams = RequestSchema.safeParse(req.body);
        
        if (!validatedParams.success) {
            return res.status(400).json({ 
                error: 'Invalid request parameters', 
                details: validatedParams.error.format() 
            });
        }
        
        // Extract validated parameters
        const { subject, topic, difficulty, numQuestions } = validatedParams.data;

        console.log(`[API /test] Received RAG request: Subject=${subject}, Topic=${topic}, Difficulty=${difficulty}, NumQuestions=${numQuestions}`);

        // Define the metadata filter function
        const filter = (doc) => {
            const metadata = doc.metadata;
            // Case-insensitive comparison
            return metadata.subject?.toLowerCase() === subject.toLowerCase() &&
                   metadata.topic?.toLowerCase() === topic.toLowerCase();
        };

        // Perform similarity search with metadata filtering
        const query = `${subject} ${topic} ${difficulty}`;
        console.log(`[API /test] Performing similarity search with query: "${query}" and filter.`);

        const results = await vectorStore.similaritySearchWithScore(
            query,
            numQuestions, // Try to retrieve the requested number
            filter // Apply the metadata filter
        );

        console.log(`[API /test] Retrieved ${results.length} questions from vector store.`);
        
        // Process retrieved documents with Zod
        const retrievedQuestions = [];
        const context = results.map(doc => doc.pageContent).join('\n');
        for (const [doc, score] of results) {
            // if (score < 0.8) {
            //     continue;
            // }

            try {
                // Parse metadata with Zod
                const validatedMetadata = QuestionMetadataSchema.parse(doc.metadata);
                
                // Create full question object
                const validatedQuestion = QuestionSchema.parse({
                    questionText: validatedMetadata.questionText,
                    options: validatedMetadata.options,
                    correctOptionIndex: validatedMetadata.correctOptionIndex,
                    explanation: validatedMetadata.explanation
                });
                
                console.log(`[API /test] Retrieved question: SIM [${score}] ${validatedQuestion.questionText}`);
                
                // Add source and metadata
                retrievedQuestions.push(validatedQuestion);
            } catch (error) {
                console.warn(`[API /test] Retrieved question validation failed:`, error.message);
                // Skip invalid questions
            }
        }
        
        // Determine how many additional questions we need
        const questionsNeeded = numQuestions - retrievedQuestions.length;
        
        let allQuestions = [...retrievedQuestions];
        
        // Generate additional questions if needed
        if (questionsNeeded > 0) {
            console.log(`[API /test] Need ${questionsNeeded} more questions. Generating with LLM...`);
            const generatedQuestions = await generateQuestions(context, subject, topic, difficulty, questionsNeeded);

            try {
                const client = new MongoClient(process.env.MONGODB_URI);
                await client.connect();
                console.log(`[API /test] Connected to MongoDB: ${process.env.MONGODB_URI}`);

                const result = await client.db('DatabaseAi').collection('diagnosticQuestions').insertMany(generatedQuestions.map(question => ({
                    ...question,
                    subject,
                    topic,
                    sub_topic: question.sub_topic || '',
                    difficulty
                })));
                console.log(`[API /test] ${generatedQuestions.length} diagnostic questions inserted with IDs: ${result.insertedIds}`);
                await client.close();
                console.log(`[API /test] MongoDB connection closed`);
            } catch (error) {
                console.error('Ошибка при сохранении диагностических вопросов:', error);
                res.status(500).json({ error: 'Ошибка при сохранении диагностических вопросов' });
            }
            
            // Combine retrieved and generated questions
            allQuestions = [...retrievedQuestions, ...generatedQuestions];
            console.log(`[API /test] Final test has ${allQuestions.length} questions (${retrievedQuestions.length} retrieved, ${generatedQuestions.length} generated)`);
        }

        const testTitle = await generateTestTitle(subject, topic, difficulty, allQuestions);

        try {
            const client = new MongoClient(process.env.MONGODB_URI);
            await client.connect();
            console.log(`[API /test] Connected to MongoDB: ${process.env.MONGODB_URI}`);

            const testDoc = {
                user_id: _id,
                testTitle: testTitle.testTitle,
                subject,
                topic,
                difficulty: difficulty,
                createdAt: new Date(),
                questions: allQuestions,
                userAnswers: [],
                completed: false,
                score: null
            };

            const validatedTest = TestSchema.parse(testDoc);
            console.log(`[API /test] Validated test: ${JSON.stringify(validatedTest)}`);
            
            const result = await client.db('DatabaseAi').collection('initialTests').insertOne(validatedTest);
            const testId = result.insertedId.toString();
            console.log(`[API /test] Test inserted with ID: ${testId}`);
            await client.close();
            console.log(`[API /test] MongoDB connection closed`);

            res.status(200).json({ testId });
        } catch (error) {
            console.error('Ошибка при создании теста:', error);
            res.status(500).json({ error: 'Ошибка при создании теста' });
        }
    } catch (error) {
        console.error("[API /test] Error during RAG test generation:", error);
        next(error || new Error('An unexpected error occurred during test generation.'));
    }
});

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

        console.log(`[API /test] Test found: ${JSON.stringify(test)}`);
        
        await client.close();
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не найден' });
        }
        
        // Проверка прав доступа (админ или владелец)
        if (test.user_id !== _id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет доступа к этому тесту' });
        }
        
        console.log(`[API /test] Test found: ${JSON.stringify(test)}`);
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

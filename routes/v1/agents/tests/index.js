require('dotenv').config(); // Load environment variables
const router = require('express').Router();
const z = require("zod");
const { QuestionSchema, TestSchema, QuestionMetadataSchema, RequestSchema } = require("./schemas");
const { initializeVectorStore, addDocumentsToVectorStore } = require("./vectorstore");
const { app } = require("./workflow"); // Import the LangGraph workflow
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');
const { runDiagnosis, graph } = require("../../../../agents/test-diagnostics/workflow");
let vectorStore = null;

// Call initialization function
initializeVectorStore().then(store => {
    vectorStore = store;
});

/**
 * POST /addQuestions
 * Route to add documents to the vector store
 * Expects JSON body with: questionIds.
 * @route POST /addQuestions
 * @group Tests - Operations related to test generation using RAG
 * @param {object} req.body.required - Request body.
 * @param {string[]} req.body.questionIds.required - The IDs of the questions to add.
 * @returns {object} 200 - A message indicating the documents were added successfully.
 * @returns {object} 500 - If the vector store is not initialized or search fails.
 */
router.post('/addQuestions', async (req, res) => {
    const { questionIds } = req.body;
    console.log(`[API /tests] Adding ${questionIds.length} questions to vector store.`);
    try {
        const success = await addDocumentsToVectorStore(vectorStore, questionIds);
        if (success) {
            res.status(200).json({ message: 'Documents added to vector store successfully.' });
        } else {
            res.status(500).json({ error: 'Failed to add documents to vector store.' });
        }
    } catch (error) {
        console.error('Ошибка при добавлении документов в векторное хранилище:', error);
        res.status(500).json({ error: 'Ошибка при добавлении документов в векторное хранилище' });
    }
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
 * @param {string} req.body.grade.required - The grade level.
 * @param {number} [req.body.numQuestions=5] - The number of questions (defaults to 5).
 * @returns {object} 200 - A complete test object with metadata and questions.
 * @returns {object} 400 - If required parameters are missing or invalid.
 * @returns {object} 500 - If the vector store is not initialized or search fails.
 */
router.post("/startInitialTest", async (req, res, next) => {
    const { _id } = req.user;
    let threadId = null;
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
        const { subject, topic, difficulty, numQuestions, grade } = validatedParams.data;

        console.log(`[API /tests] Received RAG request: Subject=${subject}, Topic=${topic}, Difficulty=${difficulty}, NumQuestions=${numQuestions}, Grade=${grade}`);

        threadId = crypto.randomUUID();
        console.log(`[API /tests] Generated thread ID: ${threadId}`);

        // Run the LangGraph workflow
        try {
            const params = {
                subject,
                topic, 
                difficulty,
                grade,
                numQuestions,
                user_id: _id
            };

            const config = {
                configurable: {
                    thread_id: threadId
                }
            }

            console.log(`[API /tests] Starting test generation workflow with params:`, params, `and config:`, config);
            const result = await app.invoke({
                input: params
            }, config);
            
            console.log(`[API /tests] Workflow completed:`, result);
            console.log(`[API /tests] Test generation successful with ID: ${result.testId}`);
            res.status(200).json({ testId: result.testId });
        } catch (error) {
            console.error("[API /tests] Error during LangGraph test generation:", error);
            // Fallback to the legacy approach if LangGraph fails
            // console.log("[API /tests] Falling back to legacy approach");
            // await legacyTestGeneration(req, res, next);
            res.status(500).json({ error: 'Ошибка при генерации теста', threadId: threadId, details: error.message });
        }
    } catch (error) {
        console.error("[API /tests] Error during test generation:", error);
        res.status(500).json({ error: 'Ошибка при генерации теста', threadId: threadId, details: error.message });
        next(error || new Error('An unexpected error occurred during test generation.'));
    }
});

/**
 * POST /resumeTest
 * Route to resume a test generation workflow
 * @route POST /resumeTest
 * @group Tests - Operations related to test generation using RAG
 * @returns {object} 200 - A complete test object with metadata and questions.
 * @returns {object} 400 - If required parameters are missing or invalid.
 * @returns {object} 500 - If the vector store is not initialized or search fails.
 */
router.post("/resumeTestGeneration/:threadId", async (req, res, next) => {
    const { _id } = req.user;
    const { threadId } = req.params;
    try {
        const config = {
            configurable: {
                thread_id: threadId
            }
        }

        console.log(`[API /tests] Resuming test generation workflow with config:`, config);
        const result = await app.invoke(null, config);

        console.log(`[LangGraph] Resumed workflow completed:`, result);
        res.status(200).json({ testId: result.testId });
    } catch (error) {
        console.error(`[API /tests] Error during RESUMING LangGraph test generation (Thread ID: ${threadId}):`, error);
        // Check if the error indicates the thread doesn't exist or cannot be resumed
        if (error.message.includes("No checkpoint found")) { // Example check, might need adjustment
             res.status(404).json({
                error: 'Состояние для возобновления не найдено. Возможно, придется начать заново.',
                threadId: threadId,
                details: error.message
            });
        } else {
            res.status(500).json({
                error: 'Ошибка при возобновлении генерации теста.',
                threadId: threadId,
                details: error.message
            });
        }
    }
});


/**
 * Legacy test generation approach to be used as fallback
 */
async function legacyTestGeneration(req, res, next) {
    const { _id } = req.user;
    try {
        // Extract validated parameters
        const { subject, topic, difficulty, numQuestions, grade } = RequestSchema.parse(req.body);
        
        // Define the ChromaDB where clause for server-side filtering
        // Note: This assumes case-sensitive matching or that data is stored consistently (e.g., lowercase).
        // If case-insensitivity is strictly required here, the data ingestion process
        // should ensure consistent casing for filterable fields.
        const whereClause = {
            "$and": [
                { "subject": { "$eq": subject } },
                { "topic": { "$eq": topic } },
                { "grade": { "$eq": grade } }
            ]
        };

        // Perform similarity search with metadata filtering
        const query = `Предмет: ${subject}, Тема: ${topic}, Уровень сложности: ${difficulty}, Класс: ${grade}`;
        console.log(`[API /tests] Performing similarity search with query: "${query}" and where clause: ${JSON.stringify(whereClause)}.`);

        const results = await vectorStore.similaritySearchWithScore(
            query,
            Math.floor(numQuestions * 0.8), // Try to retrieve the requested number
            whereClause // Pass the ChromaDB where clause object
        );

        console.log(`[API /tests] Retrieved ${results.length} questions from vector store.`);
        
        // Process retrieved documents
        const retrievedQuestions = [];
        const context = results.map(([doc, score]) => doc.metadata.questionText).join('\n');
        for (const [doc, score] of results) {
            if (score < 0.6) {
                continue;
            }

            try {
                // Create full question object
                const validatedQuestion = QuestionSchema.parse({
                    grade: doc.metadata.grade,
                    sub_topic: doc.metadata.sub_topic,
                    questionText: doc.metadata.questionText,
                    options: JSON.parse(doc.metadata.options),
                    correctOptionIndex: +doc.metadata.correctOptionIndex,
                    explanation: doc.metadata.explanation
                });
                
                console.log(`[API /tests] Retrieved question: SIM [${score}] ${validatedQuestion.questionText}`);
                
                // Add source and metadata
                retrievedQuestions.push(validatedQuestion);
            } catch (error) {
                console.warn(`[API /tests] Retrieved question validation failed:`, error.message);
                // Skip invalid questions
            }
        }
        
        // Determine how many additional questions we need
        const questionsNeeded = numQuestions - retrievedQuestions.length;
        let allQuestions = [...retrievedQuestions];
        
        // Generate additional questions if needed
        if (questionsNeeded > 0) {
            let generatedQuestions = [];
            let attempts = 0;
            const maxAttempts = 3;
            console.log(`[API /tests] Need ${questionsNeeded} more questions. Generating with LLM...`);
            while (attempts < maxAttempts) {
                try {
                    console.log(`[API /tests] Attempt ${attempts + 1} of ${maxAttempts}`);
                    generatedQuestions = await generateQuestions(context, subject, topic, difficulty, questionsNeeded, grade);
                    console.log(`[API /tests] Generated ${generatedQuestions.length} questions.`);
                    break;
                } catch (error) {
                    attempts++;
                    console.log(`[API /tests] Error generating questions: ${error.message}`);
                    if (attempts >= maxAttempts) {
                        console.log(`[API /tests] Failed to generate questions after ${maxAttempts} attempts. Returning empty array.`);
                        generatedQuestions = [];
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Save generated questions
            try {
                const client = new MongoClient(process.env.MONGODB_URI);
                await client.connect();
                console.log(`[API /tests] Connected to MongoDB: ${process.env.MONGODB_URI}`);

                const result = await client.db('DatabaseAi').collection('diagnosticQuestions').insertMany(generatedQuestions.map(question => ({
                    ...question,
                    subject,
                    topic,
                    sub_topic: question.sub_topic || '',
                    difficulty,
                    grade
                })));
                console.log(`[API /tests] ${generatedQuestions.length} diagnostic questions inserted with IDs: ${result.insertedIds}`);
                console.log(JSON.stringify(result.insertedIds));
                const questionIds = Object.values(result.insertedIds).map(id => id.toString());
                await addDocumentsToVectorStore(vectorStore, questionIds);
                console.log(`[API /tests] ${questionIds.length} diagnostic questions added to vector store.`);

                await client.close();
                console.log(`[API /tests] MongoDB connection closed`);
            } catch (error) {
                console.error('Ошибка при сохранении диагностических вопросов:', error);
                res.status(500).json({ error: 'Ошибка при сохранении диагностических вопросов' });
                return;
            }
            
            // Combine retrieved and generated questions
            allQuestions = [...retrievedQuestions, ...generatedQuestions];
            console.log(`[API /tests] Final test has ${allQuestions.length} questions (${retrievedQuestions.length} retrieved, ${generatedQuestions.length} generated)`);
        }

        // Generate test title
        console.log(`[API /tests] Generating test title...`);
        let testTitle;
        try {
            const titleResult = await generateTestTitle(subject, topic, difficulty, allQuestions);
            testTitle = titleResult.testTitle;
        } catch (error) {
            console.error("[API /tests] Error generating title, using default:", error);
            testTitle = `Тест по ${subject}: ${topic} (${difficulty})`;
        }

        // Save test
        try {
            const client = new MongoClient(process.env.MONGODB_URI);
            await client.connect();
            console.log(`[API /tests] Connected to MongoDB: ${process.env.MONGODB_URI}`);

            const testDoc = {
                user_id: _id,
                testTitle: testTitle,
                subject,
                topic,
                grade,
                difficulty,
                createdAt: new Date(),
                questions: allQuestions,
                userAnswers: [],
                completed: false,
                score: null
            };

            const validatedTest = TestSchema.parse(testDoc);
            
            const result = await client.db('DatabaseAi').collection('initialTests').insertOne(validatedTest);
            const testId = result.insertedId.toString();
            console.log(`[API /tests] Test inserted with ID: ${testId}`);
            
            await client.close();
            console.log(`[API /tests] MongoDB connection closed`);

            res.status(200).json({ testId });
        } catch (error) {
            console.error('Ошибка при создании теста:', error);
            res.status(500).json({ error: 'Ошибка при создании теста' });
        }
    } catch (error) {
        console.error("[API /tests] Error during legacy test generation:", error);
        next(error || new Error('An unexpected error occurred during test generation.'));
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

        console.log(`[API /tests] Test found: ${JSON.stringify(test)}`);
        
        await client.close();
        
        if (!test) {
            return res.status(404).json({ error: 'Тест не найден' });
        }
        
        // Проверка прав доступа (админ или владелец)
        if (test.user_id !== _id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Нет доступа к этому тесту' });
        }
        
        console.log(`[API /tests] Test found: ${JSON.stringify(test)}`);
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
        
        // Run the diagnostic workflow
        console.log(`[API /tests] Running diagnostic workflow for test ${id}...`);
        const workflowResult = await runDiagnosis(_id, id);
        console.log(`[API /tests] Diagnostic workflow completed with result: ${JSON.stringify(workflowResult)}`);

        const result = z.object({
            success: z.boolean(),
            trackId: z.string().optional()
        }).parse(workflowResult);

        if (!result.success) {
            res.status(500).json({ error: result.error });
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
                    learningTrackId: result.trackId,
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
            totalQuestions,
            learningTrackId: result.trackId
        });
    } catch (error) {
        console.error('Ошибка при отправке ответов:', error);
        res.status(500).json({ error: 'Ошибка при обработке ответов' });
    }
});

router.post('/:id/submit-stream', async (req, res) => {

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Recommended for Nginx/Apache proxies



  // Optional: Send an initial comment to keep connection open
  res.write(': Connected\n\n');

  // Handle client disconnection
  req.on('close', () => {
    console.log('Client disconnected');
    // You might need logic here to signal the graph execution to stop if possible
    res.end();
  });

  console.log('Starting graph execution stream...');

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
        
        // Run the diagnostic workflow
        console.log(`[API /tests] Running diagnostic workflow for test ${id}...`);
        
        const stream = await graph.stream({userId: _id, testId: id}, { streamMode: 'updates'});

        for await (const update of stream) {
            console.log(`[API /tests] Diagnostic workflow update: ${JSON.stringify(update)}`);
            res.write(`data: ${JSON.stringify(update)}\n\n`);
        }

        res.write(': End of stream\n\n');
        res.end();
    } catch (error) {
        console.error('Ошибка при отправке ответов:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
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

require('dotenv').config(); // Load environment variables
const router = require('express').Router();
const { QuestionSchema, TestSchema, QuestionMetadataSchema, RequestSchema } = require("./schemas");
const { initializeVectorStore, addDocumentsToVectorStore } = require("./vectorstore");
const { generateQuestions, generateTestTitle } = require("./generate");
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');
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

        // Perform similarity search with metadata filtering using the where clause
        const query = `Предмет: ${subject}, Тема: ${topic}, Уровень сложности: ${difficulty}, Класс: ${grade}`;
        console.log(`[API /tests] Performing similarity search with query: "${query}" and where clause: ${JSON.stringify(whereClause)}.`);

        const results = await vectorStore.similaritySearchWithScore(
            query,
            numQuestions, // Try to retrieve the requested number
            whereClause // Pass the ChromaDB where clause object
        );

        console.log(`[API /tests] Retrieved ${results.length} questions from vector store using where clause.`);
        
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
                    grade: validatedMetadata.grade,
                    sub_topic: validatedMetadata.sub_topic,
                    questionText: validatedMetadata.questionText,
                    options: JSON.parse(validatedMetadata.options),
                    correctOptionIndex: +validatedMetadata.correctOptionIndex,
                    explanation: validatedMetadata.explanation
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
            console.log(`[API /tests] Need ${questionsNeeded} more questions. Generating with LLM...`);
            const generatedQuestions = await generateQuestions(context, subject, topic, difficulty, questionsNeeded, grade);

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
                const questionIds = result.insertedIds.map(id => id.toString());
                await addDocumentsToVectorStore(vectorStore, questionIds);
                console.log(`[API /tests] ${questionIds.length} diagnostic questions added to vector store.`);

                await client.close();
                console.log(`[API /tests] MongoDB connection closed`);
            } catch (error) {
                console.error('Ошибка при сохранении диагностических вопросов:', error);
                res.status(500).json({ error: 'Ошибка при сохранении диагностических вопросов' });
            }
            
            // Combine retrieved and generated questions
            allQuestions = [...retrievedQuestions, ...generatedQuestions];
            console.log(`[API /tests] Final test has ${allQuestions.length} questions (${retrievedQuestions.length} retrieved, ${generatedQuestions.length} generated)`);
        }

        console.log(`[API /tests] Generating test title...`);
        const testTitle = await generateTestTitle(subject, topic, difficulty, allQuestions);
        console.log(`[API /tests] Test title generated: ${testTitle.testTitle}`);

        try {
            const client = new MongoClient(process.env.MONGODB_URI);
            await client.connect();
            console.log(`[API /tests] Connected to MongoDB: ${process.env.MONGODB_URI}`);

            const testDoc = {
                user_id: _id,
                testTitle: testTitle.testTitle,
                subject,
                topic,
                grade,
                difficulty: difficulty,
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
        console.error("[API /tests] Error during RAG test generation:", error);
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

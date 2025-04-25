require('dotenv').config(); // Load environment variables
const router = require('express').Router();
const { QuestionSchema, TestSchema, QuestionMetadataSchema, RequestSchema } = require("./schemas");
const { initializeVectorStore } = require("./vectorstore");
const { generateQuestions, generateTestTitle } = require("./generate");
let vectorStore = null;

// Call initialization function
initializeVectorStore().then(store => {
    vectorStore = store;
});

/**
 * POST /test
 * Route to generate a diagnostic test by combining retrieved questions from the vector store
 * and generating new ones with LLM when needed.
 * Expects JSON body with: subject, topic, difficulty, numQuestions.
 * @route POST /test
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
router.post("/test", async (req, res, next) => {
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
            if (score < 0.8) {
                continue;
            }

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
            
            // Combine retrieved and generated questions
            allQuestions = [...retrievedQuestions, ...generatedQuestions];
            console.log(`[API /test] Final test has ${allQuestions.length} questions (${retrievedQuestions.length} retrieved, ${generatedQuestions.length} generated)`);
        }

        const testTitle = await generateTestTitle(subject, topic, difficulty, allQuestions);

        // Create the complete test object
        const test = {
            testTitle: testTitle.testTitle,
            subject,
            topic,
            difficulty,
            questions: allQuestions.map(q => ({
                questionText: q.questionText,
                options: q.options,
                correctOptionIndex: q.correctOptionIndex,
                explanation: q.explanation
            }))
        };
        
        // Validate the entire test structure with Zod
        const validatedTest = TestSchema.parse(test);
        res.status(200).json(validatedTest);

    } catch (error) {
        console.error("[API /test] Error during RAG test generation:", error);
        next(error || new Error('An unexpected error occurred during test generation.'));
    }
});

module.exports = router;

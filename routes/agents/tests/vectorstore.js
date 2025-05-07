const { embeddings } = require('../llm');
const { QuestionMetadataSchema } = require('./schemas');
const { Document } = require('langchain/document');
const { MongoClient } = require('mongodb');
const { Chroma } = require('@langchain/community/vectorstores/chroma');
const { ObjectId } = require('mongodb');

async function addDocumentsToVectorStore(vectorStore, questionIds) {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        console.log("[VectorStore] MongoDB connected successfully.");
        const questions = await client.db('DatabaseAi').collection('diagnosticQuestions').find({ _id: { $in: questionIds.map(id => new ObjectId(id)) } }).toArray();

        console.log(`[VectorStore] Found ${questions.length} questions in MongoDB.`);

        const documents = [];
        let successCount = 0;
        let failureCount = 0;

        for (const questionId in questions) {
            try {
                const question = questions[questionId];

                // Use Zod to validate and transform the question data
                const validatedMetadataInput = {
                    ...question,
                    question_id: questionId // Use the actual loop index as string ID
                };

                // Prepare metadata specifically for ChromaDB, ensuring compatible types
                const chromaMetadata = {
                    ...validatedMetadataInput,
                    options: JSON.stringify(validatedMetadataInput.options), // Convert array to JSON string
                    correctOptionIndex: validatedMetadataInput.correctOptionIndex.toString(), // Convert number to string
                    question_id: validatedMetadataInput.question_id
                };
                
                // Validate the metadata
                QuestionMetadataSchema.parse(chromaMetadata);

                const pageContent = `Вопрос по предмету ${question.subject} по теме ${question.topic} по уровню сложности ${question.difficulty}: ${question.questionText}`
                const doc = new Document({
                    pageContent: pageContent,
                    metadata: chromaMetadata // Use the Chroma-compatible metadata
                });

                documents.push(doc);
                successCount++;
            } catch (error) {
                console.warn(`[VectorStore] Question ${questionId} validation failed:`, error.message);
                failureCount++;
            }
        }

        console.log(`[VectorStore] Loaded ${documents.length} documents (${successCount} valid, ${failureCount} skipped).`);
        await vectorStore.addDocuments(documents);
        console.log("[VectorStore] Documents added to Chroma successfully.");
        await client.close();
        console.log("[VectorStore] MongoDB connection closed.");
        return true;
    } catch (error) {
        console.error("[VectorStore] Failed to add documents to Chroma:", error);
        return false;
    }
}

/**
 * Loads questions from the JSON file, creates embeddings, and initializes the MemoryVectorStore.
 * Should be called once on application startup.
 */
async function initializeVectorStore() {
    try {
        const vectorStore = new Chroma(embeddings, {
            collectionName: 'diagnosticQuestions',
            url: 'http://localhost:8000',
        });
        console.log("[VectorStore] Chroma created successfully.");
        return vectorStore;

    } catch (error) {
        console.error("[VectorStore] Failed to initialize:", error);
        // Depending on the application, you might want to exit or handle this gracefully
        process.exit(1); // Exit if vector store initialization fails
    }
}

module.exports = { addDocumentsToVectorStore, initializeVectorStore };
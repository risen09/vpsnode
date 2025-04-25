const fs = require('fs').promises;
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { OllamaEmbeddings } = require('@langchain/ollama');
const { QuestionMetadataSchema, VectorStoreDocumentSchema } = require('./schemas');
const path = require('path');
const { Document } = require('langchain/document');

/**
 * Loads questions from the JSON file, creates embeddings, and initializes the MemoryVectorStore.
 * Should be called once on application startup.
 */
async function initializeVectorStore() {
    try {
        console.log("[VectorStore] Initializing...");
        // 1. Load Questions from JSON
        const questionsFilePath = path.resolve(__dirname, '../../../assets/documents/diagnostic_questions.json');
        console.log(`[VectorStore] Loading questions from ${questionsFilePath}`);
        const fileContent = await fs.readFile(questionsFilePath, 'utf8');
        const questionsData = JSON.parse(fileContent);

        const documents = [];
        let successCount = 0;
        let failureCount = 0;

        for (const questionId in questionsData) {
            try {
                const question = questionsData[questionId];
                const { questionText, ...metadata } = question;

                // Use Zod to validate and transform the question data
                const validatedMetadata = QuestionMetadataSchema.parse({
                    ...metadata,
                    questionText: questionText,
                    question_id: questionId
                });

                const pageContent = `Вопрос по предмету ${validatedMetadata.subject} по теме ${validatedMetadata.topic} по уровню сложности ${validatedMetadata.difficulty}: ${questionText}`
                const doc = new Document({
                    pageContent: pageContent,
                    metadata: validatedMetadata
                });

                // Final validation of the document structure
                VectorStoreDocumentSchema.parse(doc);
                
                documents.push(doc);
                successCount++;
            } catch (error) {
                console.warn(`[VectorStore] Question ${questionId} validation failed:`, error.message);
                failureCount++;
            }
        }

        console.log(`[VectorStore] Loaded ${documents.length} documents (${successCount} valid, ${failureCount} skipped).`);

        // 2. Initialize Embeddings
        const embeddings = new OllamaEmbeddings({
            model: "nomic-embed-text",
        });
        console.log("[VectorStore] OllamaEmbeddings initialized.");

        // 3. Create Vector Store
        vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);
        console.log("[VectorStore] MemoryVectorStore created successfully.");
        return vectorStore;

    } catch (error) {
        console.error("[VectorStore] Failed to initialize:", error);
        // Depending on the application, you might want to exit or handle this gracefully
        process.exit(1); // Exit if vector store initialization fails
    }
}

module.exports = { initializeVectorStore };
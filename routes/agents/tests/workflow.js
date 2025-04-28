/**
 * LangGraph implementation for test generation
 */
const { RunnableSequence } = require("@langchain/core/runnables");
const { PromptTemplate } = require("@langchain/core/prompts");
const { initializeVectorStore, addDocumentsToVectorStore } = require("./vectorstore");
const { QuestionSchema, TestSchema } = require("./schemas");
const { MongoClient } = require('mongodb');
const { ObjectId } = require('mongodb');
const { giga } = require('../llm');
const { z } = require('zod');
const { Annotation, START, END, StateGraph } = require('@langchain/langgraph');

let vectorStore = null;

initializeVectorStore().then(store => {
    vectorStore = store;
});

// Define the state graph with initial state structure
const state = Annotation.Root({
  input: Annotation({
    default: () => ({
        subject: "",
        topic: "",
        difficulty: "",
        grade: "",
        numQuestions: 0,
        user_id: "",
    }),
  }),
  questions: Annotation({
    reducer: (x, y) => [...x, ...y],
    default: () => []
  }),
  generatedQuestions: Annotation({
    reducer: (x, y) => [...x, ...y],
    default: () => []
  }),
  testTitle: Annotation({
    reducer: (x, y) => y,
    default: () => ""
  }),
  testId: Annotation({
    reducer: (x, y) => y,
    default: () => ""
  }),
  error: Annotation({
    reducer: (x, y) => ({...x, ...y}),
    default: () => ({
        message: "",
        source: "",
    })
  }),
});

// Node 1: Retrieve questions from vector store
async function retrieveQuestions(state) {
    console.log(state);
    console.log(`[LangGraph] Retrieving questions for ${state.input.subject}/${state.input.topic}, grade ${state.input.grade}`);
    
    try {
        // Define filter for vector store
        const whereClause = {
            "$and": [
                { "subject": { "$eq": state.input.subject } },
                { "topic": { "$eq": state.input.topic } },
                { "grade": { "$eq": state.input.grade } }
            ]
        };

        // Query for similar documents
        const query = `Предмет: ${state.input.subject}, Тема: ${state.input.topic}, Уровень сложности: ${state.input.difficulty}, Класс: ${state.input.grade}`;
        const results = await vectorStore.similaritySearchWithScore(
            query,
            Math.floor(state.input.numQuestions * 0.8),
            whereClause
        );

        console.log(`[LangGraph] Retrieved ${results.length} questions from vector store`);
        
        // Process and validate retrieved questions
        const context = results.map(([doc, score]) => doc.metadata.questionText).join('\n');

        const retrievedQuestions = results.map(([doc, score]) => {
          // if (score < 0.8) {
          //   return null;
          // }
          try {
            return QuestionSchema.parse({
              grade: doc.metadata.grade,
              sub_topic: doc.metadata.sub_topic,
              questionText: doc.metadata.questionText,
              options: JSON.parse(doc.metadata.options),
              correctOptionIndex: +doc.metadata.correctOptionIndex,
              explanation: doc.metadata.explanation
            });
          } catch (error) {
            console.warn(`[LangGraph] Retrieved question validation failed:`, error.message);
            return null;
          }
        });

        
        return {
            questions: retrievedQuestions
        };
    } catch (error) {
        console.error("[LangGraph] Error in retrieveQuestions node:", error);
        return {
            error: {
                message: error.message,
                source: "retrieveQuestions"
            }
        };
    }

}

// Node 2: Check if we need to generate more questions
async function checkNumberOfQuestions(state) {
    const questionsNeeded = state.input.numQuestions - Object.keys(state.questions).length;

    return questionsNeeded > 0 ? "generateMore" : "createTest";
}

// Node 3: Generate batch of questions
async function generateBatchQuestions(state) {
    const questionsNeeded = state.input.numQuestions - Object.keys(state.questions).length;
    
    console.log(`[LangGraph] Generating ${questionsNeeded} questions in batch`);
    
    // Implement retry logic for batch generation
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            attempts++;
            console.log(`[LangGraph] Generation attempt ${attempts}/${maxAttempts}`);
            
            // Call the existing generation function
            console.log(`[LLM] Generating ${questionsNeeded} questions for ${state.input.subject}/${state.input.topic} (${state.input.difficulty})`);
    
            // Create a prompt template for generating test questions
            const prompt = PromptTemplate.fromTemplate(`
        Ты - образовательный ассистент, который создает диагностические тесты для учеников.

        Твоя задача - сгенерировать {count} вопросов по заданной теме для диагностического теста.
        Каждый вопрос должен:
        1. Иметь один правильный ответ
        2. Соответствовать указанной теме ({topic}) и уровню сложности ({difficulty}) для предмета ({subject}).
        3. Соответствовать уровню класса ({grade})
        4. Содержать четкое объяснение правильного ответа.

        Используй escape-символы для символов в LaTeX, например: $\\\\frac{{a}}{{b}}$, вместо $\\frac{{a}}{{b}}$.

        Контекст: {context}
            `);
            

            const structuredModel = giga.withStructuredOutput(z.array(QuestionSchema));

            const chain = prompt.pipe(structuredModel);
    
            // Execute the chain
            const result = await chain.invoke({
                context: state.questions.map(question => question.questionText).join('\n'),
                subject: state.input.subject,
                topic: state.input.topic,
                difficulty: state.input.difficulty,
                count: questionsNeeded,
                grade: state.input.grade,
            });

            // Validate the entire array with Zod
            const validatedArray = z.array(QuestionSchema).parse(result);
            console.log(`[LLM] Successfully generated and validated ${validatedArray.length} questions`);
                
            // If we got questions, use them
            if (validatedArray && validatedArray.length > 0) {
                console.log(`[LangGraph] Successfully generated ${validatedArray.length} questions on attempt ${attempts}`);
                return {
                    questions: validatedArray,
                    generatedQuestions: validatedArray,
                };
            } else {
                console.log(`[LangGraph] Got empty results on attempt ${attempts}, will retry`);
                // Wait before retry to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error(`[LangGraph] Error generating questions (attempt ${attempts}):`, error);
            if (attempts >= maxAttempts) {
                console.error(`[LangGraph] Failed after ${maxAttempts} attempts`);
                return {
                    error: {
                        message: `Failed to generate questions after ${maxAttempts} attempts: ${error.message}`,
                        source: "generateBatchQuestions"
                    }
                };
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return {
        questions: []
    };
}

// Node 4: Save generated questions to MongoDB and vector store
async function saveGeneratedQuestions(state) {
    if (!state.generatedQuestions || state.generatedQuestions.length === 0) {
        console.log(`[LangGraph] No questions to save`);
        return {}; // Nothing to save
    }
    
    try {
        console.log(`[LangGraph] Saving ${state.generatedQuestions.length} generated questions to MongoDB`);
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        // Insert questions into MongoDB
        const result = await client.db('DatabaseAi').collection('diagnosticQuestions').insertMany(
            state.generatedQuestions.map(question => ({
                ...question,
                subject: state.input.subject,
                topic: state.input.topic,
                sub_topic: question.sub_topic || '',
                difficulty: state.input.difficulty,
                grade: state.input.grade
            }))
        );
        
        // Get IDs of saved questions
        const questionIds = Object.values(result.insertedIds).map(id => id.toString());
        console.log(`[LangGraph] Saved ${questionIds.length} questions with IDs: ${questionIds.join(', ')}`);
        
        // Add to vector store
        await addDocumentsToVectorStore(vectorStore, questionIds);
        console.log(`[LangGraph] Added questions to vector store`);
        
        await client.close();
        return { savedQuestionIds: questionIds };
    } catch (error) {
        console.error("[LangGraph] Error saving generated questions:", error);
        return {
            error: {
                message: `Failed to save generated questions: ${error.message}`,
                source: "saveGeneratedQuestions"
            }
        };
    }
}

// Node 5: Generate test title
async function generateTestTitle(state) {
    try {
        console.log(`[LangGraph] Generating test title for ${state.questions.length} questions (${state.input.subject}/${state.input.topic} ${state.input.difficulty})`);
        
        const prompt = PromptTemplate.fromTemplate(`
        Сгенерируй название теста для предмета {subject} по теме {topic} на уровне сложности {difficulty}.

        Вопросы:
        {questions}
        `);

        const structuredModel = giga.withStructuredOutput(z.object({
            testTitle: z.string().describe("Название теста"),
        }));
        
        const chain = prompt.pipe(structuredModel);
        
        const { testTitle } = await chain.invoke({
            subject: state.input.subject,
            topic: state.input.topic,
            difficulty: state.input.difficulty,
            questions: JSON.stringify(state.questions.map(q => ({
                questionText: q.questionText
            })))
        });

        return {
            testTitle
        };
    } catch (error) {
        console.error("[LangGraph] Error generating test title:", error);
        return {
            error: {
                message: `Failed to generate test title: ${error.message}`,
                source: "generateTestTitle"
            }
        };
    }
}

// Node 6: Create test with title
async function createTest(state) {
    try {
        console.log(`[LangGraph] Creating test with ${state.questions.length} questions (${state.input.subject}/${state.input.topic} ${state.input.difficulty})`);
        
        // Save test to database
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        
        const testDoc = {
            user_id: state.input.user_id,
            testTitle: state.testTitle,
            subject: state.input.subject,
            topic: state.input.topic,
            grade: state.input.grade,
            difficulty: state.input.difficulty,
            createdAt: new Date(),
            questions: state.questions,
            userAnswers: [],
            completed: false,
            score: null
        };
        
        // Validate test with Zod
        const validatedTest = TestSchema.parse(testDoc);
        
        const result = await client.db('DatabaseAi').collection('initialTests').insertOne(validatedTest);
        const testId = result.insertedId.toString();
        console.log(`[LangGraph] Test saved with ID: ${testId}`);
        
        await client.close();
        
        return {
            testId 
        };
    } catch (error) {
        console.error("[LangGraph] Error creating test:", error);
        return {
            error: {
                message: `Failed to create test: ${error.message}`,
                source: "createTest"
            }
        };
    }
}

const workflow = new StateGraph(state);

workflow.addNode("retrieveQuestions",  retrieveQuestions);
workflow.addNode("generateBatchQuestions", generateBatchQuestions);
workflow.addNode("saveGeneratedQuestions", saveGeneratedQuestions);
workflow.addNode("generateTestTitle", generateTestTitle);
workflow.addNode("createTest", createTest);

// Define the edges in the graph
workflow.addEdge(START, "retrieveQuestions");
workflow.addConditionalEdges(
    "retrieveQuestions",
    checkNumberOfQuestions,
    {
        generateMore: "generateBatchQuestions",
        createTest: "createTest"
    }
);
workflow.addEdge("generateBatchQuestions", "saveGeneratedQuestions");
workflow.addEdge("saveGeneratedQuestions", "generateTestTitle");
workflow.addEdge("generateTestTitle", "createTest");
workflow.addEdge("createTest", END);

// Compile the graph
const app = workflow.compile();
const config = {
    thread_id: '1'
}

/**
* Run the test generation workflow
* @param {Object} vectorStore - Vector store instance
* @param {Object} params - Input parameters (subject, topic, difficulty, grade, numQuestions, user_id)
* @returns {Promise<Object>} - Result with testId and testTitle
*/
async function runTestGeneration(params) {
  try {
      console.log(`[LangGraph] Starting test generation workflow with params:`, params);
      const result = await app.invoke({
          input: params
      }, config);
      
      console.log(`[LangGraph] Workflow completed:`, result);
      return {
          testId: result.testId,
          testTitle: result.testTitle
      };
  } catch (error) {
      console.error("[LangGraph] Workflow error:", error);
      throw error;
  }
}

module.exports = { app, runTestGeneration }; 
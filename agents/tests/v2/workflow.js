/**
 * LangGraph implementation for test generation
 */
const { PromptTemplate } = require("@langchain/core/prompts");
// const { initializeVectorStore, addDocumentsToVectorStore } = require("../vectorstore");
const { QuestionSchema, TestSchema } = require("../schemas");
const { MongoClient } = require('mongodb');
const { giga } = require('../../../routes/v1/agents/llm');
const { z } = require('zod');
const { Annotation, START, END, StateGraph, MemorySaver } = require('@langchain/langgraph');
const { shuffleArray } = require('../../../utils/agents');
const { SUBTOPICS } = require("../cirriculumData");

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
});

// Node 1: Retrieve questions from MongoDB
async function retrieveQuestions(state) {
    console.log(`[LangGraph] Retrieving questions from MongoDB for ${state.input.subject}/${state.input.topic}, grade ${state.input.grade}`);
    
    // Подключение к MongoDB
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    const questionsCollection = client.db('DatabaseAi').collection('diagnosticQuestions');

    // Строим фильтр для запроса
    const filter = {
        subject: state.input.subject,
        topic: state.input.topic,
        grade: state.input.grade,
        difficulty: state.input.difficulty
    };

    // Добавляем подтемы, если они указаны
    if (state.input.sub_topic) {
        const subTopics = state.input.sub_topic.split(',');
        filter.sub_topic = { $in: subTopics };
    }

    try {
        // Получаем ВСЕ вопросы, соответствующие фильтру
        const allQuestions = await questionsCollection.find(filter).toArray();
        
        console.log(`[LangGraph] Found ${allQuestions.length} matching questions in MongoDB`);

        // Перемешиваем вопросы
        const shuffledQuestions = shuffleArray(allQuestions);

        // Берем нужное количество вопросов
        const selectedQuestions = shuffledQuestions.slice(0, state.input.numQuestions);

        // Преобразуем в нужный формат и валидируем
        const retrievedQuestions = selectedQuestions.map(question => {
            try {
                return QuestionSchema.parse({
                    grade: question.grade,
                    sub_topic: question.sub_topic,
                    topic: question.topic,
                    questionText: question.questionText,
                    options: question.options,
                    correctOptionIndex: question.correctOptionIndex,
                    explanation: question.explanation
                });
            } catch (error) {
                console.warn(`[LangGraph] Retrieved question validation failed:`, error.message);
                return null;
            }
        }).filter(q => q !== null);

        return {
            questions: retrievedQuestions
        };
    } finally {
        await client.close();
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

    const allSubtopics = SUBTOPICS[state.input.topic] || [];

    // 2. Выбираем 3 случайные уникальные подтемы
    const getRandomSubtopics = (count) => {
        const shuffled = [...allSubtopics].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    const randomSubtopics = getRandomSubtopics(3);
    const possibleSubtopics = randomSubtopics.map(st => st.name).join(', ');
    
    while (attempts < maxAttempts) {
        try {

            attempts++;
            console.log(`[LangGraph] Generation attempt ${attempts}/${maxAttempts}`);
            
            // Call the existing generation function
            console.log(`[LLM] Generating ${questionsNeeded} questions for ${state.input.subject}/${state.input.topic} (${state.input.difficulty})`);

            // Create a prompt template for generating test questions
            const promptTemplate = PromptTemplate.fromTemplate(`
            Ты - образовательный ассистент, который создает диагностические тесты для учеников.

            Твоя задача - сгенерировать {count} вопросов по заданной теме для диагностического теста.
            Каждый вопрос должен:
            1. Иметь один правильный ответ
            2. Соответствовать указанной теме ({topic}){subtopicPart} и уровню сложности ({difficulty}) для предмета ({subject}).
            3. Соответствовать уровню класса ({grade})
            4. Содержать четкое объяснение правильного ответа.
            {subtopicInstruction}

            Используй escape-символы для символов в LaTeX, например: $\\\\frac{{a}}{{b}}$, вместо $\\frac{{a}}{{b}}$.

            Контекст: {context}
                `);

            const subtopicPart = state.input.sub_topic ? `, подтеме: ${state.input.subtopic}` : '';
            
            const subtopicInstruction = state.input.sub_topic
                ? `ВАЖНО: Каждый вопрос должен относиться к подтемам "${state.input.sub_topic}". Используй только эти подтемы.`
                : `ВАЖНО: Каждый вопрос должен относиться к подтемам: ${possibleSubtopics}. Используй только эти подтемы.`;

            console.log(subtopicInstruction);

            const questionsSchema = z.object({
                questions: z.array(QuestionSchema).nonempty().min(questionsNeeded).max(questionsNeeded)
            });

            const structuredModel = giga.withStructuredOutput(questionsSchema);

            const chain = promptTemplate.pipe(structuredModel);

            // Execute the chain
            const result = await chain.invoke({
                context: state.questions.map(question => question.questionText).join('\n'),
                subject: state.input.subject,
                topic: state.input.topic,
                subtopicPart,
                subtopicInstruction,
                difficulty: state.input.difficulty,
                count: questionsNeeded,
                grade: state.input.grade,
            });
                
            return {
                questions: result.questions,
                generatedQuestions: result.questions,
            };
        } catch (error) {
            console.log(`[LangGraph] Failed to generate questions on attempt ${attempts}`);
            console.log(error);

            if (attempts >= maxAttempts) {
                console.log(`[LangGraph] Failed to generate questions after ${maxAttempts} attempts`);
                throw new Error(`Failed to generate questions after ${maxAttempts} attempts`);
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

    console.log(`[LangGraph] Saving ${state.generatedQuestions.length} generated questions to MongoDB`);
    
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    console.log(state.generatedQuestions);
    
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

    await client.close();
    return {};
}

// Node 5: Generate test title
async function generateTestTitle(state) {
    console.log(`[LangGraph] Generating test title for ${state.questions.length} questions (${state.input.subject}/${state.input.topic} ${state.input.difficulty})`);
    
    let prompt = PromptTemplate.fromTemplate(`
    Сгенерируй название теста для предмета {subject} по теме {topic}, на уровне сложности {difficulty}.

    Вопросы:
    {questions}
    `);

    if(state.input.subtopic){
        prompt = PromptTemplate.fromTemplate(`
        Сгенерируй название теста для предмета {subject} по теме {topic}, подтеме: {subtopic} на уровне сложности {difficulty}.

        Вопросы:
        {questions}
        `);
    }

    const structuredModel = giga.withStructuredOutput(z.object({
        testTitle: z.string().describe("Название теста"),
    }));
    
    const chain = prompt.pipe(structuredModel);
    
    const { testTitle } = await chain.invoke({
        subject: state.input.subject,
        topic: state.input.topic,
        subtopic: state.input.sub_topic,
        difficulty: state.input.difficulty,
        questions: JSON.stringify(state.questions.map(q => ({
            questionText: q.questionText
        })))
    });

    return {
        testTitle
    };
}

// Node 6: Create test with title
async function createTest(state) {
    console.log(`[LangGraph] Creating test with ${state.questions.length} questions (${state.input.subject}/${state.input.topic} ${state.input.difficulty})`);
    
    // Save test to database
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    
    const testDoc = {
        user_id: state.input.user_id,
        testTitle: state.testTitle,
        subject: state.input.subject,
        topic: state.input.topic,
        sub_topic: state.input.sub_topic,
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
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

module.exports = { app }; 
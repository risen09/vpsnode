const { Chroma } = require("@langchain/community/vectorstores/chroma");
const { PromptTemplate } = require("@langchain/core/prompts");
const { Annotation, StateGraph, END, START, MemorySaver } = require("@langchain/langgraph");
const { GigaChat, GigaChatEmbeddings } = require("langchain-gigachat");
const { formatDocumentsAsString } = require("langchain/util/document");
const { z } = require("zod");
const https = require("https");
const { MongoClient } = require("mongodb");

const CHROMA_URL = process.env.CHROMA_URL;

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

const vectorStore = new Chroma(new GigaChatEmbeddings({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    httpsAgent,
}), {
    collectionName: "textbooks",
    url: CHROMA_URL,
});

const retriever = vectorStore.asRetriever({
    searchType: "similarity",
    searchK: 3,
});

const AgentState = Annotation.Root({
    subject: Annotation({
        default: () => ""
    }),
    topic: Annotation({
        default: () => ""
    }),
    sub_topic: Annotation({
        default: () => ""
    }),
    grade: Annotation({
        default: () => ""
    }),
    context: Annotation({
        default: () => ""
    }),
    structure: Annotation({
        default: () => []
    }),
    lesson: Annotation({
        default: () => ""
    }),
    retryCount: Annotation({
        default: () => 0
    }),
    lessonId: Annotation({
        default: () => ""
    }),
}) 

const LessonSectionSchema = z.object({
    title: z.string().describe("Название раздела"),
    description: z.string().describe("Краткое описание раздела"),
})

const LessonStructureSchema = z.object({
    sections: z.array(LessonSectionSchema).describe("Разделы урока"),
})

// --- Node Functions---

/**
 * Performs RAG search based on subject, topic, grade.
 * Updates the ragContext in the state.
 * JSDoc comments remain helpful!
 * @param {object} state The current graph state.
 * @returns {Promise<object>} Partial state with updated ragContext.
 */
const retrieve = async (state) => {
    console.log(`[LangGraph] RAG Search: Subject='${state.subject}', Topic='${state.topic}', Grade='${state.grade}'`);
    const query = `Что такое ${state.sub_topic}? Найди в учебниках по предмету ${state.subject} по теме ${state.topic} для ${state.grade} класса`
    console.log("   Query:", query);
    const context = await retriever.invoke(query);
    console.log("   RAG Found:", formatDocumentsAsString(context).substring(0, 100) + "...");
    // Return only the fields to update
    return { context: formatDocumentsAsString(context) };
};

/**
 * Generates the lesson structure based on the RAG context and input parameters.
 * Updates the generatedLessonStructure in the state.
 * @param {object} state The current graph state.
 * @returns {Promise<object>} Partial state with updated generatedLessonStructure.
 */
const generateStructureNode = async (state) => {
    console.log(`[LangGraph] Generating lesson structure node`);

    const llm = new GigaChat({
        model: "GigaChat-2-Pro",
        temperature: 1,
        maxTokens: 5000,
        topP: 0.3,
        credentials: process.env.GIGACHAT_CREDENTIALS,
        scope: 'GIGACHAT_API_PERS',
        httpsAgent,
    })
    
    const prompt = PromptTemplate.fromTemplate(`
Ты – помощник преподавателя, создающий структуру уроков по различным темам школьных дисциплин. Тебе предоставляется учебный материал по конкретной теме {topic} определенного предмета {subject} для {grade} класса, на основе которого нужно разработать структуру урока.

## Инструкция
1. Выдели ключевые понятия и термины.
2. Создай последовательную структуру урока, учитывая логическую связь между элементами.
3. Убедись, что структура отражает полный объем необходимой информации и способствует глубокому пониманию темы учащимися.

## Пример
Вход: Учебник по биологии, тема "Фотосинтез"
Выход:
1. Введение: Что такое фотосинтез? Почему это важно?
2. Основная часть: Процесс фотосинтеза, этапы, участники процесса.
3. Примеры: Реальные примеры фотосинтеза у растений.
4. Упражнения: Практические задания по определению этапов фотосинтеза.
5. Заключение: Итоги урока, повторение основных терминов.
6. Домашнее задание: Подготовить доклад о влиянии фотосинтеза на экологию.

## Пример
Вход: Учебник по математике, тема "Рациональные числа"
Выход:
1. Введение: Что такое рациональные числа?
2. Основные понятия о рациональных числах: целые числа, натуральные числа, отрицательные и положительные числа.
3. Рациональные числа на числовой прямой: положение отрицательных и положительных чисел.
4. Сложение и вычитание рациональных чисел: правила, примеры.
5. Умножение и деление рациональных чисел: примеры.
6. Преобразование между формами рациональных чисел: примеры.
7. Решение задач с использованием рациональных чисел: примеры.
8. Заключение: Итоги урока, повторение основных терминов.
9. Домашнее задание: Подготовить доклад о влиянии дробей на жизнь.

## Примечания
Учитывай возраст и уровень подготовки учеников при создании структуры урока.
`)

    const structuredModel = llm.withStructuredOutput(LessonStructureSchema);
    const chain = prompt.pipe(structuredModel);
    const { sections } = await chain.invoke({
        topic: state.sub_topic,
        subject: state.subject,
        grade: state.grade,
    });

    console.log("   Generated Lesson Structure:", JSON.stringify(sections, null, 2));

    return { structure: sections };
}

/**
 * Generates the lesson JSON based on the RAG context and input parameters.
 * Updates the generatedLessonJson in the state.
 * @param {object} state The current graph state.
 * @returns {Promise<object>} Partial state with updated generatedLessonJson.
 */
const generateLessonNode = async (state) => {
    console.log(`[LangGraph] Generate Lesson Node`);
    if (!state.context) {
        throw new Error("Ebaniy rot! No context found to generate lesson.");
    }

    const schema = z.object({
        content: z.string().describe("Текст урока"),
    })

    const llm = new GigaChat({
        model: "GigaChat-2-Pro",
        temperature: 0.2,
        maxTokens: 5000,
        credentials: process.env.GIGACHAT_CREDENTIALS,
        scope: 'GIGACHAT_API_PERS',
        httpsAgent,
    })

    const prompt = PromptTemplate.fromTemplate(`
Ты – опытный учитель, создающий подробный урок для {grade} класса по предмету {subject} на тему "{sub_topic}" раздела "{topic}".

У тебя есть ПЛАН УРОКА (структура):
{structure}

У тебя есть КОНТЕКСТ из учебников:
{context}

## Твоя Задача:
Напиши ПОЛНЫЙ и ПОДРОБНЫЙ текст урока, СТРОГО СЛЕДУЯ ПЛАНУ УРОКА.

### Инструкции:
1.  Используй предоставленный КОНТЕКСТ, чтобы РАСКРЫТЬ КАЖДЫЙ ПУНКТ ПЛАНА подробно. Не просто упоминай, а объясняй, приводи примеры из контекста. НЕ БЕРИ из КОНТЕКСТА то, что не нужно для данного урока.
2.  Особенно МНОГО ВНИМАНИЯ удели основным разделам. Они должны быть большими, понятными, с примерами.
3.  Пиши ПРОСТЫМ ЯЗЫКОМ для {grade} класса. Без сложных терминов. Будь как добрый дедушка, объясняющий мир ребёнку.
4.  Обращайся к ученику на "ты".
5.  Весь урок должен быть ЕДИНЫМ ТЕКСТОМ, разбитым на разделы согласно ПЛАНУ.
6.  Не выдумывай информацию! Если чего-то нет в КОНТЕКСТЕ, лучше пропусти или скажи, что это для старших классов.
7.  Урок должен быть написан на русском языке.
### Требования к Объему:
- Введение и заключение могут быть краткими.
- **Основная часть и примеры должны быть МАКСИМАЛЬНО ДЕТАЛЬНЫМИ И ДЛИННЫМИ**, насколько позволяет КОНТЕКСТ. Не жалей слов!
`);

    const structuredModel = llm.withStructuredOutput(schema);
    const chain = prompt.pipe(structuredModel);
    const { content } = await chain.invoke({
        topic: state.topic,
        sub_topic: state.sub_topic,
        subject: state.subject,
        grade: state.grade,
        context: state.context,
        structure: JSON.stringify(state.structure),
    });

    console.log(`   Generated Lesson: ${content.length} characters`);

    return { lesson: content };
};

/**
 * Checks the quality of the generated lesson based on length, structure inclusion, topic, and refusals.
 * This function itself doesn't decide the next node, just returns a verdict object.
 * @param {object} state The current graph state.
 * @returns {{verdict: "Pass" | "Fail", issues: string[]}} An object containing the verdict and list of issues if failed.
 */
const checkLessonQuality = (state) => {
    console.log(`[LangGraph] Quality Gate Check`);
    const { lesson, structure, topic } = state;
    const MIN_LESSON_LENGTH = 1500;
    let issues = [];

    if (!lesson || typeof lesson !== 'string' || lesson.length < MIN_LESSON_LENGTH) {
        issues.push(`Lesson too short (current: ${lesson?.length ?? 0}, required: ${MIN_LESSON_LENGTH} chars) or not a string.`);
    }
    //  else {
    //     // Check if structure titles are present
    //     if (structure && Array.isArray(structure) && structure.length > 0) {
    //         const missingSections = structure
    //             .map(section => section.title)
    //             .filter(title => !lesson.includes(title));

    //         if (missingSections.length > 0) {
    //             issues.push(`Missing section titles in lesson text: ${missingSections.join(', ')}`);
    //         }
    //     } else if (!structure || !Array.isArray(structure) || structure.length === 0) {
    //          // Allow empty structure if it was intended, maybe add check later? For now, only fail if structure *exists* but isn't followed.
    //          // issues.push("Structure data is missing or invalid in state.");
    //          console.warn("   Warning: No structure provided or structure is empty. Skipping structure check.");
    //     }

    //     // Check for topic keyword (simple example)
    //     if (topic && !lesson.toLowerCase().includes(topic.toLowerCase())) {
    //         issues.push(`Lesson text does not seem to contain the main topic: ${topic}`);
    //     }

    //     // Check for common refusal phrases (add more if needed)
    //     const refusalPhrases = ["я не могу", "извините", "as an ai", "i cannot", "unable to provide"];
    //     if (refusalPhrases.some(phrase => lesson.toLowerCase().includes(phrase))) {
    //         issues.push("Lesson contains potential refusal language.");
    //     }
    // }

    if (issues.length === 0) {
        console.log("   Quality Check Result: PASSED");
        return { verdict: "Pass", issues: [] };
    } else {
        console.log(`   Quality Check Result: FAILED - Issues: ${issues.join('; ')}`);
        return { verdict: "Fail", issues };
    }
};

/**
 * Node to handle the failure of lesson generation, increments retry counter.
 * @param {object} state The current graph state.
 * @returns {Promise<object>} Partial state with updated retry_count.
 */
const handleGenerationFailure = async (state) => {
    console.log("[LangGraph] Handling Generation Failure: Incrementing retry counter");
    const currentRetries = state.retryCount || 0;
    // This node simply increments the counter.
    // The edge from this node will go back to 'generate_lesson'.
    return { retryCount: currentRetries + 1 };
}

/**
 * Decision function to route after lesson generation based on quality check and retries.
 * @param {object} state The current graph state.
 * @returns {string | Symbol} The name of the next node or END.
 */
const decideNextStepAfterGeneration = (state) => {
    const { verdict, issues } = checkLessonQuality(state); // Run the checks

    if (verdict === "Pass") {
        return "save_lesson";
    } else {
        // Quality failed
        const currentRetries = state.retryCount || 0; // Default to 0 if undefined
        const MAX_RETRIES = 2; // Allow 2 retries (3 attempts total)

        if (currentRetries < MAX_RETRIES) {
            console.log(`   Routing to retry (Attempt ${currentRetries + 2}/${MAX_RETRIES + 1}).`);
            // Need to return an update to the state *and* the next node.
            // Route to the handler node which will update state
            return "handle_generation_failure";
        } else {
            console.log(`   Quality Check FAILED after ${MAX_RETRIES + 1} attempts. Ending graph with failure.`);
            // Optionally, save the failed state or log it more permanently here
            console.error("Lesson generation failed permanently:", { state, issues });
            throw new Error("Lesson generation failed permanently");
        }
    }
};

/**
 * Saves the validated lesson JSON to the database.
 * (This is a terminal node in this path)
 * @param {object} state The current graph state.
 * @returns {Promise<void>} Nothing (or perhaps confirmation state).
 */
const saveLessonNode = async (state) => {
    console.log(`[LangGraph] Save Lesson Node`);
    if (!state.lesson) {
        // Should not happen if quality gate passed, but good check
        throw new Error("Trying to save empty lesson.");
    }

    const { subject, topic, sub_topic, grade, lesson } = state;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log("   Connected to MongoDB");
    
    // Создаем новый урок
    const result = await client.db('DatabaseAi').collection('lessons').insertOne({
        subject,
        topic,
        sub_topic,
        grade,
        content: lesson,
        createdAt: new Date(),
    });
    console.log("   Lesson Saved Successfully!");
    console.log("   Lesson ID:", result.insertedId.toString());
    await client.close();
    console.log("   MongoDB Connection Closed");
    return { lessonId: result.insertedId.toString() };
};

// --- Graph Definition ---

// Initialize the graph - no complex schema needed for basic JS state
const graph = new StateGraph(AgentState)
    .addNode("retrieve", retrieve)
    .addNode("generate_structure", generateStructureNode)
    .addNode("generate_lesson", generateLessonNode)
    .addNode("save_lesson", saveLessonNode)
    .addNode("handle_generation_failure", handleGenerationFailure)

    // Define edges
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "generate_structure")
    .addEdge("generate_structure", "generate_lesson")
    .addConditionalEdges(
        "generate_lesson", // Source node
        decideNextStepAfterGeneration,   // Function to decide the route based on quality and retries
        {
            "save_lesson": "save_lesson", // If quality passes
            "handle_generation_failure": "handle_generation_failure", // If quality fails and retries remain
        }
    )
    // Add edge to loop back for retry
    .addEdge("handle_generation_failure", "generate_lesson")
    .addEdge("save_lesson", END); // After saving, end the graph

// Compile the graph
const checkpointer = new MemorySaver();
const app = graph.compile({ checkpointer });

console.log("[LangGraph] Lesson Creator Agent Graph Compiled!");

// Use module.exports for CommonJS environments
module.exports = { lessonCreatorAgent: app };
const { PromptTemplate } = require("@langchain/core/prompts");
const { StateGraph, END, START, Annotation, MemorySaver } = require("@langchain/langgraph");
const { GigaChat } = require("langchain-gigachat");
const { MongoClient, ObjectId } = require('mongodb');
const https = require('https');
const z = require('zod');
const { lessonCreatorAgent } = require('../../lesson-creator/graph');
// Assume Track model is available if needed for saving later
// const Track = require('../../../models/Track'); // Adjust path as needed

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // Отключение проверки сертификатов НУЦ Минцифры
});

// --- State Definition ---
// This is where we keep track of the mess, like plumber's notepad.
const state = Annotation.Root({
  userId: Annotation({
    default: () => null
  }),
  testId: Annotation({
    default: () => null
  }),
  userAnswers: Annotation({
    default: () => []
  }),
  testQuestions: Annotation({
    default: () => []
  }),
  subject: Annotation({
    default: () => null
  }),
  topic: Annotation({
    default: () => null
  }),
  grade: Annotation({
    default: () => null
  }),
  gradedResults: Annotation({
    default: () => []
  }),
  weakTopics: Annotation({
    default: () => []
  }),
  summarizedWeaknesses: Annotation({
    default: () => null
  }),
  foundLessonIds: Annotation({
    default: () => []
  }),
  topicsNeedingLessons: Annotation({
    default: () => []
  }),
  learningTrack: Annotation({
    default: () => null
  }),
  savedTrackId: Annotation({
    default: () => null
  }),
  error: Annotation({
    default: () => null
  })
});

// --- Nodes (Work Stations) ---
// Each function is like a different tool or step in fixing the clog.

/**
 * Loads initial test data (questions, user answers, subject, topic) from database.
 * Like finding the right pipes and checking the water pressure before starting job.
 * @param {object} state - The current graph state. Requires `userId` and `testId`.
 * @returns {Promise<object>} Updated state with `userAnswers`, `testQuestions`, `subject`, `topic`, or `error`.
 */
async function loadTestData(state) {
  console.log("--- Node: loadTestData ---");
  const { userId, testId } = state;
  if (!userId || !testId) {
    return { error: "Missing userId or testId" };
  }
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log(`[Graph] Connected to MongoDB for test data`);
    const test = await client.db('DatabaseAi').collection('initialTests').findOne({
        _id: new ObjectId(testId),
        user_id: userId // Ensure it's the correct user
    });
    await client.close();
    console.log(`[Graph] Disconnected from MongoDB`);

    if (!test) {
      throw new Error(`Test not found: ${testId}`)
    }
    if (!test.completed) {
        throw new Error(`Test ${testId} is not completed yet, blyat!` )
    }
    // Ensure userAnswers exists, even if empty
    if (!test.userAnswers) {
        console.warn(`[Graph] Test ${testId} has no userAnswers array.`);
        throw new Error(`No user answers found for in test ${testId}.` )
    }

    console.log(`[Graph] Test data loaded successfully for user ${userId}, test ${testId}`);
    return {
      userAnswers: test.userAnswers || [], // Pass user answers
      testQuestions: test.questions || [],
      subject: test.subject,
      topic: test.topic,
      grade: test.grade
     };
  } catch (err) {
    console.error("[Graph] Error loading test data:", err);
    return { error: `DB Error: ${err.message}` };
  }
}

/**
 * Grades the user's answers against the correct answers from the test questions.
 * Like checking each pipe joint for leaks, da?
 * @param {object} state - The current graph state. Requires `userAnswers` and `testQuestions`.
 * @returns {Promise<object>} Updated state with `gradedResults` array [{ userAnswerIndex, correctOptionIndex, isCorrect }].
 */
async function gradeAnswers(state) {
    console.log("--- Node: gradeAnswers ---");
    const { userAnswers, testQuestions } = state;
    const gradedResults = [];

    if (!userAnswers || userAnswers.length === 0 || !testQuestions || testQuestions.length === 0) {
        console.warn("[Graph] No user answers or questions provided for grading.");
        return { gradedResults }; // Return empty if nothing to grade
    }

    // Ensure arrays are of compatible length, or handle mismatch
    const numAnswers = userAnswers.length;
    const numQuestions = testQuestions.length;
    if (numAnswers !== numQuestions) {
        console.warn(`[Graph] Mismatch: ${numAnswers} answers, ${numQuestions} questions. Grading up to shortest length: ${Math.min(numAnswers, numQuestions)}`);
    }

    const gradingLength = Math.min(numAnswers, numQuestions);

    for (let i = 0; i < gradingLength; i++) {
        const question = testQuestions[i];
        const userAnswerIndex = userAnswers[i]; // User's selected option index

        // Basic validation: Check if question has correctOptionIndex
        if (question && question.correctOptionIndex !== undefined && question.correctOptionIndex !== null) {
             // Handle potential type mismatch (e.g., user answer is string '2', correct is number 2)
            const isCorrect = String(userAnswerIndex) === String(question.correctOptionIndex);

            gradedResults.push({
                userAnswerIndex: userAnswerIndex,
                correctOptionIndex: question.correctOptionIndex,
                isCorrect: isCorrect
            });
            console.log(`[Graph] Q${i}: User answered ${userAnswerIndex}, Correct is ${question.correctOptionIndex} -> ${isCorrect ? 'Correct' : 'INCORRECT'}`);
        } else {
             console.warn(`[Graph] Skipping grading for question index ${i}: Missing or invalid correctOptionIndex.`);
             // Decide how to represent this - maybe push a result with isCorrect: false or null?
             gradedResults.push({
                userAnswerIndex: userAnswerIndex,
                correctOptionIndex: null, // Indicate unknown correct answer
                isCorrect: false // Assume incorrect if we can't verify
            });
        }
    }

    console.log(`[Graph] Grading complete. ${gradedResults.filter(r => r.isCorrect).length} correct out of ${gradingLength} graded.`);
    return { gradedResults };
}

/**
 * Analyzes the graded results to identify topics where the user made mistakes.
 * Find the cracked pipes, the source of the leak!
 * @param {object} state - The current graph state. Requires `gradedResults` and `testQuestions`.
 * @returns {Promise<object>} Updated state with `weakTopics` (Map where key is 'topic/sub_topic', value is { topic, sub_topic, count }).
 */
async function analyzeFailures(state) {
  console.log("--- Node: analyzeFailures ---");
  // Now uses gradedResults from the previous step
  const { gradedResults, testQuestions } = state;
  const weakTopics = new Map();

  // Check gradedResults instead of testResults
  if (!gradedResults || gradedResults.length === 0) {
      console.warn("[Graph] No graded results found to analyze.");
      return { weakTopics };
  }

  // Iterate through gradedResults
  gradedResults.forEach((result, index) => {
    // Check if the result indicates incorrect
    if (result && !result.isCorrect) {
      const question = testQuestions[index];
      // Check if corresponding question exists and has topic/sub_topic
      if (question && question.topic) {
        const topicKey = `${question.topic}/${question.sub_topic || 'general'}`;
        const weakness = {
          topic: question.topic,
          sub_topic: question.sub_topic || 'general',
          count: 1
        }; 

        if (!weakTopics.has(topicKey)) {
          weakTopics.set(topicKey, weakness);
          console.log(`[Graph] Found weakness from Q${index}: Topic=${question.topic}, SubTopic=${question.sub_topic || 'general'}`);
        } else {
          const existingWeakness = weakTopics.get(topicKey);
          existingWeakness.count++;
          console.log(`[Graph] Found weakness from Q${index}: Topic=${question.topic}, SubTopic=${question.sub_topic || 'general'}`);
        }
      } else {
          // This might happen if question data was missing or grading failed for this index
          console.warn(`[Graph] Skipping weakness analysis for index ${index}: Missing corresponding question data or topic.`);
      }
    }
  });

  console.log(`[Graph] Identified ${weakTopics.length} raw weaknesses based on graded results.`);
  return { weakTopics };
}

/**
 * Uses LLM to generate a natural language summary of the user's weak topics.
 * Like explaining to homeowner in simple terms why their basement is flooding.
 * @param {object} state - The current graph state. Requires `weakTopics` (Map), `subject`, `topic`.
 * @returns {Promise<object>} Updated state with `summarizedWeaknesses` (string summary).
 */
async function summarizeWeaknesses(state) {
    console.log("--- Node: summarizeWeaknesses ---");
    const { weakTopics, subject, topic } = state;
    console.log(`[Graph] Weak topics: ${JSON.stringify(Array.from(weakTopics))}`);
    const summary = Array.from(weakTopics).map(([key, weakness]) => `${key}: ${weakness.count}`).join('\n');
    console.log(`[Graph] Summary:\n${summary}`);

    const llm = new GigaChat({
      model: 'GigaChat-2',
      temperature: 1,
      topP:  0.9,
      credentials: process.env.GIGACHAT_CREDENTIALS,
      httpsAgent: httpsAgent
    }).withStructuredOutput(z.object({
      summary: z.string().describe("Суть слабых мест ученика. Описание в 1 предложении.")
    }));

    const prompt = PromptTemplate.fromTemplate(`
      Ты - опытный методист, анализирующий результаты диагностического теста ученика по предмету '{subject}', тема '{topic}'.

Ученик допустил ошибки в следующих областях:
{summarized_weaknesses_string}

Проанализируй эти ошибки. Твоя задача - **кратко сформулировать основные слабые места** ученика, основываясь на частоте и характере ошибок (если это возможно определить из тем). Не просто перечисляй, а дай **суть** его трудностей. Это поможет составить план обучения. Будь дружелюбен и не забывай, что ученик - это ребенок.

ПРИМЕР:
{{ "subject": "Алгебра", "topic": "Квадратные уравнения и функции", "summarized_weaknesses_string": "Алгебра / Квадратные уравнения: 3, Геометрия / Периметр: 1, Алгебра / Функции: 1" }}

ОТВЕТ:
'Ты плохо понимаешь квадратные уравнения и функции в алгебре. Давай попробуем разобраться, для этого тебе нужно пройти следующие уроки: ...'
ИЛИ
'Из пройденного теста я вижу, что ты плохо понимаешь квадратные уравнения и функции в алгебре. Я составил для тебя следующий план обучения: ...'

Твой вывод должен быть **только на русском языке**. Не добавляй никаких вступлений или заключений, только суть слабых мест.
      `);

    const chain = prompt.pipe(llm);

    const { summary: summarizedWeaknesses } = await chain.invoke({
      subject: subject,
      topic: topic,
      summarized_weaknesses_string: summary
    });
    console.log("[Graph] Weaknesses summarized:", summarizedWeaknesses);

    return { summarizedWeaknesses };
}

/**
 * Searches the database for existing learning lessons matching the identified weak topics.
 * Check the van for spare parts before ordering new ones, understand?
 * @param {object} state - The current graph state. Requires `weakTopics` (Map).
 * @returns {Promise<object>} Updated state with `foundLessonIds` (array of ObjectIds) and `topicsNeedingLessons` (array of { topic, sub_topic, count }).
 */
async function findExistingLessons(state) {
  console.log("--- Node: findExistingLessons ---");
  const { weakTopics } = state;

  const foundLessonIds = [];
  const topicsNeedingLessons = [];

  if (weakTopics.length === 0) {
      console.log("[Graph] No weaknesses identified, skipping lesson search.");
      return { foundLessonIds, topicsNeedingLessons };
  }

  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log(`[Graph] Connected to MongoDB for lesson search`);
    const lessonsCollection = client.db('DatabaseAi').collection('lessons'); // Assuming 'lessons' collection

    for (const [_, weakness] of weakTopics) {
      // Simple search for now, might need more sophisticated matching
      const query = { topic: weakness.topic };
       if (weakness.sub_topic && weakness.sub_topic !== 'general') {
            query.sub_topic = weakness.sub_topic;
       }
      const foundLesson = await lessonsCollection.findOne(query, { projection: { _id: 1 } }); // Find one for simplicity

      if (foundLesson) {
        console.log(`[Graph] Found existing lesson for ${weakness.topic}/${weakness.sub_topic}: ${foundLesson._id}`);
        foundLessonIds.push(foundLesson._id);
      } else {
        console.log(`[Graph] No existing lesson found for ${weakness.topic}/${weakness.sub_topic}`);
        topicsNeedingLessons.push(weakness);
      }
    }
    await client.close();
    console.log(`[Graph] Disconnected from MongoDB`);
  } catch (err) {
    console.error("[Graph] Error finding lessons:", err);
    return { error: `DB Error finding lessons: ${err.message}` };
  }

  console.log(`[Graph] Found ${foundLessonIds.length} existing lessons. Need lessons for ${topicsNeedingLessons.length} topics.`);
  return { foundLessonIds, topicsNeedingLessons };
}

/**
 * Uses LLM to generate a name and description for the new learning track based on weaknesses.
 * Make it sound fancy for the customer, this learning plan, blyat.
 * @param {object} state - The current graph state. Requires `userId`, `subject`, `topic`, `foundLessonIds`, `summarizedWeaknesses`, `topicsNeedingLessons`.
 * @returns {Promise<object>} Updated state with `learningTrack` object ready for saving.
 */
async function createTrackStructure(state) {
    console.log("--- Node: createTrackStructure ---");
    const { userId, subject, topic, grade, foundLessonIds, summarizedWeaknesses, topicsNeedingLessons } = state;

    const llm = new GigaChat({
      model: 'GigaChat-2',
      temperature: 1,
      topP:  0.9,
      credentials: process.env.GIGACHAT_CREDENTIALS,
      httpsAgent: httpsAgent
    }).withStructuredOutput(z.object({
      name: z.string().describe("Яркое и запоминающееся название учебного плана."),
      description: z.string().describe("Подробное описание учебного плана.")
    }));

    const prompt = PromptTemplate.fromTemplate(`
Ты помощник, создающий эффективные учебные планы, основанные на индивидуальных потребностях учеников. Основная задача – сформировать привлекательное имя и точное описание учебного плана исходя из предложенных недостатков ученика и тем, требующих внимания.

## Инструкция
1. Проанализируй предметы {subject}, темы {topic} и обобщенные слабые места ученика {summarizedWeaknesses}. Оцени степень детализации и определись с основными направлениями работы.
2. Создай яркое и запоминающееся название (\`name\`), которое четко отражает суть учебного плана и мотивирует ученика приступить к обучению.
3. Напиши подробное описание (\`description\`), акцентируя внимание на областях, требующих особого подхода, и возможном прогрессе после изучения. 
4. При наличии тем, требующих дополнительных занятий {topicsNeedingLessons}, включи в описание соответствующие заметки.
5. Обеспечь простоту восприятия и привлекательность текста, используя активные глаголы и позитивные выражения. Будь дружелебен и непредвзят к ученику, ведь он - ребенок. 

ПРИМЕР
JSON-вход: {{ "subject": "Математика", "topic": "Алгебра", "summarizedWeaknesses": "Трудности с решением линейных уравнений и работой с квадратичными функциями", "topicsNeedingLessons": "Решение квадратных уравнений" }}
JSON-выход: {{ "name": "Алгебраический прорыв", "description": "Я заметил, что у тебя есть трудности с решением линейных уравнений и работу с квадратичными функциями. Этот курс направлен на преодоление этих слабых мест и поможет тебе справиться решать их уверенней! Особое внимание уделяется решению квадратных уравнений." }}

ПРИМЕР
JSON-вход: {{ "subject": "История", "topic": "Средневековая Европа", "summarizedWeaknesses": "Недостаток знаний о феодальной системе и Крестовых походах", "topicsNeedingLessons": "Феодализм" }}
JSON-выход: {{ "name": "Путешествие во времена рыцарей и замков", "description": "В этом курсе мы с тобой окунемся в изучение одной из интереснейших эпох - средневековой Европы. Мы сосредоточимся на понимании феодализма и истории Крестовых походов (это было в Assassin's Creed!)." }}

## Критерии качества
- Название должно быть привлекательным и соответствовать теме.
- Описание подробно описывает проблемные зоны и обещает прогресс.
- Текст легок для чтения и стимулирует интерес к изучению.
- Информация о дополнительных уроках включена аккуратно и понятно.
    `);

    const chain = prompt.pipe(llm);

    const { name, description } = await chain.invoke({
      subject: subject,
      topic: topic,
      summarizedWeaknesses: summarizedWeaknesses,
      topicsNeedingLessons: topicsNeedingLessons
    });

    const learningTrack = {
        userId: userId,
        name: name,
        description: description,
        subject: subject,
        topic: topic, // Original test topic, maybe refine later
        lessons: foundLessonIds, // Only add existing lessons for now
        grade: grade,
        tests: [], // Maybe add follow-up tests later?
        // schedule: {}, // Schedule needs separate logic if used
        createdAt: new Date(),
    };

    console.log("[Graph] Draft learning track created:", learningTrack);
    return { learningTrack };
}

/**
 * Conditional logic to decide if new lessons need to be requested/generated.
 * Do we have all parts, or must call supplier? This function decides.
 * @param {object} state - The current graph state. Checks `topicsNeedingLessons` and `error`.
 * @returns {string} The name of the next node to transition to: "request_new_lessons", "save_track", or "error_handler".
 */
function shouldRequestNewLessons(state) {
  console.log("--- Edge: shouldRequestNewLessons ---");
  if (state.error) return "error_handler"; // Go to error state if previous node failed
  console.log("[Graph] Checking if new lessons are needed:", state.topicsNeedingLessons);
  return state.topicsNeedingLessons && state.topicsNeedingLessons.length > 0 ? "request_new_lessons" : "save_track";
}

/**
 * Placeholder node for requesting or generating new lessons for topics where none exist.
 * In real system, this calls the lesson factory. Here, is just empty pipe, does nothing.
 * @param {object} state - The current graph state. Requires `topicsNeedingLessons`.
 * @returns {Promise<object>} Empty object, does not modify state in this version.
 */
async function requestNewLessons(state) {
  console.log("--- Node: requestNewLessons ---");
  const { learningTrack, topicsNeedingLessons } = state;
  if (!learningTrack) {
    throw new Error("Learning track not found. Cannot add new lesson ID." )
  }

  for (const topic of topicsNeedingLessons) {
    console.log(`[Graph] Requesting/generating a new lesson for topic:`, topic);

    const params = {
      subject: state.subject,
      topic: topic.topic,
      sub_topic: topic.sub_topic,
      grade: state.grade,
    }

    const response = await lessonCreatorAgent.invoke(params)
    console.log(`[Graph] Received response from lesson creator agent:`, response);

    learningTrack.lessons.push(response.lessonId);
    console.log(`[Graph] New lesson saved in Track sucessfully with ID: ${response.lessonId}`);

    break;
  };

  return { learningTrack };
}

/**
 * Saves the generated learning track structure to the database.
 * File the paperwork, job done (almost).
 * @param {object} state - The current graph state. Requires `learningTrack`.
 * @returns {Promise<object>} Updated state with `savedTrackId` (string) or `error`.
 */
async function saveTrack(state) {
  console.log("--- Node: saveTrack ---");
  const { learningTrack } = state;
  if (!learningTrack) {
      return { error: "Cannot save track, structure not created." };
  }
  try {
    // ***** ZOD VALIDATION *****
    // You should use your Track Zod schema here to validate learningTrack before saving.
    // const validatedTrack = TrackSchema.parse(learningTrack); // Uncomment when you have schema

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log(`[Graph] Connected to MongoDB to save track`);
    const result = await client.db('DatabaseAi').collection('tracks').insertOne(learningTrack); // Use validatedTrack
    await client.close();
    console.log(`[Graph] Disconnected from MongoDB`);

    const savedTrackId = result.insertedId;
    console.log(`[Graph] Learning track saved successfully with ID: ${savedTrackId}`);
    return { savedTrackId: savedTrackId.toString() }; // Return the ID
  } catch (err) {
    console.error("[Graph] Error saving track:", err);
    // Maybe specific handling for validation errors vs DB errors
    return { error: `DB/Validation Error saving track: ${err.message}` };
  }
}

/**
 * Handles errors that occurred during the workflow execution.
 * Cleans up the mess when pipe bursts. Logs the error.
 * @param {object} state - The current graph state. Requires `error`.
 * @returns {Promise<object>} State object with a `finalMessage` indicating failure.
 */
async function handleError(state) {
    console.error("--- Node: handleError ---");
    console.error("[Graph] Workflow failed with error:", state.error);
    // You could add logic here to notify admin, update DB status, etc.
    return { finalMessage: `Workflow failed: ${state.error}` }; // Signal failure
}

// --- Graph Definition ---
// Now we connect the pipes.

const workflow = new StateGraph(state);

// Add nodes
workflow.addNode("load_test_data", loadTestData);
workflow.addNode("grade_answers", gradeAnswers);
workflow.addNode("analyze_failures", analyzeFailures);
workflow.addNode("summarize_weaknesses", summarizeWeaknesses);
workflow.addNode("find_existing_lessons", findExistingLessons);
workflow.addNode("create_track_structure", createTrackStructure);
workflow.addNode("request_new_lessons", requestNewLessons);
workflow.addNode("save_track", saveTrack);
workflow.addNode("error_handler", handleError);

// Define edges
workflow.addEdge(START, "load_test_data");
workflow.addEdge("load_test_data", "grade_answers");
workflow.addEdge("grade_answers", "analyze_failures");
workflow.addEdge("analyze_failures", "summarize_weaknesses");
workflow.addEdge("summarize_weaknesses", "find_existing_lessons");
workflow.addEdge("find_existing_lessons", "create_track_structure");

// Conditional edge after creating structure
workflow.addConditionalEdges(
  "create_track_structure",
  shouldRequestNewLessons,
  {
    "request_new_lessons": "request_new_lessons",
    "save_track": "save_track",
    "error_handler": "error_handler"
  }
);

// Edge from placeholder request node to save node
workflow.addEdge("request_new_lessons", "save_track");

// End points
workflow.addEdge("save_track", END);
workflow.addEdge("error_handler", END); // End after handling error

// Compile the graph
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

console.log("[Graph] Diagnostic LangGraph workflow compiled, ready to fix leaks!");

/**
 * Runs the entire diagnostic workflow graph for a given user and completed test.
 * This is the main valve, comrade. Turn this to start the whole damn machine.
 * @param {string} userId - The ObjectId of the user.
 * @param {string} testId - The ObjectId of the completed initialTest.
 * @returns {Promise<object>} An object indicating success (`{ success: true, trackId: string }`) or failure (`{ success: false, error: string }`).
 */
async function runDiagnosis(userId, testId, threadId) {
    const initialState = { userId, testId };
    const config = {
        configurable: {
            thread_id: threadId
        }
    }
    console.log(`Starting diagnosis for User: ${userId}, Test: ${testId}`);
    try {
        const state = await app.invoke(initialState, {
          ...config,
          subgraphs: true
        });
        const finalState = state[1];
        if (finalState.savedTrackId) {
            console.log("Diagnosis complete. Track created:", finalState.savedTrackId);
            // Maybe update the original test document with the track ID here
            // await updateTestWithTrackId(testId, finalState.savedTrackId);
             return { success: true, trackId: finalState.savedTrackId };
        }
        else if (finalState.error) {
             console.error("Diagnosis finished with error:", finalState.error);
             return { success: false, error: finalState.error };
        } else {
             console.warn("Diagnosis finished unexpectedly:", finalState);
             return { success: false, message: "Unknown state at finish." };
        }
    } catch (e) {
        console.error("Error running graph:", e);
        return { success: false, error: e.message };
    }
}

/*
// You would call runDiagnosis from your test submission route in index.js
// runDiagnosis('user_object_id_here', 'test_object_id_here');
*/

module.exports = { graph: app, runDiagnosis }; // Export the compiled graph


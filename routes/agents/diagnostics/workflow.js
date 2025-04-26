const { StateGraph, END, START } = require("@langchain/langgraph");
const { MongoClient, ObjectId } = require('mongodb');
// Assume Track model is available if needed for saving later
// const Track = require('../../../models/Track'); // Adjust path as needed

// --- State Definition ---
// This is where we keep track of the mess, like plumber's notepad.
const graphState = {
  userId: null,
  testId: null,
  userAnswers: [], // From initialTests.userAnswers
  testQuestions: [], // From initialTests.questions
  subject: null, // Added from loadTestData
  topic: null,   // Added from loadTestData
  gradedResults: [], // NEW: Stores the result of grading [{ userAnswerIndex, correctOptionIndex, isCorrect }]
  weakTopics: [], // [{ topic: string, sub_topic: string }]
  summarizedWeaknesses: {}, // { 'Topic/SubTopic': count }
  foundLessonIds: [], // [ObjectId]
  topicsNeedingLessons: [], // [{ topic: string, sub_topic: string }]
  learningTrack: null, // Object matching TrackSchema structure
  savedTrackId: null, // Added for clarity
  error: null, // If shit hits the fan
};

// --- Nodes (Work Stations) ---
// Each function is like a different tool or step in fixing the clog.

async function loadTestData(state) {
  console.log("--- Node: loadTestData ---");
  const { userId, testId } = state;
  if (!userId || !testId) {
    return { error: "Missing userId or testId, pizdec!" };
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
      return { error: `Test not found: ${testId}` };
    }
    if (!test.completed) {
        return { error: `Test ${testId} is not completed yet, blyat!` };
    }
    // Ensure userAnswers exists, even if empty
    if (!test.userAnswers) {
        console.warn(`[Graph] Test ${testId} has no userAnswers array.`);
        test.userAnswers = [];
    }

    console.log(`[Graph] Test data loaded successfully for user ${userId}, test ${testId}`);
    return {
      userAnswers: test.userAnswers || [], // Pass user answers
      testQuestions: test.questions || [],
      subject: test.subject,
      topic: test.topic,
     };
  } catch (err) {
    console.error("[Graph] Error loading test data:", err);
    return { error: `DB Error: ${err.message}` };
  }
}

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

async function analyzeFailures(state) {
  console.log("--- Node: analyzeFailures ---");
  // Now uses gradedResults from the previous step
  const { gradedResults, testQuestions } = state;
  const weakTopics = [];

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
        weakTopics.push({
          topic: question.topic,
          sub_topic: question.sub_topic || 'general',
        });
        console.log(`[Graph] Found weakness from Q${index}: Topic=${question.topic}, SubTopic=${question.sub_topic || 'general'}`);
      } else {
          // This might happen if question data was missing or grading failed for this index
          console.warn(`[Graph] Skipping weakness analysis for index ${index}: Missing corresponding question data or topic.`);
      }
    }
  });

  console.log(`[Graph] Identified ${weakTopics.length} raw weaknesses based on graded results.`);
  return { weakTopics };
}

async function summarizeWeaknesses(state) {
    console.log("--- Node: summarizeWeaknesses ---");
    const { weakTopics } = state;
    const summarizedWeaknesses = weakTopics.reduce((acc, { topic, sub_topic }) => {
        const key = `${topic} / ${sub_topic}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    // ***** LLM CALL OPPORTUNITY *****
    // You *could* call an LLM here to get a more nuanced summary.
    // Input: summarizedWeaknesses object, maybe original questions/answers.
    // Output: A natural language summary or a more refined list of core weaknesses.
    // Example: "User struggles significantly with 'Algebra / Solving Equations' (5 errors)
    //           and shows minor difficulty in 'Geometry / Area Calculation' (1 error)."
    // For now, we just use the raw counts.
    console.log("[Graph] Weaknesses summarized:", summarizedWeaknesses);

    return { summarizedWeaknesses };
}


async function findExistingLessons(state) {
  console.log("--- Node: findExistingLessons ---");
  const { summarizedWeaknesses } = state;
  const topicsToSearch = Object.keys(summarizedWeaknesses).map(key => {
      const [topic, sub_topic] = key.split(' / ');
      return { topic, sub_topic };
  });

  const foundLessonIds = [];
  const topicsNeedingLessons = [];

  if (topicsToSearch.length === 0) {
      console.log("[Graph] No weaknesses identified, skipping lesson search.");
      return { foundLessonIds, topicsNeedingLessons };
  }

  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log(`[Graph] Connected to MongoDB for lesson search`);
    const lessonsCollection = client.db('DatabaseAi').collection('lessons'); // Assuming 'lessons' collection

    for (const weakPoint of topicsToSearch) {
      // Simple search for now, might need more sophisticated matching
      const query = { topic: weakPoint.topic };
       if (weakPoint.sub_topic && weakPoint.sub_topic !== 'general') {
            query.sub_topic = weakPoint.sub_topic;
       }
      const foundLesson = await lessonsCollection.findOne(query, { projection: { _id: 1 } }); // Find one for simplicity

      if (foundLesson) {
        console.log(`[Graph] Found existing lesson for ${weakPoint.topic}/${weakPoint.sub_topic}: ${foundLesson._id}`);
        foundLessonIds.push(foundLesson._id);
      } else {
        console.log(`[Graph] No existing lesson found for ${weakPoint.topic}/${weakPoint.sub_topic}`);
        topicsNeedingLessons.push(weakPoint);
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


async function createTrackStructure(state) {
    console.log("--- Node: createTrackStructure ---");
    const { userId, subject, topic, foundLessonIds, summarizedWeaknesses, topicsNeedingLessons } = state;

    // ***** LLM CALL OPPORTUNITY *****
    // Call LLM to generate a good track name and description based on weaknesses.
    // Input: subject, topic, summarizedWeaknesses, topicsNeedingLessons
    // Output: { name: string, description: string }
    // Example: LLM generates name "Algebra Tune-Up" and description "Focuses on solving equations and basic functions, identified as areas needing improvement. Note: Additional material needed for polynomial division."

    // Mock generation for now:
    const trackName = `Learning Track for ${subject}: ${topic} - Remediation`;
    let trackDescription = `Auto-generated track based on test results. Focuses on areas with errors:\n`;
    trackDescription += Object.entries(summarizedWeaknesses)
                             .map(([key, count]) => `- ${key} (${count} errors)`)
                             .join('\n');
    if (topicsNeedingLessons.length > 0) {
        trackDescription += `\n\nMissing content for:\n`;
        trackDescription += topicsNeedingLessons.map(t => `- ${t.topic} / ${t.sub_topic}`).join('\n');
    }


    const learningTrack = {
        userId: userId,
        name: trackName, // Replace with LLM generated name
        description: trackDescription, // Replace with LLM generated description
        subject: subject,
        topic: topic, // Original test topic, maybe refine later
        lessons: foundLessonIds, // Only add existing lessons for now
        tests: [], // Maybe add follow-up tests later?
        // schedule: {}, // Schedule needs separate logic if used
        createdAt: new Date(),
    };

    console.log("[Graph] Draft learning track created:", learningTrack);
    return { learningTrack };
}

// Conditional Edge Logic: Decide if we need to request new lessons (or just note them)
function shouldRequestNewLessons(state) {
  console.log("--- Edge: shouldRequestNewLessons ---");
  if (state.error) return "error_handler"; // Go to error state if previous node failed
  console.log("[Graph] Checking if new lessons are needed:", state.topicsNeedingLessons);
  return state.topicsNeedingLessons && state.topicsNeedingLessons.length > 0 ? "request_new_lessons" : "save_track";
}

// Optional Node: In a real system, this might trigger another process. Here, it just logs.
async function requestNewLessons(state) {
  console.log("--- Node: requestNewLessons ---");
  const { topicsNeedingLessons } = state;
  console.log(`[Graph] Placeholder for requesting/generating new lessons for:`, topicsNeedingLessons);

  // ***** LLM / EXTERNAL CALL OPPORTUNITY *****
  // This is where you would:
  // 1. Call an LLM to generate lesson content for each topic in topicsNeedingLessons.
  // 2. Save the new lessons to the 'lessons' collection.
  // 3. Get the new lesson IDs.
  // 4. Potentially update the state.learningTrack.lessons array with new IDs.
  // For now, we do nothing except acknowledge the need. The track description already notes it.

  return {}; // No state change in this mock version
}

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

// Simple error handler node
async function handleError(state) {
    console.error("--- Node: handleError ---");
    console.error("[Graph] Workflow failed with error:", state.error);
    // You could add logic here to notify admin, update DB status, etc.
    return { finalMessage: `Workflow failed: ${state.error}` }; // Signal failure
}


// --- Graph Definition ---
// Now we connect the pipes.

const workflow = new StateGraph({
  channels: graphState
});

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
const app = workflow.compile();

console.log("Diagnostic LangGraph workflow compiled, ready to fix leaks!");

// --- Example Usage (Conceptual) ---
async function runDiagnosis(userId, testId) {
    const initialState = { userId, testId };
    console.log(`Starting diagnosis for User: ${userId}, Test: ${testId}`);
    try {
        const finalState = await app.invoke(initialState);
        if (finalState.error) {
             console.error("Diagnosis finished with error:", finalState.error);
             return { success: false, error: finalState.error };
        } else if (finalState.savedTrackId) {
            console.log("Diagnosis complete. Track created:", finalState.savedTrackId);
            // Maybe update the original test document with the track ID here
            // await updateTestWithTrackId(testId, finalState.savedTrackId);
             return { success: true, trackId: finalState.savedTrackId };
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


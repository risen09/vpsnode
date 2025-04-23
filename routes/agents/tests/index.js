const router = require('express').Router();
const { StateGraph, START, END, MemorySaver } = require("@langchain/langgraph");

// Import the chains and format instructions
const { generateChain, generateFormatInstructions } = require("./generate");
const { critiqueChain } = require('./reflect'); // critiqueChain was reflect
const { refineChain } = require('./refine');

// Import the Test type (assuming TS environment or using JSDoc types)
/** @typedef {import('./schemas').Test} Test */

/**
 * Defines the state structure for our test generation graph.
 * @typedef {object} TestGenerationState
 * @property {string} subject - Initial request parameter.
 * @property {string} topic - Initial request parameter.
 * @property {string} difficulty - Initial request parameter.
 * @property {number} num_questions - Initial request parameter.
 * @property {Test | null} current_test - The latest generated or refined test.
 * @property {string | null} critique - The critique received from the critique node.
 * @property {number} revision_number - Counter for refinement attempts.
 * @property {string | null} error - Holds any error messages from nodes.
 */

// --- Constants ---
const MAX_REVISIONS = 2; // Allow maximum 1 refinement loop (initial generation + 1 refinement)

// --- Node Functions ---

/**
 * Graph Node: Generates the initial test.
 * @param {TestGenerationState} state - The current graph state.
 * @returns {Promise<Partial<TestGenerationState>>} - State updates.
 */
async function generateNode(state) {
    console.log(`[Graph] Node: generateNode (Revision ${state.revision_number})`);
    try {
        const generationInput = {
            subject: state.subject,
            topic: state.topic,
            difficulty: state.difficulty,
            num_questions: state.num_questions.toString(),
            format_instructions: generateFormatInstructions
        };
        const test = await generateChain.invoke(generationInput);
        console.log("[Graph] generateNode: Generation successful.");
        return { current_test: test, error: null, revision_number: state.revision_number + 1 };
    } catch (error) {
        console.error("[Graph] generateNode: Error during generation.", error);
        return { error: `Generation failed: ${error.message}` };
    }
}

/**
 * Graph Node: Critiques the current test.
 * @param {TestGenerationState} state - The current graph state.
 * @returns {Promise<Partial<TestGenerationState>>} - State updates.
 */
async function critiqueNode(state) {
    console.log(`[Graph] Node: critiqueNode (Revision ${state.revision_number})`);
    if (state.error || !state.current_test) {
        console.log("[Graph] critiqueNode: Skipping due to previous error or no test.");
        return {}; // No changes if there was an error or no test
    }
    try {
        const critiqueInput = {
            subject: state.subject,
            topic: state.topic,
            difficulty: state.difficulty,
            test_json: JSON.stringify(state.current_test, null, 2)
        };
        const critiqueResult = await critiqueChain.invoke(critiqueInput);
        console.log("[Graph] critiqueNode: Critique successful.");
        console.log("Critique:", critiqueResult);
        return { critique: critiqueResult, error: null };
    } catch (error) {
        console.error("[Graph] critiqueNode: Error during critique.", error);
        return { error: `Critique failed: ${error.message}` };
    }
}

/**
 * Graph Node: Refines the test based on critique.
 * @param {TestGenerationState} state - The current graph state.
 * @returns {Promise<Partial<TestGenerationState>>} - State updates.
 */
async function refineNode(state) {
    console.log(`[Graph] Node: refineNode (Revision ${state.revision_number})`);
     if (state.error || !state.critique) {
        console.log("[Graph] refineNode: Skipping due to previous error or no critique.");
        return {}; // No changes if there was an error or no critique
    }
    try {
        const refinementInput = {
            subject: state.subject,
            topic: state.topic,
            difficulty: state.difficulty,
            num_questions: state.num_questions.toString(),
            critique: state.critique,
            format_instructions: generateFormatInstructions
        };
        const refinedTest = await refineChain.invoke(refinementInput);
        console.log("[Graph] refineNode: Refinement successful.");
        return { current_test: refinedTest, error: null, revision_number: state.revision_number + 1 };
    } catch (error) {
        console.error("[Graph] refineNode: Error during refinement.", error);
        return { error: `Refinement failed: ${error.message}` };
    }
}


// --- Conditional Edge Logic ---

/**
 * Determines the next step after critique.
 * @param {TestGenerationState} state - The current graph state.
 * @returns {"refineNode" | "__end__"} - The name of the next node or END.
 */
function shouldRefine(state) {
    console.log(`[Graph] Edge: shouldRefine Check (Revision ${state.revision_number})`);
    if (state.error) {
        console.log("Decision: Error occurred, ending.");
        return END; // End if any node failed
    }
    if (state.revision_number > MAX_REVISIONS) {
         console.log(`Decision: Max revisions (${MAX_REVISIONS}) reached, ending.`);
        return END;
    }
    const critiqueText = state.critique;
    if (critiqueText && !critiqueText.trim().toLowerCase().startsWith("тест не требует доработки")) {
        console.log("Decision: Critique suggests refinement needed.");
        return "refineNode";
    } else {
        console.log("Decision: No refinement needed or critique missing/positive, ending.");
        return END;
    }
}

// --- Build the Graph ---

const workflow = new StateGraph({
    channels: {
        subject: { value: null },
        topic: { value: null },
        difficulty: { value: null },
        num_questions: { value: null },
        current_test: { value: null },
        critique: { value: null },
        revision_number: { value: (x, y) => y, default: () => 0 }, // Use last value, default 0
        error: { value: null },
    }
});

// Add nodes
workflow.addNode("generateNode", generateNode);
workflow.addNode("critiqueNode", critiqueNode);
workflow.addNode("refineNode", refineNode);

// Define edges
workflow.addEdge(START, "generateNode");
workflow.addEdge("generateNode", "critiqueNode");
// After refining, go back to critique the refined version
workflow.addEdge("refineNode", "critiqueNode");

// Add conditional edge from critique
workflow.addConditionalEdges(
    "critiqueNode",
    shouldRefine,
    {
        "refineNode": "refineNode",
        [END]: END // Use END from langgraph import
    }
);

// Compile the graph
const app = workflow.compile({checkpointer: new MemorySaver()});

// --- Express Route ---

/**
 * POST /test
 * Route to generate, critique, and potentially refine a diagnostic test using LangGraph.
 * Expects JSON body with: subject, topic, difficulty, numQuestions.
 * @route POST /test
 * @group Tests - Operations related to test generation agents
 * @param {object} req.body.required - Request body.
 * @param {string} req.body.subject.required - The subject area.
 * @param {string} req.body.topic.required - The specific topic.
 * @param {string} req.body.difficulty.required - The desired difficulty level.
 * @param {number} [req.body.numQuestions=5] - The number of questions (defaults to 5).
 * @returns {Test} 200 - The final generated/refined test object.
 * @returns {object} 400 - If required parameters are missing.
 * @returns {object} 500 - If an error occurs during the graph execution.
 */
router.post("/test", async (req, res, next) => {
    try {
        const { subject, topic, difficulty, numQuestions = 5 } = req.body;

        if (!subject || !topic || !difficulty) {
            return res.status(400).json({ error: 'Missing required parameters: subject, topic, difficulty' });
        }

        console.log(`[API] Received request for ${subject} - ${topic} (${difficulty}, ${numQuestions} questions)`);

        /** @type {TestGenerationState} */
        const initialState = {
            subject,
            topic,
            difficulty,
            num_questions: numQuestions,
            current_test: null,
            critique: null,
            revision_number: 0, // Initialized by graph default
            error: null,
        };

        // Invoke the graph
        const checkpointConfig = { configurable: { thread_id: "1" } };
        console.log("[API] Invoking LangGraph workflow...");
        const finalState = await app.invoke(initialState, checkpointConfig);
        console.log("[API] LangGraph workflow finished.");

        // Check for errors during execution
        if (finalState.error) {
            console.error("[API] Error in graph execution:", finalState.error);
            // Prefer the specific error message if available
            return res.status(500).json({ error: `Graph execution failed: ${finalState.error}` });
        }

        // Check if a test was actually generated
        if (!finalState.current_test) {
             console.error("[API] Graph finished without generating a test.");
             return res.status(500).json({ error: 'Graph execution finished, but no test was generated successfully.' });
        }

        // Return the final test
        res.status(200).json(finalState.current_test);

    } catch (error) {
        console.error("[API] Unhandled error in /test route:", error);
        // Pass error to Express error handling middleware
        next(error || new Error('An unexpected error occurred during test generation.'));
    }
});

module.exports = router;

const { Annotation, StateGraph, END, START, MemorySaver } = require("@langchain/langgraph");
const { getLlm } = require("../../getLlm");
const Assignment = require("../../../models/Assignment");
const Submission = require("../../../models/Submission");
const {ReviewSchema} = require("./schemas");
const {PromptTemplate} = require("@langchain/core/prompts");

const AgentState = Annotation.Root({
    assignmentId: Annotation({
        default: () => ""
    }),
    taskIndex: Annotation({
        default: () => 0
    }),
    submission: Annotation({
        default: () => null
    }),
    task: Annotation({
        default: () => null
    }),
    review: Annotation({
        default: () => null
    }),
    feedback: Annotation({
        default: () => null
    }),
});

// --- Node Functions---

const getAssignmentTask = async (state) => {
    console.log(`[Assignment-Grader Agent] Getting Assignment Task for Assignment ID: ${state.assignmentId} and Task Index: ${state.taskIndex}`);
    const { assignmentId, taskIndex } = state;
    if (!assignmentId) {
        throw new Error("Assignment ID is required");
    }
    if (taskIndex < 0) {
        throw new Error("Task index must be a non-negative integer");
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
        throw new Error(`Assignment with ID ${assignmentId} not found`);
    }

    if (taskIndex >= assignment.tasks.length) {
        throw new Error(`Task index ${taskIndex} is out of bounds for assignment with ${assignment.tasks.length} tasks`);
    }

    const task = assignment.tasks[taskIndex];
    console.log(`   Successfully Got Assignment Task for Assignment ID: ${assignmentId} and Task Index: ${taskIndex}`);
    return { task };
}

const reviewSubmission = async (state) => {
    console.log(`[Assignment-Grader Agent] Reviewing Submission for Assignment ID: ${state.assignmentId} and Task Index: ${state.taskIndex}`);
    const { submission, task } = state;
    if (!submission) {
        throw new Error("Submission is required for review");
    }
    if (!task) {
        throw new Error("Task is required for review");
    }

    const model = getLlm({
        model: "openai/gpt-4.1-mini",
        provider: "openai",
        streaming: false
    });

    const prompt = PromptTemplate.fromTemplate(`
Ты — школьный учитель. Проверь и проанализируй решение ученика по указанной задаче, оцени его ответ и предложи конструктивную обратную связь.

Задача:
{task}
Ответ:
{solution}

Решение ученика:
{submission}

Ошибки и недочёты должны быть выявлены с указанием причин, а предложенная подсказка должна помочь ученику улучшить своё решение.
    `);
    const structuredModel = model.withStructuredOutput(ReviewSchema);
    const chain = prompt.pipe(structuredModel);

    const review = await chain.invoke({
        task: task.task,
        solution: task.solution,
        submission: submission
    });

    return { review };
}

const giveFeedback = async (state) => {
    console.log(`[Assignment-Grader Agent] Giving Feedback for Assignment ID: ${state.assignmentId} and Task Index: ${state.taskIndex}`);
    const { review } = state;
    if (!review) {
        throw new Error("Review is required for feedback");
    }

    const model = getLlm({
        model: "openai/gpt-4.1-mini",
        provider: "openai",
        streaming: false
    });

    const prompt = PromptTemplate.fromTemplate(`
Ты – школьный учитель, проверяющий домашние задания учеников. Твоя задача – на основе проверки задания сформулировать понятный и дружелюбный фидбэк для ученика. 
Вот твой отзыв о решении ученика:
{review}

Фидбэк должен быть мотивирующим, поддерживать интерес к учебе и помогать выявить, что сделано правильно, а где допущены ошибки. Обязательно указывай, что выполнено правильно, и мягко обращай внимание на возможные ошибки, предлагая ученику подумать и исправить их самостоятельно.
Используй уважительный и спокойный тон, избегая приветствий и прощаний. Например: «Ты молодец, правильно справился с заданием!», или «Обрати внимание: у тебя небольшая ошибка в раскрытии скобок. Попробуй пересчитать пример еще раз, у тебя точно получится!»
    `);

    const chain = prompt.pipe(model);

    const feedback = await chain.invoke({ review });

    return { feedback: feedback.content };
}

const saveSubmission = async (state, config) => {
    console.log(`[Assignment-Grader Agent] Saving Submission for Assignment ID: ${state.assignmentId} and Task Index: ${state.taskIndex}`);

    if (!config) {
        throw new Error("Config is required to save submission");
    }

    const { userId } = config.configurable;
    if (!userId) {
        throw new Error("User ID is required to save submission");
    }
    const { assignmentId, taskIndex, feedback, review, submission } = state;
    if (!assignmentId || !feedback) {
        throw new Error("Missing required fields to save submission");
    }
    const newSubmission = new Submission({
        assignment_id: assignmentId,
        task_index: taskIndex,
        user_id: userId,
        submission,
        review,
        feedback,
        submitted_at: new Date()
    });

    await newSubmission.save();
    return {};
};

// --- State Graph ---
const graph = new StateGraph(AgentState)
    .addNode("getAssignmentTask", getAssignmentTask)
    .addNode("reviewSubmission", reviewSubmission)
    .addNode("giveFeedback", giveFeedback)
    .addNode("saveSubmission", saveSubmission)
    .addEdge(START, "getAssignmentTask")
    .addEdge("getAssignmentTask", "reviewSubmission")
    .addEdge("reviewSubmission", "giveFeedback")
    .addEdge("giveFeedback", "saveSubmission")
    .addEdge("saveSubmission", END)

const agent = graph.compile();

// --- Export ---
module.exports = {
    agent,
};
const router = require("express").Router();
const Assignment = require("../../../models/Assignment");
const { agent } = require("../../../agents/assignment-grader/v1/index");
const Submission = require("../../../models/Submission");

router.get("/:id", async (req, res) => {
  const { _id: userId } = req.user;
  if (!userId) {
    return res.status(401).json({ error: "User is not authenticated" });
  }

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const assignment = await Assignment.findById(req.params.id).populate({
      path: 'submissions',
      select: 'review.verdict feedback task_index submission submitted_at',
      match: {
        user_id: userId 
      },
      sort: {
        submitted_at: -1
      }
    }).exec();
    res.json(assignment);
  } catch (error) {
    console.error("Error fetching assignment:", error);
    res.status(404).json({ message: "Assignment not found" });
  }
});

router.post("/:id/submit/:taskId", async (req, res) => {
  const { _id: userId } = req.user;
  if (!userId) {
    return res.status(401).json({ error: "User is not authenticated" });
  }
  const { id, taskId } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Assignment ID is required" });
  }

  const { submission } = req.body;

  if (!submission) {
    return res.status(400).json({ error: "Submission is required" });
  }

  if (!taskId) {
    return res.status(400).json({ error: "Task ID is required" });
  }

  try {
    const { feedback, review } = await agent.invoke({
        assignmentId: id,
        taskIndex: taskId,
        submission: submission
    }, {
      configurable: {
        userId,
      }
    });

    res.json({
        message: "Submission processed successfully",
        feedback,
        verdict: review.verdict,
    });
  } catch (error) {
    console.error("Error processing submission:", error);
    res.status(500).json({ error: "Failed to process submission" });
  }
});

module.exports = router;

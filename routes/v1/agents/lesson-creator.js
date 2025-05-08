const router = require('express').Router();
const { MongoClient, ObjectId } = require('mongodb');
const { lessonCreatorAgent } = require('../../../agents/lesson-creator/graph');
const { z } = require('zod');
/**
 * @route POST /api/lesson-creator/createLesson
 * @desc Create a lesson for a given subject and topic
 * @param {string} subject - The subject of the lesson
 * @param {string} topic - The topic of the lesson
 * @param {number} grade - The grade of the lesson
 * @returns {string} The generated lesson id
 */
router.post('/createLesson', async (req, res) => {
    const { subject, topic, grade } = req.body;
    console.log(`[API /lesson-creator/createLesson] Creating lesson for ${subject} - ${topic} - ${grade}`);

    const schema = z.object({
      subject: z.string(),
      topic: z.string(),
      grade: z.number().min(5).max(12),
    });

    const { success } = schema.safeParse({ subject, topic, grade });

    if (!success) {
      return res.status(400).json({ error: 'Invalid data types' });
    }

    let threadId = null;

    try {
      threadId = crypto.randomUUID();
      console.log(`   Thread ID: ${threadId}`);

      const params = {
        subject,
        topic,
        grade,
      }

      const config = {
        configurable: {
          thread_id: threadId,
        },
      }

      console.log(`   Invoking agent with params: ${params} and config: ${config}`);
      const result = await lessonCreatorAgent.invoke(params, config);
      console.log(`   Successfully invoked agent. Result lesson id:`, result.lessonId);

      res.status(200).json({
        lessonId: result.lessonId,
      });
    } catch (error) {
      console.error(`   Error creating lesson:`, error);
      res.status(500).json({ error: 'Failed to create lesson', threadId, details: error.message });
    }
});

/**
 * Resume lesson creation after error
 * @route POST /api/lesson-creator/resumeLesson
 * @desc Resume lesson creation after error
 * @param {string} lessonId - The lesson id
 * @param {string} error - The error message
 * @returns {string} The generated lesson id
 */
router.post('/resumeLesson/:threadId', async (req, res) => {
  const { threadId } = req.params;
  console.log(`[API /lesson-creator/resumeLesson] Resuming lesson creation for thread id: ${threadId}`);

  try {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    }

    const result = await lessonCreatorAgent.invoke(null, config);
    console.log(`   Successfully resumed lesson creation. Result lesson id:`, result.lessonId);

    res.status(200).json({
      lessonId: result.lessonId,
    });
  } catch (error) {
    console.error(`   Error RESUMING lesson (threadId: ${threadId}):`, error);
    if (error.message.includes('No checkpoint found')) {
      res.status(404).json({ error: 'No checkpoint found for the given thread id', threadId, details: error.message });
    } else {
      res.status(500).json({ error: 'Failed to resume lesson', threadId, details: error.message });
    }
  }
});

module.exports = router;
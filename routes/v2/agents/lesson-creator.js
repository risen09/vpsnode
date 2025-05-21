const router = require('express').Router();
const { lessonCreatorAgent } = require('../../../agents/lesson-creator/v2/index');
const { z } = require('zod');

/**
 * @route POST /createLesson-stream
 * @desc Create a lesson for a given subject and topic
 * @param {string} subject - The subject of the lesson
 * @param {string} topic - The topic of the lesson
 * @param {string} sub_topic - The sub topic of the lesson
 * @param {number} grade - The grade of the lesson
 * @returns {string} The generated lesson id
 */
router.post('/createLesson-stream', async (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Recommended for Nginx/Apache proxies

    // Optional: Send an initial comment to keep connection open
    res.write(': Connected\n\n');

    // Handle client disconnection
    req.on('close', () => {
      console.log('Client disconnected');
      // You might need logic here to signal the graph execution to stop if possible
      res.end();
      return;
    });

    console.log('Starting graph execution stream...');

    const { subject, topic, sub_topic, grade } = req.body;
    console.log(`[API /lesson-creator/createLesson] Creating lesson for ${subject} - ${topic} - ${sub_topic} - ${grade}`);

    const schema = z.object({
      subject: z.string(),
      topic: z.string(),
      sub_topic: z.string(),
      grade: z.number().min(5).max(12),
    });

    const { success } = schema.safeParse({ subject, topic, sub_topic, grade });

    if (!success) {
      res.write(`data: ${JSON.stringify({ error: 'Invalid data types' })}\n\n`);
      res.end();
      return;
    }

    let threadId = null;

    try {
      threadId = crypto.randomUUID();
      console.log(`   Thread ID: ${threadId}`);

      const params = {
        subject,
        topic,
        sub_topic,
        grade,
      }

      const config = {
        configurable: {
          thread_id: threadId,
        },
        streamMode: ['messages', 'updates'],
      }

      console.log(`   Invoking agent with params: ${params} and config: ${config}`);
      const stream = await lessonCreatorAgent.stream(params, config);
      for await (const [streamMode, chunk] of stream) {
        console.log(`   ${streamMode}: ${JSON.stringify(chunk)}`);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write(': End of stream\n\n');
      res.end();
      return;
    } catch (error) {
      console.error(`   Error creating lesson:`, error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
      return;
    }
});


/**
 * @route POST /api/lesson-creator/createLesson
 * @desc Create a lesson for a given subject and topic
 * @param {string} subject - The subject of the lesson
 * @param {string} topic - The topic of the lesson
 * @param {string} sub_topic - The sub topic of the lesson
 * @param {number} grade - The grade of the lesson
 * @returns {string} The generated lesson id
 */
router.post('/createLesson', async (req, res) => {
    const { subject, topic, sub_topic, grade } = req.body;
    console.log(`[API /lesson-creator/createLesson] Creating lesson for ${subject} - ${topic} - ${sub_topic} - ${grade}`);

    const schema = z.object({
      subject: z.string(),
      topic: z.string(),
      sub_topic: z.string(),
      grade: z.number().min(5).max(12),
    });

    const { success } = schema.safeParse({ subject, topic, sub_topic, grade });

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
        sub_topic,
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
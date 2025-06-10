const router = require('express').Router();
const { lessonCreatorAgent } = require('../../../agents/lesson-creator/v2/index');
const { z } = require('zod');
const Lesson = require('../../../models/Lesson');

/**
 * @route POST /createLesson-stream
 * @desc Create a lesson for a given subject and topic
 * @param {string} subject - The subject of the lesson
 * @param {string} topic - The topic of the lesson
 * @param {string} sub_topic - The sub topic of the lesson
 * @param {number} grade - The grade of the lesson
 * @returns {string} The generated lesson id
 */
router.get('/:lessonId', async (req, res) => {
    const { lessonId } = req.params;
    console.log(`[API /lesson-creator/createLesson] Received request for lesson with ID: ${lessonId}`);

    if (!lessonId) {
      return res.status(400).send('Missing lessonId');
    }

    const lesson = await Lesson.findById(lessonId);
    
    if (!lesson) {
      return res.status(404).send('Lesson not found');
    }

    const { subject, topic, sub_topic, grade } = lesson;

    console.log(`  Creating lesson for ${subject} - ${topic} - ${sub_topic} - ${grade}`);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    // res.setHeader('Connection', 'keep-alive');

    const schema = z.object({
      subject: z.string(),
      topic: z.string(),
      sub_topic: z.string(),
      grade: z.number().min(5).max(11),
    });

    const { success } = schema.safeParse({ subject, topic, sub_topic, grade });

    if (!success) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid data types' })}\n\n`);
      res.end();
      return;
    }

    console.log('  Starting graph execution stream...');

    const controller = new AbortController();
    let threadId = null;

    try {
      threadId = crypto.randomUUID();
      console.log(`   Thread ID: ${threadId}`);

      const params = {
        lessonId,
        subject,
        topic,
        sub_topic,
        grade,
      }

      res.write(`event:metadata\ndata: ${JSON.stringify(params)}\n\n`);

      const config = {
        configurable: {
          thread_id: threadId,
        },
        streamMode: ['custom', 'messages'],
        signal: controller.signal,
      }

      console.log(`   Invoking agent with params: ${JSON.stringify(params)} and config: ${JSON.stringify(config)}`);
      const stream = await lessonCreatorAgent.stream(params, config);
      for await (const [type, chunk] of stream) {
        if (type === 'messages') {
          res.write(`data: ${JSON.stringify({ chunk: chunk[0].content })}\n\n`);
        } else if (type === 'custom') {
          console.log(`   Received custom event:`, chunk);
          res.write(`event:metadata\ndata: ${JSON.stringify({...params, ...chunk})}\n\n`);
        }
      }
      req.on('close', () => {
        console.log(`   Closing connection`);
        controller.abort();
      });
    } catch (error) {
      console.error(`   Error creating lesson:`, error);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      console.log(`   Closing connection`);
      res.end();
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
router.post('/resume/:threadId', async (req, res) => {
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
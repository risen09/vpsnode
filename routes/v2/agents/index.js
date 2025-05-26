const router = require('express').Router();

router.use('/createLesson', require('./lesson-creator'));

module.exports = router;
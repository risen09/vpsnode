const router = require('express').Router();

router.use('/lesson-creator', require('./lesson-creator'));

module.exports = router;
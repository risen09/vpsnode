const { z } = require("zod");

const RegistrationSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  gender: z.number().int().min(0).max(1),
  age: z.number().int().min(7).max(18),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

module.exports = { RegistrationSchema, LoginSchema }
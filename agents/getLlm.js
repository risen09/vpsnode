const { GigaChat, GigaChatEmbeddings } = require("langchain-gigachat");
const { ChatOllama } = require("@langchain/ollama");
const { ChatDeepSeek } = require('@langchain/deepseek');
const https = require("https");
const { ChatOpenAI } = require("@langchain/openai");

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

const llm = new GigaChat({
    model: 'GigaChat-2-Max',
    temperature: 0.2,
    scope: 'GIGACHAT_API_PERS',
    streaming: true,
    credentials: process.env.GIGACHAT_CREDENTIALS,
    httpsAgent,
});

const openaiEndpoint = "https://models.github.ai/inference"
const token = process.env["GITHUB_TOKEN"]
process.env["OPENAI_API_KEY"] = token

const openaiLlm = new ChatOpenAI({
    model: "openai/gpt-4.1",
    temperature: 0,
    streaming: true,
    configuration: {
        baseURL: openaiEndpoint,
    }
});

openaiLlm.defaultModel = "openai/gpt-4.1"

const ollamaLlm = new ChatOllama({
    model: "qwen2.5:3b-instruct-q4_K_S",
    temperature: 0,
    maxRetries: 2,
});

ollamaLlm.defaultModel = 'qwen2.5:3b-instruct-q4_K_S'

const llmProviders = {
    openai: openaiLlm,
    gigachat: llm,
    ollama: ollamaLlm
}

const getLlm = ({
    model = 'GigaChat-2-Max',
    streaming = true,
    provider = 'gigachat'
}) => {
    const llm = llmProviders[provider]
    llm.model = model;
    llm.streaming = streaming;

    return llm;
}

const embeddings = new GigaChatEmbeddings({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    httpsAgent,
})

module.exports = {
    embeddings,
    getLlm,
}
const { DirectoryLoader } = require("langchain/document_loaders/fs/directory");
const { PDFLoader } = require('@langchain/community/document_loaders/fs/pdf')
const { Chroma } = require("@langchain/community/vectorstores/chroma");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GigaChatEmbeddings } = require("langchain-gigachat");
const https = require("https");

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

const main = async () => {
  const directoryLoader = new DirectoryLoader('../assets/documents/algebra', {
    ".pdf": (filePath) => new PDFLoader(filePath, { splitPages: false })
  })
  const docs = await directoryLoader.load();

  console.log(`[VectorStore] Found ${docs.length} documents`);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const chunks = await splitter.splitDocuments(docs);
  console.log(`[VectorStore] Split ${docs.length} documents into ${chunks.length} chunks`)

  const cleanedChunks = chunks.map(chunk => ({
    ...chunk,
    metadata: {
      source: chunk.metadata.source,
      loc_lines_from: chunk.metadata.loc?.lines?.from,
      loc_lines_to: chunk.metadata.loc?.lines?.to,
    }
  }));

  const embeddings = new GigaChatEmbeddings({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    httpsAgent,
  })

  await Chroma.fromDocuments(cleanedChunks, embeddings, {
    collectionName: "textbooks",
    url: "http://localhost:8000", // Make sure this points to your ChromaDB instance
  });

  console.log(`[VectorStore] Added ${cleanedChunks.length} documents to vector store`)

}

main();
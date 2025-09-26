import { getRagChunks, getRagEmbeddings, cosineSimilarity } from "@/lib/rag-store"
import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

export const maxDuration = 30

async function search(queryVec: number[], ragEmbeddings: any[], ragChunks: any[], topK = 5) {
  const scored = ragEmbeddings.map((e) => ({ id: e.id, score: cosineSimilarity(queryVec, e.vector) }))
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, topK)
  return top.map((t) => ragChunks.find((c) => c.id === t.id)!)
}

function pseudoEmbed(text: string, dim = 128): number[] {
  // Improved pseudo-embedding with word-based features (same as upload route)
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  
  // Word frequency features
  const wordFreq: { [key: string]: number } = {}
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  })
  
  // Create features based on word patterns and character distributions
  let featureIndex = 0
  
  // Character-based features (original method)
  for (let i = 0; i < text.length && featureIndex < dim; i++) {
    vec[featureIndex % dim] += text.charCodeAt(i) % 31
    featureIndex++
  }
  
  // Word-based features
  Object.entries(wordFreq).forEach(([word, freq]) => {
    if (featureIndex < dim) {
      // Hash word to feature index
      let hash = 0
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff
      }
      vec[Math.abs(hash) % dim] += freq * 10 // Weight word frequency higher
    }
  })
  
  // Text length and structure features
  if (featureIndex < dim) {
    vec[featureIndex % dim] = text.length / 1000 // Normalize text length
  }
  if (featureIndex + 1 < dim) {
    vec[(featureIndex + 1) % dim] = words.length / 100 // Normalize word count
  }
  
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json()
    if (!query) return Response.json({ error: "query required" }, { status: 400 })
    
    const ragChunks = await getRagChunks()
    const ragEmbeddings = await getRagEmbeddings()
    
    if (ragEmbeddings.length === 0) return Response.json({ error: "index empty" }, { status: 400 })

    console.log(`RAG query received: "${query}"`)
    console.log(`Available chunks: ${ragChunks.length}, embeddings: ${ragEmbeddings.length}`)

    const qv = pseudoEmbed(String(query))
    const top = await search(qv, ragEmbeddings, ragChunks, 5)
    console.log(`Found ${top.length} relevant chunks`)
    
    const context = top.map((c, i) => `Chunk ${i + 1}: ${c.text}`).join("\n\n")
    console.log(`Context length: ${context.length} characters`)

    const prompt = `You are a helpful assistant that answers questions based on the provided document context. 

IMPORTANT INSTRUCTIONS:
- Use ONLY the information provided in the context below to answer the question
- If the context doesn't contain enough information to answer the question, say "I don't have enough information in the document to answer this question"
- Be specific and cite relevant parts of the document when possible
- If the question is about the document type or content, analyze what you can see in the context

CONTEXT FROM DOCUMENT:
${context}

QUESTION: ${query}

ANSWER:`
    
    const { text } = await generateText({ 
      model: openai("gpt-4o-mini"), 
      prompt,
      temperature: 0.1 // Lower temperature for more consistent, factual responses
    })
    return Response.json({ text, topK: top.length })
  } catch (e: any) {
    return Response.json({ error: e?.message || "query failed" }, { status: 500 })
  }
}



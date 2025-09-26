import { getRagChunks, getRagEmbeddings, cosineSimilarity } from "@/lib/rag-store"
import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

export const maxDuration = 30

async function search(queryVec: number[], ragEmbeddings: any[], ragChunks: any[], queryText: string, topK = 5) {
  // First try semantic search
  const scored = ragEmbeddings.map((e) => ({ id: e.id, score: cosineSimilarity(queryVec, e.vector) }))
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, topK)
  const semanticResults = top.map((t) => ragChunks.find((c) => c.id === t.id)!)
  
  // If semantic search doesn't find good results, try keyword search
  if (semanticResults.length === 0 || semanticResults.every(chunk => !chunk.text.trim())) {
    console.log('Semantic search failed, trying keyword search')
    const queryWords = String(queryText).toLowerCase().split(/\s+/).filter(w => w.length > 2)
    
    const keywordScored = ragChunks.map(chunk => {
      const chunkText = chunk.text.toLowerCase()
      const matches = queryWords.filter(word => chunkText.includes(word)).length
      return { chunk, score: matches }
    })
    
    keywordScored.sort((a, b) => b.score - a.score)
    return keywordScored.slice(0, topK).map(item => item.chunk)
  }
  
  return semanticResults
}

function pseudoEmbed(text: string, dim = 128): number[] {
  // Much improved pseudo-embedding with better semantic features (same as upload route)
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(w => w.length > 2) // Only words longer than 2 chars
  
  // Word frequency features
  const wordFreq: { [key: string]: number } = {}
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  })
  
  // Common words to weight higher (resume/CV related)
  const importantWords = [
    'experience', 'education', 'skills', 'work', 'job', 'company', 'university', 'degree',
    'project', 'development', 'software', 'engineer', 'developer', 'manager', 'analyst',
    'resume', 'cv', 'curriculum', 'vitae', 'professional', 'career', 'position', 'role',
    'responsibilities', 'achievements', 'certifications', 'languages', 'technical'
  ]
  
  let featureIndex = 0
  
  // Word-based features with better hashing
  Object.entries(wordFreq).forEach(([word, freq]) => {
    if (featureIndex < dim) {
      // Better hash function
      let hash = 0
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff
      }
      
      // Weight important words higher
      const weight = importantWords.includes(word) ? 20 : 5
      vec[Math.abs(hash) % dim] += freq * weight
    }
  })
  
  // N-gram features (bigrams)
  for (let i = 0; i < words.length - 1 && featureIndex < dim; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`
    let hash = 0
    for (let j = 0; j < bigram.length; j++) {
      hash = ((hash << 5) - hash + bigram.charCodeAt(j)) & 0xffffffff
    }
    vec[Math.abs(hash) % dim] += 3
  }
  
  // Character n-gram features
  const charNgrams = []
  for (let i = 0; i < text.length - 2; i++) {
    charNgrams.push(text.slice(i, i + 3).toLowerCase())
  }
  
  const charFreq: { [key: string]: number } = {}
  charNgrams.forEach(ngram => {
    charFreq[ngram] = (charFreq[ngram] || 0) + 1
  })
  
  Object.entries(charFreq).forEach(([ngram, freq]) => {
    if (featureIndex < dim) {
      let hash = 0
      for (let i = 0; i < ngram.length; i++) {
        hash = ((hash << 5) - hash + ngram.charCodeAt(i)) & 0xffffffff
      }
      vec[Math.abs(hash) % dim] += freq
    }
  })
  
  // Text structure features
  if (featureIndex < dim) {
    vec[featureIndex % dim] = text.length / 1000 // Normalize text length
  }
  if (featureIndex + 1 < dim) {
    vec[(featureIndex + 1) % dim] = words.length / 100 // Normalize word count
  }
  if (featureIndex + 2 < dim) {
    vec[(featureIndex + 2) % dim] = Object.keys(wordFreq).length / 50 // Unique words
  }
  
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json()
    if (!query) return Response.json({ error: "query required" }, { status: 400 })
    
    console.log(`RAG query received: "${query}"`)
    
    const ragChunks = await getRagChunks()
    const ragEmbeddings = await getRagEmbeddings()
    
    console.log(`RAG store status: ${ragChunks.length} chunks, ${ragEmbeddings.length} embeddings`)
    console.log(`Global store exists: ${!!global.__ragStore}`)
    if (global.__ragStore) {
      console.log(`Global store timestamp: ${global.__ragStore.timestamp}`)
      console.log(`Global store age: ${Date.now() - global.__ragStore.timestamp}ms`)
    }
    
    if (ragEmbeddings.length === 0) {
      console.log("ERROR: No embeddings found in RAG store")
      return Response.json({ error: "index empty" }, { status: 400 })
    }

    console.log(`Available chunks: ${ragChunks.length}, embeddings: ${ragEmbeddings.length}`)

    const qv = pseudoEmbed(String(query))
    const top = await search(qv, ragEmbeddings, ragChunks, String(query), 5)
    console.log(`Found ${top.length} relevant chunks`)
    
    // If no good matches found, use first few chunks as fallback
    let context: string
    if (top.length === 0 || top.every(chunk => !chunk.text.trim())) {
      console.log('No relevant chunks found, using fallback chunks')
      context = ragChunks.slice(0, 3).map((c, i) => `Chunk ${i + 1}: ${c.text}`).join("\n\n")
    } else {
      context = top.map((c, i) => `Chunk ${i + 1}: ${c.text}`).join("\n\n")
    }
    
    console.log(`Context length: ${context.length} characters`)
    console.log(`Context preview: ${context.substring(0, 500)}...`)
    console.log(`Top chunks found:`, top.map(c => ({ id: c.id, textPreview: c.text.substring(0, 100) })))

    const prompt = `You are a helpful assistant that analyzes documents and answers questions about them. 

CONTEXT FROM DOCUMENT:
${context}

QUESTION: ${query}

INSTRUCTIONS:
- Analyze the provided context carefully
- If the question asks about the document type, content, or general information, provide a helpful analysis based on what you can see
- If the context contains relevant information, use it to answer the question
- If the question is about the document itself (like "what is this document"), analyze the content and provide insights
- Be helpful and informative rather than restrictive

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



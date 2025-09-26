/**
 * @fileoverview Persistent RAG store for chunks and embeddings using global cache.
 */

export type RagChunk = {
  id: string
  text: string
}

export type RagEmbedding = {
  id: string
  vector: number[]
}

export type RagStore = {
  chunks: RagChunk[]
  embeddings: RagEmbedding[]
  timestamp: number
}

// Global cache that persists across requests in the same process
declare global {
  var __ragStore: RagStore | undefined
}

// Initialize global store if it doesn't exist
if (!global.__ragStore) {
  global.__ragStore = {
    chunks: [],
    embeddings: [],
    timestamp: 0
  }
}

function getRagStore(): RagStore {
  return global.__ragStore!
}

function setRagStore(store: RagStore): void {
  global.__ragStore = store
}

export async function getRagChunks(): Promise<RagChunk[]> {
  const store = getRagStore()
  
  // Check if store is not too old (24 hours)
  const now = Date.now()
  if (now - store.timestamp > 24 * 60 * 60 * 1000) {
    console.log('RAG store expired, clearing...')
    setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
    return []
  }
  
  console.log(`Loaded RAG store: ${store.chunks.length} chunks, ${store.embeddings.length} embeddings`)
  return store.chunks
}

export async function getRagEmbeddings(): Promise<RagEmbedding[]> {
  const store = getRagStore()
  
  // Check if store is not too old (24 hours)
  const now = Date.now()
  if (now - store.timestamp > 24 * 60 * 60 * 1000) {
    console.log('RAG store expired, clearing...')
    setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
    return []
  }
  
  return store.embeddings
}

export async function setRagData(chunks: RagChunk[], embeddings: RagEmbedding[]): Promise<void> {
  const store: RagStore = {
    chunks,
    embeddings,
    timestamp: Date.now()
  }
  setRagStore(store)
  console.log(`Saved RAG store: ${chunks.length} chunks, ${embeddings.length} embeddings`)
}

export async function clearRagStore(): Promise<void> {
  setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
  console.log('RAG store cleared')
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}



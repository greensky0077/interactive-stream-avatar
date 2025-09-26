/**
 * @fileoverview Persistent RAG store for chunks and embeddings using global cache and file backup.
 */

import { saveRagCache, loadRagCache, clearRagCache } from './rag-cache'

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

// Fallback in-memory store for when global doesn't work
let fallbackStore: RagStore = {
  chunks: [],
  embeddings: [],
  timestamp: 0
}

// Initialize global store if it doesn't exist
if (!global.__ragStore) {
  global.__ragStore = {
    chunks: [],
    embeddings: [],
    timestamp: 0
  }
}

async function getRagStore(): Promise<RagStore> {
  // Try global store first
  if (global.__ragStore && global.__ragStore.timestamp > 0) {
    console.log('Using global RAG store')
    return global.__ragStore
  }
  
  // Try fallback store
  if (fallbackStore.timestamp > 0) {
    console.log('Using fallback RAG store')
    return fallbackStore
  }
  
  // Try file cache as last resort
  const fileStore = await loadRagCache()
  if (fileStore) {
    console.log('Using file RAG cache')
    // Update both stores with file data
    global.__ragStore = fileStore
    fallbackStore = fileStore
    return fileStore
  }
  
  console.log('No RAG store found, using empty fallback')
  return fallbackStore
}

async function setRagStore(store: RagStore): Promise<void> {
  // Set both global and fallback stores
  global.__ragStore = store
  fallbackStore = store
  
  // Also save to file cache as backup
  await saveRagCache(store)
}

export async function getRagChunks(): Promise<RagChunk[]> {
  const store = await getRagStore()
  const isGlobalStore = store === global.__ragStore
  
  console.log(`RAG store source: ${isGlobalStore ? 'global' : 'fallback'}`)
  console.log(`Global store exists: ${!!global.__ragStore}`)
  console.log(`Global store timestamp: ${global.__ragStore?.timestamp || 0}`)
  console.log(`Fallback store timestamp: ${fallbackStore.timestamp}`)
  
  // Check if store is not too old (24 hours)
  const now = Date.now()
  if (now - store.timestamp > 24 * 60 * 60 * 1000) {
    console.log('RAG store expired, clearing...')
    await setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
    return []
  }
  
  console.log(`Loaded RAG store: ${store.chunks.length} chunks, ${store.embeddings.length} embeddings`)
  return store.chunks
}

export async function getRagEmbeddings(): Promise<RagEmbedding[]> {
  const store = await getRagStore()
  const isGlobalStore = store === global.__ragStore
  
  console.log(`RAG embeddings source: ${isGlobalStore ? 'global' : 'fallback'}`)
  console.log(`Embeddings count: ${store.embeddings.length}`)
  
  // Check if store is not too old (24 hours)
  const now = Date.now()
  if (now - store.timestamp > 24 * 60 * 60 * 1000) {
    console.log('RAG store expired, clearing...')
    await setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
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
  await setRagStore(store)
  console.log(`Saved RAG store: ${chunks.length} chunks, ${embeddings.length} embeddings`)
}

export async function clearRagStore(): Promise<void> {
  await setRagStore({ chunks: [], embeddings: [], timestamp: 0 })
  await clearRagCache()
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



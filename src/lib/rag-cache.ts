/**
 * @fileoverview Simple file-based cache for RAG data as backup to in-memory store
 */

import { RagChunk, RagEmbedding, RagStore } from './rag-store'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const CACHE_DIR = '/tmp/rag-cache'
const CACHE_FILE = join(CACHE_DIR, 'rag-store.json')

export async function saveRagCache(store: RagStore): Promise<void> {
  try {
    // Ensure cache directory exists
    if (!existsSync(CACHE_DIR)) {
      await mkdir(CACHE_DIR, { recursive: true })
    }
    
    // Write to file
    await writeFile(CACHE_FILE, JSON.stringify(store, null, 2))
    console.log(`RAG cache saved to file: ${CACHE_FILE}`)
  } catch (error) {
    console.error('Failed to save RAG cache to file:', error)
    // Don't throw - this is a backup mechanism
  }
}

export async function loadRagCache(): Promise<RagStore | null> {
  try {
    if (!existsSync(CACHE_FILE)) {
      console.log('No RAG cache file found')
      return null
    }
    
    const data = await readFile(CACHE_FILE, 'utf-8')
    const store = JSON.parse(data) as RagStore
    
    // Check if cache is not too old (24 hours)
    const now = Date.now()
    if (now - store.timestamp > 24 * 60 * 60 * 1000) {
      console.log('RAG cache file expired')
      return null
    }
    
    console.log(`RAG cache loaded from file: ${store.chunks.length} chunks, ${store.embeddings.length} embeddings`)
    return store
  } catch (error) {
    console.error('Failed to load RAG cache from file:', error)
    return null
  }
}

export async function clearRagCache(): Promise<void> {
  try {
    if (existsSync(CACHE_FILE)) {
      await writeFile(CACHE_FILE, '')
      console.log('RAG cache file cleared')
    }
  } catch (error) {
    console.error('Failed to clear RAG cache file:', error)
  }
}

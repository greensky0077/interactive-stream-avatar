/**
 * @fileoverview Simple in-memory cache for RAG data that persists better in serverless
 */

import { RagChunk, RagEmbedding, RagStore } from './rag-store'

class RagMemoryCache {
  private static instance: RagMemoryCache
  private store: RagStore = {
    chunks: [],
    embeddings: [],
    timestamp: 0
  }

  private constructor() {}

  public static getInstance(): RagMemoryCache {
    if (!RagMemoryCache.instance) {
      RagMemoryCache.instance = new RagMemoryCache()
    }
    return RagMemoryCache.instance
  }

  public setData(chunks: RagChunk[], embeddings: RagEmbedding[]): void {
    this.store = {
      chunks,
      embeddings,
      timestamp: Date.now()
    }
    console.log(`RAG memory cache updated: ${chunks.length} chunks, ${embeddings.length} embeddings`)
  }

  public getChunks(): RagChunk[] {
    console.log(`RAG memory cache chunks: ${this.store.chunks.length}`)
    return this.store.chunks
  }

  public getEmbeddings(): RagEmbedding[] {
    console.log(`RAG memory cache embeddings: ${this.store.embeddings.length}`)
    return this.store.embeddings
  }

  public clear(): void {
    this.store = {
      chunks: [],
      embeddings: [],
      timestamp: 0
    }
    console.log('RAG memory cache cleared')
  }

  public hasData(): boolean {
    return this.store.chunks.length > 0 && this.store.embeddings.length > 0
  }

  public getTimestamp(): number {
    return this.store.timestamp
  }
}

export const ragMemoryCache = RagMemoryCache.getInstance()

/**
 * @fileoverview In-memory RAG store for chunks and embeddings.
 */

export type RagChunk = {
  id: string
  text: string
}

export type RagEmbedding = {
  id: string
  vector: number[]
}

export const ragChunks: RagChunk[] = []
export const ragEmbeddings: RagEmbedding[] = []

export function clearRagStore(): void {
  ragChunks.length = 0
  ragEmbeddings.length = 0
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



import { getRagChunks, getRagEmbeddings } from "@/lib/rag-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const chunks = await getRagChunks()
    const embeddings = await getRagEmbeddings()
    
    return Response.json({
      chunks: chunks.length,
      embeddings: embeddings.length,
      hasData: chunks.length > 0 && embeddings.length > 0,
      sampleChunk: chunks.length > 0 ? chunks[0] : null
    })
  } catch (error: any) {
    return Response.json({ 
      error: error?.message || "Failed to get RAG status" 
    }, { status: 500 })
  }
}

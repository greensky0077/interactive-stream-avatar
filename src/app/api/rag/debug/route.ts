import { getRagChunks, getRagEmbeddings } from "@/lib/rag-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const chunks = await getRagChunks()
    const embeddings = await getRagEmbeddings()
    
    return Response.json({
      totalChunks: chunks.length,
      totalEmbeddings: embeddings.length,
      chunks: chunks.map(c => ({
        id: c.id,
        textLength: c.text.length,
        textPreview: c.text.substring(0, 200),
        firstWords: c.text.split(' ').slice(0, 10).join(' ')
      })),
      embeddings: embeddings.map(e => ({
        id: e.id,
        vectorLength: e.vector.length,
        vectorPreview: e.vector.slice(0, 5)
      }))
    })
  } catch (error: any) {
    return Response.json({ 
      error: error?.message || "Failed to get debug info" 
    }, { status: 500 })
  }
}

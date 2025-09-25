import { ragChunks, ragEmbeddings, cosineSimilarity } from "@/lib/rag-store"
import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

export const maxDuration = 30

function search(queryVec: number[], topK = 5) {
  const scored = ragEmbeddings.map((e) => ({ id: e.id, score: cosineSimilarity(queryVec, e.vector) }))
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, topK)
  return top.map((t) => ragChunks.find((c) => c.id === t.id)!)
}

function pseudoEmbed(text: string, dim = 128): number[] {
  const vec = new Array(dim).fill(0)
  for (let i = 0; i < text.length; i++) vec[i % dim] += text.charCodeAt(i) % 31
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json()
    if (!query) return Response.json({ error: "query required" }, { status: 400 })
    if (ragEmbeddings.length === 0) return Response.json({ error: "index empty" }, { status: 400 })

    const qv = pseudoEmbed(String(query))
    const top = search(qv, 5)
    const context = top.map((c, i) => `Chunk ${i + 1}: ${c.text}`).join("\n\n")

    const prompt = `You are a helpful assistant. Use ONLY the following context to answer.\n\n${context}\n\nQuestion: ${query}\nAnswer:`
    const { text } = await generateText({ model: openai("gpt-4o-mini"), prompt })
    return Response.json({ text, topK: top.length })
  } catch (e: any) {
    return Response.json({ error: e?.message || "query failed" }, { status: 500 })
  }
}



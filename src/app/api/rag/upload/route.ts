export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { clearRagStore, ragChunks, ragEmbeddings } from "@/lib/rag-store"

export const maxDuration = 30

function simpleChunk(text: string, maxLen = 800): string[] {
  const parts: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length)
    parts.push(text.slice(start, end))
    start = end
  }
  return parts
}

function pseudoEmbed(text: string, dim = 128): number[] {
  // Simple deterministic embedding: char code buckets
  const vec = new Array(dim).fill(0)
  for (let i = 0; i < text.length; i++) vec[i % dim] += text.charCodeAt(i) % 31
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

export async function POST(req: Request) {
  try {
    const { default: pdf } = await import("pdf-parse")
    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return Response.json({ error: "No file" }, { status: 400 })
    const arr = new Uint8Array(await file.arrayBuffer())
    const parsed = await pdf(arr)
    const rawText = (parsed.text || "").replace(/[\u0000-\u001F\u007F]+/g, " ").trim()
    if (!rawText) return Response.json({ error: "Empty PDF text" }, { status: 400 })

    clearRagStore()
    const chunks = simpleChunk(rawText)
    chunks.forEach((t, i) => ragChunks.push({ id: `c${i}`, text: t }))
    ragEmbeddings.push(
      ...ragChunks.map((c) => ({ id: c.id, vector: pseudoEmbed(c.text) }))
    )

    return Response.json({ ok: true, chunks: ragChunks.length })
  } catch (e: any) {
    return Response.json({ error: e?.message || "upload failed" }, { status: 500 })
  }
}



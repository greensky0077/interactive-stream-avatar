"use client"

import { useState } from "react"
import { Button } from "../ui/button"
import { Label } from "../ui/label"

export function RagPanel() {
  const [uploading, setUploading] = useState(false)
  const [chunks, setChunks] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState("")

  async function handleUpload(file: File) {
    setUploading(true)
    setError("")
    setAnswer("")
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/rag/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "upload failed")
      setChunks(data.chunks)
    } catch (e: any) {
      setError(e?.message || "upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleAsk() {
    setError("")
    setAnswer("")
    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "query failed")
      setAnswer(data.text)
    } catch (e: any) {
      setError(e?.message || "query failed")
    }
  }

  return (
    <fieldset className="grid gap-3 rounded-lg border p-4">
      <legend className="-ml-1 px-1 text-sm font-medium">PDF RAG</legend>
      <div className="grid gap-2">
        <Label htmlFor="pdf">Upload PDF</Label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
          }}
        />
        {uploading && <p className="text-xs text-muted-foreground">Processing…</p>}
        {typeof chunks === "number" && (
          <p className="text-xs">Indexed chunks: {chunks}</p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="q">Ask</Label>
        <input
          id="q"
          className="rounded-md border px-2 py-1"
          placeholder="Ask about the PDF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="button" onClick={handleAsk} disabled={!query}>
          Ask
        </Button>
      </div>
      {answer && (
        <div className="rounded-md border p-2 text-sm whitespace-pre-wrap">{answer}</div>
      )}
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</div>
      )}
    </fieldset>
  )
}



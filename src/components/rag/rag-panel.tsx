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
    setChunks(null)
    
    try {
      // Validate file before upload
      if (file.type !== "application/pdf") {
        throw new Error(`Invalid file type. Please select a PDF file. (Selected: ${file.type})`)
      }
      
      if (file.size > 10 * 1024 * 1024) {
        throw new Error("File too large. Maximum size is 10MB.")
      }
      
      console.log(`Uploading file: ${file.name} (${file.size} bytes)`)
      
      const form = new FormData()
      form.append("file", file)
      
      const res = await fetch("/api/rag/upload", { 
        method: "POST", 
        body: form 
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        console.error("Upload failed:", data)
        throw new Error(data?.error || `Upload failed (${res.status})`)
      }
      
      console.log("Upload successful:", data)
      setChunks(data.chunks)
      
    } catch (e: any) {
      console.error("Upload error:", e)
      setError(e?.message || "Upload failed")
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
          disabled={uploading}
        />
        {uploading && (
          <div className="text-xs text-muted-foreground">
            <p>Processing PDF...</p>
            <p>Please wait while we extract and index the content.</p>
          </div>
        )}
        {typeof chunks === "number" && (
          <div className="text-xs text-green-600">
            <p>✅ PDF uploaded successfully!</p>
            <p>Indexed {chunks} text chunks</p>
          </div>
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



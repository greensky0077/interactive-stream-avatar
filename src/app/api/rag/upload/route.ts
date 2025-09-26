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
    console.log("RAG upload request received")
    
    const form = await req.formData()
    console.log("Form data parsed successfully")
    
    const file = form.get("file") as File | null
    if (!file) {
      console.log("No file found in form data")
      return Response.json({ error: "No file provided" }, { status: 400 })
    }
    
    console.log(`File received: ${file.name}, size: ${file.size} bytes, type: ${file.type}`)
    
    // Validate file type
    if (file.type !== "application/pdf") {
      console.log(`Invalid file type: ${file.type}`)
      return Response.json({ 
        error: `Invalid file type. Expected PDF, got ${file.type}` 
      }, { status: 400 })
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      console.log(`File too large: ${file.size} bytes`)
      return Response.json({ 
        error: "File too large. Maximum size is 10MB" 
      }, { status: 400 })
    }
    
    const arr = new Uint8Array(await file.arrayBuffer())
    console.log(`File converted to buffer: ${arr.length} bytes`)
    
    // Try multiple PDF parsing approaches
    let parsed: any
    let parsingMethod = ""
    
    // Method 1: Try pdf-parse with buffer
    try {
      const pdfModule = await import("pdf-parse")
      const pdfParse = pdfModule.default
      console.log("PDF parser imported successfully")
      
      // Create a clean buffer without any file system references
      const cleanBuffer = Buffer.from(arr)
      parsed = await pdfParse(cleanBuffer)
      parsingMethod = "pdf-parse"
      console.log("PDF parsed successfully with pdf-parse")
    } catch (parseError: any) {
      console.error("pdf-parse failed:", parseError)
      
      // Method 2: Try pdfjs-dist as fallback
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")
        console.log("PDF.js imported successfully")
        
        // Load the PDF document
        const loadingTask = pdfjsLib.getDocument({ data: arr })
        const pdfDoc = await loadingTask.promise
        console.log(`PDF loaded: ${pdfDoc.numPages} pages`)
        
        // Extract text from all pages
        let fullText = ""
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum)
          const textContent = await page.getTextContent()
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(" ")
          fullText += pageText + "\n"
        }
        
        parsed = { text: fullText }
        parsingMethod = "pdfjs-dist"
        console.log("PDF parsed successfully with pdfjs-dist")
      } catch (pdfjsError: any) {
        console.error("pdfjs-dist also failed:", pdfjsError)
        
        // Method 3: Simple text extraction fallback
        try {
          // Convert buffer to string and try to extract readable text
          const bufferString = Buffer.from(arr).toString('utf8')
          const textMatch = bufferString.match(/BT\s+([^E]+)ET/g)
          let extractedText = ""
          
          if (textMatch) {
            extractedText = textMatch
              .map(match => match.replace(/BT\s+/, '').replace(/ET/, ''))
              .join(' ')
              .replace(/[^\w\s]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          }
          
          if (extractedText.length > 100) {
            parsed = { text: extractedText }
            parsingMethod = "fallback-extraction"
            console.log("PDF parsed successfully with fallback extraction")
          } else {
            throw new Error("No readable text found in PDF")
          }
        } catch (fallbackError: any) {
          console.error("All parsing methods failed:", fallbackError)
          
          // Check if it's the specific ENOENT error we're seeing
          if (parseError.message && parseError.message.includes("ENOENT")) {
            return Response.json({ 
              error: "PDF parsing failed: Server configuration issue",
              details: "The PDF parsing library encountered a file system error. This appears to be a server-side configuration issue.",
              suggestion: "Please try uploading a different PDF file or contact support if the issue persists.",
              technicalDetails: parseError.message
            }, { status: 500 })
          }
          
          return Response.json({ 
            error: "PDF parsing failed: Unable to extract text from PDF",
            details: "All PDF parsing methods failed. The file may be corrupted, password-protected, or in an unsupported format.",
            suggestion: "Please ensure the PDF contains readable text and is not password-protected."
          }, { status: 500 })
        }
      }
    }
    
    const rawText = (parsed.text || "").replace(/[\u0000-\u001F\u007F]+/g, " ").trim()
    console.log(`Extracted text length: ${rawText.length} characters`)
    
    if (!rawText) {
      console.log("No text extracted from PDF")
      return Response.json({ error: "No text content found in PDF" }, { status: 400 })
    }

    clearRagStore()
    console.log("RAG store cleared")
    
    const chunks = simpleChunk(rawText)
    console.log(`Created ${chunks.length} chunks`)
    
    chunks.forEach((t, i) => ragChunks.push({ id: `c${i}`, text: t }))
    ragEmbeddings.push(
      ...ragChunks.map((c) => ({ id: c.id, vector: pseudoEmbed(c.text) }))
    )
    
    console.log(`Successfully processed ${ragChunks.length} chunks`)

    return Response.json({ 
      ok: true, 
      chunks: ragChunks.length,
      fileName: file.name,
      textLength: rawText.length,
      parsingMethod: parsingMethod
    })
  } catch (e: any) {
    console.error("RAG upload error:", e)
    console.error("Error stack:", e.stack)
    
    // Provide more specific error messages
    let errorMessage = e?.message || "Upload failed"
    
    if (errorMessage.includes("ENOENT")) {
      errorMessage = "Server configuration error: PDF parsing library issue"
    } else if (errorMessage.includes("pdf-parse")) {
      errorMessage = "PDF parsing error: The file may be corrupted or not a valid PDF"
    } else if (errorMessage.includes("memory")) {
      errorMessage = "Memory error: File may be too large to process"
    }
    
    return Response.json({ 
      error: errorMessage,
      details: e?.stack || "No additional details available",
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}



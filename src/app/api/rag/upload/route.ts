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
    
    // Use pdfjs-dist for reliable PDF parsing
    let parsed: any
    let parsingMethod = "pdfjs-dist"
    
    try {
      console.log("Importing PDF.js library...")
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")
      console.log("PDF.js imported successfully")
      
      // Configure PDF.js for serverless environment
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
      
      console.log("Loading PDF document...")
      // Load the PDF document from buffer
      const loadingTask = pdfjsLib.getDocument({ 
        data: arr,
        useSystemFonts: true,
        disableFontFace: true,
        disableRange: true,
        disableStream: true
      })
      
      const pdfDoc = await loadingTask.promise
      console.log(`PDF loaded successfully: ${pdfDoc.numPages} pages`)
      
      // Extract text from all pages
      let fullText = ""
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdfDoc.numPages}`)
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ")
          .trim()
        
        if (pageText) {
          fullText += pageText + "\n"
        }
      }
      
      parsed = { text: fullText }
      console.log(`PDF parsed successfully with pdfjs-dist: ${fullText.length} characters extracted`)
      
    } catch (pdfjsError: any) {
      console.error("PDF.js parsing failed:", pdfjsError)
      
      // Fallback: Simple text extraction from PDF structure
      try {
        console.log("Attempting fallback text extraction...")
        const bufferString = Buffer.from(arr).toString('binary')
        
        // Look for text objects in PDF structure
        const textMatches = bufferString.match(/\(([^)]+)\)/g)
        let extractedText = ""
        
        if (textMatches) {
          extractedText = textMatches
            .map(match => match.slice(1, -1)) // Remove parentheses
            .join(' ')
            .replace(/\\[rn]/g, ' ') // Replace escape sequences
            .replace(/[^\w\s.,!?;:()-]/g, ' ') // Keep only readable characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
        }
        
        if (extractedText.length > 50) {
          parsed = { text: extractedText }
          parsingMethod = "fallback-extraction"
          console.log(`Fallback extraction successful: ${extractedText.length} characters`)
        } else {
          throw new Error("Insufficient text extracted")
        }
        
      } catch (fallbackError: any) {
        console.error("All parsing methods failed:", fallbackError)
        
        return Response.json({ 
          error: "PDF parsing failed: Unable to extract text from PDF",
          details: `PDF.js error: ${pdfjsError.message}. Fallback error: ${fallbackError.message}`,
          suggestion: "Please ensure the PDF contains readable text, is not password-protected, and is not corrupted.",
          technicalInfo: {
            fileSize: arr.length,
            fileName: file.name,
            errorType: "PDF_PARSING_FAILED"
          }
        }, { status: 500 })
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



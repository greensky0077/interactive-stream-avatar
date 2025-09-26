export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { clearRagStore, setRagData } from "@/lib/rag-store"

export const maxDuration = 30

function simpleChunk(text: string, maxLen = 800): string[] {
  const parts: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  
  let currentChunk = ""
  
  for (const sentence of sentences) {
    // If adding this sentence would exceed maxLen, save current chunk and start new one
    if (currentChunk.length + sentence.length > maxLen && currentChunk.length > 0) {
      parts.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    parts.push(currentChunk.trim())
  }
  
  // If no sentences were found, fall back to character-based chunking
  if (parts.length === 0) {
    let start = 0
    while (start < text.length) {
      const end = Math.min(start + maxLen, text.length)
      parts.push(text.slice(start, end).trim())
      start = end
    }
  }
  
  return parts.filter(chunk => chunk.length > 0)
}

function pseudoEmbed(text: string, dim = 128): number[] {
  // Improved pseudo-embedding with word-based features
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  
  // Word frequency features
  const wordFreq: { [key: string]: number } = {}
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  })
  
  // Create features based on word patterns and character distributions
  let featureIndex = 0
  
  // Character-based features (original method)
  for (let i = 0; i < text.length && featureIndex < dim; i++) {
    vec[featureIndex % dim] += text.charCodeAt(i) % 31
    featureIndex++
  }
  
  // Word-based features
  Object.entries(wordFreq).forEach(([word, freq]) => {
    if (featureIndex < dim) {
      // Hash word to feature index
      let hash = 0
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff
      }
      vec[Math.abs(hash) % dim] += freq * 10 // Weight word frequency higher
    }
  })
  
  // Text length and structure features
  if (featureIndex < dim) {
    vec[featureIndex % dim] = text.length / 1000 // Normalize text length
  }
  if (featureIndex + 1 < dim) {
    vec[(featureIndex + 1) % dim] = words.length / 100 // Normalize word count
  }
  
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
      
      // Configure PDF.js for serverless environment - use local worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString()
      
      console.log("Loading PDF document...")
      // Load the PDF document from buffer with better configuration
      const loadingTask = pdfjsLib.getDocument({ 
        data: arr,
        useSystemFonts: false,
        disableFontFace: false,
        disableRange: false,
        disableStream: false,
        verbosity: 0 // Reduce console output
      })
      
      const pdfDoc = await loadingTask.promise
      console.log(`PDF loaded successfully: ${pdfDoc.numPages} pages`)
      
      // Extract text from all pages with better text extraction
      let fullText = ""
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdfDoc.numPages}`)
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        
        // Better text extraction - preserve structure and handle text items properly
        const pageText = textContent.items
          .map((item: any) => {
            if (item.str) {
              return item.str
            }
            return ""
          })
          .filter(text => text.trim().length > 0)
          .join(" ")
          .replace(/\s+/g, " ") // Normalize whitespace
          .trim()
        
        if (pageText) {
          fullText += pageText + "\n\n"
        }
      }
      
      parsed = { text: fullText }
      console.log(`PDF parsed successfully with pdfjs-dist: ${fullText.length} characters extracted`)
      
    } catch (pdfjsError: any) {
      console.error("PDF.js parsing failed:", pdfjsError)
      
      // Fallback: Better text extraction from PDF structure
      try {
        console.log("Attempting fallback text extraction...")
        const bufferString = Buffer.from(arr).toString('binary')
        
        // More comprehensive text extraction patterns
        const patterns = [
          /\(([^)]+)\)/g, // Text in parentheses
          /\[([^\]]+)\]/g, // Text in brackets
          /<<[^>]*\/Length\s+\d+[^>]*>>\s*stream\s*([^>]*?)\s*endstream/g, // Stream content
          /BT\s*([^>]*?)\s*ET/g, // Text objects
        ]
        
        let extractedText = ""
        
        for (const pattern of patterns) {
          const matches = bufferString.match(pattern)
          if (matches) {
            const textFromPattern = matches
              .map(match => {
                // Extract content based on pattern type
                if (pattern.source.includes('\\(([^)]+)\\)')) {
                  return match.slice(1, -1) // Remove parentheses
                } else if (pattern.source.includes('\\[([^\\]]+)\\]')) {
                  return match.slice(1, -1) // Remove brackets
                } else if (pattern.source.includes('stream')) {
                  return match.replace(/^.*?stream\s*/, '').replace(/\s*endstream.*$/, '')
                } else {
                  return match.replace(/^BT\s*/, '').replace(/\s*ET$/, '')
                }
              })
              .join(' ')
              .replace(/\\[rn]/g, ' ') // Replace escape sequences
              .replace(/\\[()]/g, '') // Remove escaped parentheses
              .replace(/[^\w\s.,!?;:()\-@#&]/g, ' ') // Keep more readable characters
              .replace(/\s+/g, ' ') // Normalize whitespace
              .trim()
            
            if (textFromPattern.length > extractedText.length) {
              extractedText = textFromPattern
            }
          }
        }
        
        if (extractedText.length > 100) {
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
    
    // Better text cleaning and processing
    let rawText = parsed.text || ""
    
    // Clean up the text more carefully
    rawText = rawText
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // Remove control characters
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/([.!?])\s*([A-Z])/g, "$1\n$2") // Add line breaks after sentences
      .replace(/\n\s*\n/g, "\n") // Remove empty lines
      .trim()
    
    console.log(`Extracted text length: ${rawText.length} characters`)
    console.log(`Text preview: ${rawText.substring(0, 200)}...`)
    
    if (!rawText || rawText.length < 50) {
      console.log("No meaningful text extracted from PDF")
      return Response.json({ 
        error: "No meaningful text content found in PDF. The PDF may be image-based or corrupted.",
        suggestion: "Please ensure the PDF contains selectable text and is not password-protected."
      }, { status: 400 })
    }

    await clearRagStore()
    console.log("RAG store cleared")
    
    const chunks = simpleChunk(rawText)
    console.log(`Created ${chunks.length} chunks`)
    
    const ragChunks = chunks.map((t, i) => ({ id: `c${i}`, text: t }))
    const ragEmbeddings = ragChunks.map((c) => ({ id: c.id, vector: pseudoEmbed(c.text) }))
    
    await setRagData(ragChunks, ragEmbeddings)
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



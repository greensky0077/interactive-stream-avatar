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
  // Much improved pseudo-embedding with better semantic features
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(w => w.length > 2) // Only words longer than 2 chars
  
  // Word frequency features
  const wordFreq: { [key: string]: number } = {}
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  })
  
  // Common words to weight higher (resume/CV related)
  const importantWords = [
    'experience', 'education', 'skills', 'work', 'job', 'company', 'university', 'degree',
    'project', 'development', 'software', 'engineer', 'developer', 'manager', 'analyst',
    'resume', 'cv', 'curriculum', 'vitae', 'professional', 'career', 'position', 'role',
    'responsibilities', 'achievements', 'certifications', 'languages', 'technical'
  ]
  
  let featureIndex = 0
  
  // Word-based features with better hashing
  Object.entries(wordFreq).forEach(([word, freq]) => {
    if (featureIndex < dim) {
      // Better hash function
      let hash = 0
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff
      }
      
      // Weight important words higher
      const weight = importantWords.includes(word) ? 20 : 5
      vec[Math.abs(hash) % dim] += freq * weight
    }
  })
  
  // N-gram features (bigrams)
  for (let i = 0; i < words.length - 1 && featureIndex < dim; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`
    let hash = 0
    for (let j = 0; j < bigram.length; j++) {
      hash = ((hash << 5) - hash + bigram.charCodeAt(j)) & 0xffffffff
    }
    vec[Math.abs(hash) % dim] += 3
  }
  
  // Character n-gram features
  const charNgrams = []
  for (let i = 0; i < text.length - 2; i++) {
    charNgrams.push(text.slice(i, i + 3).toLowerCase())
  }
  
  const charFreq: { [key: string]: number } = {}
  charNgrams.forEach(ngram => {
    charFreq[ngram] = (charFreq[ngram] || 0) + 1
  })
  
  Object.entries(charFreq).forEach(([ngram, freq]) => {
    if (featureIndex < dim) {
      let hash = 0
      for (let i = 0; i < ngram.length; i++) {
        hash = ((hash << 5) - hash + ngram.charCodeAt(i)) & 0xffffffff
      }
      vec[Math.abs(hash) % dim] += freq
    }
  })
  
  // Text structure features
  if (featureIndex < dim) {
    vec[featureIndex % dim] = text.length / 1000 // Normalize text length
  }
  if (featureIndex + 1 < dim) {
    vec[(featureIndex + 1) % dim] = words.length / 100 // Normalize word count
  }
  if (featureIndex + 2 < dim) {
    vec[(featureIndex + 2) % dim] = Object.keys(wordFreq).length / 50 // Unique words
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
      
      // Configure PDF.js for serverless environment - disable worker for better compatibility
      pdfjsLib.GlobalWorkerOptions.workerSrc = null
      
      console.log("Loading PDF document...")
      // Load the PDF document from buffer with optimized configuration
      const loadingTask = pdfjsLib.getDocument({ 
        data: arr,
        useSystemFonts: true,
        disableFontFace: false,
        disableRange: true,
        disableStream: true,
        verbosity: 0,
        // Additional options for better text extraction
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
      })
      
      const pdfDoc = await loadingTask.promise
      console.log(`PDF loaded successfully: ${pdfDoc.numPages} pages`)
      
      // Extract text from all pages with improved text extraction
      let fullText = ""
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        console.log(`Processing page ${pageNum}/${pdfDoc.numPages}`)
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        
        // Improved text extraction with better content filtering
        const pageText = textContent.items
          .map((item: any) => {
            if (item.str && item.str.trim()) {
              // Filter out PDF metadata and structure
              const text = item.str.trim()
              
              // Skip PDF structure elements
              if (
                text.includes('obj') || 
                text.includes('Type') || 
                text.includes('Subtype') || 
                text.includes('Border') || 
                text.includes('Rect') ||
                text.includes('FontDescriptor') ||
                text.includes('BaseFont') ||
                text.includes('FontName') ||
                text.includes('FontBBox') ||
                text.includes('Flags') ||
                text.includes('ItalicAngle') ||
                text.includes('Ascent') ||
                text.includes('Descent') ||
                text.includes('CapHeight') ||
                text.includes('StemV') ||
                text.includes('XHeight') ||
                text.includes('CharSet') ||
                text.includes('FontFile') ||
                text.includes('Length') ||
                text.includes('Filter') ||
                text.includes('DecodeParms') ||
                text.includes('stream') ||
                text.includes('endstream') ||
                text.includes('xref') ||
                text.includes('trailer') ||
                text.includes('startxref') ||
                text.includes('%%EOF') ||
                text.match(/^\d+\s+\d+\s+obj$/) || // PDF object references
                text.match(/^\d+\s+\d+\s+R$/) || // PDF references
                text.match(/^\/[A-Za-z]+$/) || // PDF commands
                text.length < 2 || // Very short strings
                !/[a-zA-Z]/.test(text) // No letters
              ) {
                return ""
              }
              
              // Add spacing based on text positioning
              const space = item.hasEOL ? '\n' : ' '
              return text + space
            }
            return ""
          })
          .filter(text => text.trim().length > 0) // Remove empty items
          .join("")
          .replace(/\s+/g, " ") // Normalize whitespace
          .replace(/\n\s+/g, "\n") // Clean up line breaks
          .trim()
        
        if (pageText) {
          fullText += pageText + "\n\n"
        }
      }
      
      parsed = { text: fullText }
      console.log(`PDF parsed successfully with pdfjs-dist: ${fullText.length} characters extracted`)
      
    } catch (pdfjsError: any) {
      console.error("PDF.js parsing failed:", pdfjsError)
      
      // Fallback: Advanced text extraction from PDF structure
      try {
        console.log("Attempting fallback text extraction...")
        const bufferString = Buffer.from(arr).toString('binary')
        
        // Multiple extraction strategies
        let extractedText = ""
        
        // Strategy 1: Extract text from PDF text objects (most reliable)
        const textObjectPattern = /BT\s*([^>]*?)\s*ET/g
        const textMatches = bufferString.match(textObjectPattern)
        if (textMatches && textMatches.length > 0) {
          const textFromObjects = textMatches
            .map(match => match.replace(/^BT\s*/, '').replace(/\s*ET$/, ''))
            .filter(text => {
              // Filter out PDF metadata
              const cleanText = text.trim()
              return cleanText.length > 2 && 
                     /[a-zA-Z]/.test(cleanText) && 
                     !cleanText.includes('obj') &&
                     !cleanText.includes('Type') &&
                     !cleanText.includes('Subtype') &&
                     !cleanText.includes('Border') &&
                     !cleanText.includes('Rect') &&
                     !cleanText.includes('FontDescriptor') &&
                     !cleanText.includes('BaseFont') &&
                     !cleanText.includes('FontName') &&
                     !cleanText.includes('FontBBox') &&
                     !cleanText.includes('Flags') &&
                     !cleanText.includes('ItalicAngle') &&
                     !cleanText.includes('Ascent') &&
                     !cleanText.includes('Descent') &&
                     !cleanText.includes('CapHeight') &&
                     !cleanText.includes('StemV') &&
                     !cleanText.includes('XHeight') &&
                     !cleanText.includes('CharSet') &&
                     !cleanText.includes('FontFile') &&
                     !cleanText.includes('Length') &&
                     !cleanText.includes('Filter') &&
                     !cleanText.includes('DecodeParms') &&
                     !cleanText.includes('stream') &&
                     !cleanText.includes('endstream') &&
                     !cleanText.includes('xref') &&
                     !cleanText.includes('trailer') &&
                     !cleanText.includes('startxref') &&
                     !cleanText.includes('%%EOF') &&
                     !cleanText.match(/^\d+\s+\d+\s+obj$/) &&
                     !cleanText.match(/^\d+\s+\d+\s+R$/) &&
                     !cleanText.match(/^\/[A-Za-z]+$/)
            })
            .join(' ')
            .replace(/\\[rn]/g, ' ')
            .replace(/\\[()]/g, '')
            .replace(/[^\w\s.,!?;:()\-@#&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          
          if (textFromObjects.length > extractedText.length) {
            extractedText = textFromObjects
          }
        }
        
        // Strategy 2: Extract text from parentheses (common in PDFs)
        const parenPattern = /\(([^)]+)\)/g
        const parenMatches = bufferString.match(parenPattern)
        if (parenMatches && parenMatches.length > 0) {
          const textFromParens = parenMatches
            .map(match => match.slice(1, -1))
            .filter(text => {
              const cleanText = text.trim()
              return cleanText.length > 2 && 
                     /[a-zA-Z]/.test(cleanText) && 
                     !cleanText.includes('obj') &&
                     !cleanText.includes('Type') &&
                     !cleanText.includes('Subtype') &&
                     !cleanText.includes('Border') &&
                     !cleanText.includes('Rect') &&
                     !cleanText.includes('FontDescriptor') &&
                     !cleanText.includes('BaseFont') &&
                     !cleanText.includes('FontName') &&
                     !cleanText.includes('FontBBox') &&
                     !cleanText.includes('Flags') &&
                     !cleanText.includes('ItalicAngle') &&
                     !cleanText.includes('Ascent') &&
                     !cleanText.includes('Descent') &&
                     !cleanText.includes('CapHeight') &&
                     !cleanText.includes('StemV') &&
                     !cleanText.includes('XHeight') &&
                     !cleanText.includes('CharSet') &&
                     !cleanText.includes('FontFile') &&
                     !cleanText.includes('Length') &&
                     !cleanText.includes('Filter') &&
                     !cleanText.includes('DecodeParms') &&
                     !cleanText.includes('stream') &&
                     !cleanText.includes('endstream') &&
                     !cleanText.includes('xref') &&
                     !cleanText.includes('trailer') &&
                     !cleanText.includes('startxref') &&
                     !cleanText.includes('%%EOF') &&
                     !cleanText.match(/^\d+\s+\d+\s+obj$/) &&
                     !cleanText.match(/^\d+\s+\d+\s+R$/) &&
                     !cleanText.match(/^\/[A-Za-z]+$/)
            })
            .join(' ')
            .replace(/\\[rn]/g, ' ')
            .replace(/[^\w\s.,!?;:()\-@#&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          
          if (textFromParens.length > extractedText.length) {
            extractedText = textFromParens
          }
        }
        
        // Strategy 3: Extract from PDF streams
        const streamPattern = /<<[^>]*\/Length\s+\d+[^>]*>>\s*stream\s*([^>]*?)\s*endstream/g
        const streamMatches = bufferString.match(streamPattern)
        if (streamMatches && streamMatches.length > 0) {
          const textFromStreams = streamMatches
            .map(match => match.replace(/^.*?stream\s*/, '').replace(/\s*endstream.*$/, ''))
            .join(' ')
            .replace(/[^\x20-\x7E]/g, ' ') // Keep only printable ASCII
            .replace(/\s+/g, ' ')
            .trim()
          
          if (textFromStreams.length > extractedText.length) {
            extractedText = textFromStreams
          }
        }
        
        // Strategy 4: Extract from PDF content streams
        const contentPattern = /\/Contents\s*<<[^>]*\/Length\s+\d+[^>]*>>\s*stream\s*([^>]*?)\s*endstream/g
        const contentMatches = bufferString.match(contentPattern)
        if (contentMatches && contentMatches.length > 0) {
          const textFromContent = contentMatches
            .map(match => match.replace(/^.*?stream\s*/, '').replace(/\s*endstream.*$/, ''))
            .join(' ')
            .replace(/[^\x20-\x7E]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          
          if (textFromContent.length > extractedText.length) {
            extractedText = textFromContent
          }
        }
        
        // Strategy 5: Look for readable text patterns
        const readablePattern = /[A-Za-z]{3,}[^A-Za-z]*[A-Za-z]{3,}/g
        const readableMatches = bufferString.match(readablePattern)
        if (readableMatches && readableMatches.length > 0) {
          const textFromReadable = readableMatches
            .join(' ')
            .replace(/[^\w\s.,!?;:()\-@#&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          
          if (textFromReadable.length > extractedText.length) {
            extractedText = textFromReadable
          }
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
        
        // Final fallback: Try to extract any readable text from the binary data
        try {
          console.log("Attempting final fallback: binary text extraction...")
          const binaryString = Buffer.from(arr).toString('utf8', 0, Math.min(arr.length, 1024 * 1024)) // Limit to 1MB
          
          // Look for common text patterns in the binary data
          const textPatterns = [
            /[A-Za-z]{4,}\s+[A-Za-z]{4,}/g, // Words with spaces
            /[A-Za-z]{3,}[0-9]{2,4}/g, // Words with numbers (dates, etc.)
            /[A-Za-z]{3,}@[A-Za-z]{3,}/g, // Email patterns
            /[A-Za-z]{3,}\.[A-Za-z]{2,}/g, // Domain patterns
          ]
          
          let finalText = ""
          for (const pattern of textPatterns) {
            const matches = binaryString.match(pattern)
            if (matches) {
              finalText += matches.join(' ') + ' '
            }
          }
          
          if (finalText.trim().length > 20) {
            parsed = { text: finalText.trim() }
            parsingMethod = "binary-fallback"
            console.log(`Binary fallback successful: ${finalText.length} characters`)
          } else {
            throw new Error("No readable text found in binary data")
          }
          
        } catch (finalError: any) {
          console.error("All extraction methods failed:", finalError)
          
          return Response.json({ 
            error: "PDF parsing failed: Unable to extract text from PDF",
            details: `PDF.js error: ${pdfjsError.message}. Fallback error: ${fallbackError.message}. Final error: ${finalError.message}`,
            suggestion: "Please ensure the PDF contains readable text, is not password-protected, and is not corrupted. Try using a different PDF file.",
            technicalInfo: {
              fileSize: arr.length,
              fileName: file.name,
              errorType: "PDF_PARSING_FAILED"
            }
          }, { status: 500 })
        }
      }
    }
    
    // Advanced text cleaning and processing
    let rawText = parsed.text || ""
    
    console.log(`Raw extracted text length: ${rawText.length} characters`)
    console.log(`Raw text preview: ${rawText.substring(0, 300)}...`)
    
    // Clean up the text more carefully
    rawText = rawText
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // Remove control characters
      .replace(/\\[rn]/g, " ") // Replace escape sequences
      .replace(/\\[()]/g, "") // Remove escaped parentheses
      .replace(/[^\w\s.,!?;:()\-@#&]/g, " ") // Keep only readable characters
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/([.!?])\s*([A-Z])/g, "$1\n$2") // Add line breaks after sentences
      .replace(/\n\s*\n/g, "\n") // Remove empty lines
      .replace(/\s+$/gm, "") // Remove trailing spaces from lines
      .trim()
    
    // Additional cleaning for common PDF artifacts and metadata
    rawText = rawText
      .replace(/\b\w{1,2}\s+/g, " ") // Remove very short words (likely artifacts)
      .replace(/\s+([.!?])/g, "$1") // Fix spacing before punctuation
      .replace(/([a-z])([A-Z])/g, "$1 $2") // Add spaces between camelCase
      .replace(/\b(obj|Type|Subtype|Border|Rect|FontDescriptor|BaseFont|FontName|FontBBox|Flags|ItalicAngle|Ascent|Descent|CapHeight|StemV|XHeight|CharSet|FontFile|Length|Filter|DecodeParms|stream|endstream|xref|trailer|startxref|%%EOF)\b/g, " ") // Remove PDF metadata terms
      .replace(/\b\d+\s+\d+\s+(obj|R)\b/g, " ") // Remove PDF object references
      .replace(/\b\/[A-Za-z]+\b/g, " ") // Remove PDF commands
      .replace(/\s+/g, " ") // Final whitespace normalization
      .trim()
    
    console.log(`Cleaned text length: ${rawText.length} characters`)
    console.log(`Cleaned text preview: ${rawText.substring(0, 300)}...`)
    
    if (!rawText || rawText.length < 30) {
      console.log("No meaningful text extracted from PDF")
      return Response.json({ 
        error: "No meaningful text content found in PDF. The PDF may be image-based, password-protected, or corrupted.",
        suggestion: "Please ensure the PDF contains selectable text and is not password-protected. Try using a different PDF file.",
        parsingMethod: parsingMethod
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
    console.log(`Sample chunks:`, ragChunks.slice(0, 3).map(c => ({ id: c.id, textPreview: c.text.substring(0, 150) })))

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



export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file") as File | null
    
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }
    
    if (file.type !== "application/pdf") {
      return Response.json({ error: "File must be a PDF" }, { status: 400 })
    }
    
    const arr = new Uint8Array(await file.arrayBuffer())
    
    // Test different extraction methods
    const results: any = {
      fileName: file.name,
      fileSize: arr.length,
      methods: {}
    }
    
    // Method 1: PDF.js
    try {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")
      pdfjsLib.GlobalWorkerOptions.workerSrc = null
      
      const loadingTask = pdfjsLib.getDocument({ 
        data: arr,
        useSystemFonts: true,
        disableFontFace: false,
        disableRange: true,
        disableStream: true,
        verbosity: 0
      })
      
      const pdfDoc = await loadingTask.promise
      let fullText = ""
      
      for (let pageNum = 1; pageNum <= Math.min(pdfDoc.numPages, 3); pageNum++) {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        
        const pageText = textContent.items
          .map((item: any) => {
            if (item.str && item.str.trim()) {
              const space = item.hasEOL ? '\n' : ' '
              return item.str + space
            }
            return ""
          })
          .join("")
          .replace(/\s+/g, " ")
          .replace(/\n\s+/g, "\n")
          .trim()
        
        if (pageText) {
          fullText += pageText + "\n\n"
        }
      }
      
      results.methods.pdfjs = {
        success: true,
        textLength: fullText.length,
        textPreview: fullText.substring(0, 500),
        pages: pdfDoc.numPages
      }
    } catch (error: any) {
      results.methods.pdfjs = {
        success: false,
        error: error.message
      }
    }
    
    // Method 2: Binary extraction
    try {
      const binaryString = Buffer.from(arr).toString('utf8', 0, Math.min(arr.length, 1024 * 1024))
      
      const textPatterns = [
        /[A-Za-z]{4,}\s+[A-Za-z]{4,}/g,
        /[A-Za-z]{3,}[0-9]{2,4}/g,
        /[A-Za-z]{3,}@[A-Za-z]{3,}/g,
        /[A-Za-z]{3,}\.[A-Za-z]{2,}/g,
      ]
      
      let extractedText = ""
      for (const pattern of textPatterns) {
        const matches = binaryString.match(pattern)
        if (matches) {
          extractedText += matches.join(' ') + ' '
        }
      }
      
      results.methods.binary = {
        success: true,
        textLength: extractedText.length,
        textPreview: extractedText.substring(0, 500)
      }
    } catch (error: any) {
      results.methods.binary = {
        success: false,
        error: error.message
      }
    }
    
    // Method 3: PDF structure parsing
    try {
      const bufferString = Buffer.from(arr).toString('binary')
      
      const textObjectPattern = /BT\s*([^>]*?)\s*ET/g
      const textMatches = bufferString.match(textObjectPattern)
      
      let extractedText = ""
      if (textMatches && textMatches.length > 0) {
        extractedText = textMatches
          .map(match => match.replace(/^BT\s*/, '').replace(/\s*ET$/, ''))
          .join(' ')
          .replace(/\\[rn]/g, ' ')
          .replace(/\\[()]/g, '')
          .replace(/[^\w\s.,!?;:()\-@#&]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
      
      results.methods.structure = {
        success: true,
        textLength: extractedText.length,
        textPreview: extractedText.substring(0, 500),
        matches: textMatches ? textMatches.length : 0
      }
    } catch (error: any) {
      results.methods.structure = {
        success: false,
        error: error.message
      }
    }
    
    return Response.json(results)
    
  } catch (error: any) {
    return Response.json({ 
      error: error?.message || "Test extraction failed" 
    }, { status: 500 })
  }
}

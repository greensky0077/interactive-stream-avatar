/**
 * Enhanced PDF text extraction that focuses only on readable content
 */

export function extractReadableText(textContent: any): string {
  const allItems = textContent.items.map((item: any) => item.str || "").filter(str => str.trim().length > 0)
  console.log(`Total text items found: ${allItems.length}`)
  console.log(`Sample items:`, allItems.slice(0, 5))
  
  const readableItems = textContent.items
    .map((item: any) => {
      if (!item.str || !item.str.trim()) return ""
      
      const text = item.str.trim()
      
      // Only include text that looks like actual readable content
      if (isReadableContent(text)) {
        return text
      }
      return ""
    })
    .filter(text => text.length > 0)
    .join(" ")
  
  console.log(`Readable items extracted: ${readableItems.split(' ').length} words`)
  console.log(`Readable text preview: ${readableItems.substring(0, 200)}...`)
  
  // If no readable content found, try a more lenient approach
  if (readableItems.trim().length === 0) {
    console.log('No readable content found with strict filtering, trying lenient approach...')
    const lenientItems = textContent.items
      .map((item: any) => {
        if (!item.str || !item.str.trim()) return ""
        const text = item.str.trim()
        
        // More lenient filtering - just exclude obvious PDF metadata
        if (text.length >= 3 && 
            /[a-zA-Z]/.test(text) && 
            !text.includes('obj') && 
            !text.includes('Type') && 
            !text.includes('Subtype') && 
            !text.includes('FontDescriptor') &&
            !text.includes('BaseFont') &&
            !text.includes('FontName') &&
            !text.includes('stream') &&
            !text.includes('endstream') &&
            !text.includes('xref') &&
            !text.includes('trailer') &&
            !text.match(/^\d+\s+\d+\s+obj$/) &&
            !text.match(/^\d+\s+\d+\s+R$/) &&
            !text.match(/^\/[A-Za-z]+$/)) {
          return text
        }
        return ""
      })
      .filter(text => text.length > 0)
      .join(" ")
    
    console.log(`Lenient extraction found: ${lenientItems.split(' ').length} words`)
    console.log(`Lenient text preview: ${lenientItems.substring(0, 200)}...`)
    
    return lenientItems
  }
  
  return readableItems
}

function isReadableContent(text: string): boolean {
  // Must contain letters
  if (!/[a-zA-Z]/.test(text)) return false
  
  // Must be longer than 2 characters
  if (text.length < 3) return false
  
  // Must not be all uppercase (likely PDF commands)
  if (text === text.toUpperCase() && text.length < 10) return false
  
  // Must not contain PDF structure elements
  const pdfStructureElements = [
    'obj', 'Type', 'Subtype', 'Border', 'Rect', 'FontDescriptor', 'BaseFont',
    'FontName', 'FontBBox', 'Flags', 'ItalicAngle', 'Ascent', 'Descent',
    'CapHeight', 'StemV', 'XHeight', 'CharSet', 'FontFile', 'Length',
    'Filter', 'DecodeParms', 'stream', 'endstream', 'xref', 'trailer',
    'startxref', '%%EOF', 'XObject', 'Image', 'ColorSpace', 'Color Space',
    'BitsPerComponent', 'Bits Per Component', 'Width', 'Height', 'Skia',
    'DeviceRGB', 'DeviceGray', 'DeviceCMYK', 'CalRGB', 'CalGray', 'ICCBased',
    'Indexed', 'Pattern', 'Separation', 'DeviceN', 'Lab', 'CMYK', 'RGB',
    'Gray', 'Matrix', 'BBox', 'Resources', 'ProcSet', 'ExtGState', 'Shading',
    'Properties', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox',
    'Rotate', 'ViewerPreferences', 'PageLabels', 'Names', 'Dests', 'PageLayout',
    'PageMode', 'OpenAction', 'AA', 'URI', 'GoTo', 'GoToR', 'GoToE', 'Launch',
    'Thread', 'Sound', 'Movie', 'Hide', 'SubmitForm', 'ResetForm', 'ImportData',
    'JavaScript', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'RichMedia',
    'FDF', 'XFDF', 'EmbeddedFile', 'Markup', 'Popup', 'FreeText', 'Callout',
    'Line', 'Square', 'Circle', 'PolyLine', 'Polygon', 'Highlight', 'Underline',
    'Squiggly', 'StrikeOut', 'Caret', 'Stamp', 'Ink', 'FileAttachment', 'Widget',
    'Screen', 'PrinterMark', 'TrapNet', 'Watermark', '3D', 'Projection',
    'WebCapture', 'Measurement', 'Roboto-Bold', 'Arial-Bold', 'Times-Roman',
    'Helvetica', 'Courier', 'Symbol', 'ZapfDingbats'
  ]
  
  // Check if text contains any PDF structure elements
  for (const element of pdfStructureElements) {
    if (text.includes(element)) return false
  }
  
  // Must not be PDF object references
  if (/^\d+\s+\d+\s+obj$/.test(text)) return false
  if (/^\d+\s+\d+\s+R$/.test(text)) return false
  if (/^\/[A-Za-z]+$/.test(text)) return false
  if (/^\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+$/.test(text)) return false
  if (/^\d+\s+\d+\s+\d+\s+\d+$/.test(text)) return false
  
  // Must contain at least one word that looks like human-readable content
  const words = text.split(/\s+/)
  const readableWords = words.filter(word => {
    if (word.length < 2) return false
    if (!/[a-zA-Z]/.test(word)) return false
    if (word.length > 1 && word === word.toUpperCase() && word.length < 5) return false
    return true
  })
  
  // At least 30% of words should be readable (reduced from 50% to be less restrictive)
  return readableWords.length >= Math.ceil(words.length * 0.3)
}

export function cleanExtractedText(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") // Remove control characters
    .replace(/\\[rn]/g, " ") // Replace escape sequences
    .replace(/\\[()]/g, "") // Remove escaped parentheses
    .replace(/[^\w\s.,!?;:()\-@#&]/g, " ") // Keep only readable characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/([.!?])\s*([A-Z])/g, "$1\n$2") // Add line breaks after sentences
    .replace(/\n\s*\n/g, "\n") // Remove empty lines
    .replace(/\s+$/gm, "") // Remove trailing spaces from lines
    .replace(/\b\w{1,2}\s+/g, " ") // Remove very short words
    .replace(/\s+([.!?])/g, "$1") // Fix spacing before punctuation
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Add spaces between camelCase
    .replace(/\s+/g, " ") // Final whitespace normalization
    .trim()
}

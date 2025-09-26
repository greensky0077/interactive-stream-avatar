import { NextRequest } from "next/server"

const api_token = process.env.HEYGEN_API_KEY

export async function POST(req: NextRequest) {
  if (!api_token) {
    return Response.json({ 
      error: "API token is not defined",
      details: "Please check your HEYGEN_API_KEY environment variable"
    }, { status: 500 })
  }

  let sessionId: string | undefined
  try {
    const body = await req.json()
    sessionId = body?.session_id || body?.sessionId
    if (!sessionId || typeof sessionId !== "string") {
      return Response.json({ 
        error: "session_id is required",
        details: "Please provide a valid session_id in the request body"
      }, { status: 400 })
    }
  } catch {
    return Response.json({ 
      error: "Invalid JSON body",
      details: "Request body must be valid JSON"
    }, { status: 400 })
  }

  try {
    console.log("Keep-alive request for session:", sessionId.substring(0, 10) + "...")
    
    const response = await fetch("https://api.heygen.com/v1/streaming.keep_alive", {
      method: "POST",
      headers: {
        "x-api-key": api_token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ session_id: sessionId }),
    })

    const responseText = await response.text()
    console.log("Keep-alive response status:", response.status)
    console.log("Keep-alive response:", responseText)

    if (!response.ok) {
      let errorData
      try {
        errorData = JSON.parse(responseText)
      } catch {
        errorData = { message: responseText }
      }
      
      return Response.json({ 
        error: `Keep-alive failed (${response.status}): ${errorData.message || response.statusText}`,
        details: `Session: ${sessionId.substring(0, 10)}..., Status: ${response.status}, Response: ${responseText}`,
        sessionId: sessionId.substring(0, 10) + "..."
      }, { status: response.status })
    }

    const data = JSON.parse(responseText)
    console.log("Keep-alive successful for session:", sessionId.substring(0, 10) + "...")
    
    return Response.json({ 
      data,
      sessionId: sessionId.substring(0, 10) + "..."
    })
  } catch (error: any) {
    console.error("Keep-alive error:", error)
    return Response.json({ 
      error: error?.message || "keep_alive error",
      details: "Network or parsing error occurred",
      sessionId: sessionId?.substring(0, 10) + "..." || "unknown"
    }, { status: 500 })
  }
}



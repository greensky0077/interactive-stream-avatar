import { NextRequest } from "next/server"

const api_token = process.env.HEYGEN_API_KEY

export async function POST(req: NextRequest) {
  if (!api_token) {
    return Response.json({ error: "API token is not defined" }, { status: 500 })
  }

  let sessionId: string | undefined
  try {
    const body = await req.json()
    sessionId = body?.session_id || body?.sessionId
    if (!sessionId || typeof sessionId !== "string") {
      return Response.json({ error: "session_id is required" }, { status: 400 })
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const response = await fetch("https://api.heygen.com/v1/streaming.keep_alive", {
      method: "POST",
      headers: {
        "x-api-key": api_token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ session_id: sessionId }),
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = (data && (data.message || data.error)) || response.statusText
      return Response.json({ error: message || "keep_alive failed" }, { status: response.status })
    }
    return Response.json({ data })
  } catch (error: any) {
    return Response.json({ error: error?.message || "keep_alive error" }, { status: 500 })
  }
}



export const runtime = "nodejs"

const api_token = process.env.HEYGEN_API_KEY

export async function POST() {
  if (!api_token) {
    return Response.json({ error: "HEYGEN_API_KEY is not defined" }, { status: 500 })
  }

  try {
    const response = await fetch(
      "https://api.heygen.com/v1/streaming.create_token",
      {
        method: "POST",
        headers: {
          "x-api-key": api_token,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }
    )

    const text = await response.text()
    let data: any = undefined
    try { data = text ? JSON.parse(text) : undefined } catch {}

    if (!response.ok) {
      const message = (data && (data.message || data.error)) || response.statusText || "Request failed"
      return Response.json({ error: message, status: response.status, data }, { status: response.status })
    }

    return Response.json({ data })
  } catch (error: any) {
    const msg = error?.message || "Unexpected error"
    console.error("/api/grab error:", msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}

const api_token = process.env.HEYGEN_API_KEY

export async function POST() {
  if (!api_token) {
    return Response.json({ 
      error: "API token is not defined",
      details: "Please check your HEYGEN_API_KEY environment variable"
    }, { status: 500 })
  }

  try {
    console.log("Creating streaming token with API key:", api_token.substring(0, 10) + "...")
    
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

    const responseText = await response.text()
    console.log("HeyGen API response status:", response.status)
    console.log("HeyGen API response:", responseText)

    if (!response.ok) {
      let errorData
      try {
        errorData = JSON.parse(responseText)
      } catch {
        errorData = { message: responseText }
      }
      
      return Response.json({ 
        error: `HeyGen API error (${response.status}): ${errorData.message || response.statusText}`,
        details: `Status: ${response.status}, Response: ${responseText}`,
        apiKeyPrefix: api_token.substring(0, 10) + "..."
      }, { status: response.status })
    }

    const data = JSON.parse(responseText)
    console.log("Token created successfully:", data.data?.token ? "Yes" : "No")
    
    return Response.json({ 
      data,
      tokenInfo: {
        length: data.data?.token?.length || 0,
        prefix: data.data?.token?.substring(0, 10) + "..." || "No token"
      }
    })
  } catch (error: any) {
    console.error("Token creation error:", error)
    return Response.json({ 
      error: error.message,
      details: "Network or parsing error occurred",
      apiKeyPrefix: api_token.substring(0, 10) + "..."
    }, { status: 500 })
  }
}
